"""minimax 包单元测试：client SSE 解析 / 错误映射 / 缓存断点 / 能力矩阵 / think 剥离。

运行：python -m pytest tests/test_minimax_client.py -q
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from minimax.client import MiniMaxClient, MiniMaxAPIError, _map_http_error
from minimax.caching import apply_cache_breakpoints, supports_active_cache
from minimax.openai_compat import ThinkTagStreamer, strip_think_tags
from model_settings import MODEL_CATALOG, capabilities_for_model


# ---------------------------------------------------------------- SSE 解析
class _FakeSSEResponse:
    """把多行 SSE 文本伪装成 httpx 流式响应（iter_bytes 逐行产出）。"""

    def __init__(self, sse_text: str):
        self._lines = [f"{line}\n".encode("utf-8") for line in sse_text.split("\n")]

    def iter_bytes(self):
        yield from self._lines


class _ChunkedSSEResponse:
    """把多行 SSE 文本切成多块任意大小的字节块（模拟真实 iter_bytes 跨行场景）。

    Why: 真实 MiniMax 服务端每次返回的 chunk 包含完整多行 SSE 帧
    （"event: x\\ndata: {...}\\n\\n"），单 chunk 不能整体当一行处理；
    客户端必须按 \\n 切出完整行，否则所有 data: 都被 skip → 0 字 bug。
    """

    def __init__(self, sse_text: str, chunk_size: int = 73):
        self._data = sse_text.encode("utf-8")
        self._chunk_size = chunk_size

    def iter_bytes(self):
        for i in range(0, len(self._data), self._chunk_size):
            yield self._data[i : i + self._chunk_size]


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}"


# tool_use 参数分片：拼接后必须是合法 JSON
PART1 = '{"loc'
PART2 = 'ation": "上海"}'


FULL_STREAM = "\n".join([
    _sse("ping", {}),
    _sse("message_start", {"type": "message_start", "message": {"usage": {"input_tokens": 100}}}),
    _sse("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}}),
    _sse("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "让我想想"}}),
    _sse("content_block_stop", {"type": "content_block_stop", "index": 0}),
    _sse("content_block_start", {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}),
    _sse("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "你好"}}),
    _sse("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "世界"}}),
    _sse("content_block_stop", {"type": "content_block_stop", "index": 1}),
    _sse("content_block_start", {"type": "content_block_start", "index": 2, "content_block": {"type": "tool_use", "id": "tu_1", "name": "get_weather"}}),
    _sse("content_block_delta", {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": PART1}}),
    _sse("content_block_delta", {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": PART2}}),
    _sse("content_block_stop", {"type": "content_block_stop", "index": 2}),
    _sse("content_block_start", {"type": "content_block_start", "index": 3, "content_block": {"type": "server_tool_use", "id": "s1", "name": "web_search", "input": {"query": "天气"}}}),
    _sse("content_block_start", {"type": "content_block_start", "index": 4, "content_block": {"type": "web_search_tool_result", "tool_use_id": "s1", "content": [{"type": "web_search_result", "title": "天气网", "url": "https://w.io", "content": "晴"}]}}),
    _sse("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 20, "cache_read_input_tokens": 88}}),
    _sse("message_stop", {"type": "message_stop"}),
    "",
])


def test_stream_parses_all_block_types():
    events = list(MiniMaxClient._iter_sse_events(_FakeSSEResponse(FULL_STREAM)))
    types = [e["type"] for e in events]

    assert types[0] == "message_start"
    assert events[0]["usage"]["input_tokens"] == 100
    # thinking delta
    td = next(e for e in events if e["type"] == "thinking_delta")
    assert td["text"] == "让我想想"
    # text deltas 顺序拼接
    texts = [e["text"] for e in events if e["type"] == "text_delta"]
    assert texts == ["你好", "世界"]
    # tool_use input_json_delta 拼接成完整 JSON
    tu = next(e for e in events if e["type"] == "tool_use")
    assert tu["block"]["id"] == "tu_1"
    assert tu["block"]["name"] == "get_weather"
    assert tu["block"]["input"] == {"location": "上海"}
    # server tool 事件
    stu = next(e for e in events if e["type"] == "server_tool_use")
    assert stu["block"]["input"]["query"] == "天气"
    wsr = next(e for e in events if e["type"] == "web_search_tool_result")
    assert wsr["block"]["content"][0]["title"] == "天气网"
    # message_delta 携带缓存命中
    md = next(e for e in events if e["type"] == "message_delta")
    assert md["stop_reason"] == "end_turn"
    assert md["usage"]["cache_read_input_tokens"] == 88
    # message_stop 汇总
    ms = next(e for e in events if e["type"] == "message_stop")
    assert ms["usage"]["output_tokens"] == 20
    assert ms["usage"]["input_tokens"] == 100


def test_stream_normalizes_gateway_search_result_aliases():
    """兼容网关把搜索结果命名为 web_search_result/server_tool_result 或顶层事件。"""
    sse = "\n".join([
        _sse("content_block_start", {
            "type": "content_block_start", "index": 0,
            "content_block": {"type": "web_search_result", "content": [{"url": "https://a.io"}]},
        }),
        _sse("server_tool_result", {
            "type": "server_tool_result", "content": [{"url": "https://b.io"}],
        }),
        "",
    ])
    events = list(MiniMaxClient._iter_sse_events(_FakeSSEResponse(sse)))
    results = [event for event in events if event["type"] == "web_search_tool_result"]
    assert len(results) == 2
    assert results[0]["block"]["type"] == "web_search_tool_result"
    assert results[1]["block"]["content"][0]["url"] == "https://b.io"


def test_stream_error_event_raises():
    sse = _sse("error", {"type": "error", "error": {"type": "overloaded_error", "message": " overloaded"}})
    try:
        list(MiniMaxClient._iter_sse_events(_FakeSSEResponse(sse)))
        raise AssertionError("应当抛出 MiniMaxAPIError")
    except MiniMaxAPIError as exc:
        assert "overloaded" in exc.message


def test_stream_handles_multi_line_chunks():
    """iter_bytes 跨多行场景：单 chunk 包含多行 SSE 帧也必须正确切分（0 字 bug 修复）。"""
    text = _sse("message_start", {"type": "message_start", "message": {"usage": {"input_tokens": 5}}})
    text += "\n\n"
    text += _sse("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}})
    text += "\n\n"
    text += _sse("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "a"}})
    text += "\n\n"
    text += _sse("content_block_start", {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}})
    text += "\n\n"
    text += _sse("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "你好"}})
    text += "\n\n"
    text += _sse("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"}})
    text += "\n\n"
    text += _sse("message_stop", {"type": "message_stop"})
    text += "\n\n"

    # 单 chunk 全部内容（最坏情况：单次返回全部数据）
    events_one_chunk = list(MiniMaxClient._iter_sse_events(_ChunkedSSEResponse(text, chunk_size=10_000)))
    # 真实场景：73 字节切块（实测 MiniMax 每次约 100-300 字节）
    events_chunked = list(MiniMaxClient._iter_sse_events(_ChunkedSSEResponse(text, chunk_size=73)))

    for label, events in (("one_chunk", events_one_chunk), ("chunked_73", events_chunked)):
        types = [e["type"] for e in events]
        assert "text_delta" in types, f"[{label}] 漏掉 text_delta → 0 字 bug: {types}"
        text_event = next(e for e in events if e["type"] == "text_delta")
        assert text_event["text"] == "你好", f"[{label}] text 内容丢失: {text_event}"
        assert text_event.get("index") == 1, f"[{label}] 应透传 index=1: {text_event}"
        thinking_event = next(e for e in events if e["type"] == "thinking_delta")
        assert thinking_event.get("index") == 0, f"[{label}] 应透传 index=0: {thinking_event}"


# ---------------------------------------------------------------- 错误映射
def test_error_mapping():
    assert "Key" in _map_http_error(401, "").message
    assert "限流" in _map_http_error(429, "").message
    err400 = _map_http_error(400, '{"detail":"bad thinking"}')
    assert "bad thinking" in err400.message
    assert "服务端" in _map_http_error(502, "").message


def test_client_requires_key():
    try:
        MiniMaxClient(api_key="")
        raise AssertionError("空 Key 应当被拒绝")
    except MiniMaxAPIError:
        pass


# ---------------------------------------------------------------- 缓存断点
def test_m3_no_active_cache():
    assert supports_active_cache("MiniMax-M3") is False
    system, tools = apply_cache_breakpoints("MiniMax-M3", system="你是助手", tools=[{"name": "t"}])
    # M3 请求体禁止携带 cache_control
    assert system == "你是助手"
    assert tools == [{"name": "t"}]


def test_m27_injects_breakpoints():
    assert supports_active_cache("MiniMax-M2.7") is True
    system, tools = apply_cache_breakpoints("MiniMax-M2.7", system="你是助手", tools=[{"name": "a"}, {"name": "b"}])
    # 字符串 system 转块列表并打点
    assert isinstance(system, list) and system[0]["cache_control"] == {"type": "ephemeral"}
    # tools 尾项打点、首项不打
    assert "cache_control" not in tools[0]
    assert tools[-1]["cache_control"] == {"type": "ephemeral"}


# ---------------------------------------------------------------- 能力矩阵
def test_catalog_and_capabilities():
    group = MODEL_CATALOG["minimax"]
    assert {v["model_id"] for v in group} == {
        "MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed",
        "MiniMax-M2.5", "MiniMax-M2.5-highspeed",
    }
    m3 = capabilities_for_model("MiniMax-M3")
    assert m3.supports_vision is True and m3.thinking_control == "minimax"
    m27 = capabilities_for_model("MiniMax-M2.7")
    assert m27.supports_vision is False and m27.supports_active_cache is True
    # 回归：既有三供应商不受影响
    assert capabilities_for_model("glm-5v-turbo").thinking_control == "glm"
    assert capabilities_for_model("qwen3.7-plus").thinking_control == "qwen_budget"
    assert capabilities_for_model("deepseek-v4-flash").thinking_control == "deepseek"


# ---------------------------------------------------------------- think 标签剥离
def test_strip_think_tags_whole_text():
    assert strip_think_tags("<think>推理</think>正文") == "正文"
    # 开标签截断（闭标签未到）：其后内容全部丢弃
    assert strip_think_tags("<think>推理还没结束") == ""


def test_think_tag_streamer_whole_block():
    s = ThinkTagStreamer()
    assert s.feed("<think>思考</think>答案") == "答案"
    assert s.flush() == ""


def test_think_tag_streamer_split_chunks():
    s = ThinkTagStreamer()
    out = s.feed("前段<thi")
    assert out == "前段"           # "<th" 前缀暂存，不放行
    out = s.feed("nk>思考中")
    assert out == ""               # 进入思考块，全部丢弃
    out = s.feed("还在想</th")
    assert out == ""               # 闭标签前缀暂存
    out = s.feed("ink>后段")
    assert out == "后段"
    assert s.flush() == ""


def test_think_tag_streamer_unclosed_keeps_pending_silent():
    s = ThinkTagStreamer()
    assert s.feed("正常") == "正常"
    assert s.feed("<think>未结束") == ""
    # 流终止：思考块未闭合 → 残留不放行
    assert s.flush() == ""


def test_think_tag_streamer_plain_text_passthrough():
    s = ThinkTagStreamer()
    chunks = ["你好", "世界", "1 < 2 且 3 > 2"]
    assert "".join(s.feed(c) for c in chunks) == "你好世界1 < 2 且 3 > 2"
    assert s.flush() == ""


if __name__ == "__main__":
    test_stream_parses_all_block_types()
    test_stream_error_event_raises()
    test_error_mapping()
    test_client_requires_key()
    test_m3_no_active_cache()
    test_m27_injects_breakpoints()
    test_catalog_and_capabilities()
    test_strip_think_tags_whole_text()
    test_think_tag_streamer_whole_block()
    test_think_tag_streamer_split_chunks()
    test_think_tag_streamer_unclosed_keeps_pending_silent()
    test_think_tag_streamer_plain_text_passthrough()
    print("ALL TESTS PASSED")
