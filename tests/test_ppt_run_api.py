from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from ppt_api import create_ppt_router
from ppt_repository import PptRepository


FIXTURE = Path(__file__).parent / "fixtures" / "ppt_document_v1.json"


def _client(tmp_path: Path) -> TestClient:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = "presentation-run-001"
    document["revision"] = 0
    repository.create_presentation(
        presentation_id="presentation-run-001",
        owner_scope="owner-a",
        title="Run test",
        document=document,
        template_id=None,
    )

    async def owner_resolver(request: Request) -> str:
        return request.headers.get("x-test-owner", "owner-a")

    app = FastAPI()
    app.include_router(create_ppt_router(repository, owner_resolver=owner_resolver))
    app.state.ppt_repository = repository
    return TestClient(app)


def test_run_is_idempotent_and_events_are_replayable_as_sse(tmp_path: Path) -> None:
    client = _client(tmp_path)
    headers = {"x-test-owner": "owner-a"}
    payload = {
        "runId": "run-api-001",
        "presentationId": "presentation-run-001",
        "prompt": "做一份关于团队协作的 8 页 PPT",
        "modelProvider": "glm",
        "searchProvider": "firecrawl",
        "searchLimit": 15,
    }

    first = client.post("/api/ppt/runs", headers=headers, json=payload)
    second = client.post("/api/ppt/runs", headers=headers, json=payload)
    conflicting = client.post(
        "/api/ppt/runs",
        headers=headers,
        json={**payload, "prompt": "另一个任务"},
    )
    assert first.status_code == 201
    assert second.status_code == 200
    assert conflicting.status_code == 409
    assert conflicting.json()["error"]["code"] == "PPT_RUN_CONFLICT"
    assert second.json()["runId"] == "run-api-001"
    assert second.json()["state"]["modelProvider"] == "glm"
    assert second.json()["state"]["searchProvider"] == "firecrawl"
    assert second.json()["state"]["searchLimit"] == 15

    time.sleep(0.35)
    snapshot = client.get("/api/ppt/runs/run-api-001", headers=headers)
    assert snapshot.status_code == 200
    assert snapshot.json()["status"] in {"RUNNING", "COMPLETED", "CANCELLED"}

    stream = client.get(
        "/api/ppt/runs/run-api-001/events",
        headers={**headers, "Last-Event-ID": "0"},
    )
    assert stream.status_code == 200
    assert stream.headers["content-type"].startswith("text/event-stream")
    assert "event: run.created" in stream.text
    assert "id: 1" in stream.text


def test_run_is_owner_scoped_and_can_be_cancelled(tmp_path: Path) -> None:
    client = _client(tmp_path)
    created = client.post(
        "/api/ppt/runs",
        headers={"x-test-owner": "owner-a"},
        json={
            "runId": "run-cancel-001",
            "presentationId": "presentation-run-001",
            "prompt": "快速生成",
        },
    )
    assert created.status_code == 201

    hidden = client.get("/api/ppt/runs/run-cancel-001", headers={"x-test-owner": "owner-b"})
    cancelled = client.post("/api/ppt/runs/run-cancel-001/cancel", headers={"x-test-owner": "owner-a"})

    assert hidden.status_code == 404
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
    events = client.get("/api/ppt/runs/run-cancel-001/events", headers={"x-test-owner": "owner-a"})
    assert "event: run.cancelled" in events.text


def test_resumable_runs_are_listed_in_updated_order_and_exclude_terminal_runs(tmp_path: Path) -> None:
    client = _client(tmp_path)
    headers = {"x-test-owner": "owner-a"}
    first = client.post(
        "/api/ppt/runs",
        headers=headers,
        json={
            "runId": "run-resume-001",
            "presentationId": "presentation-run-001",
            "prompt": "保留未完成进度",
        },
    )
    second = client.post(
        "/api/ppt/runs",
        headers=headers,
        json={
            "runId": "run-resume-002",
            "presentationId": "presentation-run-001",
            "prompt": "另一个未完成进度",
        },
    )
    assert first.status_code == 201
    assert second.status_code == 201
    client.post("/api/ppt/runs/run-resume-001/cancel", headers=headers)

    resumable = client.get("/api/ppt/runs/resumable", headers=headers)

    assert resumable.status_code == 200
    assert [run["runId"] for run in resumable.json()["runs"]] == ["run-resume-002"]
    assert resumable.json()["runs"][0]["state"]["prompt"] == "另一个未完成进度"


