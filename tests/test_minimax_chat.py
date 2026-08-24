"""minimax.chat 主链路单测：参数构造 / 附件转换 / 事件契约 / 记忆读写。

运行：python -m pytest tests/test_minimax_chat.py -q
"""

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

from minimax import chat as mm_chat
from minimax.client import MiniMaxAPIError
from model_settings import ModelSettings


# --------------------------------------------------------------------- fakes

@dataclass
class FakeAttachment:
    type: str
    url: str


@dataclass
class FakeRuntime:
    response_length: str = "detailed"
    deep_thinking: str = "auto"


@dataclass
class FakeRequest:
    message: str = "你好"
    mode: str = "standard"
    session_id: str | None = None
    attachments: list = field(default_factory=list)
    runtime_settings: FakeRuntime | None = field(default_factory=FakeRuntime)


class FakeMemoryEngine:
    def __init__(self):
        self.turns: list[tuple[str, str, str]] = []  # (sid, role, content)
        self.summarized = 0

    def push_chat_turn(self, session_id, role, content):
        self.turns.append((session_id, role, content))

    def get_chat_window(self, session_id, **kwargs):
        return [{"role": r, "content": c} for _, r, c in self.turns]

    def maybe_summarize(self, session_id, *, chat_mode=False):
        self.summarized += 1


class FakeClient:
    """替换 MiniMaxClient：按脚本产出事件，捕获请求参数。"""

    calls: list[dict] = []
    script: list[dict] = [
        {"type": "thinking_delta", "text": "思考片段"},
        {"type": "text_delta", "text": "回答A"},
        {"type": "text_delta", "text": "回答B"},
        {"type": "message_stop", "usage": {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 8}},
    ]

    def __init__(self, api_key, base_url="x", timeout=1.0):
        pass

    def stream_message(self, **kwargs):
        FakeClient.calls.append(kwargs)
        yield from FakeClient.script


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


@pytest.fixture(autouse=True)
def _reset_fake():
    FakeClient.calls = []
    FakeClient.script = [
        {"type": "thinking_delta", "text": "思考片段"},
        {"type": "text_delta", "text": "回答A"},
        {"type": "text_delta", "text": "回答B"},
        {"type": "message_stop", "usage": {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 8}},
    ]
    yield


# --------------------------------------------------------------------- 参数构造

def test_attachments_https_url():
    blocks = mm_chat.attachments_to_blocks([FakeAttachment("image_url", "https://x.io/a.png")])
    assert blocks == [{"type": "image", "source": {"type": "url", "url": "https://x.io/a.png"}}]


def test_attachments_base64_data_url():
    blocks = mm_chat.attachments_to_blocks([FakeAttachment("image_url", "data:image/webp;base64,QUJD")])
    assert blocks[0]["source"]["type"] == "base64"
    assert blocks[0]["source"]["media_type"] == "image/webp"
    assert blocks[0]["source"]["data"] == "QUJD"


def test_attachments_reject_non_image():
    with pytest.raises(MiniMaxAPIError):
        mm_chat.attachments_to_blocks([FakeAttachment("video_url", "https://x.io/v.mp4")])


def test_thinking_payload_disabled():
    assert mm_chat.build_thinking_payload(False, _settings(), 8_000) is None


def test_thinking_budget_clamped_to_min():
    settings = _settings(thinking_budget=256)
    payload = mm_chat.build_thinking_payload(True, settings, 8_000)
    assert payload == {"type": "enabled", "budget_tokens": 1_024}


def test_thinking_budget_clamped_below_max_tokens():
    settings = _settings(thinking_budget=65_536, max_tokens=4_000)
    payload = mm_chat.build_thinking_payload(True, settings, 2_000)
    # 协议约束：1024 ≤ budget < max_tokens（max_tokens ≤ 2048 时钉在 1024）
    assert 1_024 <= payload["budget_tokens"] < 2_000

    payload2 = mm_chat.build_thinking_payload(True, settings, 8_000)
    assert payload2["budget_tokens"] == 8_000 - 1_024


def test_convert_usage_with_cache_read():
    usage = mm_chat.convert_usage({"input_tokens": 100, "output_tokens": 40, "cache_read_input_tokens": 60})
    assert usage["prompt_tokens"] == 100
    assert usage["completion_tokens"] == 40
    assert usage["total_tokens"] == 140
    assert usage["cache_read_input_tokens"] == 60
    assert usage["prompt_tokens_details"]["cached_tokens"] == 60


