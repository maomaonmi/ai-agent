from __future__ import annotations

import json
import asyncio
import sqlite3

import httpx
import pytest

from video_engine import (
    QwenVideoProvider,
    ZhipuVideoProvider,
    VideoGenerationRequest,
    VideoJobRepository,
    VideoTaskStatus,
    get_video_capabilities,
)


def test_video_capabilities_expose_official_models_and_limits():
    models = {item["id"]: item for item in get_video_capabilities()}

    assert set(models) == {
        "happyhorse-1.1-t2v",
        "happyhorse-1.0-t2v",
        "wan3.0-video",
        "wan2.7-t2v",
        "wan2.7-t2v-2026-06-12",
        "wan2.6-t2v",
        "cogvideox-3",
    }
    assert models["wan3.0-video"]["future_modes"] == [
        "image_to_video",
        "first_last_frame",
        "reference_to_video",
    ]
    assert models["happyhorse-1.1-t2v"]["duration_min"] == 3
    assert models["happyhorse-1.1-t2v"]["duration_max"] == 15
    assert models["wan2.7-t2v-2026-06-12"]["duration_min"] == 2
    assert models["wan2.7-t2v-2026-06-12"]["duration_max"] == 15
    assert models["wan2.7-t2v-2026-06-12"]["provider"] == "qianwen"
    assert models["cogvideox-3"]["durations"] == [5, 10]


def test_video_request_rejects_model_specific_invalid_duration():
    with pytest.raises(ValueError, match="duration"):
        VideoGenerationRequest(
            prompt="一只猫在月光下奔跑",
            model="happyhorse-1.1-t2v",
            ratio="16:9",
            duration=2,
            resolution="720P",
        )


def test_video_request_accepts_wan3_auto_ratio_and_30_seconds():
    request = VideoGenerationRequest(
        prompt="海边日落，镜头缓慢推进",
        model="wan3.0-video",
        ratio="auto",
        duration=30,
        resolution="1080P",
    )

    assert request.duration == 30
    assert request.ratio == "auto"


def test_qwen_provider_submits_official_async_payload_and_reads_task_id():
    captured: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["headers"] = dict(request.headers)
        captured["json"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"request_id": "req-1", "output": {"task_id": "qwen-task-1", "task_status": "PENDING"}},
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = QwenVideoProvider(api_key="test-key", client=client, base_url="https://dashscope.test/api/v1")
    result = asyncio.run(provider.submit(
        VideoGenerationRequest(
            prompt="雨夜东京街头",
            model="wan2.7-t2v",
            ratio="16:9",
            duration=5,
            resolution="720P",
        )
    ))
    asyncio.run(client.aclose())

    assert result.provider_task_id == "qwen-task-1"
    assert captured["method"] == "POST"
    assert captured["headers"]["x-dashscope-async"] == "enable"
    body = captured["json"]
    assert body["model"] == "wan2.7-t2v"
    assert body["input"]["prompt"] == "雨夜东京街头"
    assert body["parameters"]["duration"] == 5
    assert body["parameters"]["resolution"] == "720P"


def test_qwen_provider_maps_success_and_failure_snapshots():
    responses = iter(
        [
            httpx.Response(
                200,
                json={
                    "output": {
                        "task_id": "qwen-task-1",
                        "task_status": "SUCCEEDED",
                        "video_url": "https://cdn.test/video.mp4",
                    }
                },
            ),
            httpx.Response(
                200,
                json={"output": {"task_id": "qwen-task-2", "task_status": "FAILED", "code": "BadPrompt", "message": "bad prompt"}},
            ),
        ]
    )

    async def handler(_: httpx.Request) -> httpx.Response:
        return next(responses)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = QwenVideoProvider(api_key="test-key", client=client, base_url="https://dashscope.test/api/v1")
    async def run():
        return await provider.retrieve("qwen-task-1"), await provider.retrieve("qwen-task-2")

    success, failure = asyncio.run(run())
    asyncio.run(client.aclose())

    assert success.status is VideoTaskStatus.SUCCEEDED
    assert success.video_url == "https://cdn.test/video.mp4"
    assert failure.status is VideoTaskStatus.FAILED
    assert failure.error_code == "BadPrompt"
    assert failure.error_message == "bad prompt"


