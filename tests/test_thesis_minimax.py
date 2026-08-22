"""T12 写作链路 provider 化单测：默认 qwen 零回归 + minimax 分支行为。

不发起真实网络请求——MiniMaxClient.stream_message 通过 monkeypatch 替身注入。
"""

from __future__ import annotations

import json

import pytest

from thesis_writing import ThesisBodyRequest, ThesisOutlineRequest, ThesisReferenceRequest


def test_default_provider_is_qwen_for_zero_regression() -> None:
    """存量前端不传 provider：三个请求模型默认 qwen，行为与改造前完全一致。"""
    outline = ThesisOutlineRequest(instruction="智能体安全研究")
    reference = ThesisReferenceRequest(instruction="智能体安全研究", chapters=[{"id": "ch1", "title": "绪论"}])
    body = ThesisBodyRequest(title="论文", chapters=[{"id": "ch1", "title": "绪论"}])

    assert outline.provider == "qwen"
    assert reference.provider == "qwen"
    assert body.provider == "qwen"


def test_minimax_provider_accepted_by_all_requests() -> None:
    outline = ThesisOutlineRequest(instruction="智能体安全研究", provider="minimax")
    reference = ThesisReferenceRequest(
        instruction="智能体安全研究",
        chapters=[{"id": "ch1", "title": "绪论"}],
        provider="minimax",
    )
    body = ThesisBodyRequest(title="论文", chapters=[{"id": "ch1", "title": "绪论"}], provider="minimax")

    assert outline.provider == "minimax"
    assert reference.provider == "minimax"
    assert body.provider == "minimax"


def test_thesis_model_settings_swaps_minimax_base_url_to_compat(monkeypatch: pytest.MonkeyPatch) -> None:
    """minimax profile 的 Anthropic base_url 必须换成 OpenAI 兼容 /v1 端点。"""

    class FakeSettings:
        def __init__(self, base_url: str) -> None:
            self.provider = "minimax"
            self.api_key = "mm-key"
            self.base_url = base_url
            self.model_id = "MiniMax-M3"

        def model_copy(self, *, update: dict) -> "FakeSettings":
            clone = FakeSettings(self.base_url)
            clone.__dict__.update(update)
            return clone

    captured: list[str] = []

    class Store:
        def load(self, provider: str) -> FakeSettings:
            captured.append(provider)
            return FakeSettings("https://api.minimaxi.com/anthropic")

    monkeypatch.setattr("main.model_settings_store", Store())

    from main import _thesis_model_settings

    settings = _thesis_model_settings("minimax")
    assert settings.base_url == "https://api.minimaxi.com/v1"
    assert settings.api_key == "mm-key"
    assert captured == ["minimax"]


def test_minimax_reference_generator_event_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    """minimax 参考资料检索：事件序列与千问 Deep Research 链路同构。"""
    from minimax.client import MiniMaxClient

    search_block = {
        "content": [
            {"type": "web_search_result", "title": "权威来源A", "url": "https://gov.example/a", "page_age": "2025-01"},
            {"type": "web_search_result", "title": "权威来源B", "url": "https://edu.example/b"},
        ]
    }

    def fake_stream_message(self, *, model, messages, max_tokens, tools, **_kwargs):
        assert model == "MiniMax-M3"
        assert tools and tools[0]["type"] == "web_search_20250305"
        yield {"type": "server_tool_use", "block": {"name": "web_search"}}
        yield {"type": "web_search_tool_result", "block": search_block}

    monkeypatch.setattr(MiniMaxClient, "stream_message", fake_stream_message)

    from main import generate_thesis_reference_events_via_minimax

    request = ThesisReferenceRequest(
        instruction="智能体安全研究",
        chapters=[
            {"id": "ch1", "title": "绪论", "summary": "研究背景"},
            {"id": "ch2", "title": "现状分析"},
        ],
        provider="minimax",
    )

    class FakeSettings:
        api_key = "mm-key"
        model_id = "MiniMax-M3"

    frames = list(generate_thesis_reference_events_via_minimax(request, FakeSettings()))

    names = [frame.split("\n")[0].removeprefix("event: ") for frame in frames]
    assert names == [
        "thesis_chapter_search_started",
        "thesis_reference_found",
        "thesis_reference_found",
        "thesis_chapter_search_completed",
        "thesis_chapter_search_started",
        "thesis_chapter_search_completed",
    ]

    first_found = json.loads(frames[1].split("data: ", 1)[1])
    assert first_found["chapter_id"] == "ch1"
    assert first_found["id"] == "ch1-ref-1"
    assert first_found["url"] == "https://gov.example/a"
    assert first_found["status"] == "found"

    completed = json.loads(frames[3].split("data: ", 1)[1])
    assert completed == {"type": "chapter_search_completed", "chapter_id": "ch1", "count": 2}
    empty_chapter = json.loads(frames[5].split("data: ", 1)[1])
    assert empty_chapter == {"type": "chapter_search_completed", "chapter_id": "ch2", "count": 0}