def test_ppt_history_lists_terminal_and_active_runs_with_presentation_binding(tmp_path: Path) -> None:
    client = _client(tmp_path)
    headers = {"x-test-owner": "owner-a"}
    first = client.post(
        "/api/ppt/runs",
        headers=headers,
        json={
            "runId": "run-history-001",
            "presentationId": "presentation-run-001",
            "prompt": "记录已完成的历史 PPT",
        },
    )
    second = client.post(
        "/api/ppt/runs",
        headers=headers,
        json={
            "runId": "run-history-002",
            "presentationId": "presentation-run-001",
            "prompt": "记录仍在执行的历史 PPT",
        },
    )
    assert first.status_code == 201
    assert second.status_code == 201
    client.post("/api/ppt/runs/run-history-001/cancel", headers=headers)

    history = client.get("/api/ppt/runs/history?limit=50", headers=headers)

    assert history.status_code == 200
    records = {item["runId"]: item for item in history.json()["runs"]}
    assert {"run-history-001", "run-history-002"}.issubset(records)
    assert records["run-history-001"]["presentationId"] == "presentation-run-001"
    assert records["run-history-001"]["title"] == "Run test"
    assert records["run-history-001"]["prompt"] == "记录已完成的历史 PPT"
    assert records["run-history-001"]["status"] == "CANCELLED"


def test_completed_presentation_can_be_published_to_market_idempotently(tmp_path: Path) -> None:
    client = _client(tmp_path)
    headers = {"x-test-owner": "owner-a"}
    client.app.state.ppt_repository.create_run(
        run_id="run-publish-001",
        presentation_id="presentation-run-001",
        owner_scope="owner-a",
        status="COMPLETED",
        phase="REVIEW",
        state={"qualityReport": {"status": "passed"}},
    )
    published = client.post("/api/ppt/presentations/presentation-run-001/publish", headers=headers)
    repeated = client.post("/api/ppt/presentations/presentation-run-001/publish", headers=headers)
    assert published.status_code == 200
    assert published.json()["template"]["isPrivate"] is True
    assert published.json()["template"]["status"] == "READY"
    assert published.json()["template"]["pageCount"] == 1
    assert published.json()["template"]["manifest"]["presentationDocument"]["slides"][0]["id"] == "slide-001"
    assert repeated.json()["template"]["id"] == published.json()["template"]["id"]
    market = client.get("/api/ppt/templates?page=1&pageSize=50&source=PRIVATE", headers=headers)
    assert market.status_code == 200
    assert published.json()["template"]["id"] in {item["id"] for item in market.json()["templates"]}


def test_published_presentation_syncs_first_slide_image_as_market_cover(tmp_path: Path) -> None:
    client = _client(tmp_path)
    headers = {"x-test-owner": "owner-a"}
    repository = client.app.state.ppt_repository
    record = repository.get_presentation("presentation-run-001", owner_scope="owner-a")
    assert record is not None
    document = json.loads(json.dumps(record.document))
    document["slides"][0]["background"] = {
        "type": "IMAGE",
        "assetId": "asset-cover-001",
        "fit": "COVER",
        "opacity": 1,
    }
    repository.commit_revision(
        presentation_id=record.id,
        owner_scope="owner-a",
        expected_revision=record.current_revision,
        document={**document, "revision": record.current_revision + 1},
        operations=[],
        operation_payloads={},
    )
    repository.create_run(
        run_id="run-publish-cover-001",
        presentation_id="presentation-run-001",
        owner_scope="owner-a",
        status="COMPLETED",
        phase="REVIEW",
        state={"qualityReport": {"status": "passed"}},
    )

    published = client.post("/api/ppt/presentations/presentation-run-001/publish", headers=headers)

    assert published.status_code == 200
    template = published.json()["template"]
    assert template["coverUrl"].endswith("/api/ppt/assets/asset-cover-001/content")
    assert template["manifest"]["coverAssetId"] == "asset-cover-001"


def test_republishing_after_private_template_soft_delete_restores_the_same_entry(tmp_path: Path) -> None:
    client = _client(tmp_path)
    headers = {"x-test-owner": "owner-a"}
    repository = client.app.state.ppt_repository
    repository.create_run(
        run_id="run-publish-restored-001",
        presentation_id="presentation-run-001",
        owner_scope="owner-a",
        status="COMPLETED",
        phase="REVIEW",
        state={"qualityReport": {"status": "passed"}},
    )

    first = client.post("/api/ppt/presentations/presentation-run-001/publish", headers=headers)
    assert first.status_code == 200
    template_id = first.json()["template"]["id"]
    assert client.delete(f"/api/ppt/templates/{template_id}", headers=headers).status_code == 204
    assert client.get(f"/api/ppt/templates/{template_id}", headers=headers).status_code == 404

    restored = client.post("/api/ppt/presentations/presentation-run-001/publish", headers=headers)

    assert restored.status_code == 200
    assert restored.json()["template"]["id"] == template_id
    assert restored.json()["template"]["status"] == "READY"
    market = client.get("/api/ppt/templates?page=1&pageSize=50&source=PRIVATE", headers=headers)
    assert template_id in {item["id"] for item in market.json()["templates"]}


