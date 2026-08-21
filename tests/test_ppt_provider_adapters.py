from __future__ import annotations

import ipaddress

import pytest

from ppt_materials import (
    AiImageAdapter,
    FirecrawlSearchAdapter,
    NativeSearchAdapter,
    OpenAICompatibleNativeSearchAdapter,
    QwenDashScopeSearchAdapter,
    GlmWebSearchAdapter,
    SettingsAiImageAdapter,
    SettingsNarrativeGenerator,
    ProviderNotConfigured,
    SafeImageDownloader,
    SourceLedger,
    UnsafeSourceUrl,
    generate_required_ai_images,
    WebPageImageExtractor,
    _streaming_json_request,
    build_settings_search_adapters,
)


def test_firecrawl_adapter_requires_key_without_leaking_secret() -> None:
    adapter = FirecrawlSearchAdapter(endpoint="https://firecrawl.example/search", api_key=None)

    with pytest.raises(ProviderNotConfigured) as error:
        adapter("agent research", 20)

    assert error.value.code == "PPT_PROVIDER_NOT_CONFIGURED"
    assert "api" not in str(error.value).lower()


def test_firecrawl_adapter_normalizes_response_and_caps_limit() -> None:
    calls: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def request_json(endpoint: str, headers: dict[str, str], payload: dict[str, object]):
        calls.append((endpoint, headers, payload))
        return {"data": [{"title": "One", "url": "https://example.com/one"}, {"url": "https://example.com/two"}]}

    adapter = FirecrawlSearchAdapter(
        endpoint="https://firecrawl.example/search",
        api_key="test-key",
        request_json=request_json,
    )

    result = adapter("agent research", 99)

    assert result == [
        {"title": "One", "url": "https://example.com/one"},
        {"title": "", "url": "https://example.com/two"},
    ]
    assert calls == [
        (
            "https://firecrawl.example/search",
            {"Authorization": "Bearer test-key", "Content-Type": "application/json"},
            {"query": "agent research", "limit": 20},
        )
    ]


def test_native_search_adapter_uses_qwen_or_glm_endpoint_contract() -> None:
    calls: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def request_json(endpoint: str, headers: dict[str, str], payload: dict[str, object]):
        calls.append((endpoint, headers, payload))
        return {"results": [{"title": "Native source", "link": "https://example.com/native"}]}

    adapter = NativeSearchAdapter(
        "glm",
        endpoint="https://glm.example/search",
        api_key="glm-key",
        request_json=request_json,
    )

    assert adapter("native search", 50) == [{"title": "Native source", "url": "https://example.com/native"}]
    assert calls[0] == (
        "https://glm.example/search",
        {"Authorization": "Bearer glm-key", "Content-Type": "application/json"},
        {"query": "native search", "limit": 20},
    )


def test_settings_native_search_adapter_uses_glm_web_search_contract() -> None:
    calls: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def request_json(endpoint: str, headers: dict[str, str], payload: dict[str, object]):
        calls.append((endpoint, headers, payload))
        return {"choices": [{"message": {"content": "参考 https://example.com/native-result"}}]}

    adapter = OpenAICompatibleNativeSearchAdapter(
        "glm",
        base_url="https://open.bigmodel.cn/api/paas/v4",
        api_key="glm-key",
        model="glm-5.1",
        request_json=request_json,
    )

    assert adapter("native search", 20) == [{"title": "native search", "url": "https://example.com/native-result"}]
    assert calls[0][0] == "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    assert calls[0][1]["Authorization"] == "Bearer glm-key"
    assert calls[0][2]["tools"]
    assert calls[0][2]["stream"] is True


def test_settings_native_search_adapter_matches_qwen_native_mode_contract() -> None:
    calls: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def request_json(endpoint: str, headers: dict[str, str], payload: dict[str, object]):
        calls.append((endpoint, headers, payload))
        return {
            "search_info": {
                "search_results": [
                    {"index": 1, "title": "Qwen source", "url": "https://example.com/qwen"}
                ]
            }
        }

    adapter = OpenAICompatibleNativeSearchAdapter(
        "qwen",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key="qwen-key",
        model="qwen3.7-plus",
        request_json=request_json,
    )

    assert adapter("native search", 20) == [{"title": "Qwen source", "url": "https://example.com/qwen"}]
    assert calls[0][0] == "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    assert calls[0][2]["stream"] is True
    assert calls[0][2]["enable_search"] is True
    assert calls[0][2]["search_options"] == {
        "search_strategy": "turbo",
        "forced_search": True,
    }


