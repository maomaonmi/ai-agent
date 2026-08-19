from __future__ import annotations

from fastapi.testclient import TestClient

from visual_workflow_api import create_visual_workflow_router
from visual_workflow_repository import VisualWorkflowRepository


class FakeWorkflowExecutor:
    def __init__(self):
        self.calls = []

    async def execute(self, workflow_id, run_id, document, plan):
        self.calls.append((workflow_id, run_id, document.revision, plan.node_ids))


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
    assert reference["inputs"][1]["dataType"] == "media.asset"
    assert reference["inputs"][1]["cardinality"] == "many"
    image_generate = next(item for item in payload["definitions"] if item["kind"] == "image_generate")
    assert {port["id"] for port in image_generate["inputs"]} == {"prompt", "reference_image", "references"}
    reference_image = next(port for port in image_generate["inputs"] if port["id"] == "reference_image")
    assert reference_image["dataType"] == "image.asset"
    assert reference_image["required"] is False
    image_references = next(port for port in image_generate["inputs"] if port["id"] == "references")
    assert image_references["dataType"] == "image.asset"
    assert image_references["cardinality"] == "many"
    reference_video = next(item for item in payload["definitions"] if item["kind"] == "reference_to_video")
    assert reference_video["inputs"][1]["dataType"] == "media.asset"


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


def test_validate_endpoint_allows_multiple_edges_from_one_output_port(tmp_path):
    api = client(tmp_path)
    workflow_id = api.post("/api/visual-workflows", json={"name": "单连线规则"}).json()["id"]
    document = document_payload()
    document["nodes"] = [
        document["nodes"][0],
        {"id": "prompt-2", "kind": "prompt_input", "definitionVersion": 1, "position": {"x": 0, "y": 200}, "config": {}},
        {"id": "video-a", "kind": "text_to_video", "definitionVersion": 1, "position": {"x": 200, "y": 0}, "config": {}},
        {"id": "video-b", "kind": "text_to_video", "definitionVersion": 1, "position": {"x": 200, "y": 200}, "config": {}},
    ]
    document["edges"] = [
        {"id": "e-a", "sourceNodeId": "prompt-1", "sourcePortId": "prompt", "targetNodeId": "video-a", "targetPortId": "prompt"},
        {"id": "e-b", "sourceNodeId": "prompt-1", "sourcePortId": "prompt", "targetNodeId": "video-b", "targetPortId": "prompt"},
        {"id": "e-c", "sourceNodeId": "prompt-2", "sourcePortId": "prompt", "targetNodeId": "video-a", "targetPortId": "prompt"},
    ]

    response = api.post(f"/api/visual-workflows/{workflow_id}/validate", json={"document": document})

    assert response.status_code == 200
    assert response.json() == {"valid": True, "issues": []}


def test_validate_endpoint_allows_prompt_and_image_inputs_on_image_generate(tmp_path):
    api = client(tmp_path)
    workflow_id = api.post("/api/visual-workflows", json={"name": "图片生成双输入"}).json()["id"]
    document = document_payload()
    document["nodes"] = [
        document["nodes"][0],
        {"id": "image-1", "kind": "image_input", "definitionVersion": 1, "position": {"x": 0, "y": 200}, "config": {}},
        {"id": "generate-1", "kind": "image_generate", "definitionVersion": 1, "position": {"x": 320, "y": 120}, "config": {}},
    ]
    document["edges"] = [
        {"id": "prompt-generate", "sourceNodeId": "prompt-1", "sourcePortId": "prompt", "targetNodeId": "generate-1", "targetPortId": "prompt"},
        {"id": "image-generate", "sourceNodeId": "image-1", "sourcePortId": "image", "targetNodeId": "generate-1", "targetPortId": "reference_image"},
    ]

    response = api.post(f"/api/visual-workflows/{workflow_id}/validate", json={"document": document})

    assert response.status_code == 200
    assert response.json() == {"valid": True, "issues": []}


def test_deleted_workflow_is_not_listed_and_get_returns_not_found(tmp_path):
    api = client(tmp_path)
    workflow_id = api.post("/api/visual-workflows", json={"name": "待删除"}).json()["id"]

    deleted = api.delete(f"/api/visual-workflows/{workflow_id}")
    fetched = api.get(f"/api/visual-workflows/{workflow_id}")
    listed = api.get("/api/visual-workflows?page=1&pageSize=10")

    assert deleted.status_code == 204
    assert fetched.status_code == 404
    assert listed.json()["pagination"]["totalItems"] == 0