def test_getting_an_older_published_template_backfills_its_preview_document(tmp_path: Path) -> None:
    client = _client(tmp_path)
    repository = client.app.state.ppt_repository
    template_id = f"template-published-{uuid.uuid5(uuid.NAMESPACE_URL, 'owner-a:presentation-run-001').hex}"
    repository.create_template(
        template_id=template_id,
        owner_scope="owner-a",
        name="旧发布记录",
        description="旧记录",
        scene="CUSTOM",
        source="PRIVATE",
        status="READY",
        manifest={"pageCount": 0, "publishedPresentationId": "presentation-run-001"},
    )

    detail = client.get(f"/api/ppt/templates/{template_id}", headers={"x-test-owner": "owner-a"})

    assert detail.status_code == 200
    assert detail.json()["pageCount"] == 1
    assert detail.json()["manifest"]["presentationDocument"]["slides"][0]["id"] == "slide-001"
    listed = client.get("/api/ppt/templates?page=1&pageSize=50&source=PRIVATE", headers={"x-test-owner": "owner-a"})
    listed_template = next(item for item in listed.json()["templates"] if item["id"] == template_id)
    assert listed_template["pageCount"] == 1


def test_completed_presentation_with_legacy_numeric_metadata_can_be_published(tmp_path: Path) -> None:
    client = _client(tmp_path)
    headers = {"x-test-owner": "owner-a"}
    repository = client.app.state.ppt_repository
    record = repository.get_presentation("presentation-run-001", owner_scope="owner-a")
    assert record is not None
    legacy_document = record.document
    legacy_document["metadata"]["updatedAt"] = 1787495566.5002158
    repository.commit_revision(
        presentation_id=record.id,
        owner_scope="owner-a",
        expected_revision=record.current_revision,
        document={**legacy_document, "revision": record.current_revision + 1},
        operations=[],
        operation_payloads={},
    )
    repository.create_run(
        run_id="run-publish-legacy-001",
        presentation_id="presentation-run-001",
        owner_scope="owner-a",
        status="COMPLETED",
        phase="REVIEW",
        state={"qualityReport": {"status": "passed"}},
    )

    published = client.post("/api/ppt/presentations/presentation-run-001/publish", headers=headers)

    assert published.status_code == 200
    assert published.json()["template"]["status"] == "READY"


def test_completed_presentation_with_replayed_duplicate_slide_can_be_published(tmp_path: Path) -> None:
    client = _client(tmp_path)
    headers = {"x-test-owner": "owner-a"}
    repository = client.app.state.ppt_repository
    record = repository.get_presentation("presentation-run-001", owner_scope="owner-a")
    assert record is not None
    duplicate_document = {
        **record.document,
        "slides": [record.document["slides"][0], {**record.document["slides"][0], "order": 1}],
        "revision": record.current_revision + 1,
    }
    repository.commit_revision(
        presentation_id=record.id,
        owner_scope="owner-a",
        expected_revision=record.current_revision,
        document=duplicate_document,
        operations=[],
        operation_payloads={},
    )
    repository.create_run(
        run_id="run-publish-duplicate-001",
        presentation_id="presentation-run-001",
        owner_scope="owner-a",
        status="COMPLETED",
        phase="REVIEW",
        state={"qualityReport": {"status": "passed"}},
    )

    published = client.post("/api/ppt/presentations/presentation-run-001/publish", headers=headers)

    assert published.status_code == 200
    assert published.json()["template"]["pageCount"] == 1


def test_unfinished_presentation_cannot_be_published(tmp_path: Path) -> None:
    client = _client(tmp_path)
    headers = {"x-test-owner": "owner-a"}
    client.app.state.ppt_repository.create_run(
        run_id="run-publish-pending",
        presentation_id="presentation-run-001",
        owner_scope="owner-a",
        status="RUNNING",
        phase="BUILD",
        state={},
    )
    rejected = client.post("/api/ppt/presentations/presentation-run-001/publish", headers=headers)
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "PPT_PRESENTATION_NOT_READY"


def test_ppt_asset_content_is_served_from_local_storage_and_owner_scoped(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = "presentation-asset-001"
    document["revision"] = 0
    repository.create_presentation(
        presentation_id="presentation-asset-001",
        owner_scope="owner-a",
        title="Asset test",
        document=document,
        template_id=None,
    )
    asset_root = tmp_path / "assets"
    asset_path = asset_root / "web" / "asset-1.png"
    asset_path.parent.mkdir(parents=True)
    asset_path.write_bytes(b"png-bytes")
    repository.create_asset(
        asset_id="asset-1",
        owner_scope="owner-a",
        kind="PPT_WEB_IMAGE",
        storage_path="web/asset-1.png",
        mime_type="image/png",
        size_bytes=9,
        sha256="a" * 64,
        source_url="https://example.com/source.png",
    )

    async def owner_resolver(request: Request) -> str:
        return request.headers.get("x-test-owner", "owner-a")

    app = FastAPI()
    app.include_router(create_ppt_router(repository, owner_resolver=owner_resolver, asset_root=asset_root))
    response = TestClient(app).get("/api/ppt/assets/asset-1/content", headers={"x-test-owner": "owner-a"})
    hidden = TestClient(app).get("/api/ppt/assets/asset-1/content", headers={"x-test-owner": "owner-b"})

    assert response.status_code == 200
    assert response.content == b"png-bytes"
    assert response.headers["content-type"].startswith("image/png")
    assert hidden.status_code == 404
