from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from ppt_api import create_ppt_router
from ppt_repository import PptRepository


FIXTURE = Path(__file__).parent / "fixtures" / "ppt_document_v1.json"


def _client(tmp_path: Path) -> TestClient:
    repository = PptRepository(tmp_path / "ppt.db")

    async def owner_resolver(request: Request) -> str:
        return request.headers.get("x-test-owner", "owner-a")

    app = FastAPI()
    app.include_router(create_ppt_router(repository, owner_resolver=owner_resolver))
    return TestClient(app)


def _document(presentation_id: str) -> dict[str, object]:
    document = json.loads(FIXTURE.read_text(encoding="utf-8"))
    document["presentationId"] = presentation_id
    document["revision"] = 0
    return document


def test_create_blank_presentation_is_a_fresh_server_side_document(tmp_path: Path) -> None:
    client = _client(tmp_path)

    response = client.post(
        "/api/ppt/presentations",
        headers={"x-test-owner": "owner-a"},
        json={"title": "新的团队协作 PPT"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["presentationId"]
    assert payload["title"] == "新的团队协作 PPT"
    assert payload["revision"] == 0
    assert payload["document"]["presentationId"] == payload["presentationId"]
    assert payload["document"]["slides"]

    fetched = client.get(
        f"/api/ppt/presentations/{payload['presentationId']}",
        headers={"x-test-owner": "owner-a"},
    )
    assert fetched.status_code == 200
    assert fetched.json() == payload


def test_presentation_operations_are_atomic_and_revision_checked(tmp_path: Path) -> None:
    client = _client(tmp_path)
    presentation_id = "presentation-api-001"
    created = client.post(
        "/api/ppt/presentations",
        headers={"x-test-owner": "owner-a"},
        json={"title": "协作", "document": _document(presentation_id)},
    )
    assert created.status_code == 201

    operation = {
        "operationId": "op-notes-001",
        "type": "SET_NOTES",
        "slideId": "slide-001",
        "notes": "由 Agent 生成的演讲备注",
    }
    updated = client.post(
        f"/api/ppt/presentations/{presentation_id}/operations",
        headers={"x-test-owner": "owner-a"},
        json={"baseRevision": 0, "operations": [operation]},
    )
    assert updated.status_code == 200
    assert updated.json()["revision"] == 1
    assert updated.json()["document"]["slides"][0]["notes"] == operation["notes"]

    stale = client.post(
        f"/api/ppt/presentations/{presentation_id}/operations",
        headers={"x-test-owner": "owner-a"},
        json={"baseRevision": 0, "operations": [{**operation, "operationId": "op-stale"}]},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "REVISION_CONFLICT"
    assert stale.json()["error"]["details"]["currentRevision"] == 1


def test_duplicate_operation_is_idempotent_and_private_presentation_is_owner_scoped(tmp_path: Path) -> None:
    client = _client(tmp_path)
    created = client.post(
        "/api/ppt/presentations",
        headers={"x-test-owner": "owner-a"},
        json={"title": "仅本人可见"},
    )
    presentation_id = created.json()["presentationId"]
    operation = {
        "operationId": "op-idempotent",
        "type": "SET_NOTES",
        "slideId": "slide-1",
        "notes": "一次即可",
    }

    first = client.post(
        f"/api/ppt/presentations/{presentation_id}/operations",
        headers={"x-test-owner": "owner-a"},
        json={"baseRevision": 0, "operations": [operation]},
    )
    second = client.post(
        f"/api/ppt/presentations/{presentation_id}/operations",
        headers={"x-test-owner": "owner-a"},
        json={"baseRevision": 0, "operations": [operation]},
    )
    hidden = client.get(
        f"/api/ppt/presentations/{presentation_id}",
        headers={"x-test-owner": "owner-b"},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["revision"] == 1
    assert second.json()["ignoredOperationIds"] == ["op-idempotent"]
    assert hidden.status_code == 404
    assert hidden.json()["error"]["code"] == "PPT_PRESENTATION_NOT_FOUND"