def test_convert_usage_none():
    assert mm_chat.convert_usage(None) is None
    assert mm_chat.convert_usage({}) is None


def test_extract_web_docs_filters_result_items():
    block = {"content": [
        {"type": "web_search_result", "title": "A", "url": "https://a.io", "page_age": "2026-01-01"},
        {"type": "web_search_result", "title": "no-url", "url": ""},
        {"type": "other"},
    ]}
    docs = mm_chat.extract_web_docs(block)
    assert len(docs) == 1
    assert docs[0]["url"] == "https://a.io"
    assert docs[0]["native_search"] is True


def test_extract_web_docs_accepts_gateway_result_shapes_and_deduplicates():
    block = {
        "results": [
            {"title": "A", "link": "https://a.io", "snippet": "摘要 A"},
            {"name": "B", "href": "https://b.io", "description": "摘要 B"},
        ],
        "content": [
            {"type": "search_result", "title": "A again", "url": "https://a.io", "text": "重复"},
        ],
    }
    docs = mm_chat.extract_web_docs(block)
    assert [doc["url"] for doc in docs] == ["https://a.io", "https://b.io"]
    assert docs[0]["content"] == "摘要 A"
    assert docs[1]["title"] == "B"


# --------------------------------------------------------------------- 事件契约

def test_standard_stream_event_contract(monkeypatch):
    monkeypatch.setattr(mm_chat, "MiniMaxClient", FakeClient)
    memory = FakeMemoryEngine()
    chunks = list(mm_chat.generate_minimax_chat_events(
        FakeRequest(message="hi", session_id="s1"),
        _settings(),
        None,
        wants_web=False,
        use_deep=False,
        memory_engine=memory,
    ))
    events = _parse_events(chunks)
    names = [n for n, _ in events]

    # 首尾节点闭环
    assert names[0] == "node" and events[0][1]["node_name"] == "MiniMax · MiniMax-M3"
    assert events[0][1]["status"] == "processing"
    # token 顺序拼接
    tokens = [p["token"] for n, p in events if n == "token"]
    assert tokens == ["回答A", "回答B"]
    # thinking_delta 透传（thinking_enabled 默认 True 且 mode=deep 才开——此处 use_deep=False + standard → 关）
    # reasoning 事件不应出现（思考未开启时服务端不该发 thinking 块；脚本发了也只透传不记账 reasoning_len）
    done = next(p for n, p in events if n == "done")
    assert done["answer"] == "回答A回答B"
    assert done["model"] == "MiniMax-M3"
    assert done["wants_web"] is False
    # usage 已转换为 OpenAI 风格
    assert done["usage"]["prompt_tokens"] == 10
    assert done["usage"]["cache_read_input_tokens"] == 8
    # 记忆落账：user + assistant
    roles = [r for _, r, _ in memory.turns]
    assert roles == ["user", "assistant"]


def test_web_mode_placeholder_and_real_docs(monkeypatch):
    monkeypatch.setattr(mm_chat, "MiniMaxClient", FakeClient)
    FakeClient.script = [
        {"type": "server_tool_use", "block": {"id": "s1", "name": "web_search", "input": {"query": "天气"}}},
        {"type": "web_search_tool_result", "block": {"content": [
            {"type": "web_search_result", "title": "天气网", "url": "https://w.io"}
        ]}},
        {"type": "text_delta", "text": "晴"},
        {"type": "message_stop", "usage": {"input_tokens": 1, "output_tokens": 1}},
    ]
    chunks = list(mm_chat.generate_minimax_chat_events(
        FakeRequest(message="天气", mode="web"),
        _settings(),
        None,
        wants_web=True,
        use_deep=False,
        memory_engine=FakeMemoryEngine(),
    ))
    events = _parse_events(chunks)

    # 占位 web_docs 先行
    web_docs_events = [p for n, p in events if n == "web_docs"]
    assert web_docs_events[0]["placeholder"] is True
    # server_tool_use → 进度节点
    search_node = next(p for n, p in events if n == "node" and p.get("node_name") == "web_search")
    assert "天气" in search_node["message"]
    # done 携带真实引用
    done = next(p for n, p in events if n == "done")
    assert done["web_docs"][0]["url"] == "https://w.io"
    # 请求参数：tools 含 web_search server tool
    call = FakeClient.calls[0]
    assert call["tools"][0]["type"] == "web_search_20250305"
    assert call["tool_choice"] == {"type": "tool", "name": "web_search"}


