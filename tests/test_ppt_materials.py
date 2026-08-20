from __future__ import annotations

import pytest

from ppt_materials import (
    MaterialGate,
    SearchCoordinator,
    SourceLedger,
    UnsafeSourceUrl,
)


def test_search_coordinator_routes_provider_and_caps_each_round() -> None:
    calls: list[tuple[str, str, int]] = []

    def firecrawl(query: str, limit: int):
        calls.append(("firecrawl", query, limit))
        return [{"title": str(index), "url": f"https://example.com/{index}"} for index in range(30)]

    coordinator = SearchCoordinator({"deepseek": firecrawl})
    results = coordinator.search_round(provider="deepseek", query="agent", limit=20)

    assert len(results) == 20
    assert calls == [("firecrawl", "agent", 20)]
    assert coordinator.ledger[0]["provider"] == "firecrawl"


def test_source_ledger_rejects_private_targets_and_enforces_media_gate() -> None:
    ledger = SourceLedger()
    with pytest.raises(UnsafeSourceUrl):
        ledger.add_web_image("http://127.0.0.1/admin", page_url="https://example.com/article")
    with pytest.raises(UnsafeSourceUrl):
        ledger.add_web_image("https://169.254.169.254/latest/meta-data", page_url="https://example.com/article")

    for index in range(3):
        ledger.add_web_image(f"https://images.example.com/{index}.jpg", page_url="https://example.com/article")
    gate = MaterialGate(ledger)
    gate.record_ai_image("COVER", "asset-cover")
    gate.record_ai_image("MID_BACKGROUND", "asset-mid")
    gate.record_ai_image("END", "asset-end")

    assert gate.ready_for_build() is True
    assert {item["role"] for item in gate.ai_images} == {"COVER", "MID_BACKGROUND", "END"}
