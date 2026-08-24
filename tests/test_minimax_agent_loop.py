"""minimax.agent_loop 单测：工具名规整 / schema 转换 / 流重组 / 多轮工具循环。

运行：python -m pytest tests/test_minimax_agent_loop.py -q
"""

import asyncio
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from minimax import agent_loop as mm_agent
from minimax.agent_loop import StreamAssembler, extract_tool_web_docs, openai_tools_to_anthropic, sanitize_tool_name
from model_settings import ModelSettings


# --------------------------------------------------------------------- 纯函数

def test_sanitize_tool_name_keeps_legal():
    assert sanitize_tool_name("mcp__fetch__fetch_url") == "mcp__fetch__fetch_url"


def test_sanitize_tool_name_illegal_chars():
    safe = sanitize_tool_name("tool/with spaces.中文" * 5)
    assert safe  # 非空
    from minimax.agent_loop import _TOOL_NAME_RE
    assert _TOOL_NAME_RE.fullmatch(safe), f"规整后名字非法: {safe}"


def test_openai_tools_to_anthropic_and_name_map():
    specs = [
        {"type": "function", "function": {
            "name": "mcp__fetch__fetch_url",
            "description": "抓取网页",
            "parameters": {"type": "object", "properties": {"url": {"type": "string"}}},
        }},
        {"type": "function", "function": {"name": "bad name!", "description": "x", "parameters": None}},
    ]
    tools, name_map = openai_tools_to_anthropic(specs)
    assert tools[0] == {
        "name": "mcp__fetch__fetch_url",
        "description": "抓取网页",
        "input_schema": {"type": "object", "properties": {"url": {"type": "string"}}},
    }
    # 非法名被规整，且 name_map 可还原
    assert name_map[tools[1]["name"]] == "bad name!"
    assert tools[1]["input_schema"] == {"type": "object", "properties": {}}


def test_stream_assembler_rebuilds_full_blocks():
    asm = StreamAssembler()
    for evt in [
        {"type": "thinking_delta", "text": "先想"},
        {"type": "thinking_delta", "text": "一想"},
        {"type": "signature_delta", "text": "sig123"},
        {"type": "text_delta", "text": "查一下"},
        {"type": "tool_use", "block": {"id": "tu_1", "name": "fetch", "input": {"url": "https://x.io"}}},
        {"type": "message_delta", "stop_reason": "tool_use", "usage": {"output_tokens": 9}},
    ]:
        asm.feed(evt)
    blocks = asm.blocks()
    assert blocks[0] == {"type": "thinking", "thinking": "先想一想", "signature": "sig123"}
    assert blocks[1] == {"type": "text", "text": "查一下"}
    assert blocks[2]["type"] == "tool_use" and blocks[2]["input"] == {"url": "https://x.io"}
    assert asm.stop_reason == "tool_use"
    assert asm.usage["output_tokens"] == 9


def test_extract_tool_web_docs_reads_mcp_json_and_plain_urls():
    report = '{"results":[{"title":"来源 A","url":"https://a.example/x","snippet":"摘要"}]}'
    docs = extract_tool_web_docs(report, "mcp__search__web")
    assert docs[0]["title"] == "来源 A"
    assert docs[0]["url"] == "https://a.example/x"
    plain = extract_tool_web_docs("URL: https://b.example/y", "mcp__search__web")
    assert plain[0]["url"] == "https://b.example/y"


# --------------------------------------------------------------------- 端到端循环

@dataclass
class FakeRuntime:
    response_length: str = "detailed"
    deep_thinking: str = "auto"


@dataclass
class FakeRequest:
    message: str = "帮我抓这个网页"
    mode: str = "standard"
    session_id: str | None = None
    attachments: list = field(default_factory=list)
    runtime_settings: FakeRuntime | None = field(default_factory=FakeRuntime)


class FakeMemory:
    def __init__(self):
        self.turns = []

    def push_chat_turn(self, sid, role, content):
        self.turns.append((role, content))

    def get_chat_window(self, sid, **kw):
        return [{"role": r, "content": c} for r, c in self.turns]

    def maybe_summarize(self, sid, *, chat_mode=False):
        pass


class ScriptedClient:
    """多轮脚本客户端：第 1 次调用返回 tool_use，第 2 次返回最终答案。"""

    calls: list[dict] = []
    scripts: list[list[dict]] = []

    def __init__(self, api_key, base_url="x", timeout=1.0):
        pass

    def stream_message(self, **kwargs):
        ScriptedClient.calls.append(kwargs)
        script = ScriptedClient.scripts.pop(0)
        yield from script


