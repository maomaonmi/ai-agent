"""Phase 1 记忆系统单元测试。

覆盖：
    - MemoryEngine：四层记忆（追加账本 / 档案卡 / 摘要 / 滑动窗口）+ 上下文合成器
    - VFSCheckpointStore：VFS 持久化 + zlib 自适应压缩
    - SkillStore：Skill 胶囊 CRUD + 两阶段匹配 + 阈值自动沉淀

前置条件：SessionStore 先实例化以创建 5 张表（含 FK 约束），三个被测模块共享同一 SQLite。
"""

from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from memory_engine import FAR_FUTURE, MemoryEngine, _estimate_tokens
from session_memory import SessionStore
from skill_store import SkillCapsule, SkillStore
from vfs_checkpoint import VFSCheckpointStore


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------


@pytest.fixture
def setup(tmp_path):
    """创建共享同一 SQLite 的全套记忆系统组件 + 一个会话。

    Why: 5 张扩展表由 SessionStore._initialize() 创建（含 session_id FK 约束），
    必须先实例化；raw_event_ledger / profile_cards / conversation_summaries /
    vfs_checkpoints 的 session_id 必须在 sessions 表中存在，否则 FK 校验失败。
    """
    db_path = tmp_path / "memory.db"
    session_store = SessionStore(db_path)
    session = session_store.create("standard", title="测试会话")
    engine = MemoryEngine(db_path)
    vfs_store = VFSCheckpointStore(db_path)
    skill_store = SkillStore(db_path)
    return SimpleNamespace(
        db_path=db_path,
        session_store=session_store,
        session=session,
        engine=engine,
        vfs_store=vfs_store,
        skill_store=skill_store,
    )


# ==================================================================
# MemoryEngine 测试
# ==================================================================


def test_dual_timestamp_interrupt(setup):
    """双时间戳打断与恢复：同字段二次写入后旧记录失效、新记录生效。"""
    sid = setup.session.session_id
    engine = setup.engine

    assert engine.update_profile_field(sid, "tech_stack", "React", source="inferred")
    time.sleep(0.02)
    assert engine.update_profile_field(sid, "tech_stack", "Vue", source="explicit")

    # 当前生效画像只含 Vue
    profile = engine.get_valid_profile(sid)
    assert profile.get("tech_stack") == "Vue"

    # 历史含两条：新（生效）在前，旧（失效）在后
    history = engine.get_profile_history(sid, "tech_stack")
    assert len(history) == 2
    assert history[0]["field_value"] == "Vue"
    assert history[1]["field_value"] == "React"

    now = time.time()
    # 新记录 valid_end == FAR_FUTURE（生效中）
    assert history[0]["valid_end"] == FAR_FUTURE
    assert history[0]["valid_end"] > now
    # 旧记录 valid_end < now（已被打断失效）
    assert history[1]["valid_end"] < now
    # 打断时间 >= 旧记录写入时间（valid_end 在 valid_start 之后）
    assert history[1]["valid_end"] >= history[1]["valid_start"]


def test_ledger_append_only(setup):
    """追加账本：写入 3 条事件，query_events 按 created_at DESC 返回。"""
    sid = setup.session.session_id
    engine = setup.engine

    events = [
        ("user_input", {"text": "第一条"}),
        ("ai_reply", {"text": "第二条"}),
        ("tool_call", {"name": "search", "text": "第三条"}),
    ]
    for etype, edata in events:
        assert engine.record_event(sid, etype, edata) is True
        time.sleep(0.02)

    result = engine.query_events(sid, limit=50)
    assert len(result) == 3
    # DESC 排序：最后写入的在前
    assert result[0]["event_type"] == "tool_call"
    assert result[1]["event_type"] == "ai_reply"
    assert result[2]["event_type"] == "user_input"
    # event_data 正确反序列化为 dict
    assert result[0]["event_data"]["text"] == "第三条"
    assert result[2]["event_data"]["text"] == "第一条"
    # created_at 严格递减
    assert result[0]["created_at"] >= result[1]["created_at"] >= result[2]["created_at"]


