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
        model_provider="qwen",
        search_provider="firecrawl",
        search_limit=3,
    )

    assert created is True
    for _ in range(500):
        snapshot = service.get(run.id, owner_scope="owner-a")
        if snapshot.status in {"COMPLETED", "FAILED", "CANCELLED"}:
            break
        time.sleep(0.01)

    assert snapshot.status == "COMPLETED"
    assert snapshot.state["modelProvider"] == "qwen"
    assert snapshot.state["searchProvider"] == "firecrawl"
    assert snapshot.state["searchLimit"] == 3
    assert snapshot.state["searchRounds"][0]["resultCount"] == 3
    assert snapshot.state["webImages"]["downloadedCount"] == 9
    assert len(snapshot.state["webImages"]["candidateSources"]) == 9
    assert snapshot.state["webImages"]["mode"] == "provider"
    assert snapshot.state["aiImages"]["mode"] == "provider"
    assert len(calls) == 3
    events = repository.list_run_events(run.id, after_sequence=0, limit=200)
    search_complete = next(event for event in events if event.event_type == "phase.completed" and event.payload.get("phase") == "SEARCH_1")
    assert search_complete.payload["resultCount"] == 3
    assert search_complete.payload["mode"] == "provider"
    assert search_complete.payload["sources"] == [
        {"title": "Source 0", "url": "https://example.com/article-10", "imageUrl": "https://cdn.example/image-10.png"},
        {"title": "Source 1", "url": "https://example.com/article-11", "imageUrl": "https://cdn.example/image-11.png"},
        {"title": "Source 2", "url": "https://example.com/article-12", "imageUrl": "https://cdn.example/image-12.png"},
    ]
    web_complete = next(event for event in events if event.event_type == "phase.completed" and event.payload.get("phase") == "WEB_ASSETS")
    assert web_complete.payload["downloadedCount"] == 9
    assert len(web_complete.payload["candidateSources"]) == 9
    assert len(web_complete.payload["assets"]) == 9
    assert [item["selectedCount"] for item in web_complete.payload["selectionRounds"]] == [3, 3, 3]


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
        web_image_extractor=type("Extractor", (), {"extract": lambda *_args, **_kwargs: []})(),
        allow_demo_materials=True,
    )
    run, _ = service.create(
        run_id="run-fallback-001",
        presentation_id="presentation-fallback-001",
        owner_scope="owner-a",
        prompt="fallback",
        max_iterations=3,
    )
    for _ in range(500):
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