def _settings() -> ModelSettings:
    return ModelSettings(
        provider="minimax",
        api_format="anthropic_messages",
        base_url="https://api.minimaxi.com/anthropic",
        model_id="MiniMax-M3",
        api_key="k",
        display_name="MiniMax M3",
        temperature=1.0,
        max_tokens=16_000,
    )


def _parse(chunks):
    out = []
    for c in chunks:
        lines = c.strip().split("\n")
        out.append((lines[0][len("event: "):], json.loads(lines[1][len("data: "):])))
    return out


@pytest.fixture(autouse=True)
def _reset():
    ScriptedClient.calls = []
    # 第 1 轮：thinking + tool_use；第 2 轮：text 最终答案
    ScriptedClient.scripts = [
        [
            {"type": "thinking_delta", "text": "需要工具"},
            {"type": "signature_delta", "text": "sigA"},
            {"type": "text_delta", "text": "我去查"},
            {"type": "tool_use", "block": {"id": "tu_9", "name": "mcp__fetch__fetch_url", "input": {"url": "https://x.io"}}},
            {"type": "message_delta", "stop_reason": "tool_use", "usage": {"input_tokens": 5, "output_tokens": 3}},
        ],
        [
            {"type": "thinking_delta", "text": "拿到结果"},
            {"type": "text_delta", "text": "网页标题是 X"},
            {"type": "message_delta", "stop_reason": "end_turn", "usage": {"input_tokens": 50, "output_tokens": 10}},
        ],
    ]
    yield


def test_agent_loop_two_round_tool_cycle(monkeypatch):
    monkeypatch.setattr(mm_agent, "MiniMaxClient", ScriptedClient)
    dispatched: list[tuple[str, dict]] = []

    async def dispatch(name, args):
        dispatched.append((name, args))
        return "网页内容 ABC"

    specs = [{"type": "function", "function": {
        "name": "mcp__fetch__fetch_url", "description": "fetch", "parameters": {"type": "object", "properties": {}},
    }}]

    async def run():
        return [c async for c in mm_agent.generate_minimax_agent_events(
            FakeRequest(), _settings(),
            wants_web=False, use_deep=False, memory_engine=FakeMemory(),
            openai_tool_specs=specs, dispatch=dispatch,
        )]

    chunks = asyncio.run(run())
    events = _parse(chunks)
    names = [n for n, _ in events]

    # 1) 工具调用被 dispatch（原始名）
    assert dispatched == [("mcp__fetch__fetch_url", {"url": "https://x.io"})]

    # 2) mcp 事件（前端 MCP 进度组件契约）
    call_ev = next(p for n, p in events if n == "mcp" and "mcp_tool_call" in p)
    assert call_ev["mcp_tool_call"] == "mcp__fetch__fetch_url"
    result_ev = next(p for n, p in events if n == "mcp" and "mcp_tool_result" in p)
    assert result_ev["ok"] is True

    # 3) 两轮 token 均透传，最终答案拼接
    tokens = "".join(p["token"] for n, p in events if n == "token")
    assert tokens == "我去查网页标题是 X"

    # 4) 第二次调用：assistant 完整块（thinking+signature+text+tool_use）+ user tool_result 回传
    second_call = ScriptedClient.calls[1]
    assert second_call["messages"][-2]["role"] == "assistant"
    asst_blocks = second_call["messages"][-2]["content"]
    assert [b["type"] for b in asst_blocks] == ["thinking", "text", "tool_use"]
    assert asst_blocks[0]["signature"] == "sigA"
    assert asst_blocks[2]["input"] == {"url": "https://x.io"}
    tool_result_msg = second_call["messages"][-1]
    assert tool_result_msg["role"] == "user"
    assert tool_result_msg["content"][0]["type"] == "tool_result"
    assert tool_result_msg["content"][0]["tool_use_id"] == "tu_9"
    assert "网页内容 ABC" in tool_result_msg["content"][0]["content"]

    # 5) 工具以 Anthropic schema 注入
    first_call = ScriptedClient.calls[0]
    assert first_call["tools"][0]["input_schema"]["type"] == "object"

    # 6) done 契约
    done = next(p for n, p in events if n == "done")
    assert done["answer"] == "我去查网页标题是 X"
    assert done["usage"]["prompt_tokens"] == 50


