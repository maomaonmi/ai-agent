"""Provider adapters and safety gates for PPT research materials.

The module keeps external integrations behind small, injectable adapters. The
agent can run with deterministic demo material locally, while a configured
deployment can opt into Firecrawl/native search and an image model without
moving credentials into the domain model or browser.
"""

from __future__ import annotations

import hashlib
from html.parser import HTMLParser
import ipaddress
import json
import os
import socket
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin, urlparse
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
_QWEN_DASHSCOPE_SEARCH_MODELS = frozenset({
    "qwen-plus",
    "qwen-plus-latest",
    "qwen-flash",
    "qwen-flash-latest",
    "qwen3.8-max",
    "qwen3.7-max",
    "qwen3.5-plus",
    "qwen3.5-flash",
    "qwen3-max",
})


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


def _request_json_with_timeout(endpoint: str, headers: dict[str, str], payload: dict[str, object], *, timeout_seconds: int) -> Mapping[str, object]:
    """POST JSON with bounded response size and a generic public error."""

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
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


def _default_json_request(endpoint: str, headers: dict[str, str], payload: dict[str, object]) -> Mapping[str, object]:
    return _request_json_with_timeout(endpoint, headers, payload, timeout_seconds=max(5, min(60, int(os.getenv("PPT_PROVIDER_TIMEOUT_SECONDS", "12")))))


