"""测试 agent_loop / chat 的 web_search 能力位 gate + 实时 web_docs 推送。

Why: M2.7 等模型后端可能拒 web_search，gate 后立刻给前端 skipped 节点
+ 实时推送 web_search_tool_result → web_docs 事件（GLM/千问同款契约）。
"""
import asyncio
import json
from typing import Any

import pytest


# ============================================================ agent_loop gate
def test_agent_loop_skips_web_search_for_unsupported_model(monkeypatch):
    """model_id 标 supports_server_web_search=False 时，agent_loop 应跳过 tool 注入并发 skipped 节点。"""
    from minimax import agent_loop as loop

    events: list[dict] = []

    class _Settings:
        api_key = "test"
        base_url = "https://example"
        model_id = "MiniMax-LockedDown-99"
        max_tokens = 1024
        temperature = 0.5
        thinking_budget = 4096
        thinking_enabled = False
        tool_call_rounds = 1

    class _Request:
        message = "今天上海天气"
        mode = "standard"
        session_id = None
        attachments: list[Any] = []

    # Why: 把所有 provider-specific 路径 mock 掉，只看 web_search 注入决策。
    async def _collect():
        gen = loop.generate_minimax_agent_events(
            request=_Request(),
            settings=_Settings(),
            wants_web=True,
            use_deep=False,
            memory_engine=_DummyMemory(),
            openai_tool_specs=[],
            dispatch=_DummyDispatch(),
            max_rounds=1,
        )
        # 收到 2 个事件就 break（不等流式收完）—— 验证 skipped 节点先发
        async for raw in gen:
            events.append(_parse(raw))
            if any(e.get("node_name") == "web_search" and e.get("status") == "skipped" for e in events):
                break

    # 走 provider capability matrix：把目标 model 标为不支持
    from model_settings import ProviderCapabilities
    monkeypatch.setattr(
        "minimax.agent_loop.capabilities_for_model",
        lambda _id: ProviderCapabilities(True, "minimax", False, True, supports_server_web_search=False),
    )

    # Also stub client to avoid real network
    class _NoopClient:
        def __init__(self, *_a, **_kw):
            pass
        def stream_message(self, **_kwargs):
            return iter([])
    monkeypatch.setattr(loop, "MiniMaxClient", _NoopClient)

    asyncio.run(_collect())

    skipped = [e for e in events if e.get("node_name") == "web_search" and e.get("status") == "skipped"]
    assert skipped, f"应发 skipped 节点: events={events}"
    assert skipped[0]["skipped_reason"] == "model_not_support_server_web_search"


def test_agent_loop_emits_placeholder_when_web_search_enabled():
    """wants_web=True 且支持时：先发占位 web_docs 事件（前端联网面板必现）。"""
    from minimax import agent_loop as loop

    events: list[dict] = []

    class _Settings:
        api_key = "test"
        base_url = "https://example"
        model_id = "MiniMax-M3"
        max_tokens = 1024
        temperature = 0.5
        thinking_budget = 4096
        thinking_enabled = False
        tool_call_rounds = 1

    class _Request:
        message = "test"
        mode = "standard"
        session_id = None
        attachments: list[Any] = []

    class _NoopClient:
        def __init__(self, *_a, **_kw):
            pass
        def stream_message(self, **_kwargs):
            return iter([])

    async def _collect():
        gen = loop.generate_minimax_agent_events(
            request=_Request(),
            settings=_Settings(),
            wants_web=True,
            use_deep=False,
            memory_engine=_DummyMemory(),
            openai_tool_specs=[],
            dispatch=_DummyDispatch(),
            max_rounds=1,
        )
        async for raw in gen:
            events.append(_parse(raw))
            if any(e.get("placeholder") for e in events if "docs" in (e.get("docs") or []) if isinstance(e, dict)):
                break

    asyncio.run(_collect())

    placeholders = [e for e in events if e.get("placeholder") is True]
    assert placeholders, f"wants_web=True 应发占位 web_docs 事件: events={events}"