def test_summary_roundtrip(setup):
    """摘要往返 + topics 反序列化：save → get_recent 字段一致。"""
    sid = setup.session.session_id
    engine = setup.engine

    ok = engine.save_summary(sid, 0, 8, "讨论了React 状态管理方案", ["react", "state"])
    assert ok is True

    summary = engine.get_recent_summary(sid)
    assert summary is not None
    assert summary["turn_start"] == 0
    assert summary["turn_end"] == 8
    assert summary["summary_text"] == "讨论了React 状态管理方案"
    assert summary["topics"] == ["react", "state"]
    assert isinstance(summary["topics"], list)


def test_maybe_summarize_below_threshold_noop(setup):
    """§5.1：未达双阈值（<8 轮且 ≤6000 token）时不触发，无摘要落库。"""
    sid = setup.session.session_id
    engine = setup.engine

    for i in range(3):
        engine.record_event(sid, "ai_reply", {"instruction": f"指令{i}", "summary": f"结果{i}"})

    assert engine.maybe_summarize(sid) is False
    assert engine.get_recent_summary(sid) is None


def test_maybe_summarize_turn_threshold_triggers(setup):
    """§5.1：未摘要 ≥8 轮触发；压缩保留最近 4 条原文；二次调用幂等不重复。"""
    sid = setup.session.session_id
    engine = setup.engine

    for i in range(8):
        engine.record_event(
            sid, "ai_reply", {"instruction": f"添加功能{i}", "summary": f"完成第{i}次修改"}
        )

    assert engine.maybe_summarize(sid) is True
    summary = engine.get_recent_summary(sid)
    assert summary is not None
    # 8 条事件保留最近 4 条 → 压缩区间 [1, 4]
    assert summary["turn_start"] == 1
    assert summary["turn_end"] == 4
    # 降级截断路径（未注入 llm_compress）：摘要来自摘要素材
    assert "指令" in summary["summary_text"]
    assert isinstance(summary["topics"], list)

    # 幂等：已覆盖区间不重复压缩
    assert engine.maybe_summarize(sid) is False
    assert len(engine.get_all_summaries(sid)) == 1


def test_maybe_summarize_token_threshold_triggers(setup):
    """§5.1：轮数不足但内容 >6000 token 时触发（突发长对话场景）。"""
    sid = setup.session.session_id
    engine = setup.engine

    # 3 轮（<8）但每条 summary 约 6250 token（25000 英文字符 / 4）
    for i in range(3):
        engine.record_event(sid, "ai_reply", {"instruction": f"指令{i}", "summary": "x" * 25_000})
        engine.record_event(sid, "vfs_change", {"changed_files": [f"f{i}.txt"]})

    assert engine.maybe_summarize(sid) is True
    summary = engine.get_recent_summary(sid)
    assert summary is not None
    # 6 条事件保留最近 4 条 → 压缩区间 [1, 2]
    assert summary["turn_end"] == 2


def test_maybe_summarize_llm_compress_injected(setup):
    """§5.1：注入 llm_compress 时使用 LLM 压缩结果作为摘要文本。"""
    sid = setup.session.session_id
    engine = setup.engine

    for i in range(8):
        engine.record_event(sid, "ai_reply", {"instruction": f"指令{i}", "summary": f"结果{i}"})

    calls: list[str] = []

    def fake_llm(digest: str) -> str:
        calls.append(digest)
        return "LLM 压缩后的结构化摘要"

    assert engine.maybe_summarize(sid, llm_compress=fake_llm) is True
    assert len(calls) == 1
    assert "指令" in calls[0]  # 摘要素材含指令行
    summary = engine.get_recent_summary(sid)
    assert summary is not None
    assert summary["summary_text"] == "LLM 压缩后的结构化摘要"


