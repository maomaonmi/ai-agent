from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.testclient import TestClient

from video_engine import ProviderSubmission, ProviderTaskSnapshot, VideoTaskStatus, VideoJobRepository
from video_api import create_video_router
from video_monitor import VideoTaskMonitor


class FakeProvider:
    async def submit(self, request):
        return ProviderSubmission("remote-api-1", VideoTaskStatus.PENDING, "request-api-1")

    async def retrieve(self, provider_task_id):
        return ProviderTaskSnapshot(provider_task_id, VideoTaskStatus.SUCCEEDED, "SUCCEEDED", video_url="https://cdn.test/video.mp4")


def _app(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    provider = FakeProvider()
    monitor = VideoTaskMonitor(repository, {"qianwen": provider})
    app = FastAPI()
    app.include_router(create_video_router(repository, monitor))
    return app, repository, monitor


def test_video_api_lists_models_and_creates_async_task(tmp_path):
    app, repository, _ = _app(tmp_path)
    with TestClient(app) as client:
        models = client.get("/api/video/models")
        created = client.post(
            "/api/video/create_task",
            json={
                "prompt": "雨夜东京街头",
                "model": "wan2.6-t2v",
                "ratio": "16:9",
                "duration": 5,
                "resolution": "720P",
                "client_request_id": "client-api-1",
            },
        )

    assert models.status_code == 200
    assert any(item["id"] == "wan3.0-video" for item in models.json()["models"])
    assert created.status_code == 202
    assert created.json()["status"] == "PENDING"
    assert repository.list_tasks()[0]["provider_task_id"] == "remote-api-1"


def test_video_api_is_idempotent_for_client_request_id(tmp_path):
    app, repository, _ = _app(tmp_path)
    payload = {
        "prompt": "一列火车驶过雪山",
        "model": "wan2.6-t2v",
        "ratio": "16:9",
        "duration": 5,
        "resolution": "720P",
        "client_request_id": "client-api-2",
    }
    with TestClient(app) as client:
        first = client.post("/api/video/create_task", json=payload)
        second = client.post("/api/video/create_task", json=payload)

    assert first.status_code == second.status_code == 202
    assert first.json()["id"] == second.json()["id"]
    assert len(repository.list_tasks()) == 1


def test_video_api_status_and_reconnectable_sse(tmp_path):
    app, repository, monitor = _app(tmp_path)
    payload = {
        "prompt": "海边日落",
        "model": "wan2.6-t2v",
        "ratio": "16:9",
        "duration": 5,
        "resolution": "720P",
    }
    with TestClient(app) as client:
        created = client.post("/api/video/create_task", json=payload)
        task_id = created.json()["id"]
        status = client.get(f"/api/video/status/{task_id}")
        assert status.status_code == 200

        asyncio.run(monitor.poll_once(task_id))
        with client.stream("GET", f"/api/video/stream/{task_id}") as response:
            body = response.read().decode("utf-8")

    assert status.json()["status"] == "PENDING"
    assert "event: snapshot" in body
    assert "event: result" in body
    assert "https://cdn.test/video.mp4" in body