def test_agent_run_deduplicates_sources_across_search_rounds(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = "presentation-dedupe-001"
    repository.create_presentation(
        presentation_id="presentation-dedupe-001",
        owner_scope="owner-a",
        title="Dedupe test",
        document=document,
        template_id=None,
    )

    def search(query: str, _limit: int):
        marker = "round-2" if "行业研究" in query else "round-3" if "最新实践" in query else "round-1"
        return [
            {"title": f"{marker} source {index}", "url": f"https://example.com/{marker}-{index}"}
            for index in range(3)
        ]

    class ImageAdapter:
        def generate(self, *, role: str, prompt: str):
            return {"role": role, "assetId": f"asset-{role.lower()}", "imageUrl": "https://cdn.example/generated.png"}

    service = AgentRunService(
        repository,
        search_adapters={"firecrawl": search, "qwen": search, "glm": search},
        ai_image_adapter=ImageAdapter(),
        image_downloader=None,
        web_image_extractor=type("Extractor", (), {"extract": lambda *_args, **_kwargs: []})(),
        allow_demo_materials=True,
    )
    run, _ = service.create(
        run_id="run-dedupe-001",
        presentation_id="presentation-dedupe-001",
        owner_scope="owner-a",
        prompt="agent workflow",
        max_iterations=3,
    )
    for _ in range(500):
        snapshot = service.get(run.id, owner_scope="owner-a")
        if snapshot.status in {"COMPLETED", "FAILED", "CANCELLED"}:
            break
        time.sleep(0.01)

    assert snapshot.status == "COMPLETED"
    events = repository.list_run_events(run.id, after_sequence=0, limit=200)
    completed = [event for event in events if event.event_type == "phase.completed" and event.payload.get("phase", "").startswith("SEARCH")]
    urls = [url for event in completed for url in [source["url"] for source in event.payload["sources"]]]
    assert len(urls) == len(set(urls)) == 9
    assert [event.payload["sources"][0]["title"] for event in completed] == ["round-1 source 0", "round-2 source 0", "round-3 source 0"]


def test_ai_assets_do_not_report_three_generated_images_when_provider_is_missing(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = "presentation-no-ai-provider-001"
    repository.create_presentation(
        presentation_id="presentation-no-ai-provider-001",
        owner_scope="owner-a",
        title="Missing image provider",
        document=document,
        template_id=None,
    )

    def search(_query: str, _limit: int):
        return [
            {
                "title": f"Source {index}",
                "url": f"https://example.com/article-{index}",
                "imageUrl": f"https://cdn.example/image-{index}.png",
            }
            for index in range(3)
        ]

    class Downloader:
        def download(self, image_url: str) -> DownloadedImage:
            return DownloadedImage(image_url, "image/png", b"image", "a" * 64)

    service = AgentRunService(
        repository,
        search_adapters={"firecrawl": search, "qwen": search, "glm": search},
        image_downloader=Downloader(),
    )
    # Explicitly clear settings-backed discovery for this deterministic missing-provider case.
    service.ai_image_adapter = None
    run, _ = service.create(
        run_id="run-no-ai-provider-001",
        presentation_id="presentation-no-ai-provider-001",
        owner_scope="owner-a",
        prompt="missing image provider",
        max_iterations=3,
    )

    for _ in range(500):
        snapshot = service.get(run.id, owner_scope="owner-a")
        if snapshot.status in {"COMPLETED", "FAILED", "CANCELLED"}:
            break
        time.sleep(0.01)

    assert snapshot.status == "FAILED"
    assert snapshot.state["aiImages"]["generatedCount"] == 0
    events = repository.list_run_events(run.id, after_sequence=0, limit=200)
    failed = next(event for event in events if event.event_type == "run.failed")
    assert "AI 图片生成 provider 未配置" in failed.payload["message"]


def test_idempotent_create_restarts_an_unfinished_worker_after_process_restore(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = "presentation-worker-restore-001"
    repository.create_presentation(
        presentation_id="presentation-worker-restore-001",
        owner_scope="owner-a",
        title="Worker restore",
        document=document,
        template_id=None,
    )
    repository.create_run(
        run_id="run-worker-restore-001",
        presentation_id="presentation-worker-restore-001",
        owner_scope="owner-a",
        status="RUNNING",
        phase="WEB_ASSETS",
        state={"prompt": "resume worker", "modelProvider": "deepseek", "searchProvider": "auto", "searchLimit": 20},
    )
    service = AgentRunService(repository, search_adapters={})
    calls: list[str] = []
    service._execute = lambda run_id, owner_scope: calls.append(f"{run_id}:{owner_scope}")  # type: ignore[method-assign]

    restored, created = service.create(
        run_id="run-worker-restore-001",
        presentation_id="presentation-worker-restore-001",
        owner_scope="owner-a",
        prompt="resume worker",
        max_iterations=3,
    )

    for _ in range(100):
        if calls:
            break
        time.sleep(0.01)
    assert created is False
    assert restored.status == "RUNNING"
    assert calls == ["run-worker-restore-001:owner-a"]


def test_web_assets_are_selected_in_four_rounds_of_three_from_the_candidate_pool(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = "presentation-web-rounds-001"
    repository.create_presentation(
        presentation_id="presentation-web-rounds-001",
        owner_scope="owner-a",
        title="Web asset rounds",
        document=document,
        template_id=None,
    )

    def search(query: str, _limit: int):
        offset = 0 if "概念定义" in query else 9 if "行业研究" in query else 18
        return [
            {
                "title": f"Image source {offset + index}",
                "url": f"https://example.com/article-{offset + index}",
                "imageUrl": f"https://cdn.example/image-{offset + index}.png",
            }
            for index in range(9)
        ]

    class Downloader:
        def download(self, image_url: str) -> DownloadedImage:
            return DownloadedImage(image_url, "image/png", b"image", "a" * 64)

    class ImageAdapter:
        def generate(self, *, role: str, prompt: str):
            return {"role": role, "assetId": f"asset-{role.lower()}", "imageUrl": f"https://cdn.example/{role.lower()}.png"}

    service = AgentRunService(
        repository,
        search_adapters={"firecrawl": search, "qwen": search, "glm": search},
        ai_image_adapter=ImageAdapter(),
        image_downloader=Downloader(),
    )
    run, _ = service.create(
        run_id="run-web-rounds-001",
        presentation_id="presentation-web-rounds-001",
        owner_scope="owner-a",
        prompt="web rounds",
        max_iterations=3,
        search_limit=20,
    )

    for _ in range(500):
        snapshot = service.get(run.id, owner_scope="owner-a")
        if snapshot.status in {"COMPLETED", "FAILED", "CANCELLED"}:
            break
        time.sleep(0.01)

    assert snapshot.status == "COMPLETED"
    web_images = snapshot.state["webImages"]
    assert web_images["candidateCount"] == 27
    assert web_images["selectedCount"] == 9
    assert web_images["downloadedCount"] == 9
    assert len(web_images["candidateSources"]) == 27
    assert len(web_images["selectionRounds"]) == 3
    assert [round_state["selectedCount"] for round_state in web_images["selectionRounds"]] == [3, 3, 3]