def test_maybe_summarize_llm_failure_falls_back_to_truncation(setup):
    """R1：llm_compress 连续失败（重试 3 次）后降级为截断素材，不抛异常。"""
    sid = setup.session.session_id
    engine = setup.engine

    for i in range(8):
        engine.record_event(sid, "ai_reply", {"instruction": f"指令{i}", "summary": f"结果{i}"})

    attempts = {"count": 0}

    def broken_llm(digest: str) -> str:
        attempts["count"] += 1
        raise RuntimeError("LLM 不可用")

    assert engine.maybe_summarize(sid, llm_compress=broken_llm) is True
    assert attempts["count"] == 3  # 重试 3 次后放弃
    summary = engine.get_recent_summary(sid)
    assert summary is not None
    # 降级截断：非空且 ≤ 2000 字符
    assert 0 < len(summary["summary_text"]) <= 2000


def test_sliding_window(setup):
    """滑动窗口：尾部截取 K 条；空列表与 k<=0 返回空。"""
    sid = setup.session.session_id
    engine = setup.engine

    messages = [{"role": "user", "content": f"消息{i}"} for i in range(10)]

    # k=6 → 最后 6 条
    window = engine.get_sliding_window(sid, messages, k=6)
    assert len(window) == 6
    assert window[0]["content"] == "消息4"
    assert window[-1]["content"] == "消息9"

    # 空列表 → []
    assert engine.get_sliding_window(sid, [], k=6) == []

    # k=0 → []
    assert engine.get_sliding_window(sid, messages, k=0) == []

    # k 负数 → []
    assert engine.get_sliding_window(sid, messages, k=-1) == []


def test_build_context_token_budget(setup):
    """上下文合成器 token 预算：大数据量下 build_context 结果 ≤ 3500 token。

    Why: 四层各有硬预算（500+800+2000=3300），加头部/输入容差上限 3500。
    """
    sid = setup.session.session_id
    engine = setup.engine

    # 50 个档案卡字段（远超 500 token 档案预算，触发裁剪）
    for i in range(50):
        engine.update_profile_field(sid, f"field_{i}", f"value_{i}" * 20)

    # 长摘要（远超 800 token 摘要预算，触发二分截断）
    long_summary = "这是一段很长的摘要内容需要被截断处理。" * 100
    engine.save_summary(sid, 0, 100, long_summary, ["topic_a", "topic_b"])

    # 10 轮长对话 = 20 条消息（远超 2000 token 窗口预算，触发尾部裁剪）
    messages: list[dict[str, object]] = []
    for i in range(10):
        messages.append(
            {"role": "user", "content": f"用户第{i}轮提问" + "详细描述" * 50}
        )
        messages.append(
            {"role": "assistant", "content": f"AI第{i}轮回答" + "详细回复" * 50}
        )

    context = engine.build_context(sid, "当前用户输入", messages)

    # 三段都被填充（裁剪未完全清空）
    assert "项目档案卡" in context
    assert "最近对话摘要" in context
    assert "最近对话" in context

    token_count = _estimate_tokens(context)
    # 硬预算 3300 + 头部/输入容差 ≤ 3500
    assert token_count <= 3500, f"context token {token_count} 超过 3500 预算"


def test_build_context_empty(setup):
    """空会话上下文：无任何记忆数据时 build_context 不抛异常，含用户输入。"""
    sid = setup.session.session_id
    engine = setup.engine

    context = engine.build_context(sid, "你好", [])

    assert isinstance(context, str)
    assert "你好" in context
    assert "当前用户输入" in context
    # 无档案卡 / 摘要 / 对话段
    assert "项目档案卡" not in context
    assert "最近对话摘要" not in context
    assert "最近对话" not in context


# ==================================================================
# 手动删除 + 会话清空 + 定期清理 + 重复检测 测试
# ==================================================================


def test_delete_summary(setup):
    """行级删除摘要：命中返回 True 且列表减少；不存在 id 返回 False。"""
    sid = setup.session.session_id
    engine = setup.engine

    assert engine.save_summary(sid, 0, 4, "摘要A", ["a"])
    assert engine.save_summary(sid, 5, 9, "摘要B", ["b"])
    summaries = engine.get_all_summaries(sid)
    assert len(summaries) == 2

    assert engine.delete_summary(summaries[0]["summary_id"])
    remaining = engine.get_all_summaries(sid)
    assert len(remaining) == 1
    assert remaining[0]["summary_text"] == "摘要A"  # ORDER BY DESC：剩较旧的 A

    assert not engine.delete_summary(999999)