def test_settings_narrative_generator_writes_structured_slide_section() -> None:
    calls: list[tuple[str, dict[str, object]]] = []

    def request_json(endpoint: str, headers: dict[str, str], payload: dict[str, object]):
        calls.append((endpoint, payload))
        return {"choices": [{"message": {"content": '{"title":"真实标题","subtitle":"观点","body":"这是正文段落。","keyPoints":["事实"],"speakerNotes":"备注","sourceUrls":["https://example.com/source"]}'}}]}

    generator = SettingsNarrativeGenerator(
        provider="qwen",
        model="qwen3.7-plus",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key="qwen-key",
        request_json=request_json,
    )
    result = generator.generate_slide(
        prompt="人工智能发展",
        slide={"ordinal": 2, "section": "背景", "direction": "解释变化"},
        chapter=1,
        total_slides=16,
        evidence=[{"title": "来源", "url": "https://example.com/source"}],
        previous_sections=[],
    )

    assert result["title"] == "真实标题"
    assert result["ordinal"] == 2
    assert calls[0][0].endswith("/chat/completions")
    assert calls[0][1]["response_format"] == {"type": "json_object"}


def test_qwen_dashscope_search_adapter_returns_native_sources() -> None:
    calls: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def request_json(endpoint: str, headers: dict[str, str], payload: dict[str, object]):
        calls.append((endpoint, headers, payload))
        return {
            "output": {
                "search_info": {
                    "search_results": [
                        {"index": 1, "title": "Qwen native source", "url": "https://example.com/qwen-native", "snippet": "摘要"}
                    ]
                }
            }
        }

    adapter = QwenDashScopeSearchAdapter(
        api_key="qwen-key",
        model="qwen3.7-plus",
        request_json=request_json,
    )

    assert adapter("native search", 20) == [{"title": "Qwen native source", "url": "https://example.com/qwen-native"}]
    assert calls[0][0] == "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation"
    assert calls[0][1]["X-DashScope-SSE"] == "enable"
    assert calls[0][2]["model"] == "qwen-plus"
    assert calls[0][2]["parameters"]["enable_search"] is True
    assert calls[0][2]["parameters"]["search_options"]["enable_source"] is True


def test_glm_web_search_adapter_returns_structured_sources() -> None:
    calls: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def request_json(endpoint: str, headers: dict[str, str], payload: dict[str, object]):
        calls.append((endpoint, headers, payload))
        return {"search_result": [{"title": "GLM source", "link": "https://example.com/glm", "content": "摘要"}]}

    adapter = GlmWebSearchAdapter(api_key="glm-key", request_json=request_json)

    assert adapter("native search", 20) == [{"title": "GLM source", "url": "https://example.com/glm"}]
    assert calls[0][0] == "https://open.bigmodel.cn/api/paas/v4/web_search"
    assert calls[0][2] == {
        "search_query": "native search",
        "search_engine": "search_pro",
        "search_intent": False,
        "count": 20,
        "search_recency_filter": "noLimit",
        "content_size": "high",
    }


def test_settings_factory_uses_structured_native_search_adapters(monkeypatch: pytest.MonkeyPatch) -> None:
    class ServiceStore:
        def load(self):
            return type("Service", (), {"firecrawl_api_key": ""})()

    class ModelStore:
        def load(self, provider: str):
            return type(
                "Model",
                (),
                {
                    "api_key": f"{provider}-key",
                    "model_id": "qwen-plus" if provider == "qwen" else "glm-5.1",
                    "base_url": "https://example.com/v1",
                    "temperature": 1.0,
                    "max_tokens": 1000,
                },
            )()

    monkeypatch.setattr("model_settings.ServiceSettingsStore", ServiceStore)
    monkeypatch.setattr("model_settings.ModelSettingsStore", ModelStore)
    adapters = build_settings_search_adapters(request_json=lambda *_args: {})

    assert isinstance(adapters["qwen"], QwenDashScopeSearchAdapter)
    assert isinstance(adapters["glm"], GlmWebSearchAdapter)


