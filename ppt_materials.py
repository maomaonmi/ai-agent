"""Provider adapters and safety gates for PPT research materials."""

from __future__ import annotations

import ipaddress
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from urllib.parse import urlparse

from ppt_agent_loop import SearchBatch, SearchProvider


class UnsafeSourceUrl(ValueError):
    code = "PPT_UNSAFE_SOURCE_URL"


SearchCallable = Callable[[str, int], Sequence[Mapping[str, object]]]


def _validate_https_url(raw: str) -> str:
    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise UnsafeSourceUrl("source URL must use HTTPS")
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".localhost") or hostname.endswith(".internal"):
        raise UnsafeSourceUrl("private hostnames are not allowed")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None and (address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or not address.is_global):
        raise UnsafeSourceUrl("private or reserved IP addresses are not allowed")
    return parsed.geturl()


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
        for raw in raw_results[:20]:
            url = raw.get("url")
            if not isinstance(url, str):
                continue
            try:
                safe_url = _validate_https_url(url)
            except UnsafeSourceUrl:
                continue
            results.append({"title": str(raw.get("title", ""))[:500], "url": safe_url})
        self.ledger.append({"provider": batch.provider, "requestedProvider": provider, "query": batch.query, "requested": batch.limit, "returned": len(results)})
        return results

    @staticmethod
    def _provider_name(provider: str) -> SearchProvider:
        if provider == "deepseek":
            return "firecrawl"
        if provider in {"qwen", "glm", "firecrawl"}:
            return provider  # type: ignore[return-value]
        raise ValueError(f"unsupported search provider: {provider}")


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


@dataclass(slots=True)
class MaterialGate:
    ledger: SourceLedger
    ai_images: list[dict[str, object]] = field(default_factory=list)

    def record_ai_image(self, role: str, asset_id: str) -> None:
        if role not in {"COVER", "MID_BACKGROUND", "END"}:
            raise ValueError("AI image role must be COVER, MID_BACKGROUND, or END")
        if any(item["role"] == role for item in self.ai_images):
            return
        self.ai_images.append({"role": role, "assetId": asset_id})

    def ready_for_build(self) -> bool:
        roles = {item["role"] for item in self.ai_images}
        return len(self.ledger.web_images) >= 3 and {"COVER", "MID_BACKGROUND", "END"} <= roles
