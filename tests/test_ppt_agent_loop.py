from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from ppt_agent_loop import AgentRunService, SearchBatch, SearchBatchLimitExceeded
from ppt_materials import DownloadedImage
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