def test_delete_profile_card_only_inactive(setup):
    """档案卡删除约束：生效中卡拒绝删除，失效卡可删。"""
    sid = setup.session.session_id
    engine = setup.engine

    engine.update_profile_field(sid, "project.name", "v1")
    engine.update_profile_field(sid, "project.name", "v2")  # v1 卡失效

    history = engine.get_profile_history(sid, "project.name")
    assert len(history) == 2
    inactive = [c for c in history if c["valid_end"] != FAR_FUTURE]
    assert len(inactive) == 1

    # 生效中卡拒绝删除
    active_id = next(c["card_id"] for c in history if c["valid_end"] == FAR_FUTURE)
    assert not engine.delete_profile_card(int(active_id))
    assert engine.get_valid_profile(sid)["project.name"] == "v2"  # 生效卡未被误删

    # 失效卡可删
    assert engine.delete_profile_card(int(inactive[0]["card_id"]))
    assert len(engine.get_profile_history(sid, "project.name")) == 1


def test_clear_session_memory(setup):
    """会话级清空：四表清空返回统计，全局 skill 资产不受影响。"""
    sid = setup.session.session_id
    engine = setup.engine

    engine.record_event(sid, "user_input", {"text": "你好"})
    engine.save_summary(sid, 0, 4, "摘要", ["t"])
    engine.update_profile_field(sid, "k", "v")
    setup.vfs_store.save_checkpoint(sid, "run", {"a.py": "x"}, "manual")
    # 全局 skill（跨会话资产）
    setup.skill_store.create_skill(
        skill_name="s",
        skill_type="code_pattern",
        trigger_condition="t",
        trigger_keywords=["t"],
        standard_steps=["a"],
    )

    result = engine.clear_session_memory(sid)
    assert result == {
        "events": 1, "summaries": 1, "profile_cards": 1, "vfs_checkpoints": 1,
    }
    assert engine.query_events(sid) == []
    assert engine.get_all_summaries(sid) == []
    assert engine.get_profile_history(sid, "k") == []
    assert setup.vfs_store.list_checkpoints(sid) == []
    assert len(setup.skill_store.list_skills()) == 1  # skill 不在清理范围

    # 空会话幂等
    assert engine.clear_session_memory("nonexistent-session") == {
        "events": 0, "summaries": 0, "profile_cards": 0, "vfs_checkpoints": 0,
    }


def test_event_retention_keeps_recent_500(setup):
    """惰性定期清理：事件账本每会话仅保留最近 500 条。"""
    from memory_engine import _EVENT_KEEP_PER_SESSION

    sid = setup.session.session_id
    engine = setup.engine

    for i in range(_EVENT_KEEP_PER_SESSION + 5):
        engine.record_event(sid, "user_input", {"text": f"msg-{i}"})

    events = engine.query_events(sid, limit=_EVENT_KEEP_PER_SESSION + 10)
    assert len(events) == _EVENT_KEEP_PER_SESSION
    # 保尾策略：query_events 为 DESC 序，首条为最新
    assert events[0]["event_data"] == {"text": f"msg-{_EVENT_KEEP_PER_SESSION + 4}"}


def test_summary_retention_keeps_recent_20(setup):
    """惰性定期清理：摘要每会话仅保留最近 20 条。"""
    from memory_engine import _SUMMARY_KEEP_PER_SESSION

    sid = setup.session.session_id
    engine = setup.engine

    for i in range(_SUMMARY_KEEP_PER_SESSION + 2):
        assert engine.save_summary(sid, i, i + 1, f"摘要-{i}", [])

    summaries = engine.get_all_summaries(sid)
    assert len(summaries) == _SUMMARY_KEEP_PER_SESSION
    # ORDER BY created_at DESC：首条为最新
    assert summaries[0]["summary_text"] == f"摘要-{_SUMMARY_KEEP_PER_SESSION + 1}"