# ============================================================ 实时 web_docs 推送
def test_agent_loop_realtime_web_docs_for_each_tool_result(monkeypatch):
    """每个 web_search_tool_result 应实时推送 web_docs 事件（带 hit_count/total）。"""
    from minimax import agent_loop as loop
    from minimax.client import MiniMaxClient

    events: list[dict] = []

    class _Settings:
        api_key = "test"
        base_url = "https://example"
        model_id = "MiniMax-M3"
        max_tokens = 1024
        temperature = 0.5
        thinking_budget = 4096
        thinking_enabled = False
        tool_call_rounds = 1

    class _Request:
        message = "test"
        mode = "standard"
        session_id = None
        attachments: list[Any] = []

    # 模拟 M3 流：先思考 + 搜 1 次 + 出 1 段 text + end_turn。
    # Why: MiniMaxClient._iter_sse_events 内部已把 content_block_start
    # (block.type=web_search_tool_result) 翻译成 web_search_tool_result 事件，
    # agent_loop 直接消费 client yield 的事件序列。
    def _stream(**_kwargs):
        yield {"type": "message_start", "usage": {}}
        yield {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}}
        yield {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "搜…"}}
        yield {"type": "content_block_stop", "index": 0}
        # 模型 server-side 调用 web_search → 工具结果块
        yield {"type": "web_search_tool_result", "block": {
            "type": "web_search_tool_result", "tool_use_id": "x", "content": [
                {"type": "web_search_result", "title": "上海天气", "url": "https://a.com", "page_age": "2026-01-01"},
                {"type": "web_search_result", "title": "上海气温", "url": "https://b.com"},
            ]
        }}
        # 模型输出最终答案
        yield {"type": "content_block_start", "index": 2, "content_block": {"type": "text", "text": ""}}
        yield {"type": "content_block_delta", "index": 2, "delta": {"type": "text_delta", "text": "今天 35 度"}}
        yield {"type": "content_block_stop", "index": 2}
        yield {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}
        yield {"type": "message_stop", "usage": {"output_tokens": 10}}

    class _Client:
        def __init__(self, *_a, **_kw):
            pass
        stream_message = staticmethod(_stream)

    monkeypatch.setattr(loop, "MiniMaxClient", _Client)

    async def _collect():
        gen = loop.generate_minimax_agent_events(
            request=_Request(),
            settings=_Settings(),
            wants_web=True,
            use_deep=False,
            memory_engine=_DummyMemory(),
            openai_tool_specs=[],
            dispatch=_DummyDispatch(),
            max_rounds=1,
        )
        async for raw in gen:
            events.append(_parse(raw))
            # 收完 done 即停
            if raw.startswith("event: done"):
                break

    asyncio.run(_collect())

    web_docs_events = [e for e in events if e.get("docs") and e.get("placeholder") is False]
    assert web_docs_events, f"应发真实 web_docs 事件: events={events}"
    first = web_docs_events[0]
    assert first["count"] == 2, f"应一次返回 2 条结果: {first}"
    assert first["total"] == 2
    assert first["docs"][0]["url"] == "https://a.com"
    assert first["docs"][1]["title"] == "上海气温"


# ============================================================ helpers
class _DummyMemory:
    def push_chat_turn(self, *_args, **_kwargs):
        return None
    def get_chat_window(self, *_args, **_kwargs):
        return []
    def maybe_summarize(self, *_args, **_kwargs):
        return None


class _DummyDispatch:
    async def __call__(self, *_args, **_kwargs):
        return "noop"


def _parse(raw_sse: str) -> dict:
    """SSE 文本 → dict。容错：只取 data 行 JSON。"""
    data_line = next(
        (line[len("data:"):].strip() for line in raw_sse.splitlines() if line.startswith("data:")),
        None,
    )
    if not data_line:
        return {}
    try:
        return json.loads(data_line)
    except json.JSONDecodeError:
        return {"raw": data_line}