def test_deep_mode_thinking_payload_sent(monkeypatch):
    monkeypatch.setattr(mm_chat, "MiniMaxClient", FakeClient)
    list(mm_chat.generate_minimax_chat_events(
        FakeRequest(message="难题", mode="deep"),
        _settings(thinking_budget=2_048),
        None,
        wants_web=False,
        use_deep=True,
        memory_engine=FakeMemoryEngine(),
    ))
    call = FakeClient.calls[0]
    assert call["thinking"] == {"type": "enabled", "budget_tokens": 2_048}


def test_mcp_system_prompt_and_attachments(monkeypatch):
    monkeypatch.setattr(mm_chat, "MiniMaxClient", FakeClient)
    request = FakeRequest(message="看图", attachments=[FakeAttachment("image_url", "https://x.io/a.png")])
    list(mm_chat.generate_minimax_chat_events(
        request, _settings(), "MCP 数据注入",
        wants_web=False, use_deep=False, memory_engine=FakeMemoryEngine(),
    ))
    call = FakeClient.calls[0]
    assert call["system"] == "MCP 数据注入"
    last_msg = call["messages"][-1]
    assert last_msg["role"] == "user"
    assert last_msg["content"][0]["type"] == "image"
    assert last_msg["content"][-1] == {"type": "text", "text": "看图"}


def test_memory_window_injected_into_messages(monkeypatch):
    monkeypatch.setattr(mm_chat, "MiniMaxClient", FakeClient)
    memory = FakeMemoryEngine()
    memory.turns = [("s1", "user", "旧问题"), ("s1", "assistant", "旧回答")]
    list(mm_chat.generate_minimax_chat_events(
        FakeRequest(message="新问题", session_id="s1"),
        _settings(),
        None,
        wants_web=False, use_deep=False, memory_engine=memory,
    ))
    messages = FakeClient.calls[0]["messages"]
    # 历史滑窗（[:-1] 排除刚 push 的当前轮）+ 当前消息
    assert [m["content"] for m in messages] == ["旧问题", "旧回答", "新问题"]


def test_api_error_yields_error_event(monkeypatch):
    class BoomClient:
        def __init__(self, api_key, base_url="x", timeout=1.0):
            pass

        def stream_message(self, **kwargs):
            raise MiniMaxAPIError("MiniMax API Key 无效或无权限", status_code=401)
            yield  # pragma: no cover

    monkeypatch.setattr(mm_chat, "MiniMaxClient", BoomClient)
    chunks = list(mm_chat.generate_minimax_chat_events(
        FakeRequest(), _settings(), None,
        wants_web=False, use_deep=False, memory_engine=FakeMemoryEngine(),
    ))
    events = _parse_events(chunks)
    err = next(p for n, p in events if n == "error")
    assert err["code"] == "MINIMAX_401"
    assert "API Key" in err["message"]


def test_active_cache_breakpoint_injected_for_m27(monkeypatch):
    monkeypatch.setattr(mm_chat, "MiniMaxClient", FakeClient)
    FakeClient.script = [{"type": "message_stop", "usage": {"input_tokens": 1, "output_tokens": 1}}]
    list(mm_chat.generate_minimax_chat_events(
        FakeRequest(message="hi"),
        _settings(model_id="MiniMax-M2.7"),
        "长系统提示词",
        wants_web=True, use_deep=False, memory_engine=FakeMemoryEngine(),
    ))
    call = FakeClient.calls[0]
    # M2.7 支持主动缓存：system 尾块 + tools 尾项断点
    assert isinstance(call["system"], list)
    assert call["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert call["tools"][-1]["cache_control"] == {"type": "ephemeral"}


def test_m3_no_cache_control_leak(monkeypatch):
    monkeypatch.setattr(mm_chat, "MiniMaxClient", FakeClient)
    FakeClient.script = [{"type": "message_stop", "usage": {"input_tokens": 1, "output_tokens": 1}}]
    list(mm_chat.generate_minimax_chat_events(
        FakeRequest(message="hi"),
        _settings(model_id="MiniMax-M3"),  # M3 不支持主动缓存
        "系统提示",
        wants_web=False, use_deep=False, memory_engine=FakeMemoryEngine(),
    ))
    call = FakeClient.calls[0]
    # system 保持纯字符串，永不携带 cache_control（M3 携带会报错）
    assert isinstance(call["system"], str)
    assert call["tools"] is None
