from __future__ import annotations

from fastapi.testclient import TestClient

from visual_workflow_api import create_visual_workflow_router
from visual_workflow_repository import VisualWorkflowRepository


def client(tmp_path):
    repository = VisualWorkflowRepository(tmp_path / "workflow.sqlite3")
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(create_visual_workflow_router(repository))
    return TestClient(app)


def document_payload(prompt_text: str = "雨夜中的东京") -> dict:
    return {
        "schemaVersion": 1,
        "workflowId": "",
        "revision": 0,
        "name": "ignored by revision",
        "nodes": [{
            "id": "prompt-1",
            "kind": "prompt_input",
            "definitionVersion": 1,
            "position": {"x": 80, "y": 120},
            "config": {"text": prompt_text},
        }],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    }


def test_node_definition_endpoint_exposes_typed_ports(tmp_path):
    response = client(tmp_path).get("/api/visual-workflow-node-definitions")

    assert response.status_code == 200
    payload = response.json()
    reference = next(item for item in payload["definitions"] if item["kind"] == "reference_to_video")
    assert reference["inputs"][1]["dataType"] == "video.asset"
    assert reference["inputs"][1]["cardinality"] == "many"


def test_create_get_and_list_workflow_round_trip(tmp_path):
    api = client(tmp_path)

    created = api.post("/api/visual-workflows", json={"name": "人物视频流水线"})
    assert created.status_code == 201
    payload = created.json()
    workflow_id = payload["id"]
    assert payload["currentRevision"] == 1
    assert payload["document"]["workflowId"] == workflow_id

    fetched = api.get(f"/api/visual-workflows/{workflow_id}")
    listed = api.get("/api/visual-workflows?page=1&pageSize=10")

    assert fetched.status_code == 200
    assert fetched.json()["name"] == "人物视频流水线"
    assert listed.status_code == 200
    assert listed.json()["pagination"]["totalItems"] == 1


def test_save_revision_uses_optimistic_base_revision_and_rejects_stale_writer(tmp_path):
    api = client(tmp_path)
    workflow_id = api.post("/api/visual-workflows", json={"name": "可版本化图"}).json()["id"]

    saved = api.patch(f"/api/visual-workflows/{workflow_id}", json={
        "baseRevision": 1,
        "document": document_payload("第一版提示词"),
    })
    stale = api.patch(f"/api/visual-workflows/{workflow_id}", json={
        "baseRevision": 1,
        "document": document_payload("过期编辑器的提示词"),
    })

    assert saved.status_code == 200
    assert saved.json()["currentRevision"] == 2
    assert saved.json()["document"]["revision"] == 2
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "REVISION_CONFLICT"


def test_validate_endpoint_returns_node_and_port_issues(tmp_path):
    api = client(tmp_path)
    workflow_id = api.post("/api/visual-workflows", json={"name": "待校验"}).json()["id"]
    invalid = document_payload()
    invalid["nodes"] = [{
        "id": "generate-1",
        "kind": "image_generate",
        "definitionVersion": 1,
        "position": {"x": 0, "y": 0},
        "config": {},
    }]

    response = api.post(f"/api/visual-workflows/{workflow_id}/validate", json={
        "document": invalid,
        "requireInputs": True,
    })

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "WORKFLOW_INVALID"
    assert response.json()["error"]["details"]["issues"][0]["nodeId"] == "generate-1"


def test_deleted_workflow_is_not_listed_and_get_returns_not_found(tmp_path):
    api = client(tmp_path)
    workflow_id = api.post("/api/visual-workflows", json={"name": "待删除"}).json()["id"]

    deleted = api.delete(f"/api/visual-workflows/{workflow_id}")
    fetched = api.get(f"/api/visual-workflows/{workflow_id}")
    listed = api.get("/api/visual-workflows?page=1&pageSize=10")

    assert deleted.status_code == 204
    assert fetched.status_code == 404
    assert listed.json()["pagination"]["totalItems"] == 0