def test_agent_loop_dispatch_failure_continues(monkeypatch):
    monkeypatch.setattr(mm_agent, "MiniMaxClient", ScriptedClient)

    async def dispatch(name, args):
        raise RuntimeError("boom")

    async def run():
        return [c async for c in mm_agent.generate_minimax_agent_events(
            FakeRequest(), _settings(),
            wants_web=False, use_deep=False, memory_engine=FakeMemory(),
            openai_tool_specs=[{"type": "function", "function": {"name": "t", "description": "", "parameters": {}}}],
            dispatch=dispatch,
        )]

    chunks = asyncio.run(run())
    events = _parse(chunks)
    # 失败以 tool_result 文本回传（模型可见），循环不中断
    fail_ev = next(p for n, p in events if n == "mcp" and "mcp_tool_result" in p)
    assert fail_ev["ok"] is False
    second_call = ScriptedClient.calls[1]
    assert "工具调用失败" in second_call["messages"][-1]["content"][0]["content"]
    # 最终仍有 done
    assert any(n == "done" for n, _ in events)


def test_agent_loop_end_turn_first_round(monkeypatch):
    monkeypatch.setattr(mm_agent, "MiniMaxClient", ScriptedClient)
    # 单轮即 end_turn：不再发起第二轮调用
    ScriptedClient.scripts = [[
        {"type": "text_delta", "text": "直接回答"},
        {"type": "message_delta", "stop_reason": "end_turn", "usage": {"input_tokens": 1, "output_tokens": 1}},
    ]]

    async def run():
        return [c async for c in mm_agent.generate_minimax_agent_events(
            FakeRequest(), _settings(),
            wants_web=False, use_deep=False, memory_engine=FakeMemory(),
            openai_tool_specs=[], dispatch=lambda n, a: asyncio.sleep(0),
        )]

    chunks = asyncio.run(run())
    assert len(ScriptedClient.calls) == 1
    done = next(p for n, p in _parse(chunks) if n == "done")
    assert done["answer"] == "直接回答"


def test_agent_loop_synthesizes_answer_after_round_cap(monkeypatch):
    """工具循环耗尽轮次时，必须再发起一次无工具收束请求，不能返回空答案。"""
    monkeypatch.setattr(mm_agent, "MiniMaxClient", ScriptedClient)
    tool_round = [
        {"type": "tool_use", "block": {"id": "tu_cap", "name": "t", "input": {}}},
        {"type": "message_delta", "stop_reason": "tool_use", "usage": {"output_tokens": 1}},
    ]
    # The third tool round is the configured interactive safety cap.  The
    # fourth call is the tool-free final synthesis turn added by the loop.
    ScriptedClient.scripts = [tool_round for _ in range(3)] + [[
        {"type": "text_delta", "text": "最终正文"},
        {"type": "message_delta", "stop_reason": "end_turn", "usage": {"output_tokens": 2}},
    ]]

    async def dispatch(name, args):
        return "工具结果"

    async def run():
        return [c async for c in mm_agent.generate_minimax_agent_events(
            FakeRequest(), _settings(),
            wants_web=False, use_deep=False, memory_engine=FakeMemory(),
            openai_tool_specs=[{"type": "function", "function": {"name": "t", "description": "", "parameters": {}}}],
            dispatch=dispatch,
        )]

    chunks = asyncio.run(run())
    assert len(ScriptedClient.calls) == 4
    assert ScriptedClient.calls[-1]["tools"] is None
    done = next(p for n, p in _parse(chunks) if n == "done")
    assert done["answer"] == "最终正文"