def test_maybe_summarize_skips_duplicate_summary(setup):
    """摘要重复检测：压缩结果与最近摘要规范化文本一致时跳过落库。

    Why 构造方式: 压缩区间 = total-4（保留最近 4 条原文），两次触发需区间等长
    且内容相同才能保证 digest 一致。第一批 8 条 → 覆盖 [1,4]（4 条）；第二批
    4 条 → total=12，覆盖 [5,8]（同为 4 条相同事件）。第二次触发靠 token 阈值
    （turns=4<8 但内容超长），digest 与首次摘要一致 → 去重跳过。
    """
    sid = setup.session.session_id
    engine = setup.engine
    reply = {"instruction": "相同指令", "summary": "很长的结果" * 500}

    for _ in range(8):
        engine.record_event(sid, "ai_reply", reply)
    assert engine.maybe_summarize(sid) is True
    assert len(engine.get_all_summaries(sid)) == 1

    for _ in range(4):
        engine.record_event(sid, "ai_reply", reply)
    assert engine.maybe_summarize(sid) is False  # 重复摘要被跳过
    assert len(engine.get_all_summaries(sid)) == 1


def test_skill_dedup_normalized_trigger(setup):
    """Skill 沉淀规范化去重：标点/大小写变体命中已有胶囊，不重复落库。"""
    store = setup.skill_store

    first = store.maybe_create_skill_from_success(
        trigger_condition="帮我添加搜索框",
        trigger_keywords=["搜索框"],
        standard_steps=["s1", "s2", "s3"],
    )
    # 第一次 success_count=1，未达阈值
    assert first is None
    assert len(store.list_skills()) == 1

    # 带标点变体 → 命中同一胶囊，success_count 推进到 2 并返回成熟胶囊
    second = store.maybe_create_skill_from_success(
        trigger_condition="帮我添加搜索框！",
        trigger_keywords=["搜索框"],
        standard_steps=["s1", "s2", "s3"],
    )
    assert second is not None
    assert second.success_count == 2
    assert len(store.list_skills()) == 1  # 无重复落库
    # 原文保留（审计语义不破坏）
    assert store.list_skills()[0].trigger_condition == "帮我添加搜索框"


def test_vfs_delete_checkpoint(setup):
    """行级删除 checkpoint：命中返回 True；不存在 id 返回 False。"""
    sid = setup.session.session_id
    store = setup.vfs_store

    cp_id = store.save_checkpoint(sid, "run", {"a.py": "x"}, "manual")
    assert store.list_checkpoints(sid)[0]["checkpoint_id"] == cp_id

    assert store.delete_checkpoint(cp_id)
    assert store.list_checkpoints(sid) == []
    assert not store.delete_checkpoint(cp_id)  # 已删除 → False


def test_vfs_checkpoint_roundtrip(setup):
    """VFS 序列化/反序列化无损往返（含中文路径与内容）。"""
    sid = setup.session.session_id
    vfs_store = setup.vfs_store

    original_vfs = {
        "src/组件.tsx": "export const 组件 = () => <div>你好</div>;",
        "src/工具/中文.ts": "# 中文注释\nprint('你好世界')",
        "README.md": "# 项目说明\n这是测试。",
        "docs/设计文档.md": "## 架构设计\n详细内容...",
        "src/index.ts": "console.log('入口');",
        "src/页面/首页.tsx": "export default 首页;",
        "config/配置.json": '{"key": "值"}',
        "src/样式.css": ".app { color: red; }",
        "tests/测试.test.ts": "test('测试', () => {});",
        "src/数据/列表.json": "[1, 2, 3]",
    }

    checkpoint_id = vfs_store.save_checkpoint(
        sid, "run-1", original_vfs, trigger_reason="manual"
    )
    assert isinstance(checkpoint_id, int)
    assert checkpoint_id > 0

    result = vfs_store.restore_vfs(sid)
    assert result is not None
    restored_vfs, restored_id = result
    assert restored_id == checkpoint_id
    assert restored_vfs == original_vfs


