from __future__ import annotations

import asyncio

from video_engine import (
    ProviderSubmission,
    ProviderTaskSnapshot,
    VideoGenerationRequest,
    VideoJobRepository,
    VideoTaskStatus,
)
from video_monitor import VideoTaskMonitor


class FakeProvider:
    def __init__(self, snapshots: list[ProviderTaskSnapshot]):
        self.snapshots = iter(snapshots)
        self.submitted: list[str] = []

    async def submit(self, request: VideoGenerationRequest) -> ProviderSubmission:
        self.submitted.append(request.model)
        return ProviderSubmission("remote-1", VideoTaskStatus.PENDING, "request-1")

    async def retrieve(self, provider_task_id: str) -> ProviderTaskSnapshot:
        return next(self.snapshots)


def _request() -> VideoGenerationRequest:
    return VideoGenerationRequest(
        prompt="一只猫在月光下奔跑",
        model="wan2.6-t2v",
        ratio="16:9",
        duration=5,
        resolution="720P",
    )


def test_monitor_submits_task_without_waiting_for_generation(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    task = repository.create_task(_request(), client_request_id="client-1")
    provider = FakeProvider([])
    monitor = VideoTaskMonitor(repository, {"qianwen": provider}, poll_interval_seconds=15)

    asyncio.run(monitor.submit_task(task["id"], _request()))
    stored = repository.get_task(task["id"])

    assert provider.submitted == ["wan2.6-t2v"]
    assert stored["provider_task_id"] == "remote-1"
    assert stored["status"] == "PENDING"
    assert stored["provider_status"] == "PENDING"


def test_monitor_polls_and_reaches_success(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    task = repository.create_task(_request())
    provider = FakeProvider(
        [
            ProviderTaskSnapshot("remote-1", VideoTaskStatus.RUNNING, "RUNNING"),
            ProviderTaskSnapshot("remote-1", VideoTaskStatus.SUCCEEDED, "SUCCEEDED", video_url="https://cdn.test/video.mp4"),
        ]
    )
    monitor = VideoTaskMonitor(repository, {"qianwen": provider}, poll_interval_seconds=15)
    asyncio.run(monitor.submit_task(task["id"], _request()))

    asyncio.run(monitor.poll_once(task["id"]))
    running = repository.get_task(task["id"])
    assert running["status"] == "RUNNING"
    assert running["progress"] >= 10

    asyncio.run(monitor.poll_once(task["id"]))
    success = repository.get_task(task["id"])
    assert success["status"] == "SUCCEEDED"
    assert success["progress"] == 100
    assert success["video_url"] == "https://cdn.test/video.mp4"


def test_monitor_recovers_active_tasks_after_restart(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    task = repository.create_task(_request())
    provider = FakeProvider([ProviderTaskSnapshot("remote-1", VideoTaskStatus.RUNNING, "RUNNING")])
    first = VideoTaskMonitor(repository, {"qianwen": provider}, poll_interval_seconds=15)
    asyncio.run(first.submit_task(task["id"], _request()))

    restarted = VideoTaskMonitor(repository, {"qianwen": provider}, poll_interval_seconds=15)
    asyncio.run(restarted.recover())

    assert task["id"] in restarted.active_task_ids


def test_monitor_marks_orphaned_pending_task_as_failed(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    task = repository.create_task(_request())
    monitor = VideoTaskMonitor(repository, {"qianwen": FakeProvider([])})

    asyncio.run(monitor.poll_once(task["id"]))
    failed = repository.get_task(task["id"])

    assert failed["status"] == "FAILED"
    assert failed["error_code"] == "SUBMISSION_INCOMPLETE"
