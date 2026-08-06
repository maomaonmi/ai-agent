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
# VFSCheckpointStore 测试
# ==================================================================


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
        sid, "run-big", big_vfs, trigger_reason="auto"
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
    """清理旧 checkpoint：写入 15 个，cleanup(keep=10) 删除 5 个。"""
    sid = setup.session.session_id
    vfs_store = setup.vfs_store

    for i in range(15):
        vfs_store.save_checkpoint(
            sid, f"run-{i}", {f"file_{i}.txt": f"content_{i}"}, trigger_reason="auto"
        )
        time.sleep(0.02)

    assert len(vfs_store.list_checkpoints(sid, limit=50)) == 15

    deleted = vfs_store.cleanup_old_checkpoints(sid, keep=10)
    assert deleted == 5

    remaining = vfs_store.list_checkpoints(sid, limit=50)
    assert len(remaining) == 10


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
