"""Phase 2 记忆系统集成测试。

覆盖目标（来自 PLAN/memory_engine_plan.md T2.6）：
    - VFS 压缩在真实 patch 流程中的表现
    - Skill 匹配在真实请求中的表现

Why: 单元测试（test_memory_engine.py）只覆盖各 store 的孤立行为；
集成测试需要验证 _record_patch_success 这个"统一落账 helper"在真实 stream
函数退出点被调用时，能正确驱动 MemoryEngine + VFSCheckpointStore + SkillStore
三件套，并产生可观测的副作用（checkpoint 落盘 / Skill 自动沉淀 / 事件追加）。
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from App import (
    _build_memory_prompt_suffix,
    _record_patch_success,
    fullstack_patch_stream,
)
from memory_engine import MemoryEngine
from session_memory import SessionStore
from skill_store import SkillStore
from vfs_checkpoint import VFSCheckpointStore


# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------


@pytest.fixture
def memory_stack(tmp_path):
    """创建共享同一 SQLite 的全套记忆系统组件 + 一个会话。

    Why: 5 张扩展表由 SessionStore._initialize() 创建（含 session_id FK 约束），
    必须先实例化；raw_event_ledger / profile_cards / conversation_summaries /
    vfs_checkpoints / skills 的 session_id 必须在 sessions 表中存在，
    否则 FK 校验失败。
    """
    db_path = tmp_path / "memory_integration.db"
    session_store = SessionStore(db_path)
    session = session_store.create("code", title="集成测试会话")
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


def _make_vfs(size_bytes: int) -> dict[str, str]:
    """构造 JSON 序列化后约 size_bytes 的 VFS。

    Why: VFSCheckpointStore.COMPRESS_THRESHOLD=100_000 以 JSON 字节数为准，
    不是 dict 大小。直接用 'x' * size_bytes 可精确控制压缩阈值边界。
    """
    return {
        "frontend/index.html": "<button>保存</button>",
        "frontend/styles.css": "/* styles */",
        "frontend/app.js": "console.log('ready');",
        "backend/server.py": "from fastapi import FastAPI\napp = FastAPI()",
        "backend/database.json": '{"students": []}',
        "frontend/large_asset.txt": "x" * size_bytes,
    }


# ==================================================================
# 1. _record_patch_success: VFS 压缩在真实落账流程中的表现
# ==================================================================


def test_record_patch_success_with_large_vfs_saves_compressed_checkpoint(memory_stack):
    """大 VFS（>100KB）经 _record_patch_success 落账时触发 zlib 压缩。

    Why: 真实 patch 流程中 VFS 可能含数百 KB 的源码；save_checkpoint 必须
    自适应压缩，否则 SQLite BLOB 列膨胀。本测试验证 helper 正确驱动
    save_checkpoint 并保留 is_compressed 标志。
    """
    sid = memory_stack.session.session_id
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    # JSON 序列化后 > 100KB（COMPRESS_THRESHOLD）
    large_after_vfs = _make_vfs(120_000)
    before_vfs = _make_vfs(0)

    _record_patch_success(
        memory_engine=engine,
        vfs_store=vfs_store,
        skill_store=skill_store,
        session_id=sid,
        run_id="run-large-1",
        before_vfs=before_vfs,
        after_vfs=large_after_vfs,
        instruction="添加一个大型静态资源用于压测",
        summary="新增 large_asset.txt",
        skill_type="task_flow",
    )

    checkpoints = vfs_store.list_checkpoints(sid)
    assert len(checkpoints) == 1
    assert checkpoints[0]["is_compressed"] is True
    assert checkpoints[0]["trigger_reason"] == "post_patch"
    assert checkpoints[0]["run_id"] == "run-large-1"

    # 无损恢复
    restored = vfs_store.restore_vfs(sid)
    assert restored is not None
    restored_vfs, restored_id = restored
    assert restored_id == checkpoints[0]["checkpoint_id"]
    assert restored_vfs == large_after_vfs


def test_record_patch_success_with_small_vfs_saves_uncompressed_checkpoint(memory_stack):
    """小 VFS（<100KB）经 _record_patch_success 落账时不压缩。"""
    sid = memory_stack.session.session_id
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    small_after_vfs = {
        "frontend/index.html": "<button>保存</button>",
        "backend/server.py": "app = FastAPI()",
    }

    _record_patch_success(
        memory_engine=engine,
        vfs_store=vfs_store,
        skill_store=skill_store,
        session_id=sid,
        run_id="run-small-1",
        before_vfs=None,
        after_vfs=small_after_vfs,
        instruction="初始化小项目",
        summary="生成 2 文件",
        skill_type="task_flow",
    )

    checkpoints = vfs_store.list_checkpoints(sid)
    assert len(checkpoints) == 1
    assert checkpoints[0]["is_compressed"] is False
    assert checkpoints[0]["trigger_reason"] == "post_patch"

    restored = vfs_store.restore_vfs(sid)
    assert restored is not None
    assert restored[0] == small_after_vfs


def test_record_patch_success_skips_checkpoint_when_after_vfs_none(memory_stack):
    """after_vfs=None 时不写 checkpoint（但 ai_reply 事件仍要落账）。"""
    sid = memory_stack.session.session_id
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    _record_patch_success(
        memory_engine=engine,
        vfs_store=vfs_store,
        skill_store=skill_store,
        session_id=sid,
        run_id="run-no-vfs",
        before_vfs=None,
        after_vfs=None,
        instruction="纯咨询答复",
        summary="回答了用户问题，未改代码",
        skill_type="code_pattern",
    )

    # 无 checkpoint
    assert vfs_store.list_checkpoints(sid) == []
    # 但 ai_reply 事件已记录
    events = engine.query_events(sid, limit=10)
    assert len(events) == 1
    assert events[0]["event_type"] == "ai_reply"
    assert events[0]["event_data"]["summary"] == "回答了用户问题，未改代码"


# ==================================================================
# 2. _record_patch_success: 事件账本与档案卡更新
# ==================================================================


def test_record_patch_success_appends_event_ledger(memory_stack):
    """_record_patch_success 写入 ai_reply + vfs_change 两条事件到追加账本。"""
    sid = memory_stack.session.session_id
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    before = {"index.html": "<h1>旧</h1>"}
    after = {"index.html": "<h1>新</h1>", "app.js": "console.log('new')"}

    _record_patch_success(
        memory_engine=engine,
        vfs_store=vfs_store,
        skill_store=skill_store,
        session_id=sid,
        run_id="run-events-1",
        before_vfs=before,
        after_vfs=after,
        instruction="添加 app.js 并改标题",
        summary="新增 app.js、修改 index.html",
        skill_type="code_pattern",
    )

    events = engine.query_events(sid, limit=10)
    # DESC 排序：最后写入的在前 → vfs_change, ai_reply
    assert len(events) == 2
    assert events[0]["event_type"] == "vfs_change"
    assert events[1]["event_type"] == "ai_reply"

    # vfs_change 事件记录正确的 changed_files
    vfs_event_data = events[0]["event_data"]
    assert set(vfs_event_data["changed_files"]) == {"index.html", "app.js"}
    assert vfs_event_data["before_file_count"] == 1
    assert vfs_event_data["after_file_count"] == 2
    assert vfs_event_data["run_id"] == "run-events-1"

    # ai_reply 事件记录 summary + instruction
    ai_event_data = events[1]["event_data"]
    assert ai_event_data["summary"] == "新增 app.js、修改 index.html"
    assert ai_event_data["instruction"] == "添加 app.js 并改标题"
    assert ai_event_data["run_id"] == "run-events-1"


def test_record_patch_success_updates_profile_last_modified_files(memory_stack):
    """_record_patch_success 更新档案卡 last_modified_files 字段（双时间戳）。"""
    sid = memory_stack.session.session_id
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    before = {"a.txt": "1", "b.txt": "2"}
    after = {"a.txt": "1-changed", "b.txt": "2", "c.txt": "3"}

    _record_patch_success(
        memory_engine=engine,
        vfs_store=vfs_store,
        skill_store=skill_store,
        session_id=sid,
        run_id="run-profile-1",
        before_vfs=before,
        after_vfs=after,
        instruction="修改 a.txt 新增 c.txt",
        summary="改了 2 个文件",
        skill_type="code_pattern",
    )

    profile = engine.get_valid_profile(sid)
    assert "last_modified_files" in profile
    # changed_files 已排序，限制前 20 个
    assert profile["last_modified_files"] == ["a.txt", "c.txt"]


# ==================================================================
# 3. _record_patch_success: Skill 自动沉淀与匹配
# ==================================================================


def test_record_patch_success_called_twice_auto_creates_skill(memory_stack):
    """同指令连续 2 次成功 → Skill 自动沉淀（success_count=2 达阈值）。

    Why: AUTO_CREATE_THRESHOLD=2，单次成功不沉淀（统计显著性不足）。
    真实请求中用户重复"添加搜索框"等类似指令时，第二次成功后应自动入库，
    后续 quick_match 能命中并注入标准步骤。
    """
    sid = memory_stack.session.session_id
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    instruction = "add search box 添加搜索框"
    before = {"index.html": "<div></div>"}
    after_v1 = {"index.html": "<div><input id='search'></div>"}
    after_v2 = {"index.html": "<div><input id='search' placeholder='搜索'></div>"}

    # 第一次：success_count=1，未达阈值，maybe_create_skill_from_success 返回 None
    _record_patch_success(
        memory_engine=engine,
        vfs_store=vfs_store,
        skill_store=skill_store,
        session_id=sid,
        run_id="run-skill-1",
        before_vfs=before,
        after_vfs=after_v1,
        instruction=instruction,
        summary="添加搜索框 v1",
        skill_type="code_pattern",
    )
    skills_after_first = skill_store.list_skills()
    assert len(skills_after_first) == 1
    assert skills_after_first[0].success_count == 1
    # 未达阈值 → quick_match 不返回
    assert skill_store.quick_match(instruction) == []

    # 第二次：success_count=2，达阈值
    _record_patch_success(
        memory_engine=engine,
        vfs_store=vfs_store,
        skill_store=skill_store,
        session_id=sid,
        run_id="run-skill-2",
        before_vfs=after_v1,
        after_vfs=after_v2,
        instruction=instruction,
        summary="添加搜索框 v2 加 placeholder",
        skill_type="code_pattern",
    )
    skills_after_second = skill_store.list_skills()
    assert len(skills_after_second) == 1  # 同 trigger_condition 复用同一条
    assert skills_after_second[0].success_count == 2

    # 达阈值 → quick_match 命中
    matched = skill_store.quick_match(instruction)
    assert len(matched) == 1
    assert matched[0].skill_id == skills_after_second[0].skill_id
    assert matched[0].trigger_condition == instruction
    # standard_steps 由 _record_patch_success 内部固定模板生成
    assert len(matched[0].standard_steps) == 3
    assert any("reject_destructive_patch" in step for step in matched[0].standard_steps)


def test_record_patch_success_skill_quick_match_no_match_for_unrelated_input(memory_stack):
    """已沉淀的 Skill 不会被无关输入误匹配。"""
    sid = memory_stack.session.session_id
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    instruction = "add search box 添加搜索框"
    after = {"index.html": "<input id='search'>"}

    # 连续 2 次成功以达阈值
    for i in range(2):
        _record_patch_success(
            memory_engine=engine,
            vfs_store=vfs_store,
            skill_store=skill_store,
            session_id=sid,
            run_id=f"run-skill-{i}",
            before_vfs={"index.html": "<div>"} if i == 0 else after,
            after_vfs=after,
            instruction=instruction,
            summary=f"第 {i + 1} 次成功",
            skill_type="code_pattern",
        )

    # 无关输入不命中
    assert skill_store.quick_match("帮我修复后端 500 错误") == []
    assert skill_store.quick_match("react 组件生成") == []


# ==================================================================
# 4. _record_patch_success: best-effort 容错
# ==================================================================


def test_record_patch_success_silent_when_session_id_none(memory_stack):
    """session_id=None 时整体降级为 no-op，不抛异常。"""
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    # 不应抛异常
    _record_patch_success(
        memory_engine=engine,
        vfs_store=vfs_store,
        skill_store=skill_store,
        session_id=None,
        run_id="run-noop",
        before_vfs={"a": "1"},
        after_vfs={"a": "2"},
        instruction="should be ignored",
        summary="noop",
        skill_type="code_pattern",
    )

    # 无任何副作用
    sid = memory_stack.session.session_id
    assert engine.query_events(sid, limit=10) == []
    assert vfs_store.list_checkpoints(sid) == []
    assert skill_store.list_skills() == []


def test_record_patch_success_silent_when_memory_engine_none(memory_stack):
    """memory_engine=None 时整体降级为 no-op（router 独立可测场景）。"""
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store
    sid = memory_stack.session.session_id

    _record_patch_success(
        memory_engine=None,
        vfs_store=vfs_store,
        skill_store=skill_store,
        session_id=sid,
        run_id="run-no-engine",
        before_vfs={"a": "1"},
        after_vfs={"a": "2"},
        instruction="should be ignored",
        summary="noop",
        skill_type="code_pattern",
    )

    assert vfs_store.list_checkpoints(sid) == []
    assert skill_store.list_skills() == []


# ==================================================================
# 5. _build_memory_prompt_suffix: 上下文合成器集成
# ==================================================================


def test_build_memory_prompt_suffix_returns_empty_when_no_session(memory_stack):
    """session_id=None 时返回空串（主流程无感知）。"""
    suffix, matched = _build_memory_prompt_suffix(
        memory_stack.engine,
        None,
        user_input="你好",
        current_vfs={"index.html": "<div></div>"},
    )
    assert suffix == ""
    assert matched == []


def test_build_memory_prompt_suffix_returns_empty_when_no_engine():
    """memory_engine=None 时返回空串。"""
    suffix, matched = _build_memory_prompt_suffix(
        None,
        "fake-session-id",
        user_input="你好",
    )
    assert suffix == ""
    assert matched == []


def test_build_memory_prompt_suffix_appends_profile_after_record(memory_stack):
    """落账后再调 build_context → suffix 含档案卡 / 最近对话段。

    Why: 验证 _record_patch_success 写入的档案卡字段能被 build_context 读出，
    形成"写入 → 读出"闭环，证明记忆系统在真实请求中可被感知。
    """
    sid = memory_stack.session.session_id
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    # 先落账一次写入 last_modified_files
    _record_patch_success(
        memory_engine=engine,
        vfs_store=vfs_store,
        skill_store=skill_store,
        session_id=sid,
        run_id="run-suffix-1",
        before_vfs={"app.js": "old"},
        after_vfs={"app.js": "new", "index.html": "<div>updated</div>"},
        instruction="更新 app.js 和 index.html",
        summary="改了 2 个文件",
        skill_type="code_pattern",
    )

    suffix, _matched = _build_memory_prompt_suffix(
        engine,
        sid,
        user_input="继续修改",
        current_vfs={"app.js": "new", "index.html": "<div>updated</div>"},
    )

    # suffix 非空且含档案卡段
    assert suffix.startswith("\n\n")
    assert "项目档案卡" in suffix
    # last_modified_files 字段已被记录
    assert "app.js" in suffix
    assert "index.html" in suffix


# ==================================================================
# 6. 端到端：fullstack_patch_stream 真实请求中触发记忆钩子
# ==================================================================


def _build_fake_client_returning_patch(patch_operations: list[dict]):
    """构造 FakeClient：streaming 抛错 → fallback 非流式返回 envelope JSON。

    Why: stream_json_completion 优先尝试 stream=True，FakeClient 返回的
    SimpleNamespace 不是 async iterable 会抛 TypeError，触发非流式 fallback；
    fallback 调 stream=False，FakeClient 同一 create() 返回 envelope JSON。
    """

    class FakeCompletions:
        def __init__(self):
            self.calls = 0

        async def create(self, **kwargs):
            self.calls += 1
            content = json.dumps({
                "intent": "patch",
                "summary": "应用了测试补丁",
                "payload": {"operations": patch_operations},
                "terminal_commands": [],
                "rationale": "test rationale",
            }, ensure_ascii=False)
            return SimpleNamespace(choices=[SimpleNamespace(
                message=SimpleNamespace(content=content),
            )])

    class FakeClient:
        class Chat:
            completions = FakeCompletions()
        chat = Chat()

    return FakeClient()


def test_fullstack_patch_stream_invokes_memory_hooks_on_success(memory_stack):
    """端到端：fullstack_patch_stream 成功退出后，VFS checkpoint + 事件账本 + 档案卡全部落账。

    Why: 这是 T2.4/T2.5 集成的最终验证——把 FakeClient 注入真实 stream 函数，
    驱动 Path A 成功路径，验证退出点的 _record_patch_success 确实执行了
    save_checkpoint + record_event + update_profile 三件套。
    """
    sid = memory_stack.session.session_id
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    initial_vfs = {
        "frontend/index.html": "<section>\n  <h2>Items</h2>\n  <ul></ul>\n</section>",
        "frontend/styles.css": "",
        "frontend/app.js": "const ready = true;",
        "backend/server.py": "",
        "backend/database.json": '{"items": []}',
    }
    patch_ops = [{
        "file": "frontend/index.html",
        "op": "replace",
        "target": "<ul></ul>",
        "content": "<ul><li>新项目</li></ul>",
    }]
    fake_client = _build_fake_client_returning_patch(patch_ops)

    async def collect():
        return [event async for event in fullstack_patch_stream(
            initial_vfs,
            "在列表里添加一个项目",
            None,
            fake_client,
            "test-model",
            workspace_id="test-ws",
            run_id="run-e2e-1",
            terminal_pool=None,
            session_id=sid,
            memory_engine=engine,
            vfs_store=vfs_store,
            skill_store=skill_store,
        )]

    events = asyncio.run(collect())

    # 1. SSE 流应包含成功的 code_update（done=True）
    code_updates = [
        e for e in events
        if e.startswith("data: ") and '"type": "code_update"' in e and '"done": true' in e
    ]
    assert len(code_updates) >= 1, "应有 done=True 的 code_update 事件"

    # 2. VFS checkpoint 已落盘（post_patch 触发）
    checkpoints = vfs_store.list_checkpoints(sid)
    assert len(checkpoints) == 1, "应有 1 条 post_patch checkpoint"
    assert checkpoints[0]["trigger_reason"] == "post_patch"
    assert checkpoints[0]["run_id"] == "run-e2e-1"

    # 3. 事件账本含 ai_reply + vfs_change
    ledger_events = engine.query_events(sid, limit=10)
    event_types = [e["event_type"] for e in ledger_events]
    assert "ai_reply" in event_types
    assert "vfs_change" in event_types

    # 4. 档案卡含 last_modified_files
    profile = engine.get_valid_profile(sid)
    assert "last_modified_files" in profile
    assert "frontend/index.html" in profile["last_modified_files"]

    # 5. Skill：第一次成功，未达阈值，list_skills 有 1 条但 success_count=1
    skills = skill_store.list_skills()
    assert len(skills) == 1
    assert skills[0].success_count == 1
    # quick_match 未达阈值不返回
    assert skill_store.quick_match("在列表里添加一个项目") == []


def test_fullstack_patch_stream_skill_threshold_after_two_successful_patches(memory_stack):
    """端到端：连续 2 次成功的 fullstack patch → Skill 达阈值，quick_match 命中。

    Why: 验证 Skill 自动沉淀在真实请求流中的表现——同一指令重复成功后，
    第三次类似请求应能通过 quick_match 命中已沉淀的 Skill，证明程序性记忆
    在 stream 函数中可被复用。
    """
    sid = memory_stack.session.session_id
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    instruction = "add search input 添加搜索框"
    initial_vfs = {
        "frontend/index.html": "<section>\n  <h2>Search</h2>\n  <div></div>\n</section>",
        "frontend/styles.css": "",
        "frontend/app.js": "",
        "backend/server.py": "",
        "backend/database.json": '{"items": []}',
    }

    async def run_once(run_id: str, current_vfs: dict[str, str]) -> dict[str, str]:
        # Why: 用 insert_after + 稳定锚点 <h2>Search</h2>，避免第二次运行时
        # target 已被第一次替换掉导致补丁无法应用。
        patch_ops = [{
            "file": "frontend/index.html",
            "op": "insert_after",
            "target": "<h2>Search</h2>",
            "content": f"<input id='search-{run_id}'>",
        }]
        fake_client = _build_fake_client_returning_patch(patch_ops)
        events = [e async for e in fullstack_patch_stream(
            current_vfs,
            instruction,
            None,
            fake_client,
            "test-model",
            workspace_id="test-ws",
            run_id=run_id,
            terminal_pool=None,
            session_id=sid,
            memory_engine=engine,
            vfs_store=vfs_store,
            skill_store=skill_store,
        )]
        # 从最后一个 code_update(done=True) 解析 VFS
        for ev in reversed(events):
            if ev.startswith("data: ") and '"type": "code_update"' in ev and '"done": true' in ev:
                payload = json.loads(ev[len("data: "):].strip())
                return json.loads(payload["code"])
        raise AssertionError("未找到 done=True 的 code_update 事件")

    # 第一次成功
    vfs_after_1 = asyncio.run(run_once("run-skill-e2e-1", initial_vfs))
    skills_after_1 = skill_store.list_skills()
    assert len(skills_after_1) == 1
    assert skills_after_1[0].success_count == 1
    assert skill_store.quick_match(instruction) == []

    # 第二次成功 → 达阈值
    vfs_after_2 = asyncio.run(run_once("run-skill-e2e-2", vfs_after_1))
    skills_after_2 = skill_store.list_skills()
    assert len(skills_after_2) == 1
    assert skills_after_2[0].success_count == 2

    # quick_match 命中
    matched = skill_store.quick_match(instruction)
    assert len(matched) == 1
    assert matched[0].trigger_condition == instruction

    # VFS checkpoints 应有 2 条
    checkpoints = vfs_store.list_checkpoints(sid, limit=50)
    assert len(checkpoints) == 2
    assert all(c["trigger_reason"] == "post_patch" for c in checkpoints)


def test_fullstack_patch_stream_compressed_checkpoint_for_large_vfs(memory_stack):
    """端到端：大 VFS（>100KB）成功 patch 后落盘的 checkpoint 应被压缩。

    Why: 真实全栈项目可能含数百 KB 源码，验证 _record_patch_success 在
    stream 函数退出点被调用时，save_checkpoint 自适应压缩生效。
    """
    sid = memory_stack.session.session_id
    engine = memory_stack.engine
    vfs_store = memory_stack.vfs_store
    skill_store = memory_stack.skill_store

    # 构造 >100KB 的初始 VFS
    large_initial_vfs = {
        "frontend/index.html": "<section>\n  <h2>Items</h2>\n  <ul></ul>\n</section>",
        "frontend/styles.css": "",
        "frontend/app.js": "console.log('ready');",
        "backend/server.py": "",
        "backend/database.json": '{"items": []}',
        "frontend/large_asset.txt": "x" * 120_000,
    }
    patch_ops = [{
        "file": "frontend/index.html",
        "op": "replace",
        "target": "<ul></ul>",
        "content": "<ul><li>大文件场景</li></ul>",
    }]
    fake_client = _build_fake_client_returning_patch(patch_ops)

    async def collect():
        return [event async for event in fullstack_patch_stream(
            large_initial_vfs,
            "在列表里添加一个项目（大 VFS 场景）",
            None,
            fake_client,
            "test-model",
            workspace_id="test-ws",
            run_id="run-large-e2e",
            terminal_pool=None,
            session_id=sid,
            memory_engine=engine,
            vfs_store=vfs_store,
            skill_store=skill_store,
        )]

    events = asyncio.run(collect())

    # 流应成功完成
    assert any(
        e.startswith("data: ") and '"type": "code_update"' in e and '"done": true' in e
        for e in events
    ), "应有 done=True 的 code_update 事件"

    # checkpoint 应被压缩
    checkpoints = vfs_store.list_checkpoints(sid)
    assert len(checkpoints) == 1
    assert checkpoints[0]["is_compressed"] is True, "大 VFS checkpoint 应触发 zlib 压缩"
    assert checkpoints[0]["trigger_reason"] == "post_patch"

    # 无损恢复并验证补丁已应用
    restored = vfs_store.restore_vfs(sid)
    assert restored is not None
    restored_vfs, _ = restored
    assert "<li>大文件场景</li>" in restored_vfs["frontend/index.html"]
    assert restored_vfs["frontend/large_asset.txt"] == "x" * 120_000
