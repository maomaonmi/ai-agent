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
    assert all(str(asset["imageUrl"]).startswith("/api/ppt/assets/") for asset in snapshot.state["webImages"]["assets"])
    assert all("assetId" in asset for asset in snapshot.state["webImages"]["assets"])
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


def test_repair_web_assets_rehydrates_legacy_remote_urls_idempotently(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = "presentation-repair-001"
    repository.create_presentation(
        presentation_id="presentation-repair-001",
        owner_scope="owner-a",
        title="Repair test",
        document=document,
        template_id=None,
    )
    repository.create_run(
        run_id="run-repair-001",
        presentation_id="presentation-repair-001",
        owner_scope="owner-a",
        status="COMPLETED",
        phase="REVIEW",
        state={
            "prompt": "repair",
            "webImages": {
                "assets": [{"imageUrl": "https://cdn.example/legacy.png", "pageUrl": "https://example.com/article"}],
                "selectionRounds": [{"round": 1, "assets": [{"imageUrl": "https://cdn.example/legacy.png"}]}],
            },
        },
    )

    class Downloader:
        calls = 0

        def download(self, image_url: str) -> DownloadedImage:
            self.calls += 1
            return DownloadedImage(image_url, "image/png", b"legacy-png", "b" * 64)

    downloader = Downloader()
    service = AgentRunService(repository, image_downloader=downloader, search_adapters={})

    repaired = service.repair_web_assets("run-repair-001", owner_scope="owner-a")
    asset = repaired.state["webImages"]["assets"][0]
    assert asset["assetId"].startswith("ppt-web-")
    assert asset["imageUrl"].startswith("/api/ppt/assets/")
    assert (tmp_path / "ppt-assets" / "web").exists()
    assert downloader.calls == 1

    service.repair_web_assets("run-repair-001", owner_scope="owner-a")
    assert downloader.calls == 1


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


def test_continue_audit_resumes_from_first_missing_artifact(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = "presentation-continue-001"
    repository.create_presentation(
        presentation_id="presentation-continue-001",
        owner_scope="owner-a",
        title="Continue test",
        document=document,
        template_id=None,
    )
    state = {
        "prompt": "continue audit",
        "searchRounds": [{"results": [{"url": "https://example.com/1"}]}, {"results": [{"url": "https://example.com/2"}]}, {"results": [{"url": "https://example.com/3"}]}],
        "webImages": {"selectedCount": 3, "assets": [{"assetId": f"web-{index}", "imageUrl": f"/api/ppt/assets/web-{index}", "pageUrl": "https://example.com"} for index in range(3)]},
        "aiImages": {"generatedCount": 3, "requiredCount": 3, "assets": [{"role": role, "assetId": f"asset-{role}"} for role in ("COVER", "MID_BACKGROUND", "END")]},
    }
    repository.create_run(
        run_id="run-continue-001",
        presentation_id="presentation-continue-001",
        owner_scope="owner-a",
        status="COMPLETED",
        phase="REVIEW",
        state=state,
    )
    service = AgentRunService(repository, search_adapters={}, image_downloader=None, web_image_extractor=None, allow_demo_materials=True)
    resumed, created = service.create(
        run_id="run-continue-001",
        presentation_id="presentation-continue-001",
        owner_scope="owner-a",
        prompt="continue audit",
        max_iterations=3,
        resume=True,
    )
    assert created is False
    assert resumed.status in {"QUEUED", "RUNNING"}
    assert resumed.phase in {"OUTLINE", "BUILD", "REVIEW"}
    for _ in range(500):
        snapshot = service.get(resumed.id, owner_scope="owner-a")
        if snapshot.status in {"COMPLETED", "FAILED", "CANCELLED"}:
            break
        time.sleep(0.01)
    assert snapshot.status == "COMPLETED"
    assert snapshot.state["outline"]["slideCount"] == 16
    assert snapshot.state["build"]["status"] == "completed"
    assert snapshot.state["build"]["contentVersion"] == 3
    assert "qualityReport" in snapshot.state
    presentation = repository.get_presentation("presentation-continue-001", owner_scope="owner-a")
    assert presentation is not None
    assert len(presentation.document["slides"]) == 16
    assert all(slide.get("background", {}).get("type") == "IMAGE" for slide in presentation.document["slides"])
    assert any(element.get("type") == "IMAGE" for slide in presentation.document["slides"] for element in slide.get("elements", []))
    assert all(any(element.get("id", "").endswith("-body") and len(element.get("text", "")) > 20 for element in slide.get("elements", [])) for slide in presentation.document["slides"])


def test_continue_audit_keeps_saved_search_and_generated_ai_assets() -> None:
    state = {
        "searchRounds": [
            {"results": [{"url": "https://example.com/round-1"}]},
            {"results": [{"url": "https://example.com/round-2"}]},
            {"results": [{"url": "https://example.com/round-3"}]},
        ],
        "webImages": {"mode": "provider", "selectedCount": 3, "assets": [{"imageUrl": "/api/ppt/assets/web-1"}, {"imageUrl": "/api/ppt/assets/web-2"}, {"imageUrl": "/api/ppt/assets/web-3"}]},
        "aiImages": {"mode": "provider", "generatedCount": 3, "requiredCount": 3, "assets": [{"role": role, "imageUrl": "https://provider.example/keep-me"} for role in ("COVER", "MID_BACKGROUND", "END")]},
    }
    # The provider URLs are already generated artifacts.  Only the missing
    # outline should be resumed; saved search rounds and AI images must not
    # trigger another Qwen/GLM request or generation call.
    assert AgentRunService._first_incomplete_phase(state) == "OUTLINE"


def test_build_writes_model_generated_sections_one_page_at_a_time(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = "presentation-narrative-001"
    repository.create_presentation(
        presentation_id="presentation-narrative-001",
        owner_scope="owner-a",
        title="Narrative test",
        document=document,
        template_id=None,
    )

    def search(query: str, _limit: int):
        marker = "one" if "概念定义" in query else "two" if "行业研究" in query else "three"
        return [{
            "title": f"{marker} source {index}",
            "url": f"https://example.com/{marker}-{index}",
            "imageUrl": f"https://cdn.example/{marker}-{index}.png",
        } for index in range(3)]

    class Downloader:
        def download(self, image_url: str) -> DownloadedImage:
            return DownloadedImage(image_url, "image/png", b"image", "a" * 64)

    class ImageAdapter:
        def generate(self, *, role: str, prompt: str):
            return {"role": role, "assetId": f"asset-{role.lower()}", "imageUrl": f"https://cdn.example/{role.lower()}.png"}

    class Narrative:
        provider = "qwen"

        def __init__(self):
            self.calls: list[int] = []

        def generate_slide(self, *, prompt, slide, chapter, total_slides, evidence, previous_sections):
            ordinal = int(slide["ordinal"])
            self.calls.append(ordinal)
            return {
                "title": f"模型标题 {ordinal}",
                "subtitle": f"第 {chapter} 章的判断",
                "body": f"这是模型真实写入的第 {ordinal} 页正文，基于 {len(evidence)} 条资料逐段展开，并承接前文形成连续叙事。",
                "keyPoints": [f"证据要点 {ordinal}", "可执行判断"],
                "speakerNotes": f"请讲解第 {ordinal} 页。",
                "sourceUrls": [str(evidence[0]["url"])] if evidence else [],
            }

    narrative = Narrative()
    service = AgentRunService(
        repository,
        search_adapters={"firecrawl": search, "qwen": search, "glm": search},
        ai_image_adapter=ImageAdapter(),
        image_downloader=Downloader(),
        narrative_generator=narrative,
    )
    run, _ = service.create(
        run_id="run-narrative-001",
        presentation_id="presentation-narrative-001",
        owner_scope="owner-a",
        prompt="人工智能发展",
        max_iterations=3,
    )
    for _ in range(500):
        snapshot = service.get(run.id, owner_scope="owner-a")
        if snapshot.status in {"COMPLETED", "FAILED", "CANCELLED"}:
            break
        time.sleep(0.01)

    assert snapshot.status == "COMPLETED"
    assert narrative.calls == list(range(1, 17))
    assert snapshot.state["build"]["contentMode"] == "model-segmented"
    assert snapshot.state["build"]["layoutVersion"] == 2
    assert snapshot.state["build"]["completedSlides"] == 16
    assert len({slide.get("layout") for slide in snapshot.state["outline"]["slides"]}) >= 6
    presentation = repository.get_presentation("presentation-narrative-001", owner_scope="owner-a")
    assert presentation is not None
    assert presentation.document["slides"][0]["elements"][1]["text"] == "模型标题 1"
    assert "模型真实写入的第 1 页正文" in next(
        element["text"] for element in presentation.document["slides"][0]["elements"] if element["id"].endswith("-body")
    )
    chart_elements = [
        element
        for slide in presentation.document["slides"]
        for element in slide.get("elements", [])
        if element.get("type") == "CHART"
    ]
    assert chart_elements
    assert chart_elements[0]["categories"] == ["阶段一", "阶段二", "阶段三"]
    assert chart_elements[0]["series"][0]["values"] == [42, 68, 86]
    progress = [
        event for event in repository.list_run_events(run.id, after_sequence=0, limit=500)
        if event.event_type == "phase.progress" and event.payload.get("phase") == "BUILD"
    ]
    assert len(progress) >= 16 * 5
    assert progress[0].payload["componentLabel"] == "建立画布骨架"
    assert any(event.payload.get("componentLabel") == "写入正文与要点" for event in progress)
    assert any(event.payload.get("writerProvider") == "qwen" and event.payload.get("completedSlides") == 16 for event in progress)