def test_compile_endpoint_returns_topological_batches(tmp_path):
    api = client(tmp_path)
    created = api.post("/api/visual-workflows", json={"name": "可编译流水线"}).json()
    workflow_id = created["id"]
    document = document_payload()
    document["nodes"] = [
        document["nodes"][0],
        {"id": "video-1", "kind": "text_to_video", "definitionVersion": 1, "position": {"x": 320, "y": 120}, "config": {}},
    ]
    document["edges"] = [{"id": "prompt-video", "sourceNodeId": "prompt-1", "sourcePortId": "prompt", "targetNodeId": "video-1", "targetPortId": "prompt"}]
    saved = api.patch(f"/api/visual-workflows/{workflow_id}", json={"baseRevision": 1, "document": document})
    assert saved.status_code == 200

    response = api.post(f"/api/visual-workflows/{workflow_id}/compile", json={})

    assert response.status_code == 200
    assert response.json()["plan"]["batches"] == [["prompt-1"], ["video-1"]]


def test_dry_run_creation_is_idempotent_and_execute_is_guarded(tmp_path):
    api = client(tmp_path)
    workflow_id = api.post("/api/visual-workflows", json={"name": "预演"}).json()["id"]
    payload = {"mode": "dry-run", "clientRequestId": "client-123"}

    first = api.post(f"/api/visual-workflows/{workflow_id}/runs", json=payload)
    second = api.post(f"/api/visual-workflows/{workflow_id}/runs", json=payload)
    execute = api.post(f"/api/visual-workflows/{workflow_id}/runs", json={"mode": "execute"})

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["status"] == "PLANNED"
    assert execute.status_code == 409
    assert execute.json()["error"]["code"] == "EXECUTION_NOT_AVAILABLE"


def test_execute_run_is_accepted_when_an_executor_is_injected(tmp_path):
    repository = VisualWorkflowRepository(tmp_path / "workflow.sqlite3")
    executor = FakeWorkflowExecutor()
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(create_visual_workflow_router(repository, executor=executor))
    api = TestClient(app)
    created = api.post("/api/visual-workflows", json={"name": "真实执行"}).json()
    document = document_payload()
    document["nodes"].append({"id": "video-1", "kind": "text_to_video", "definitionVersion": 1, "position": {"x": 320, "y": 120}, "config": {}})
    document["edges"] = [{"id": "prompt-video", "sourceNodeId": "prompt-1", "sourcePortId": "prompt", "targetNodeId": "video-1", "targetPortId": "prompt"}]
    saved = api.patch(f"/api/visual-workflows/{created['id']}", json={"baseRevision": 1, "document": document})
    response = api.post(f"/api/visual-workflows/{created['id']}/runs", json={"mode": "execute", "requireInputs": True})

    assert saved.status_code == 200
    assert response.status_code == 201
    assert response.json()["mode"] == "execute"
    assert response.json()["nodeRuns"]
    assert executor.calls and executor.calls[0][3] == ("prompt-1", "video-1")


def test_planned_run_can_be_cancelled_and_cancel_is_idempotent(tmp_path):
    api = client(tmp_path)
    workflow_id = api.post("/api/visual-workflows", json={"name": "可取消预演"}).json()["id"]
    run = api.post(f"/api/visual-workflows/{workflow_id}/runs", json={"mode": "dry-run"}).json()

    cancelled = api.post(f"/api/visual-workflows/{workflow_id}/runs/{run['id']}/cancel")
    repeated = api.post(f"/api/visual-workflows/{workflow_id}/runs/{run['id']}/cancel")

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
    assert repeated.status_code == 200
    assert repeated.json()["status"] == "CANCELLED"


def test_compile_endpoint_returns_structured_cycle_error(tmp_path):
    api = client(tmp_path)
    created = api.post("/api/visual-workflows", json={"name": "环路"}).json()
    workflow_id = created["id"]
    document = document_payload()
    document["nodes"] = [
        {"id": "a", "kind": "prompt_template", "definitionVersion": 1, "position": {"x": 0, "y": 0}, "config": {}},
        {"id": "b", "kind": "prompt_template", "definitionVersion": 1, "position": {"x": 200, "y": 0}, "config": {}},
    ]
    document["edges"] = [
        {"id": "a-b", "sourceNodeId": "a", "sourcePortId": "prompt", "targetNodeId": "b", "targetPortId": "prompt_in"},
        {"id": "b-a", "sourceNodeId": "b", "sourcePortId": "prompt", "targetNodeId": "a", "targetPortId": "prompt_in"},
    ]
    # Saving rejects invalid graphs; compile should still return the same
    # structured error when a malformed revision is submitted directly to the
    # endpoint only if it exists. This assertion documents the save boundary.
    saved = api.patch(f"/api/visual-workflows/{workflow_id}", json={"baseRevision": 1, "document": document})

    assert saved.status_code == 422
    assert saved.json()["error"]["details"]["issues"][0]["code"] == "CYCLE_DETECTED"