def test_streaming_native_request_collects_search_info_frames(monkeypatch: pytest.MonkeyPatch) -> None:
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self, _limit: int) -> bytes:
            return (
                b"data: {\"choices\": [{\"delta\": {\"content\": \"answer\"}}]}\n\n"
                b"data: {\"search_info\": {\"search_results\": [{\"title\": \"Source\", \"url\": \"https://example.com/source\"}]}}\n\n"
                b"data: [DONE]\n\n"
            )

    monkeypatch.setattr("ppt_materials.urllib.request.urlopen", lambda *_args, **_kwargs: Response())
    result = _streaming_json_request(
        "https://example.com/chat/completions",
        {"Authorization": "Bearer test"},
        {"stream": True},
    )

    assert len(result["stream_frames"]) == 2
    assert result["stream_frames"][1]["search_info"]["search_results"][0]["url"] == "https://example.com/source"


def test_safe_image_downloader_rejects_private_dns_and_enforces_bytes_and_mime() -> None:
    def private_resolver(*_args, **_kwargs):
        return [(None, None, None, None, ("127.0.0.1", 0))]

    downloader = SafeImageDownloader(opener=lambda _request: None, resolver=private_resolver)
    with pytest.raises(UnsafeSourceUrl):
        downloader.download("https://cdn.example/image.png")

    def public_resolver(*_args, **_kwargs):
        return [(None, None, None, None, (str(ipaddress.ip_address("93.184.216.34")), 0))]

    class Response:
        headers = {"Content-Type": "image/png", "Content-Length": "5"}
        status = 200

        def __init__(self) -> None:
            self.reads = 0

        def geturl(self) -> str:
            return "https://cdn.example/image.png"

        def read(self, _size: int = -1) -> bytes:
            self.reads += 1
            return b"12345" if self.reads == 1 else b""

        def close(self) -> None:
            return None

    downloader = SafeImageDownloader(opener=lambda _request: Response(), resolver=public_resolver, max_bytes=5)
    downloaded = downloader.download("https://cdn.example/image.png")

    assert downloaded.mime_type == "image/png"
    assert downloaded.content == b"12345"
    assert downloaded.byte_size == 5
    assert len(downloaded.sha256) == 64


def test_safe_image_downloader_rejects_redirects_oversize_and_non_images() -> None:
    def public_resolver(*_args, **_kwargs):
        return [(None, None, None, None, ("93.184.216.34", 0))]

    class Response:
        def __init__(self, *, content_type: str, content_length: str | None, body: bytes, final_url: str):
            self.headers = {"Content-Type": content_type}
            if content_length is not None:
                self.headers["Content-Length"] = content_length
            self.body = body
            self.final_url = final_url

        def geturl(self) -> str:
            return self.final_url

        def read(self, _size: int = -1) -> bytes:
            return self.body

        def close(self) -> None:
            return None

    with pytest.raises(UnsafeSourceUrl):
        SafeImageDownloader(
            opener=lambda _request: Response(
                content_type="image/png",
                content_length=None,
                body=b"ok",
                final_url="https://evil.example/image.png",
            ),
            resolver=public_resolver,
        ).download("https://cdn.example/image.png")


    with pytest.raises(ValueError, match="size"):
        SafeImageDownloader(
            opener=lambda _request: Response(
                content_type="image/png",
                content_length="6",
                body=b"123456",
                final_url="https://cdn.example/image.png",
            ),
            resolver=public_resolver,
            max_bytes=5,
        ).download("https://cdn.example/image.png")

    with pytest.raises(ValueError, match="image MIME"):
        SafeImageDownloader(
            opener=lambda _request: Response(
                content_type="text/html",
                content_length="2",
                body=b"ok",
                final_url="https://cdn.example/image.png",
            ),
            resolver=public_resolver,
        ).download("https://cdn.example/image.png")


def test_safe_image_downloader_rejects_tiny_raster_material() -> None:
    def public_resolver(*_args, **_kwargs):
        return [(None, None, None, None, ("93.184.216.34", 0))]

    class Response:
        headers = {"Content-Type": "image/png"}

        def __init__(self) -> None:
            self.reads = 0

        def geturl(self) -> str:
            return "https://cdn.example/icon.png"

        def read(self, _size: int = -1) -> bytes:
            # Minimal PNG header declaring a 60x60 image; pixel decoding is
            # intentionally unnecessary for the content-quality gate.
            self.reads += 1
            return b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + (60).to_bytes(4, "big") + (60).to_bytes(4, "big") if self.reads == 1 else b""

        def close(self) -> None:
            return None

    with pytest.raises(ValueError, match="dimensions"):
        SafeImageDownloader(opener=lambda _request: Response(), resolver=public_resolver).download("https://cdn.example/icon.png")


