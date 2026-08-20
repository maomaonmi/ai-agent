"""Provider adapters and safety gates for PPT research materials.

The module keeps external integrations behind small, injectable adapters. The
agent can run with deterministic demo material locally, while a configured
deployment can opt into Firecrawl/native search and an image model without
moving credentials into the domain model or browser.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import socket
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse
import re

from ppt_agent_loop import SearchBatch, SearchProvider


class UnsafeSourceUrl(ValueError):
    code = "PPT_UNSAFE_SOURCE_URL"


class ProviderNotConfigured(RuntimeError):
    code = "PPT_PROVIDER_NOT_CONFIGURED"


class ProviderRequestFailed(RuntimeError):
    code = "PPT_PROVIDER_REQUEST_FAILED"


SearchCallable = Callable[[str, int], Sequence[Mapping[str, object]]]
JsonRequest = Callable[[str, dict[str, str], dict[str, object]], Mapping[str, object]]

_MAX_SEARCH_RESULTS = 20
_MAX_JSON_BYTES = 2 * 1024 * 1024
_DEFAULT_IMAGE_MAX_BYTES = 8 * 1024 * 1024
_IMAGE_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"})
_AI_IMAGE_ROLES = ("COVER", "MID_BACKGROUND", "END")


def _validate_https_url(raw: str) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise UnsafeSourceUrl("source URL must use HTTPS")
    parsed = urlparse(raw.strip())
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise UnsafeSourceUrl("source URL must use HTTPS")
    if parsed.username or parsed.password:
        raise UnsafeSourceUrl("source URL must not include credentials")
    try:
        parsed.port
    except ValueError as exc:
        raise UnsafeSourceUrl("source URL has an invalid port") from exc
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".localhost") or hostname.endswith(".internal"):
        raise UnsafeSourceUrl("private hostnames are not allowed")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise UnsafeSourceUrl("private or reserved IP addresses are not allowed")
    return parsed.geturl()


def _default_json_request(endpoint: str, headers: dict[str, str], payload: dict[str, object]) -> Mapping[str, object]:
    """POST JSON with bounded response size and a generic public error."""

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(_MAX_JSON_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderRequestFailed("provider request failed") from exc
    if len(raw) > _MAX_JSON_BYTES:
        raise ProviderRequestFailed("provider response exceeded size limit")
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProviderRequestFailed("provider returned invalid JSON") from exc
    if not isinstance(decoded, Mapping):
        raise ProviderRequestFailed("provider returned an invalid response")
    return decoded


def _normalize_search_response(payload: Mapping[str, object]) -> list[dict[str, object]]:
    candidates: object = payload.get("data", payload.get("results", []))
    if isinstance(candidates, Mapping):
        candidates = candidates.get("results", [])
    if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes, bytearray)):
        raise ProviderRequestFailed("provider returned invalid search results")
    normalized: list[dict[str, object]] = []
    for candidate in candidates[:_MAX_SEARCH_RESULTS]:
        if not isinstance(candidate, Mapping):
            continue
        url = candidate.get("url") or candidate.get("link")
        if not isinstance(url, str):
            continue
        item: dict[str, object] = {"title": str(candidate.get("title", ""))[:500], "url": url}
        metadata = candidate.get("metadata") if isinstance(candidate.get("metadata"), Mapping) else {}
        image_url = candidate.get("imageUrl") or candidate.get("image_url") or candidate.get("thumbnail") or candidate.get("image") or metadata.get("image")
        if isinstance(image_url, str):
            item["imageUrl"] = image_url
        page_url = candidate.get("pageUrl") or candidate.get("page_url") or metadata.get("pageUrl")
        if isinstance(page_url, str):
            item["pageUrl"] = page_url
        normalized.append(item)
    return normalized


class FirecrawlSearchAdapter:
    """Firecrawl-backed search adapter used directly by the DeepSeek route."""

    provider = "firecrawl"

    def __init__(
        self,
        *,
        endpoint: str | None = None,
        api_key: str | None = None,
        request_json: JsonRequest | None = None,
    ) -> None:
        self.endpoint = endpoint or os.getenv("FIRECRAWL_SEARCH_URL", "https://api.firecrawl.dev/v1/search")
        self.api_key = api_key if api_key is not None else os.getenv("FIRECRAWL_API_KEY")
        self.request_json = request_json or _default_json_request

    def __call__(self, query: str, limit: int) -> list[dict[str, object]]:
        if not self.api_key or not self.endpoint:
            raise ProviderNotConfigured("firecrawl provider is not configured")
        _validate_https_url(self.endpoint)
        payload = self.request_json(
            self.endpoint,
            {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            {"query": query, "limit": min(limit, _MAX_SEARCH_RESULTS)},
        )
        return _normalize_search_response(payload)


class NativeSearchAdapter:
    """Adapter for a provider's own search API (Qwen or GLM)."""

    def __init__(
        self,
        provider: str,
        *,
        endpoint: str | None = None,
        api_key: str | None = None,
        request_json: JsonRequest | None = None,
    ) -> None:
        if provider not in {"qwen", "glm"}:
            raise ValueError("native search provider must be qwen or glm")
        self.provider = provider
        prefix = provider.upper()
        self.endpoint = endpoint if endpoint is not None else os.getenv(f"{prefix}_SEARCH_URL")
        self.api_key = api_key if api_key is not None else os.getenv(f"{prefix}_API_KEY")
        self.request_json = request_json or _default_json_request

    def __call__(self, query: str, limit: int) -> list[dict[str, object]]:
        if not self.api_key or not self.endpoint:
            raise ProviderNotConfigured(f"{self.provider} provider is not configured")
        _validate_https_url(self.endpoint)
        payload = self.request_json(
            self.endpoint,
            {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            {"query": query, "limit": min(limit, _MAX_SEARCH_RESULTS)},
        )
        return _normalize_search_response(payload)


class OpenAICompatibleNativeSearchAdapter:
    """Use a configured Qwen/GLM chat endpoint with its native web search mode."""

    def __init__(
        self,
        provider: str,
        *,
        base_url: str,
        api_key: str,
        model: str,
        request_json: JsonRequest | None = None,
    ) -> None:
        if provider not in {"qwen", "glm"}:
            raise ValueError("native search provider must be qwen or glm")
        self.provider = provider
        self.endpoint = base_url.rstrip("/") if base_url.rstrip("/").endswith("/chat/completions") else f"{base_url.rstrip('/')}/chat/completions"
        self.api_key = api_key
        self.model = model
        self.request_json = request_json or _default_json_request

    def __call__(self, query: str, limit: int) -> list[dict[str, object]]:
        if not self.api_key or not self.endpoint:
            raise ProviderNotConfigured(f"{self.provider} provider is not configured")
        _validate_https_url(self.endpoint)
        payload: dict[str, object] = {
            "model": self.model,
            "messages": [{"role": "user", "content": query}],
            "stream": False,
        }
        if self.provider == "qwen":
            payload.update({
                "enable_search": True,
                "search_options": {
                    "search_strategy": "turbo",
                    "forced_search": True,
                    "result_type": "search_result",
                },
            })
        else:
            payload.update({
                "tools": [{
                    "type": "web_search",
                    "web_search": {
                        "enable": True,
                        "searchEngine": "search_pro",
                        "searchResult": True,
                        "count": min(limit, _MAX_SEARCH_RESULTS),
                        "contentSize": "high",
                        "searchRecencyFilter": "noLimit",
                    },
                }],
                "tool_choice": "auto",
            })
        response = self.request_json(
            self.endpoint,
            {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            payload,
        )
        return _normalize_native_chat_response(response, query=query, limit=limit)


def _normalize_native_chat_response(payload: Mapping[str, object], *, query: str, limit: int) -> list[dict[str, object]]:
    """Extract citations from Qwen/GLM native-search chat responses."""

    candidates: list[dict[str, object]] = []

    def visit(value: object) -> None:
        if isinstance(value, Mapping):
            url = value.get("url") or value.get("link") or value.get("source_url")
            if isinstance(url, str) and url.startswith("https://"):
                item: dict[str, object] = {"title": str(value.get("title") or value.get("name") or query)[:500], "url": url}
                image_url = value.get("imageUrl") or value.get("image_url") or value.get("thumbnail")
                if isinstance(image_url, str): item["imageUrl"] = image_url
                page_url = value.get("pageUrl") or value.get("page_url")
                if isinstance(page_url, str): item["pageUrl"] = page_url
                if not any(existing["url"] == url for existing in candidates): candidates.append(item)
            for nested in value.values(): visit(nested)
        elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            for nested in value: visit(nested)
        elif isinstance(value, str):
            for url in re.findall(r"https://[^\s)\]}>,]+", value):
                clean_url = url.rstrip(".,;:!?\"")
                if not any(existing["url"] == clean_url for existing in candidates):
                    candidates.append({"title": query[:500], "url": clean_url})

    visit(payload)
    return candidates[: min(limit, _MAX_SEARCH_RESULTS)]


def build_default_search_adapters(
    *,
    env: Mapping[str, str] | None = None,
    request_json: JsonRequest | None = None,
) -> dict[str, SearchCallable]:
    """Build only adapters with complete credentials; never returns secret values."""

    settings = env or os.environ
    adapters: dict[str, SearchCallable] = {}
    firecrawl_key = settings.get("FIRECRAWL_API_KEY")
    if firecrawl_key:
        adapters["firecrawl"] = FirecrawlSearchAdapter(
            endpoint=settings.get("FIRECRAWL_SEARCH_URL"),
            api_key=firecrawl_key,
            request_json=request_json,
        )
        adapters["deepseek"] = adapters["firecrawl"]
    for provider in ("qwen", "glm"):
        key = settings.get(f"{provider.upper()}_API_KEY")
        endpoint = settings.get(f"{provider.upper()}_SEARCH_URL")
        if key and endpoint:
            adapters[provider] = NativeSearchAdapter(
                provider,
                endpoint=endpoint,
                api_key=key,
                request_json=request_json,
            )
    return adapters


def build_settings_search_adapters(*, request_json: JsonRequest | None = None) -> dict[str, SearchCallable]:
    """Build PPT search adapters from the same persisted settings as the app UI."""

    from model_settings import ModelSettingsStore, ServiceSettingsStore

    service = ServiceSettingsStore().load()
    models = ModelSettingsStore()
    adapters: dict[str, SearchCallable] = {}
    if service.firecrawl_api_key:
        endpoint = os.getenv("FIRECRAWL_SEARCH_URL", "https://api.firecrawl.dev/v1/search")
        adapters["firecrawl"] = FirecrawlSearchAdapter(endpoint=endpoint, api_key=service.firecrawl_api_key, request_json=request_json)
        adapters["deepseek"] = adapters["firecrawl"]
    for provider in ("qwen", "glm"):
        settings = models.load(provider)
        if settings.api_key:
            endpoint = os.getenv(f"{provider.upper()}_SEARCH_URL")
            if endpoint:
                adapters[provider] = NativeSearchAdapter(provider, endpoint=endpoint, api_key=settings.api_key, request_json=request_json)
            else:
                adapters[provider] = OpenAICompatibleNativeSearchAdapter(
                    provider,
                    base_url=settings.base_url,
                    api_key=settings.api_key,
                    model=settings.model_id,
                    request_json=request_json,
                )
    return adapters


class SearchCoordinator:
    """Call an injected provider adapter without exposing API keys to the domain layer."""

    def __init__(self, adapters: Mapping[str, SearchCallable]) -> None:
        self.adapters = dict(adapters)
        self.ledger: list[dict[str, object]] = []

    def search_round(self, *, provider: str, query: str, limit: int = 20) -> list[dict[str, object]]:
        if provider not in self.adapters:
            raise ValueError(f"unsupported search provider: {provider}")
        batch = SearchBatch(provider=self._provider_name(provider), query=query, limit=limit)
        raw_results = self.adapters[provider](batch.query, batch.limit)
        results: list[dict[str, object]] = []
        for raw in raw_results[:_MAX_SEARCH_RESULTS]:
            url = raw.get("url")
            if not isinstance(url, str):
                continue
            try:
                safe_url = _validate_https_url(url)
            except UnsafeSourceUrl:
                continue
            item: dict[str, object] = {"title": str(raw.get("title", ""))[:500], "url": safe_url}
            image_url = raw.get("imageUrl")
            if isinstance(image_url, str):
                try:
                    item["imageUrl"] = _validate_https_url(image_url)
                except UnsafeSourceUrl:
                    pass
            page_url = raw.get("pageUrl")
            if isinstance(page_url, str):
                try:
                    item["pageUrl"] = _validate_https_url(page_url)
                except UnsafeSourceUrl:
                    pass
            results.append(item)
        self.ledger.append({"provider": batch.provider, "requestedProvider": provider, "query": batch.query, "requested": batch.limit, "returned": len(results)})
        return results

    @staticmethod
    def _provider_name(provider: str) -> SearchProvider:
        if provider == "deepseek":
            return "firecrawl"
        if provider in {"qwen", "glm", "firecrawl"}:
            return provider  # type: ignore[return-value]
        raise ValueError(f"unsupported search provider: {provider}")


def _resolve_public_hostname(hostname: str, resolver: Callable[..., Sequence[tuple[Any, ...]]]) -> None:
    try:
        addresses = resolver(hostname, 443, type=socket.SOCK_STREAM)
    except (OSError, socket.gaierror) as exc:
        raise UnsafeSourceUrl("source hostname could not be resolved") from exc
    if not addresses:
        raise UnsafeSourceUrl("source hostname has no address")
    for info in addresses:
        try:
            address = ipaddress.ip_address(str(info[4][0]))
        except (IndexError, ValueError) as exc:
            raise UnsafeSourceUrl("source hostname resolved to an invalid address") from exc
        if not address.is_global:
            raise UnsafeSourceUrl("source hostname resolved to a private or reserved address")


@dataclass(frozen=True, slots=True)
class DownloadedImage:
    url: str
    mime_type: str
    content: bytes
    sha256: str

    @property
    def byte_size(self) -> int:
        return len(self.content)


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args: Any, **_kwargs: Any) -> urllib.request.Request | None:
        raise UnsafeSourceUrl("image redirects are not allowed")


class SafeImageDownloader:
    """Download a single public HTTPS image with SSRF and resource guards."""

    def __init__(
        self,
        *,
        opener: Callable[[urllib.request.Request], Any] | None = None,
        resolver: Callable[..., Sequence[tuple[Any, ...]]] | None = None,
        max_bytes: int = _DEFAULT_IMAGE_MAX_BYTES,
    ) -> None:
        if max_bytes < 1:
            raise ValueError("image size limit must be positive")
        self.max_bytes = max_bytes
        self.resolver = resolver or socket.getaddrinfo
        if opener is None:
            opener_instance = urllib.request.build_opener(_NoRedirectHandler())
            self.opener = lambda request: opener_instance.open(request, timeout=30)
        else:
            self.opener = opener

    def download(self, image_url: str) -> DownloadedImage:
        safe_url = _validate_https_url(image_url)
        hostname = urlparse(safe_url).hostname
        if not hostname:
            raise UnsafeSourceUrl("source URL has no hostname")
        _resolve_public_hostname(hostname, self.resolver)
        request = urllib.request.Request(safe_url, headers={"Accept": "image/*", "User-Agent": "AIPPT/1.0"}, method="GET")
        response = self.opener(request)
        try:
            final_url = response.geturl() if hasattr(response, "geturl") else safe_url
            if _validate_https_url(str(final_url)) != safe_url:
                raise UnsafeSourceUrl("image redirects are not allowed")
            headers = getattr(response, "headers", {})
            content_length = headers.get("Content-Length") if hasattr(headers, "get") else None
            if content_length is not None:
                try:
                    if int(content_length) > self.max_bytes:
                        raise ValueError("image size exceeds limit")
                except ValueError as exc:
                    if str(exc) == "image size exceeds limit":
                        raise
                    raise ValueError("image content length is invalid") from exc
            mime_type = str(headers.get("Content-Type", "")).split(";", 1)[0].strip().lower()
            if mime_type not in _IMAGE_MIME_TYPES:
                raise ValueError("image MIME type is not allowed")
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = response.read(min(64 * 1024, self.max_bytes - total + 1))
                if not chunk:
                    break
                total += len(chunk)
                if total > self.max_bytes:
                    raise ValueError("image size exceeds limit")
                chunks.append(chunk)
            content = b"".join(chunks)
            return DownloadedImage(safe_url, mime_type, content, hashlib.sha256(content).hexdigest())
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()


@dataclass(slots=True)
class SourceLedger:
    web_images: list[dict[str, object]] = field(default_factory=list)

    def add_web_image(self, image_url: str, *, page_url: str, alt: str = "") -> dict[str, object]:
        safe_image_url = _validate_https_url(image_url)
        safe_page_url = _validate_https_url(page_url)
        if any(item["imageUrl"] == safe_image_url for item in self.web_images):
            return next(item for item in self.web_images if item["imageUrl"] == safe_image_url)
        if len(self.web_images) >= 100:
            raise ValueError("web image source ledger is full")
        item = {"imageUrl": safe_image_url, "pageUrl": safe_page_url, "alt": alt[:1_000], "license": "UNVERIFIED"}
        self.web_images.append(item)
        return item

    def add_downloaded_web_image(
        self,
        image_url: str,
        *,
        page_url: str,
        downloader: SafeImageDownloader,
        alt: str = "",
    ) -> dict[str, object]:
        downloaded = downloader.download(image_url)
        item = self.add_web_image(downloaded.url, page_url=page_url, alt=alt)
        item.update({"mimeType": downloaded.mime_type, "byteSize": downloaded.byte_size, "sha256": downloaded.sha256})
        return item


class AiImageAdapter:
    """HTTP image-generation adapter with a narrow, role-aware output contract."""

    def __init__(
        self,
        *,
        endpoint: str | None = None,
        api_key: str | None = None,
        request_json: JsonRequest | None = None,
    ) -> None:
        self.endpoint = endpoint if endpoint is not None else os.getenv("AI_IMAGE_URL")
        self.api_key = api_key if api_key is not None else os.getenv("AI_IMAGE_API_KEY")
        self.request_json = request_json or _default_json_request

    def generate(self, *, role: str, prompt: str) -> dict[str, object]:
        if role not in _AI_IMAGE_ROLES:
            raise ValueError("AI image role must be COVER, MID_BACKGROUND, or END")
        if not self.api_key or not self.endpoint:
            raise ProviderNotConfigured("AI image provider is not configured")
        _validate_https_url(self.endpoint)
        payload = self.request_json(
            self.endpoint,
            {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            {"prompt": prompt, "role": role, "size": "1600x900"},
        )
        candidates: object = payload.get("data", payload.get("images", []))
        if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes, bytearray)) or not candidates:
            raise ProviderRequestFailed("image provider returned no image")
        first = candidates[0]
        if not isinstance(first, Mapping):
            raise ProviderRequestFailed("image provider returned an invalid image")
        asset_url = first.get("url") or first.get("imageUrl")
        if asset_url is not None:
            if not isinstance(asset_url, str):
                raise ProviderRequestFailed("image provider returned an invalid image URL")
            asset_url = _validate_https_url(asset_url)
        asset_id = first.get("id") or first.get("assetId") or hashlib.sha256(f"{role}:{prompt}".encode()).hexdigest()[:16]
        result: dict[str, object] = {"role": role, "assetId": str(asset_id)}
        if asset_url:
            result["imageUrl"] = asset_url
        if isinstance(first.get("b64_json"), str):
            result["imageData"] = first["b64_json"]
        return result