def test_vfs_compression(setup):
    """大 VFS zlib 压缩：> 100KB 时 is_compressed=1，且无损恢复。"""
    sid = setup.session.session_id
    vfs_store = setup.vfs_store

    # JSON 序列化后 > 100KB（COMPRESS_THRESHOLD = 100_000）
    big_content = "x" * 120_000
    big_vfs = {"large_file.txt": big_content, "other.txt": "小文件"}

    checkpoint_id = vfs_store.save_checkpoint(
        sid, "run-big", big_vfs, trigger_reason="manual"
    )
    assert checkpoint_id > 0

    # 通过 list_checkpoints 验证 is_compressed 标志
    checkpoints = vfs_store.list_checkpoints(sid)
    assert len(checkpoints) == 1
    assert checkpoints[0]["is_compressed"] is True

    # 无损恢复
    result = vfs_store.restore_vfs(sid)
    assert result is not None
    restored_vfs, _ = result
    assert restored_vfs == big_vfs
    assert restored_vfs["large_file.txt"] == big_content


def test_vfs_small_no_compression(setup):
    """小 VFS 不压缩：< 100KB 时 is_compressed=0，且无损恢复。"""
    sid = setup.session.session_id
    vfs_store = setup.vfs_store

    small_vfs = {"small.txt": "hello world", "readme.md": "# 小文件"}

    checkpoint_id = vfs_store.save_checkpoint(
        sid, "run-small", small_vfs, trigger_reason="manual"
    )
    assert checkpoint_id > 0

    checkpoints = vfs_store.list_checkpoints(sid)
    assert len(checkpoints) == 1
    assert checkpoints[0]["is_compressed"] is False

    result = vfs_store.restore_vfs(sid)
    assert result is not None
    restored_vfs, _ = result
    assert restored_vfs == small_vfs


def test_vfs_cleanup(setup):
    """清理旧 checkpoint：写入 15 个（manual 不限频），自动回收后保留 MAX_KEEP。"""
    sid = setup.session.session_id
    vfs_store = setup.vfs_store

    for i in range(15):
        vfs_store.save_checkpoint(
            sid, f"run-{i}", {f"file_{i}.txt": f"content_{i}"}, trigger_reason="manual"
        )
        time.sleep(0.02)

    # save_checkpoint 内已按 MAX_KEEP(=10) 自动回收，无需手动 cleanup。
    remaining = vfs_store.list_checkpoints(sid, limit=50)
    assert len(remaining) == vfs_store.MAX_KEEP


def test_vfs_rate_limit_throttles_auto(setup):
    """R3 限频：auto/post_patch 在 MIN_SAVE_INTERVAL 内重复写入被合并（覆盖而非新增）。

    Why 覆盖语义: 跳过会丢失最新 VFS 恢复点；覆盖最近一条自动类 checkpoint 既控制
    行数增长，又保证 restore_vfs 永远拿到最新状态。
    """
    sid = setup.session.session_id
    vfs_store = setup.vfs_store

    first = vfs_store.save_checkpoint(sid, "run-a", {"a.txt": "1"}, trigger_reason="auto")
    assert first > 0
    # 间隔 < 5s，第二次 auto 被合并到第一条（返回同一 checkpoint_id）。
    second = vfs_store.save_checkpoint(sid, "run-b", {"a.txt": "2"}, trigger_reason="auto")
    assert second == first
    # 仅保留 1 条记录，且内容为最新 VFS。
    checkpoints = vfs_store.list_checkpoints(sid)
    assert len(checkpoints) == 1
    assert checkpoints[0]["run_id"] == "run-b"
    restored = vfs_store.restore_vfs(sid)
    assert restored is not None
    assert restored[0] == {"a.txt": "2"}