def test_zhipu_provider_uses_async_result_endpoint_and_reads_video_result():
    captured: dict[str, object] = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured.setdefault("urls", []).append(str(request.url))
        if request.method == "POST":
            captured["body"] = json.loads(request.content)
            return httpx.Response(200, json={"id": "zhipu-task-1", "task_status": "PROCESSING"})
        return httpx.Response(
            200,
            json={
                "id": "zhipu-task-1",
                "task_status": "SUCCESS",
                "video_result": [{"url": "https://cdn.test/cogvideo.mp4", "cover_image_url": "https://cdn.test/cover.jpg"}],
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = ZhipuVideoProvider(api_key="test-key", client=client, base_url="https://open.bigmodel.test/api/paas/v4")
    request = VideoGenerationRequest(
        prompt="电影级 hip-hop 舞蹈",
        model="cogvideox-3",
        ratio="16:9",
        duration=5,
        resolution="720P",
    )

    async def run():
        submission = await provider.submit(request)
        snapshot = await provider.retrieve(submission.provider_task_id)
        return submission, snapshot

    submission, snapshot = asyncio.run(run())
    asyncio.run(client.aclose())

    assert submission.provider_task_id == "zhipu-task-1"
    assert submission.provider_status is VideoTaskStatus.RUNNING
    assert captured["body"]["duration"] == 5
    assert captured["urls"] == [
        "https://open.bigmodel.test/api/paas/v4/videos/generations",
        "https://open.bigmodel.test/api/paas/v4/async-result/zhipu-task-1",
    ]
    assert snapshot.status is VideoTaskStatus.SUCCEEDED
    assert snapshot.video_url == "https://cdn.test/cogvideo.mp4"


def test_zhipu_provider_maps_fail_status_from_async_result():
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"task_status": "FAIL", "error": {"code": "ContentFilter", "message": "内容不合规"}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = ZhipuVideoProvider(api_key="test-key", client=client, base_url="https://open.bigmodel.test/api/paas/v4")
    snapshot = asyncio.run(provider.retrieve("zhipu-task-failed"))
    asyncio.run(client.aclose())

    assert snapshot.status is VideoTaskStatus.FAILED
    assert snapshot.error_code == "ContentFilter"
    assert snapshot.error_message == "内容不合规"


def test_video_job_repository_is_idempotent_and_protects_terminal_state(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    request = VideoGenerationRequest(
        prompt="湖边风吹过芦苇",
        model="wan2.6-t2v",
        ratio="16:9",
        duration=5,
        resolution="720P",
    )

    first = repository.create_task(request, client_request_id="client-1")
    same = repository.create_task(request, client_request_id="client-1")
    assert same["id"] == first["id"]

    repository.update_task(first["id"], status=VideoTaskStatus.SUCCEEDED, progress=100, video_url="/api/video/assets/a")
    repository.update_task(first["id"], status=VideoTaskStatus.RUNNING, progress=50)
    stored = repository.get_task(first["id"])

    assert stored["status"] == VideoTaskStatus.SUCCEEDED.value
    assert stored["progress"] == 100
    assert [event["sequence"] for event in repository.list_events(first["id"])] == [1, 2]

    with sqlite3.connect(tmp_path / "video.sqlite3") as connection:
        assert connection.execute("SELECT COUNT(*) FROM video_generation_tasks").fetchone()[0] == 1


def test_video_job_repository_deletes_terminal_task_and_cascades_assets(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    request = VideoGenerationRequest(
        prompt="云海之上的日出",
        model="wan2.6-t2v",
        ratio="16:9",
        duration=5,
        resolution="720P",
    )
    task = repository.create_task(request)
    asset = repository.create_asset(
        task["id"],
        storage_path=str(tmp_path / "assets" / "video.mp4"),
        mime_type="video/mp4",
        size_bytes=12,
        sha256="hash",
    )
    repository.update_task(task["id"], status=VideoTaskStatus.SUCCEEDED, progress=100, video_url="https://cdn.test/video.mp4")

    deleted = repository.delete_task(task["id"])

    assert deleted is not None
    assert deleted["assets"][0]["id"] == asset["id"]
    assert repository.get_task(task["id"]) is None
    assert repository.get_asset(asset["id"]) is None
    assert repository.list_events(task["id"]) == []


def test_video_job_repository_rejects_delete_for_active_task(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    task = repository.create_task(VideoGenerationRequest(
        prompt="正在生成的镜头",
        model="wan2.6-t2v",
        ratio="16:9",
        duration=5,
        resolution="720P",
    ))

    with pytest.raises(ValueError, match="不能删除"):
        repository.delete_task(task["id"])
    assert repository.get_task(task["id"]) is not None