class SettingsAiImageAdapter:
    """GLM image generation adapter backed by the persisted model settings."""

    def __init__(
        self,
        *,
        api_key: str,
        endpoint: str = "https://open.bigmodel.cn/api/paas/v4/images/generations",
        request_json: JsonRequest | None = None,
    ) -> None:
        self.api_key = api_key
        self.endpoint = endpoint
        self.request_json = request_json or _default_json_request

    def generate(self, *, role: str, prompt: str) -> dict[str, object]:
        if role not in _AI_IMAGE_ROLES:
            raise ValueError("AI image role must be COVER, MID_BACKGROUND, or END")
        if not self.api_key:
            raise ProviderNotConfigured("image provider is not configured")
        _validate_https_url(self.endpoint)
        payload = {"model": "glm-image", "prompt": f"{prompt}\n画面用途：{role}", "size": "1440x810"}
        response = self.request_json(
            self.endpoint,
            {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            payload,
        )
        candidates = response.get("data", [])
        if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes, bytearray)) or not candidates:
            raise ProviderRequestFailed("image provider returned no image")
        first = candidates[0]
        if not isinstance(first, Mapping) or not isinstance(first.get("url"), str):
            raise ProviderRequestFailed("image provider returned an invalid image")
        asset_url = _validate_https_url(str(first["url"]))
        return {"role": role, "assetId": str(first.get("id") or hashlib.sha256(asset_url.encode()).hexdigest()[:16]), "imageUrl": asset_url}