def test_vfs_rate_limit_never_coalesces_manual_or_pre_patch(setup):
    """R3 限频合并查询限定自动类：pre_patch/manual 安全网行永不被自动类写入覆盖。"""
    sid = setup.session.session_id
    vfs_store = setup.vfs_store

    # 先落一条 pre_patch 安全网，紧跟着 post_patch 不得合并进它。
    pre = vfs_store.save_checkpoint(sid, "run-pre", {"a.txt": "before"}, trigger_reason="pre_patch")
    post = vfs_store.save_checkpoint(sid, "run-post", {"a.txt": "after"}, trigger_reason="post_patch")
    assert post != pre
    checkpoints = vfs_store.list_checkpoints(sid)
    assert len(checkpoints) == 2
    # DESC：post_patch 在前，pre_patch 安全网内容完好。
    assert checkpoints[0]["trigger_reason"] == "post_patch"
    assert checkpoints[1]["trigger_reason"] == "pre_patch"

    # 再次 post_patch（间隔 < 5s）→ 合并进上一条 post_patch，pre_patch 仍不动。
    post2 = vfs_store.save_checkpoint(sid, "run-post2", {"a.txt": "after2"}, trigger_reason="post_patch")
    assert post2 == post
    checkpoints = vfs_store.list_checkpoints(sid)
    assert len(checkpoints) == 2
    assert checkpoints[0]["run_id"] == "run-post2"
    # pre_patch 内容仍是 before（未被 clobber）——恢复历史锚点完好。
    history = vfs_store.list_checkpoints(sid, limit=10)
    pre_row = next(c for c in history if c["trigger_reason"] == "pre_patch")
    assert pre_row["run_id"] == "run-pre"


def test_vfs_rate_limit_skips_manual_and_pre_patch(setup):
    """R3 限频：manual / pre_patch 不受限，即使间隔 < MIN_SAVE_INTERVAL 也落盘。"""
    sid = setup.session.session_id
    vfs_store = setup.vfs_store

    a = vfs_store.save_checkpoint(sid, "run-a", {"a.txt": "1"}, trigger_reason="manual")
    b = vfs_store.save_checkpoint(sid, "run-b", {"a.txt": "2"}, trigger_reason="pre_patch")
    assert a > 0 and b > 0
    assert len(vfs_store.list_checkpoints(sid)) == 2


# ==================================================================
# SkillStore 测试
# ==================================================================


def test_skill_crud(setup):
    """Skill CRUD 往返：create → get → list → delete。"""
    skill_store = setup.skill_store

    skill = skill_store.create_skill(
        skill_name="react_component_gen",
        skill_type="code_pattern",
        trigger_condition="生成 React 组件",
        trigger_keywords=["react", "组件"],
        standard_steps=["分析需求", "生成代码", "验证"],
        required_params=["component_name"],
        validation_rules=["必须导出组件"],
        sample_envelope="sample",
    )

    # get_skill 字段一致
    fetched = skill_store.get_skill(skill.skill_id)
    assert fetched is not None
    assert fetched.skill_id == skill.skill_id
    assert fetched.skill_name == "react_component_gen"
    assert fetched.skill_type == "code_pattern"
    assert fetched.trigger_condition == "生成 React 组件"
    assert fetched.trigger_keywords == ["react", "组件"]
    assert fetched.standard_steps == ["分析需求", "生成代码", "验证"]
    assert fetched.required_params == ["component_name"]
    assert fetched.validation_rules == ["必须导出组件"]
    assert fetched.sample_envelope == "sample"
    assert fetched.success_count == 0
    assert fetched.failure_count == 0

    # list_skills 返回所有
    skills = skill_store.list_skills()
    assert len(skills) == 1
    assert skills[0].skill_id == skill.skill_id

    # delete → get_skill 返回 None
    assert skill_store.delete_skill(skill.skill_id) is True
    assert skill_store.get_skill(skill.skill_id) is None
    # 重复删除返回 False
    assert skill_store.delete_skill(skill.skill_id) is False


