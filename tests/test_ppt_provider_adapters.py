from __future__ import annotations

import ipaddress

import pytest

from ppt_materials import (
    AiImageAdapter,
    FirecrawlSearchAdapter,
    NativeSearchAdapter,
    ProviderNotConfigured,
    SafeImageDownloader,
    SourceLedger,
    UnsafeSourceUrl,
    generate_required_ai_images,
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