def generate_required_ai_images(adapter: AiImageAdapter, *, prompt: str) -> list[dict[str, object]]:
    """Generate exactly the three visuals required before PPT build can start."""

    return [adapter.generate(role=role, prompt=f"{prompt}\nComposition role: {role}") for role in _AI_IMAGE_ROLES]


def build_settings_ai_image_adapter(*, request_json: JsonRequest | None = None) -> SettingsAiImageAdapter | None:
    """Build the image adapter from the configured GLM profile when available."""

    from model_settings import ModelSettingsStore

    settings = ModelSettingsStore().load("glm")
    if not settings.api_key:
        return None
    return SettingsAiImageAdapter(api_key=settings.api_key, request_json=request_json)


@dataclass(slots=True)
class MaterialGate:
    ledger: SourceLedger
    ai_images: list[dict[str, object]] = field(default_factory=list)

    def record_ai_image(self, role: str, asset_id: str) -> None:
        if role not in _AI_IMAGE_ROLES:
            raise ValueError("AI image role must be COVER, MID_BACKGROUND, or END")
        if any(item["role"] == role for item in self.ai_images):
            return
        self.ai_images.append({"role": role, "assetId": asset_id})

    def record_ai_asset(self, asset: Mapping[str, object]) -> None:
        role = asset.get("role")
        asset_id = asset.get("assetId")
        if not isinstance(role, str) or not isinstance(asset_id, str):
            raise ValueError("AI image asset must include role and assetId")
        self.record_ai_image(role, asset_id)

    def ready_for_build(self) -> bool:
        roles = {item["role"] for item in self.ai_images}
        return len(self.ledger.web_images) >= 3 and set(_AI_IMAGE_ROLES) <= roles