def test_source_ledger_records_downloaded_web_image_metadata() -> None:
    def public_resolver(*_args, **_kwargs):
        return [(None, None, None, None, ("93.184.216.34", 0))]

    class Response:
        headers = {"Content-Type": "image/webp"}

        def __init__(self) -> None:
            self.reads = 0

        def geturl(self) -> str:
            return "https://cdn.example/image.webp"

        def read(self, _size: int = -1) -> bytes:
            self.reads += 1
            return b"webp" if self.reads == 1 else b""

        def close(self) -> None:
            return None

    ledger = SourceLedger()
    item = ledger.add_downloaded_web_image(
        "https://cdn.example/image.webp",
        page_url="https://example.com/article",
        downloader=SafeImageDownloader(opener=lambda _request: Response(), resolver=public_resolver),
        alt="A source image",
    )

    assert item["mimeType"] == "image/webp"
    assert item["byteSize"] == 4
    assert item["sha256"]
    assert item["license"] == "UNVERIFIED"


def test_ai_image_adapter_and_required_roles() -> None:
    calls: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def request_json(endpoint: str, headers: dict[str, str], payload: dict[str, object]):
        calls.append((endpoint, headers, payload))
        return {"data": [{"url": "https://cdn.example/generated.png", "id": "generated-1"}]}

    adapter = AiImageAdapter(
        endpoint="https://images.example/generate",
        api_key="image-key",
        request_json=request_json,
    )
    generated = generate_required_ai_images(adapter, prompt="dark forest theory")

    assert [item["role"] for item in generated] == ["COVER", "MID_BACKGROUND", "END"]
    assert all(item["assetId"] == "generated-1" for item in generated)
    assert calls[0][1] == {"Authorization": "Bearer image-key", "Content-Type": "application/json"}
    assert calls[0][2]["role"] == "COVER"


def test_ai_image_adapter_requires_credentials() -> None:
    adapter = AiImageAdapter(endpoint="https://images.example/generate", api_key=None)
    with pytest.raises(ProviderNotConfigured):
        adapter.generate(role="COVER", prompt="cover")


def test_settings_ai_image_adapter_uses_glm_generation_contract() -> None:
    calls: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def request_json(endpoint: str, headers: dict[str, str], payload: dict[str, object]):
        calls.append((endpoint, headers, payload))
        return {"data": [{"id": "glm-image-1", "url": "https://cdn.example/generated.png"}]}

    adapter = SettingsAiImageAdapter(api_key="glm-key", request_json=request_json)
    assert adapter.generate(role="COVER", prompt="future teams") == {
        "role": "COVER",
        "assetId": "glm-image-1",
        "imageUrl": "https://cdn.example/generated.png",
    }
    assert calls[0][2]["model"] == "glm-image"
    assert calls[0][2]["size"] == "1728x960"
    assert "画面用途：COVER" in str(calls[0][2]["prompt"])


def test_web_page_image_extractor_reads_open_graph_and_img_sources() -> None:
    html = b'''<html><head><meta property="og:image" content="https://cdn.example/og.png"></head><body><img src="/images/hero.webp"></body></html>'''

    class Response:
        def read(self, _size: int = -1) -> bytes:
            return html

        def close(self) -> None:
            return None

    extractor = WebPageImageExtractor(opener=lambda _request: Response())
    assert extractor.extract("https://example.com/article", limit=2) == [
        "https://cdn.example/og.png",
        "https://example.com/images/hero.webp",
    ]


def test_web_page_image_extractor_skips_logos_and_small_icon_hints() -> None:
    html = b'''<meta property="og:image" content="https://cdn.example/logo-normal.png"><img src="https://cdn.example/image-w_60,h_60.png"><img src="/images/hero.webp">'''

    class Response:
        def read(self, _size: int = -1) -> bytes:
            return html

        def close(self) -> None:
            return None

    extractor = WebPageImageExtractor(opener=lambda _request: Response())
    assert extractor.extract("https://example.com/article", limit=3) == ["https://example.com/images/hero.webp"]