def _streaming_json_request(endpoint: str, headers: dict[str, str], payload: dict[str, object]) -> Mapping[str, object]:
    """Read the same SSE contract used by the normal native-search chat mode.

    Qwen exposes ``search_info`` on streaming chunks (including chunks without
    choices); GLM may expose citations in tool/annotation chunks.  A regular
    JSON POST can therefore return a perfectly valid answer while losing every
    source.  Keep the transport small and dependency-free so the PPT worker can
    consume the provider stream without importing the application module.
    """

    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    timeout_seconds = max(30, min(180, int(os.getenv("PPT_PROVIDER_TIMEOUT_SECONDS", "120"))))
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read(_MAX_JSON_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ProviderRequestFailed("provider request failed") from exc
    if len(raw) > _MAX_JSON_BYTES:
        raise ProviderRequestFailed("provider response exceeded size limit")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ProviderRequestFailed("provider returned invalid UTF-8") from exc

    # Some compatible gateways ignore stream=true and return one JSON object.
    try:
        decoded = json.loads(text)
    except json.JSONDecodeError:
        decoded = None
    if isinstance(decoded, Mapping):
        return decoded

    frames: list[Mapping[str, object]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            frame = json.loads(data)
        except json.JSONDecodeError:
            continue
        if isinstance(frame, Mapping):
            frames.append(frame)
    if not frames:
        raise ProviderRequestFailed("provider returned an invalid streaming response")
    return {"stream_frames": frames}


def _image_json_request(endpoint: str, headers: dict[str, str], payload: dict[str, object]) -> Mapping[str, object]:
    # GLM-Image HD generation is documented to take about 20 seconds; the
    # hosted endpoint can be slower on a cold request, so allow two minutes.
    return _request_json_with_timeout(endpoint, headers, payload, timeout_seconds=max(30, min(180, int(os.getenv("PPT_IMAGE_PROVIDER_TIMEOUT_SECONDS", "120")))))


def _narrative_json_request(endpoint: str, headers: dict[str, str], payload: dict[str, object]) -> Mapping[str, object]:
    """Bounded request used for one slide's narrative section.

    BUILD deliberately makes one request per slide. A separate timeout keeps a
    slow writing request from being confused with image generation while still
    allowing a real model to finish a longer Chinese section.
    """
    return _request_json_with_timeout(
        endpoint,
        headers,
        payload,
        timeout_seconds=max(30, min(180, int(os.getenv("PPT_NARRATIVE_TIMEOUT_SECONDS", "90")))),
    )


def _normalize_search_response(payload: Mapping[str, object]) -> list[dict[str, object]]:
    candidates: object = payload.get("data", payload.get("results", payload.get("search_result", [])))
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


class QwenDashScopeSearchAdapter:
    """Qwen's native DashScope search route, including source metadata.

    The OpenAI-compatible Chat Completions route can use web search but does
    not return the source list. PPT requires auditable URLs, so this adapter
    deliberately uses DashScope's native text-generation contract.
    """

    provider = "qwen"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        endpoint: str | None = None,
        request_json: JsonRequest | None = None,
    ) -> None:
        self.endpoint = endpoint or os.getenv(
            "QWEN_NATIVE_SEARCH_URL",
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
        )
        self.api_key = api_key
        # Some profiles use the OpenAI-compatible-only qwen3.7-plus alias.
        # DashScope's source-returning route supports qwen-plus instead; keep
        # the user's chat model untouched and use the closest native search
        # model for this source-collection job.
        self.model = model if model in _QWEN_DASHSCOPE_SEARCH_MODELS else "qwen-plus"
        self.request_json = request_json

    def __call__(self, query: str, limit: int) -> list[dict[str, object]]:
        if not self.api_key or not self.endpoint:
            raise ProviderNotConfigured("qwen provider is not configured")
        _validate_https_url(self.endpoint)
        payload: dict[str, object] = {
            "model": self.model,
            "input": {"messages": [{"role": "user", "content": query}]},
            "parameters": {
                "result_format": "message",
                "incremental_output": True,
                "enable_search": True,
                "search_options": {
                    "search_strategy": "turbo",
                    "forced_search": True,
                    "enable_source": True,
                    "prepend_search_result": True,
                },
            },
        }
        request_json = self.request_json or _streaming_json_request
        response = request_json(
            self.endpoint,
            {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "X-DashScope-SSE": "enable",
            },
            payload,
        )
        return _normalize_native_chat_response(response, query=query, limit=limit)


class GlmWebSearchAdapter:
    """GLM's structured Web Search API, returning source URLs directly."""

    provider = "glm"

    def __init__(
        self,
        *,
        api_key: str,
        endpoint: str | None = None,
        request_json: JsonRequest | None = None,
    ) -> None:
        self.endpoint = endpoint or os.getenv(
            "GLM_WEB_SEARCH_URL",
            "https://open.bigmodel.cn/api/paas/v4/web_search",
        )
        self.api_key = api_key
        self.request_json = request_json or _default_json_request

    def __call__(self, query: str, limit: int) -> list[dict[str, object]]:
        if not self.api_key or not self.endpoint:
            raise ProviderNotConfigured("glm provider is not configured")
        _validate_https_url(self.endpoint)
        response = self.request_json(
            self.endpoint,
            {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            {
                "search_query": query[:70],
                "search_engine": "search_pro",
                "search_intent": False,
                "count": min(limit, _MAX_SEARCH_RESULTS),
                "search_recency_filter": "noLimit",
                "content_size": "high",
            },
        )
        return _normalize_search_response(response)


class OpenAICompatibleNativeSearchAdapter:
    """Use a configured Qwen/GLM chat endpoint with its native web search mode."""

    def __init__(
        self,
        provider: str,
        *,
        base_url: str,
        api_key: str,
        model: str,
        temperature: float = 1.0,
        max_tokens: int = 16_000,
        request_json: JsonRequest | None = None,
    ) -> None:
        if provider not in {"qwen", "glm"}:
            raise ValueError("native search provider must be qwen or glm")
        self.provider = provider
        self.endpoint = base_url.rstrip("/") if base_url.rstrip("/").endswith("/chat/completions") else f"{base_url.rstrip('/')}/chat/completions"
        self.api_key = api_key
        self.model = model
        self.temperature = max(0.0, min(2.0, float(temperature)))
        self.max_tokens = max(1, min(65_536, int(max_tokens)))
        self.request_json = request_json

    def __call__(self, query: str, limit: int) -> list[dict[str, object]]:
        if not self.api_key or not self.endpoint:
            raise ProviderNotConfigured(f"{self.provider} provider is not configured")
        _validate_https_url(self.endpoint)
        payload: dict[str, object] = {
            "model": self.model,
            "messages": [{"role": "user", "content": query}],
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            # Match the normal app's native-search route.  Search citations are
            # delivered on streaming chunks, not reliably in a non-stream body.
            "stream": True,
        }
        if self.provider == "qwen":
            payload.update({
                "enable_search": True,
                "search_options": {
                    "search_strategy": "turbo",
                    "forced_search": True,
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
        request_json = self.request_json or _streaming_json_request
        response = request_json(
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
        if not settings.api_key:
            continue
        # The regular chat route proves that the credentials are valid, but
        # its streaming answer is not an auditable source contract: providers
        # may return plain text without citations/tool frames. PPT needs a
        # concrete URL list, so use each provider's structured native search
        # endpoint when no custom endpoint is configured.
        endpoint = os.getenv(f"{provider.upper()}_SEARCH_URL")
        if endpoint:
            adapters[provider] = NativeSearchAdapter(provider, endpoint=endpoint, api_key=settings.api_key, request_json=request_json)
        elif provider == "qwen":
            adapters[provider] = QwenDashScopeSearchAdapter(
                api_key=settings.api_key,
                model=settings.model_id,
                request_json=request_json,
            )
        else:
            adapters[provider] = GlmWebSearchAdapter(
                api_key=settings.api_key,
                request_json=request_json,
            )
    return adapters


class SearchCoordinator:
    """Call an injected provider adapter without exposing API keys to the domain layer."""

    def __init__(self, adapters: Mapping[str, SearchCallable]) -> None:
        self.adapters = dict(adapters)
        self.ledger: list[dict[str, object]] = []

    def search_round(self, *, provider: str, query: str, limit: int = 20, exclude_urls: set[str] | None = None) -> list[dict[str, object]]:
        if provider not in self.adapters:
            raise ValueError(f"unsupported search provider: {provider}")
        batch = SearchBatch(provider=self._provider_name(provider), query=query, limit=limit)
        raw_results = self.adapters[provider](batch.query, batch.limit)
        results: list[dict[str, object]] = []
        excluded = {_source_key(url) for url in (exclude_urls or set())}
        seen: set[str] = set()
        for raw in raw_results[:_MAX_SEARCH_RESULTS]:
            url = raw.get("url")
            if not isinstance(url, str):
                continue
            try:
                safe_url = _validate_https_url(url)
            except UnsafeSourceUrl:
                continue
            key = _source_key(safe_url)
            if key in excluded or key in seen:
                continue
            seen.add(key)
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


def _source_key(url: str) -> str:
    parsed = urlparse(url.strip())
    return f"{parsed.scheme.lower()}://{(parsed.netloc or '').lower()}{parsed.path.rstrip('/')}".lower()


class _ImageHintParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hints: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value for key, value in attrs}
        if tag.lower() == "meta" and values.get("property", "").lower() in {"og:image", "og:image:url", "twitter:image"}:
            if values.get("content"):
                self.hints.append(values["content"] or "")
        elif tag.lower() == "img":
            for key in ("src", "data-src", "data-original"):
                if values.get(key):
                    self.hints.append(values[key] or "")
                    break


class WebPageImageExtractor:
    """Find public image hints in a page before handing them to the downloader."""

    def __init__(self, *, opener: Callable[[urllib.request.Request], Any] | None = None, max_html_bytes: int = 512 * 1024) -> None:
        self.max_html_bytes = max_html_bytes
        if opener is None:
            opener_instance = urllib.request.build_opener()
            self.opener = lambda request: opener_instance.open(request, timeout=15)
        else:
            self.opener = opener

    def extract(self, page_url: str, *, limit: int = 3) -> list[str]:
        try:
            safe_page_url = _validate_https_url(page_url)
            request = urllib.request.Request(safe_page_url, headers={"Accept": "text/html", "User-Agent": "AIPPT/1.0"}, method="GET")
            response = self.opener(request)
            try:
                raw = response.read(self.max_html_bytes + 1)
            finally:
                close = getattr(response, "close", None)
                if callable(close):
                    close()
            if len(raw) > self.max_html_bytes:
                raw = raw[: self.max_html_bytes]
            parser = _ImageHintParser()
            parser.feed(raw.decode("utf-8", errors="ignore"))
            images: list[str] = []
            seen: set[str] = set()
            for hint in parser.hints:
                candidate = urljoin(safe_page_url, hint.strip())
                try:
                    candidate = _validate_https_url(candidate)
                except UnsafeSourceUrl:
                    continue
                key = _source_key(candidate)
                if key in seen:
                    continue
                parsed_candidate = urlparse(candidate)
                basename = parsed_candidate.path.rsplit("/", 1)[-1].lower()
                if any(token in basename for token in ("logo", "favicon", "icon", "avatar", "sprite", "qrcode", "w_60", "h_60")):
                    continue
                query = parsed_candidate.query.lower()
                if any(marker in query for marker in ("w_60", "h_60", "width=60", "height=60", "size=small")):
                    continue
                seen.add(key)
                images.append(candidate)
                if len(images) >= max(1, min(limit, 10)):
                    break
            return images
        except (OSError, urllib.error.URLError, UnicodeError, UnsafeSourceUrl, ValueError):
            return []


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
        # The local desktop runtime maps public hosts into TEST-NET-2-like
        # egress addresses (198.18.0.0/15). urllib still reaches the public
        # origin, so keep the SSRF guard while allowing this known bridge.
        synthetic_egress = ipaddress.ip_network("198.18.0.0/15")
        if not address.is_global and address not in synthetic_egress:
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


def _image_dimensions(content: bytes, mime_type: str) -> tuple[int, int] | None:
    """Read dimensions from common raster headers without decoding pixels."""
    if mime_type == "image/png" and content.startswith(b"\x89PNG\r\n\x1a\n") and len(content) >= 24:
        return int.from_bytes(content[16:20], "big"), int.from_bytes(content[20:24], "big")
    if mime_type == "image/gif" and content[:6] in {b"GIF87a", b"GIF89a"} and len(content) >= 10:
        return int.from_bytes(content[6:8], "little"), int.from_bytes(content[8:10], "little")
    if mime_type == "image/webp" and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        if content[12:16] == b"VP8X" and len(content) >= 30:
            return 1 + int.from_bytes(content[24:27], "little"), 1 + int.from_bytes(content[27:30], "little")
        if content[12:16] == b"VP8 " and len(content) >= 30 and content[23:27] == b"\x9d\x01\x2a":
            return int.from_bytes(content[26:28], "little") & 0x3FFF, int.from_bytes(content[28:30], "little") & 0x3FFF
    if mime_type == "image/jpeg" and content[:2] == b"\xff\xd8":
        index = 2
        while index + 9 < len(content):
            if content[index] != 0xFF:
                index += 1
                continue
            marker = content[index + 1]
            index += 2
            if marker in {0xD8, 0xD9}:
                continue
            if index + 2 > len(content):
                break
            segment_length = int.from_bytes(content[index:index + 2], "big")
            if segment_length < 2 or index + segment_length > len(content):
                break
            if marker in set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0)):
                if segment_length >= 7:
                    return int.from_bytes(content[index + 5:index + 7], "big"), int.from_bytes(content[index + 3:index + 5], "big")
            index += segment_length
    return None


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
            dimensions = _image_dimensions(content, mime_type)
            if dimensions is not None and (dimensions[0] < 160 or dimensions[1] < 90):
                raise ValueError("image dimensions are too small for PPT material")
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
        persist: Callable[[DownloadedImage], Mapping[str, object]] | None = None,
    ) -> dict[str, object]:
        downloaded = downloader.download(image_url)
        item = self.add_web_image(downloaded.url, page_url=page_url, alt=alt)
        item.update({"mimeType": downloaded.mime_type, "byteSize": downloaded.byte_size, "sha256": downloaded.sha256})
        if persist is not None:
            item.update(dict(persist(downloaded)))
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
        self.request_json = request_json or _image_json_request

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
        self.request_json = request_json or _image_json_request

    def generate(self, *, role: str, prompt: str) -> dict[str, object]:
        if role not in _AI_IMAGE_ROLES:
            raise ValueError("AI image role must be COVER, MID_BACKGROUND, or END")
        if not self.api_key:
            raise ProviderNotConfigured("image provider is not configured")
        _validate_https_url(self.endpoint)
        # GLM-Image requires dimensions divisible by 32; 1728x960 is the
        # documented 16:9 size and avoids the invalid 1440x810 request.
        payload = {"model": "glm-image", "prompt": f"{prompt}\n画面用途：{role}"[:1000], "size": "1728x960"}
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


class SettingsNarrativeGenerator:
    """Generate one structured, source-aware narrative section per slide.

    The adapter intentionally uses the same persisted model profiles as the
    chat/settings UI. It is OpenAI-compatible for DeepSeek, Qwen and GLM, but
    does not enable web search: BUILD consumes the already persisted search
    ledger and asks the model to write from that evidence.
    """

    def __init__(
        self,
        *,
        provider: str,
        model: str,
        base_url: str,
        api_key: str,
        temperature: float = 0.7,
        max_tokens: int = 2_000,
        request_json: JsonRequest | None = None,
    ) -> None:
        self.provider = provider
        self.model = model
        self.endpoint = base_url.rstrip("/") if base_url.rstrip("/").endswith("/chat/completions") else f"{base_url.rstrip('/')}/chat/completions"
        self.api_key = api_key
        self.temperature = max(0.0, min(2.0, float(temperature)))
        self.max_tokens = max(256, min(65_536, int(max_tokens)))
        self.request_json = request_json or _narrative_json_request

    @staticmethod
    def _content_from_response(payload: Mapping[str, object]) -> str:
        choices = payload.get("choices")
        if isinstance(choices, Sequence) and choices and isinstance(choices[0], Mapping):
            message = choices[0].get("message")
            if isinstance(message, Mapping):
                content = message.get("content") or message.get("reasoning_content")
                if isinstance(content, str):
                    return content.strip()
            text = choices[0].get("text")
            if isinstance(text, str):
                return text.strip()
        # Some gateways are configured with stream=true by policy. Reassemble
        # the content deltas so the contract stays identical for the caller.
        frames = payload.get("stream_frames")
        if isinstance(frames, Sequence):
            chunks: list[str] = []
            for frame in frames:
                if not isinstance(frame, Mapping):
                    continue
                frame_choices = frame.get("choices")
                if not isinstance(frame_choices, Sequence) or not frame_choices:
                    continue
                choice = frame_choices[0]
                if not isinstance(choice, Mapping):
                    continue
                delta = choice.get("delta") or choice.get("message")
                if isinstance(delta, Mapping) and isinstance(delta.get("content"), str):
                    chunks.append(str(delta["content"]))
            return "".join(chunks).strip()
        return ""

    @staticmethod
    def _parse_json(text: str) -> dict[str, object]:
        candidate = text.strip()
        if candidate.startswith("```"):
            candidate = re.sub(r"^```(?:json)?\s*|\s*```$", "", candidate, flags=re.IGNORECASE | re.DOTALL).strip()
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", candidate, flags=re.DOTALL)
            if not match:
                raise ProviderRequestFailed("narrative model returned invalid JSON")
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError as exc:
                raise ProviderRequestFailed("narrative model returned invalid JSON") from exc
        if not isinstance(parsed, Mapping):
            raise ProviderRequestFailed("narrative model returned an invalid section")
        result: dict[str, object] = {}
        for key in ("title", "subtitle", "body", "speakerNotes"):
            value = parsed.get(key)
            if isinstance(value, str) and value.strip():
                result[key] = value.strip()
        points = parsed.get("keyPoints")
        if isinstance(points, Sequence) and not isinstance(points, (str, bytes, bytearray)):
            result["keyPoints"] = [str(item).strip() for item in points if str(item).strip()][:4]
        urls = parsed.get("sourceUrls")
        if isinstance(urls, Sequence) and not isinstance(urls, (str, bytes, bytearray)):
            result["sourceUrls"] = [str(item).strip() for item in urls if str(item).startswith(("http://", "https://"))][:5]
        return result

    def generate_slide(
        self,
        *,
        prompt: str,
        slide: Mapping[str, object],
        chapter: int,
        total_slides: int,
        evidence: Sequence[Mapping[str, object]],
        previous_sections: Sequence[Mapping[str, object]],
    ) -> dict[str, object]:
        if not self.api_key:
            raise ProviderNotConfigured(f"{self.provider} narrative provider is not configured")
        _validate_https_url(self.endpoint)
        evidence_text = "\n".join(
            f"- {item.get('title', '来源')} | {item.get('url', '')}"
            for item in evidence[:8]
            if isinstance(item, Mapping)
        ) or "（没有可用来源）"
        previous_text = "\n".join(
            f"- 第 {item.get('ordinal', '?')} 页：{item.get('title', '')}：{item.get('body', '')}"
            for item in previous_sections[-3:]
            if isinstance(item, Mapping)
        ) or "（这是第一段）"
        system = (
            "你是专业的中文演示文稿作者。请只输出 JSON，不要 Markdown，不要解释。"
            "正文必须是可直接放进 PPT 的真实段落，而不是‘本页将介绍’这类占位符。"
        )
        user = {
            "任务": prompt,
            "章节": chapter,
            "当前页": int(slide.get("ordinal", 0) or 0),
            "总页数": total_slides,
            "章节主题": slide.get("section"),
            "页标题方向": slide.get("direction"),
            "已完成的前文": previous_text,
            "搜索证据": evidence_text,
            "输出格式": {
                "title": "不超过22字的页标题",
                "subtitle": "一句话观点，不超过45字",
                "body": "120-220字的连贯中文段落，包含具体事实、因果或判断",
                "keyPoints": ["2-4条可验证要点"],
                "speakerNotes": "80-160字演讲备注",
                "sourceUrls": ["只填写实际使用的证据 URL"],
            },
        }
        payload: dict[str, object] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
            ],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }
        # JSON mode is not reliable on every GLM profile; prompting plus
        # defensive parsing works across all configured providers.
        if self.provider in {"deepseek", "qwen"}:
            payload["response_format"] = {"type": "json_object"}
        response = self.request_json(
            self.endpoint,
            {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            payload,
        )
        content = self._content_from_response(response)
        result = self._parse_json(content)
        if not result.get("title") or not result.get("body"):
            raise ProviderRequestFailed("narrative model returned an incomplete section")
        result["ordinal"] = int(slide.get("ordinal", 0) or 0)
        result["section"] = str(slide.get("section") or "")
        return result


def build_settings_narrative_generator(provider: str, *, request_json: JsonRequest | None = None) -> SettingsNarrativeGenerator | None:
    """Build the writer from the model profile selected by the PPT run."""
    from model_settings import ModelSettingsStore

    settings = ModelSettingsStore().load(provider)
    if not settings.api_key or not settings.base_url or not settings.model_id:
        return None
    return SettingsNarrativeGenerator(
        provider=provider,
        model=settings.model_id,
        base_url=settings.base_url,
        api_key=settings.api_key,
        temperature=min(1.0, settings.temperature),
        max_tokens=min(8_000, settings.max_tokens),
        request_json=request_json,
    )


def generate_required_ai_images(adapter: AiImageAdapter, *, prompt: str) -> list[dict[str, object]]:
    """Generate exactly the three visuals required before PPT build can start."""

    def generate(role: str) -> dict[str, object]:
        return adapter.generate(role=role, prompt=f"{prompt}\nComposition role: {role}")

    # The provider supports concurrent jobs; preserve role order while keeping
    # the live workflow responsive instead of waiting for three serial calls.
    with ThreadPoolExecutor(max_workers=len(_AI_IMAGE_ROLES), thread_name_prefix="ppt-image") as executor:
        return list(executor.map(generate, _AI_IMAGE_ROLES))


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
