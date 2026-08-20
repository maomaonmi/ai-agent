from __future__ import annotations

import json
import time
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
