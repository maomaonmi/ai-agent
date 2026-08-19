from __future__ import annotations

import asyncio

from visual_workflow_execution import compile_workflow
from visual_workflow_executor import VisualWorkflowExecutor
from visual_workflow_models import WorkflowDocument
from visual_workflow_repository import VisualWorkflowRepository
from video_engine import ProviderSubmission, ProviderTaskSnapshot, VideoTaskStatus


class FakeImageProvider:
    def __init__(self):
        self.calls = []

    async def generate(self, *, model, prompt, ratio, count, references, negative_prompt=None):
        self.calls.append({"model": model, "prompt": prompt, "ratio": ratio, "count": count, "references": references})
        return ["https://cdn.example/generated-image.png"]


class FakeVideoProvider:
    def __init__(self):
        self.requests = []

    async def submit(self, request):
        self.requests.append(request)
        return ProviderSubmission("video-task-1", VideoTaskStatus.PENDING)

    async def retrieve(self, provider_task_id):
        return ProviderTaskSnapshot(
            provider_task_id=provider_task_id,
            status=VideoTaskStatus.SUCCEEDED,
            provider_status="SUCCEEDED",
            video_url="https://cdn.example/generated-video.mp4",
        )


class FakeReferenceAssets:
    def get_reference_url(self, asset_id, *, expires=6 * 60 * 60):
        assert asset_id == "asset-video-1"
        return "https://oss.example/reference-video.mp4"


def _document() -> WorkflowDocument:
    return WorkflowDocument.model_validate({
        "schemaVersion": 1,
        "workflowId": "wf-1",
        "revision": 1,
        "name": "真实节点执行",
        "nodes": [
            {"id": "prompt", "kind": "prompt_input", "position": {"x": 0, "y": 0}, "config": {"text": "一只猫在雨中奔跑"}},
            {"id": "ref-a", "kind": "image_input", "position": {"x": 0, "y": 120}, "config": {"url": "https://cdn.example/ref-a.png"}},
            {"id": "ref-b", "kind": "image_input", "position": {"x": 0, "y": 240}, "config": {"url": "https://cdn.example/ref-b.png"}},
            {"id": "image", "kind": "image_generate", "position": {"x": 320, "y": 80}, "config": {"model": "fake-image", "ratio": "16:9", "count": 1}},
            {"id": "video", "kind": "image_to_video", "position": {"x": 640, "y": 80}, "config": {"model": "wan2.7-i2v", "duration": 5, "resolution": "720P", "ratio": "16:9"}},
        ],
        "edges": [
            {"id": "prompt-image", "sourceNodeId": "prompt", "sourcePortId": "prompt", "targetNodeId": "image", "targetPortId": "prompt"},
            {"id": "ref-a-image", "sourceNodeId": "ref-a", "sourcePortId": "image", "targetNodeId": "image", "targetPortId": "references"},
            {"id": "ref-b-image", "sourceNodeId": "ref-b", "sourcePortId": "image", "targetNodeId": "image", "targetPortId": "references"},
            {"id": "prompt-video", "sourceNodeId": "prompt", "sourcePortId": "prompt", "targetNodeId": "video", "targetPortId": "prompt"},
            {"id": "image-video", "sourceNodeId": "image", "sourcePortId": "image", "targetNodeId": "video", "targetPortId": "first_frame"},
        ],
    })


def test_executor_runs_multireference_image_then_async_video(tmp_path):
    repository = VisualWorkflowRepository(tmp_path / "workflow.sqlite3")
    image_provider = FakeImageProvider()
    video_provider = FakeVideoProvider()
    executor = VisualWorkflowExecutor(repository, {"qianwen": video_provider}, image_provider=image_provider)
    document = _document()
    workflow = repository.create_workflow("真实执行")
    document = document.model_copy(update={"workflow_id": workflow["id"]})
    run = repository.create_run(workflow["id"], revision=1, mode="execute", requested_node_ids=["video"])
    plan = compile_workflow(document, requested_node_ids=["video"], require_inputs=True)

    asyncio.run(executor.execute(workflow["id"], run["id"], document, plan))

    stored_run = repository.get_run(workflow["id"], run["id"])
    node_runs = repository.get_node_runs(workflow["id"], run["id"])
    assert stored_run["status"] == "SUCCEEDED"
    assert image_provider.calls[0]["references"] == ["https://cdn.example/ref-a.png", "https://cdn.example/ref-b.png"]
    assert video_provider.requests[0].first_frame_url == "https://cdn.example/generated-image.png"
    assert all(item["status"] == "SUCCEEDED" for item in node_runs)
    assert repository.list_events(workflow["id"], run["id"])