def test_minimax_reference_generator_dedupes_urls_across_chapters(monkeypatch: pytest.MonkeyPatch) -> None:
    """跨章节 URL 去重：同一来源不得在两章重复出现。"""
    from minimax.client import MiniMaxClient

    search_block = {
        "content": [
            {"type": "web_search_result", "title": "共享来源", "url": "https://gov.example/shared"},
        ]
    }

    def fake_stream_message(self, *, model, messages, max_tokens, tools, **_kwargs):
        yield {"type": "web_search_tool_result", "block": search_block}

    monkeypatch.setattr(MiniMaxClient, "stream_message", fake_stream_message)

    from main import generate_thesis_reference_events_via_minimax

    request = ThesisReferenceRequest(
        instruction="智能体安全研究",
        chapters=[
            {"id": "ch1", "title": "绪论"},
            {"id": "ch2", "title": "现状"},
        ],
        provider="minimax",
    )

    class FakeSettings:
        api_key = "mm-key"
        model_id = "MiniMax-M3"

    frames = list(generate_thesis_reference_events_via_minimax(request, FakeSettings()))
    found_payloads = [
        json.loads(frame.split("data: ", 1)[1])
        for frame in frames
        if frame.startswith("event: thesis_reference_found")
    ]
    assert len(found_payloads) == 1
    assert found_payloads[0]["chapter_id"] == "ch1"
    completed_second = [
        json.loads(frame.split("data: ", 1)[1])
        for frame in frames
        if frame.startswith("event: thesis_chapter_search_completed") and '"ch2"' in frame
    ]
    assert completed_second[0]["count"] == 0


def test_minimax_reference_generator_emits_failure_event(monkeypatch: pytest.MonkeyPatch) -> None:
    """单章检索失败：chapter_search_failed 事件透出，不阻断后续章节。"""
    from minimax.client import MiniMaxClient

    def fake_stream_message(self, *, model, messages, max_tokens, tools, **_kwargs):
        raise RuntimeError("connection reset")
        yield  # pragma: no cover - 生成器语法占位

    monkeypatch.setattr(MiniMaxClient, "stream_message", fake_stream_message)

    from main import generate_thesis_reference_events_via_minimax

    request = ThesisReferenceRequest(
        instruction="智能体安全研究",
        chapters=[{"id": "ch1", "title": "绪论"}],
        provider="minimax",
    )

    class FakeSettings:
        api_key = "mm-key"
        model_id = "MiniMax-M3"

    frames = list(generate_thesis_reference_events_via_minimax(request, FakeSettings()))
    names = [frame.split("\n")[0].removeprefix("event: ") for frame in frames]
    assert names == ["thesis_chapter_search_started", "thesis_chapter_search_failed"]
    payload = json.loads(frames[1].split("data: ", 1)[1])
    assert payload["chapter_id"] == "ch1"
    assert "connection reset" in payload["message"]
