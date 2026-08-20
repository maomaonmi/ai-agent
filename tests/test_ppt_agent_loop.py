from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from ppt_agent_loop import AgentRunService, SearchBatch, SearchBatchLimitExceeded
from ppt_materials import DownloadedImage, ProviderRequestFailed
from ppt_repository import PptRepository


FIXTURE = Path(__file__).parent / "fixtures" / "ppt_document_v1.json"


def test_search_batch_never_allows_more_than_twenty_results() -> None:
    with pytest.raises(SearchBatchLimitExceeded):
        SearchBatch(provider="firecrawl", query="agent", limit=21)

    batch = SearchBatch(provider="qwen", query="agent", limit=20)
    assert batch.limit == 20


def test_agent_run_uses_configured_search_download_and_image_adapters(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = "presentation-provider-001"
    repository.create_presentation(
        presentation_id="presentation-provider-001",
        owner_scope="owner-a",
        title="Provider test",
        document=document,
        template_id=None,
    )

    calls: list[str] = []

    def search(query: str, limit: int):
        calls.append(query)
        base = len(calls) * 10
        return [
            {
                "title": f"Source {index}",
                "url": f"https://example.com/article-{base + index}",
                "imageUrl": f"https://cdn.example/image-{base + index}.png",
            }
            for index in range(3)
        ]

    class Downloader:
        def download(self, image_url: str) -> DownloadedImage:
            content = image_url.encode("utf-8")
            return DownloadedImage(image_url, "image/png", content, "a" * 64)

    class ImageAdapter:
        def generate(self, *, role: str, prompt: str) -> dict[str, object]:
            return {"role": role, "assetId": f"provider-{role.lower()}", "imageUrl": "https://cdn.example/generated.png"}

    service = AgentRunService(
        repository,
        search_adapters={"firecrawl": search, "qwen": search, "glm": search},
        ai_image_adapter=ImageAdapter(),
        image_downloader=Downloader(),
    )
    run, created = service.create(
        run_id="run-provider-001",
        presentation_id="presentation-provider-001",
        owner_scope="owner-a",
        prompt="provider integration",
        max_iterations=3,
    )

    assert created is True
    for _ in range(100):
        snapshot = service.get(run.id, owner_scope="owner-a")
        if snapshot.status in {"COMPLETED", "FAILED", "CANCELLED"}:
            break
        time.sleep(0.01)

    assert snapshot.status == "COMPLETED"
    assert snapshot.state["searchRounds"][0]["resultCount"] == 3
    assert snapshot.state["webImages"]["downloadedCount"] == 3
    assert snapshot.state["webImages"]["mode"] == "provider"
    assert snapshot.state["aiImages"]["mode"] == "provider"
    assert len(calls) == 3
    events = repository.list_run_events(run.id, after_sequence=0, limit=200)
    search_complete = next(event for event in events if event.event_type == "phase.completed" and event.payload.get("phase") == "SEARCH_1")
    assert search_complete.payload["resultCount"] == 3
    assert search_complete.payload["mode"] == "provider"
    web_complete = next(event for event in events if event.event_type == "phase.completed" and event.payload.get("phase") == "WEB_ASSETS")
    assert web_complete.payload["downloadedCount"] == 3


def test_agent_run_falls_back_to_firecrawl_when_native_search_times_out(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = "presentation-fallback-001"
    repository.create_presentation(
        presentation_id="presentation-fallback-001",
        owner_scope="owner-a",
        title="Fallback test",
        document=document,
        template_id=None,
    )

    def firecrawl(_query: str, _limit: int):
        return [{"title": "Source", "url": "https://example.com/source"}]

    def native_failure(_query: str, _limit: int):
        raise ProviderRequestFailed("provider request failed")

    class ImageAdapter:
        def generate(self, *, role: str, prompt: str):
            return {"role": role, "assetId": f"provider-{role.lower()}", "imageUrl": "https://cdn.example/generated.png"}

    service = AgentRunService(
        repository,
        search_adapters={"firecrawl": firecrawl, "qwen": native_failure, "glm": native_failure},
        ai_image_adapter=ImageAdapter(),
        image_downloader=None,
    )
    run, _ = service.create(
        run_id="run-fallback-001",
        presentation_id="presentation-fallback-001",
        owner_scope="owner-a",
        prompt="fallback",
        max_iterations=3,
    )
    for _ in range(100):
        snapshot = service.get(run.id, owner_scope="owner-a")
        if snapshot.status in {"COMPLETED", "FAILED", "CANCELLED"}:
            break
        time.sleep(0.01)

    assert snapshot.status == "COMPLETED"
    events = repository.list_run_events(run.id, after_sequence=0, limit=200)
    second_search = next(event for event in events if event.event_type == "phase.completed" and event.payload.get("phase") == "SEARCH_2")
    assert second_search.payload["mode"] == "provider-fallback"
    assert second_search.payload["provider"] == "firecrawl"
    assert second_search.payload["requestedProvider"] == "qwen"