def test_executor_maps_mixed_media_to_reference_video_request(tmp_path):
    repository = VisualWorkflowRepository(tmp_path / "workflow.sqlite3")
    video_provider = FakeVideoProvider()
    executor = VisualWorkflowExecutor(repository, {"qianwen": video_provider})
    document = WorkflowDocument.model_validate({
        "schemaVersion": 1,
        "workflowId": "wf-2",
        "revision": 1,
        "name": "混合参考",
        "nodes": [
            {"id": "prompt", "kind": "prompt_input", "position": {"x": 0, "y": 0}, "config": {"text": "替换场景"}},
            {"id": "image", "kind": "image_input", "position": {"x": 0, "y": 120}, "config": {"url": "https://cdn.example/ref.png"}},
            {"id": "video", "kind": "video_input", "position": {"x": 0, "y": 240}, "config": {"url": "https://cdn.example/ref.mp4"}},
            {"id": "generate", "kind": "reference_to_video", "position": {"x": 320, "y": 120}, "config": {"model": "wan3.0-video", "duration": 5, "resolution": "720P", "ratio": "16:9"}},
        ],
        "edges": [
            {"id": "p-g", "sourceNodeId": "prompt", "sourcePortId": "prompt", "targetNodeId": "generate", "targetPortId": "prompt"},
            {"id": "i-g", "sourceNodeId": "image", "sourcePortId": "image", "targetNodeId": "generate", "targetPortId": "references"},
            {"id": "v-g", "sourceNodeId": "video", "sourcePortId": "video", "targetNodeId": "generate", "targetPortId": "references"},
        ],
    })
    workflow = repository.create_workflow("混合参考")
    document = document.model_copy(update={"workflow_id": workflow["id"]})
    run = repository.create_run(workflow["id"], revision=1, mode="execute", requested_node_ids=["generate"])
    plan = compile_workflow(document, requested_node_ids=["generate"], require_inputs=True)

    asyncio.run(executor.execute(workflow["id"], run["id"], document, plan))

    request = video_provider.requests[0]
    assert request.mode == "reference_to_video"
    assert [reference.media_kind for reference in request.references] == ["reference_image", "reference_video"]


def test_executor_resolves_uploaded_video_asset_id_to_signed_url(tmp_path):
    repository = VisualWorkflowRepository(tmp_path / "workflow.sqlite3")
    video_provider = FakeVideoProvider()
    executor = VisualWorkflowExecutor(repository, {"qianwen": video_provider}, reference_assets=FakeReferenceAssets())
    document = WorkflowDocument.model_validate({
        "schemaVersion": 1,
        "workflowId": "wf-uploaded-video",
        "revision": 1,
        "name": "上传视频",
        "nodes": [{"id": "video", "kind": "video_input", "position": {"x": 0, "y": 0}, "config": {"referenceAssetId": "asset-video-1"}}],
        "edges": [],
    })
    workflow = repository.create_workflow("上传视频")
    document = document.model_copy(update={"workflow_id": workflow["id"]})
    run = repository.create_run(workflow["id"], revision=1, mode="execute", requested_node_ids=["video"])
    plan = compile_workflow(document, requested_node_ids=["video"], require_inputs=True)

    result = asyncio.run(executor.execute(workflow["id"], run["id"], document, plan))

    assert result["status"] == "SUCCEEDED"
    node_run = repository.get_node_runs(workflow["id"], run["id"])[0]
    assert node_run["output_artifacts"][0]["value"] == "https://oss.example/reference-video.mp4"