def test_skill_quick_match(setup):
    """关键词快速匹配：命中/不命中 + 阈值过滤（success_count < 2 不参与）。"""
    skill_store = setup.skill_store

    # 达阈值 Skill（success_count=2 >= AUTO_CREATE_THRESHOLD=2）
    skill_qualified = skill_store.create_skill(
        skill_name="react_skill",
        skill_type="code_pattern",
        trigger_condition="生成 React 组件",
        trigger_keywords=["react", "组件"],
        standard_steps=["step1"],
    )
    skill_store.record_success(skill_qualified.skill_id)
    skill_store.record_success(skill_qualified.skill_id)
    assert skill_store.get_skill(skill_qualified.skill_id).success_count == 2

    # 未达阈值 Skill（success_count=1 < 2）
    skill_unqualified = skill_store.create_skill(
        skill_name="python_skill",
        skill_type="code_pattern",
        trigger_condition="写 Python 脚本",
        trigger_keywords=["python", "脚本"],
        standard_steps=["step1"],
    )
    skill_store.record_success(skill_unqualified.skill_id)
    assert skill_store.get_skill(skill_unqualified.skill_id).success_count == 1

    # 命中：输入含 "react" 和 "组件"
    matched = skill_store.quick_match("帮我生成一个react组件")
    assert len(matched) == 1
    assert matched[0].skill_id == skill_qualified.skill_id

    # 不命中：python 关键词虽匹配，但 success_count=1 未达阈值被过滤
    no_match = skill_store.quick_match("帮我写一个python脚本")
    assert no_match == []


def test_skill_match_skills_no_llm(setup):
    """两阶段匹配无 LLM：有候选返回 quick_match 结果；无候选返回空列表。"""
    skill_store = setup.skill_store

    # 创建达阈值的 Skill
    skill = skill_store.create_skill(
        skill_name="matchable_skill",
        skill_type="code_pattern",
        trigger_condition="可匹配任务",
        trigger_keywords=["匹配", "test"],
        standard_steps=["step1"],
    )
    skill_store.record_success(skill.skill_id)
    skill_store.record_success(skill.skill_id)

    # 有候选但 llm_matcher=None → 直接返回 quick_match 结果
    matched = skill_store.match_skills("这是一个匹配test的请求", llm_matcher=None)
    assert len(matched) == 1
    assert matched[0].skill_id == skill.skill_id

    # 无候选 → 返回空列表（不调 LLM）
    no_match = skill_store.match_skills("完全无关的内容xyz", llm_matcher=None)
    assert no_match == []


def test_skill_auto_create(setup):
    """自动沉淀：三次同 trigger 调用的阈值演进（None → Skill → Skill）。"""
    skill_store = setup.skill_store

    trigger = "自动沉淀触发条件"
    keywords = ["auto", "沉淀"]
    steps = ["step1", "step2"]

    # 第一次：创建新 Skill，success_count=1 < 2 → None
    result1 = skill_store.maybe_create_skill_from_success(
        trigger_condition=trigger,
        trigger_keywords=keywords,
        standard_steps=steps,
    )
    assert result1 is None
    existing = skill_store._find_by_trigger_condition(trigger)
    assert existing is not None
    assert existing.success_count == 1

    # 第二次：success_count=2 >= 2 → 返回 Skill
    result2 = skill_store.maybe_create_skill_from_success(
        trigger_condition=trigger,
        trigger_keywords=keywords,
        standard_steps=steps,
    )
    assert result2 is not None
    assert result2.success_count == 2
    assert result2.trigger_condition == trigger

    # 第三次：success_count=3 >= 2 → 返回 Skill
    result3 = skill_store.maybe_create_skill_from_success(
        trigger_condition=trigger,
        trigger_keywords=keywords,
        standard_steps=steps,
    )
    assert result3 is not None
    assert result3.success_count == 3

    # 全程只创建了一个 Skill（同一 trigger_condition 复用）
    all_skills = skill_store.list_skills()
    assert len(all_skills) == 1
    assert all_skills[0].skill_id == result3.skill_id