def test_deep_tool_loop_uses_short_staged_thinking_and_final_synthesis(monkeypatch):
    """深度模式在工具结果后走短思考，再用无工具请求写最终正文。"""
    monkeypatch.setattr(mm_agent, "MiniMaxClient", ScriptedClient)
    ScriptedClient.scripts = [[
        {"type": "thinking_delta", "text": "先判断是否需要检索"},
        {"type": "tool_use", "block": {"id": "tu_stage", "name": "t", "input": {}}},
        {"type": "message_delta", "stop_reason": "tool_use", "usage": {"output_tokens": 1}},
    ], [
        {"type": "thinking_delta", "text": "已拿到结果，准备组织答案"},
        {"type": "text_delta", "text": "简短前言"},
        {"type": "message_delta", "stop_reason": "end_turn", "usage": {"output_tokens": 2}},
    ], [
        {"type": "thinking_delta", "text": "规划正文结构"},
        {"type": "text_delta", "text": "只输出规划"},
        {"type": "message_delta", "stop_reason": "end_turn", "usage": {"output_tokens": 2}},
    ], [
        {"type": "text_delta", "text": "完整正文"},
        {"type": "message_delta", "stop_reason": "end_turn", "usage": {"output_tokens": 3}},
    ]]

    async def dispatch(name, args):
        return "检索结果"

    async def run():
        return [c async for c in mm_agent.generate_minimax_agent_events(
            FakeRequest(), _settings(),
            wants_web=True, use_deep=True, memory_engine=FakeMemory(),
            openai_tool_specs=[{"type": "function", "function": {"name": "t", "description": "", "parameters": {}}}],
            dispatch=dispatch,
        )]

    chunks = asyncio.run(run())
    events = _parse(chunks)
    assert len(ScriptedClient.calls) == 4
    # Each tool-loop request is deliberately short; final synthesis keeps a
    # short planning phase, then writes with thinking/tools disabled.
    assert ScriptedClient.calls[0]["thinking"]["budget_tokens"] <= 1024
    assert ScriptedClient.calls[0]["max_tokens"] <= 3_072
    assert ScriptedClient.calls[1]["thinking"]["budget_tokens"] <= 1536
    assert ScriptedClient.calls[1]["max_tokens"] <= 3_584
    assert ScriptedClient.calls[2]["tools"] is None
    assert ScriptedClient.calls[2]["thinking"]["budget_tokens"] <= 1024
    assert ScriptedClient.calls[2]["max_tokens"] <= 1_536
    assert ScriptedClient.calls[3]["tools"] is None
    assert ScriptedClient.calls[3]["thinking"] is None
    assert any(name == "reasoning_delta" for name, _ in events)
    done = next(payload for name, payload in events if name == "done")
    assert "完整正文" in done["answer"]


def test_deep_reasoning_has_aggregate_stream_cap(monkeypatch):
    monkeypatch.setattr(mm_agent, "MiniMaxClient", ScriptedClient)
    ScriptedClient.scripts = [[
        {"type": "thinking_delta", "text": "x" * 20_000},
        {"type": "message_delta", "stop_reason": "end_turn", "usage": {"output_tokens": 20_000}},
    ], [
        {"type": "thinking_delta", "text": "规划"},
        {"type": "message_delta", "stop_reason": "end_turn", "usage": {"output_tokens": 1}},
    ], [
        {"type": "text_delta", "text": "完整正文"},
        {"type": "message_delta", "stop_reason": "end_turn", "usage": {"output_tokens": 2}},
    ]]

    async def run():
        return [c async for c in mm_agent.generate_minimax_agent_events(
            FakeRequest(), _settings(),
            wants_web=False, use_deep=True, memory_engine=FakeMemory(),
            openai_tool_specs=[], dispatch=lambda n, a: asyncio.sleep(0),
        )]

    events = _parse(asyncio.run(run()))
    reasoning = "".join(payload["reasoning_delta"] for name, payload in events if name == "reasoning_delta")
    assert len(reasoning) <= mm_agent.MAX_TOTAL_REASONING_CHARS
    done = next(payload for name, payload in events if name == "done")
    assert done["answer"] == "完整正文"


def test_agent_loop_web_search_tool_appended(monkeypatch):
    monkeypatch.setattr(mm_agent, "MiniMaxClient", ScriptedClient)
    ScriptedClient.scripts = [[
        {"type": "text_delta", "text": "ok"},
        {"type": "message_delta", "stop_reason": "end_turn", "usage": {"input_tokens": 1, "output_tokens": 1}},
    ]]

    async def run():
        return [c async for c in mm_agent.generate_minimax_agent_events(
            FakeRequest(), _settings(),
            wants_web=True, use_deep=False, memory_engine=FakeMemory(),
            openai_tool_specs=[], dispatch=lambda n, a: asyncio.sleep(0),
        )]

    chunks = asyncio.run(run())
    tools = ScriptedClient.calls[0]["tools"]
    assert tools[-1]["type"] == "web_search_20250305"
    # web 占位面板事件
    assert any(n == "web_docs" for n, _ in _parse(chunks))
