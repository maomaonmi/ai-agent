"""minimax.research 原生调研引擎单测：指令映射 / 参数构造 / 事件契约 / 记忆落账 / 错误路径。

运行：python -m pytest tests/test_minimax_research.py -q
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from minimax import research as mm_research
from minimax.client import MiniMaxAPIError
from model_settings import ModelSettings


# --------------------------------------------------------------------- fakes

class FakeMemoryEngine:
    def __init__(self):
        self.turns: list[tuple[str, str, str]] = []

    def push_chat_turn(self, session_id, role, content):
        self.turns.append((session_id, role, content))

    def get_chat_window(self, session_id, **kwargs):
        return [{"role": r, "content": c} for _, r, c in self.turns]

    def maybe_summarize(self, session_id, *, chat_mode=False):
        pass


class FakeClient:
    """替换 minimax.research.MiniMaxClient：按脚本产出事件，捕获请求参数。

    两段式路由：带 tools 的请求（阶段1 搜索）走 stage1 脚本；
    不带 tools 的请求（阶段2 写作）走 stage2 脚本。
    """

    calls: list[dict] = []
    stage1_script: list[dict] = []
    stage2_script: list[dict] = []

    def __init__(self, api_key, base_url="x", timeout=1.0):
        pass

    def stream_message(self, **kwargs):
        FakeClient.calls.append(kwargs)
        script = FakeClient.stage1_script if kwargs.get("tools") else FakeClient.stage2_script
        yield from script


def _settings(**overrides) -> ModelSettings:
    defaults = dict(
        provider="minimax",
        api_format="anthropic_messages",
        base_url="https://api.minimaxi.com/anthropic",
        model_id="MiniMax-M3",
        api_key="test-key",
        display_name="MiniMax M3",
        thinking_enabled=True,
        temperature=1.0,
        max_tokens=16_000,
    )
    defaults.update(overrides)
    return ModelSettings(**defaults)


def _parse_events(raw_chunks: list[str]) -> list[tuple[str, dict]]:
    out = []
    for chunk in raw_chunks:
        lines = chunk.strip().split("\n")
        name = lines[0][len("event: "):]
        payload = json.loads(lines[1][len("data: "):])
        out.append((name, payload))
    return out


# 阶段1（搜索）：两轮检索 + usage。
STAGE1_SCRIPT = [
    {"type": "server_tool_use", "block": {"id": "s1", "name": "web_search", "input": {"query": "量子计算 2026"}}},
    {"type": "web_search_tool_result", "block": {"tool_use_id": "s1", "content": [
        {"type": "web_search_result", "title": "综述A", "url": "https://a.io", "page_age": "2026-01-01",
         "content": "量子计算综述摘要"},
        {"type": "web_search_result", "title": "论文B", "url": "https://b.io"},
    ]}},
    {"type": "server_tool_use", "block": {"id": "s2", "name": "web_search", "input": {"query": "quantum computing breakthrough"}}},
    {"type": "web_search_tool_result", "block": {"tool_use_id": "s2", "content": [
        {"type": "web_search_result", "title": "Report C", "url": "https://c.io"},
    ]}},
    {"type": "message_delta", "delta": {"stop_reason": "end_turn"},
     "usage": {"input_tokens": 500, "output_tokens": 200, "cache_read_input_tokens": 300}},
]

# 阶段2（写作）：思考 + 报告正文 + usage。
STAGE2_SCRIPT = [
    {"type": "thinking_delta", "text": "拆解主题"},
    {"type": "text_delta", "text": "# 核心结论\n"},
    {"type": "text_delta", "text": "量子计算进展…"},
    {"type": "message_delta", "delta": {"stop_reason": "end_turn"},
     "usage": {"input_tokens": 100, "output_tokens": 800}},
]


@pytest.fixture(autouse=True)
def _reset_fake():
    FakeClient.calls = []
    FakeClient.stage1_script = list(STAGE1_SCRIPT)
    FakeClient.stage2_script = list(STAGE2_SCRIPT)
    yield


# --------------------------------------------------------------------- 指令映射

def test_directives_depth_mapping():
    # maxDepth → 阶段1 检索轮次指令
    d4 = mm_research._format_search_directives({"maxDepth": 4})
    assert "约 3 轮" in d4
    d7 = mm_research._format_search_directives({"maxDepth": 7})
    assert "约 6 轮" in d7
    d10 = mm_research._format_search_directives({"maxDepth": 10})
    assert "约 10 轮" in d10


def test_directives_maxurls_capped_at_30():
    # maxUrls → 阶段2 引用规模指令
    d = mm_research._format_writing_directives({"maxUrls": 500})
    assert "30 条以内" in d
    d2 = mm_research._format_writing_directives({"maxUrls": 10})
    assert "10 条以内" in d2


def test_directives_empty_options():
    assert mm_research._format_search_directives(None) == ""
    assert mm_research._format_search_directives({}) == ""
    assert mm_research._format_search_directives({"maxDepth": 0, "maxUrls": 0}) == ""
    assert mm_research._format_writing_directives(None) == ""


# --------------------------------------------------------------------- 事件契约

def test_research_full_event_contract(monkeypatch):
    monkeypatch.setattr(mm_research, "MiniMaxClient", FakeClient)
    memory = FakeMemoryEngine()
    chunks = list(mm_research.generate_minimax_research_events(
        "量子计算最新进展", "s1", _settings(), memory,
        research_options={"maxDepth": 7, "maxUrls": 20},
    ))
    events = _parse_events(chunks)

    # 启动顺序：先 research_process(planning) 兼容千问链路，再 node 启动
    assert events[0][0] == "research_process"
    assert events[0][1]["stage"] == "planning"
    assert events[0][1]["status"] == "running"
    # node 启动节点：原生调研标识
    first_node = next(p for n, p in events if n == "node")
    assert "MiniMax 原生调研" in first_node["node_name"]
    assert first_node["native_search"] is True

    # 检索轮次 node：两轮，每轮带 round 与 query
    search_nodes = [p for n, p in events if n == "node" and p.get("node_name") == "web_search" and p["status"] == "processing"]
    assert len(search_nodes) == 2
    assert search_nodes[0]["round"] == 1
    assert "量子计算 2026" in search_nodes[0]["message"]
    assert search_nodes[1]["round"] == 2

    # 每轮结果 node：hit_count 递报
    done_nodes = [p for n, p in events if n == "node" and p.get("node_name") == "web_search" and p["status"] == "completed"]
    assert [d["hit_count"] for d in done_nodes] == [2, 1]

    # 千问同款 web_docs 事件：前端 sendDeepResearch.onWebDocs 收 docs 数组
    web_docs_events = [p for n, p in events if n == "web_docs"]
    assert web_docs_events, "应推 web_docs 事件兼容千问链路"
    assert sum(p["count"] for p in web_docs_events) == 3
    assert web_docs_events[0]["docs"][0]["url"] == "https://a.io"

    # 千问同款 research_process searching/writing/complete 阶段
    stages = [p["stage"] for n, p in events if n == "research_process"]
    assert "searching" in stages
    assert "writing" in stages
    assert "complete" in stages

    # 思考与正文流
    assert any(n == "reasoning_delta" and p["reasoning_delta"] == "拆解主题" for n, p in events)
    tokens = [p["token"] for n, p in events if n == "token"]
    assert "".join(tokens) == "# 核心结论\n量子计算进展…"

    # 千问同款 done：total_pages / total_chunks / top_chunks
    research_done = next(p for n, p in events if n == "done" and "total_pages" in p)
    assert research_done["total_pages"] == 2
    assert research_done["total_chunks"] == 3
    assert len(research_done["top_chunks"]) == 3

    # 千问同款 research_reason_done：写入消息 content=report
    rrd = next(p for n, p in events if n == "research_reason_done")
    assert rrd["report"].startswith("# 核心结论")
    assert rrd["reasoning"] == "拆解主题"

    # chat 兼容 done：engine/web_docs/usage（usage 为两阶段合并：500+100=600）
    done = next(p for n, p in events if n == "done" and p.get("engine") == "minimax")
    assert done["engine"] == "minimax"
    assert done["mode"] == "research"
    assert done["native_search"] is True
    assert len(done["web_docs"]) == 3
    assert done["web_docs"][0]["url"] == "https://a.io"
    assert done["usage"]["prompt_tokens"] == 600
    assert done["usage"]["cache_read_input_tokens"] == 300

    # 记忆落账：user + assistant
    roles = [r for _, r, _ in memory.turns]
    assert roles == ["user", "assistant"]


def test_research_request_params(monkeypatch):
    monkeypatch.setattr(mm_research, "MiniMaxClient", FakeClient)
    settings = _settings(thinking_budget=None)
    list(mm_research.generate_minimax_research_events("主题", None, settings, FakeMemoryEngine()))
    # 两段式：calls[0]=阶段1（带 tools），calls[1]=阶段2（写作）
    assert len(FakeClient.calls) == 2
    stage1, stage2 = FakeClient.calls

    # 阶段1：强制开启服务端搜索工具 + tool_choice 协议级兜底
    assert any(t.get("name") == "web_search" for t in (stage1["tools"] or []))
    assert stage1["tool_choice"] == "any"
    assert "调研助手" in stage1["system"]
    assert "至少进行 2 轮 web_search" in stage1["system"]
    # 阶段2：纯写作——无 tools、有 thinking、system 含报告结构约束
    assert not stage2.get("tools")
    # 调研思考预算默认 6144（用户未显式配置）。Why 6K：4K 太紧模型会跳过 web_search，
    # 8K 太高模型会过度思考同样跳过；6K 是经验甜区。
    assert stage2["thinking"] == {"type": "enabled", "budget_tokens": 6_144}
    assert "深度调研分析师" in stage2["system"]
    assert "报告总长度 ≥ 4000 字" in stage2["system"]
    # max_tokens 不低于报告下限
    assert stage2["max_tokens"] >= mm_research._MIN_REPORT_TOKENS
    # 阶段2 user 消息含阶段1 收集的材料（[1] 序号 + URL）
    assert "[1] 综述A" in stage2["messages"][-1]["content"]
    assert "https://a.io" in stage2["messages"][-1]["content"]


def test_research_options_injected_into_system(monkeypatch):
    monkeypatch.setattr(mm_research, "MiniMaxClient", FakeClient)
    list(mm_research.generate_minimax_research_events(
        "主题", None, _settings(), FakeMemoryEngine(),
        research_options={"maxDepth": 10, "maxUrls": 15},
    ))
    stage1, stage2 = FakeClient.calls
    # maxDepth → 阶段1 轮次指令；maxUrls → 阶段2 引用规模指令
    assert "约 10 轮" in stage1["system"]
    assert "15 条以内" in stage2["system"]


def test_research_user_thinking_budget_wins(monkeypatch):
    monkeypatch.setattr(mm_research, "MiniMaxClient", FakeClient)
    list(mm_research.generate_minimax_research_events(
        "主题", None, _settings(thinking_budget=2_048), FakeMemoryEngine(),
    ))
    # thinking 仅阶段2 携带
    assert FakeClient.calls[1]["thinking"]["budget_tokens"] == 2_048


def test_research_error_event(monkeypatch):
    class ExplodingClient:
        def __init__(self, api_key, base_url="x", timeout=1.0):
            pass

        def stream_message(self, **kwargs):
            raise MiniMaxAPIError("配额不足", status_code=429)
            yield  # pragma: no cover

    monkeypatch.setattr(mm_research, "MiniMaxClient", ExplodingClient)
    chunks = list(mm_research.generate_minimax_research_events(
        "主题", None, _settings(), FakeMemoryEngine(),
    ))
    events = _parse_events(chunks)
    err = next(p for n, p in events if n == "error")
    assert err["code"] == "MINIMAX_429"
    assert "配额不足" in err["message"]
    # 出错时不产 done
    assert not any(n == "done" for n, _ in events)
