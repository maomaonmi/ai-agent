"""Background orchestration for provider-backed video jobs."""

from __future__ import annotations

import asyncio
import time
from typing import Mapping

from video_engine import (
    TERMINAL_VIDEO_STATUSES,
    VideoGenerationRequest,
    VideoJobRepository,
    VideoProvider,
    VideoProviderError,
    VideoTaskStatus,
    video_capability,
)


class VideoTaskMonitor:
    """One in-process scheduler shared by all API clients and SSE streams.

    The repository remains the source of truth.  The in-memory set only avoids
    creating duplicate local poll work; it can always be rebuilt from SQLite.
    """

    def __init__(
        self,
        repository: VideoJobRepository,
        providers: Mapping[str, VideoProvider],
        *,
        asset_store: object | None = None,
        reference_assets: object | None = None,
        poll_interval_seconds: float = 15.0,
        max_concurrency: int = 4,
        max_task_age_seconds: float = 15 * 60,
    ):
        self.repository = repository
        self.providers = dict(providers)
        self.asset_store = asset_store
        self.reference_assets = reference_assets
        self.poll_interval_seconds = max(1.0, poll_interval_seconds)
        self.max_task_age_seconds = max(60.0, max_task_age_seconds)
        self._semaphore = asyncio.Semaphore(max(1, max_concurrency))
        self.active_task_ids: set[str] = set()
        self.submitting_task_ids: set[str] = set()
        self._runner: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        await self.recover()
        if self._runner is None or self._runner.done():
            self._stop_event.clear()
            self._runner = asyncio.create_task(self._run(), name="video-task-monitor")

    async def stop(self) -> None:
        self._stop_event.set()
        if self._runner is not None:
            await self._runner
            self._runner = None

    async def recover(self) -> None:
        self.active_task_ids = {task["id"] for task in self.repository.list_active_tasks()}

    async def submit_task(self, task_id: str, request: VideoGenerationRequest) -> dict:
        capability = video_capability(request.model)
        provider = self.providers.get(capability["provider"])
        if provider is None:
            return self.repository.update_task(
                task_id,
                status=VideoTaskStatus.FAILED,
                error_code="PROVIDER_NOT_CONFIGURED",
                error_message=f"未配置{capability['provider']}视频服务",
            ) or {}
        self.submitting_task_ids.add(task_id)
        try:
            provider_request = request
            if request.mode == "reference_to_video":
                if self.reference_assets is None:
                    return self.repository.update_task(
                        task_id,
                        status=VideoTaskStatus.FAILED,
                        error_code="REFERENCE_STORAGE_NOT_CONFIGURED",
                        error_message="参考视频存储未配置",
                    ) or {}
                try:
                    provider_request = request.model_copy(update={
                        "references": [
                            reference.model_copy(update={"url": self.reference_assets.get_reference_url(reference.asset_id)})  # type: ignore[attr-defined]
                            for reference in request.references
                        ],
                    })
                except Exception as exc:
                    code = getattr(exc, "code", "ASSET_NOT_READY")
                    return self.repository.update_task(
                        task_id,
                        status=VideoTaskStatus.FAILED,
                        error_code=code,
                        error_message=str(exc),
                    ) or {}
            try:
                submission = await provider.submit(provider_request)
            except VideoProviderError as exc:
                return self.repository.update_task(
                    task_id,
                    status=VideoTaskStatus.FAILED,
                    error_code=exc.code,
                    error_message=str(exc),
                ) or {}
            except Exception:  # provider boundary: never crash the scheduler
                return self.repository.update_task(
                    task_id,
                    status=VideoTaskStatus.FAILED,
                    error_code="PROVIDER_REQUEST_FAILED",
                    error_message="视频供应商请求失败，请稍后重试",
                ) or {}

            self.active_task_ids.add(task_id)
            return self.repository.update_task(
                task_id,
                status=submission.provider_status if submission.provider_status not in TERMINAL_VIDEO_STATUSES else VideoTaskStatus.PENDING,
                progress=5,
                provider_task_id=submission.provider_task_id,
                provider_status=submission.provider_status.value,
                next_poll_at=time.time(),
            ) or {}
        finally:
            self.submitting_task_ids.discard(task_id)

    async def poll_once(self, task_id: str) -> dict | None:
        task = self.repository.get_task(task_id)
        if task is None:
            self.active_task_ids.discard(task_id)
            return None
        if task["status"] in {status.value for status in TERMINAL_VIDEO_STATUSES}:
            self.active_task_ids.discard(task_id)
            return task
        if task_id in self.submitting_task_ids:
            return task
        if time.time() - float(task.get("created_at") or time.time()) > self.max_task_age_seconds:
            updated = self.repository.update_task(
                task_id,
                status=VideoTaskStatus.FAILED,
                error_code="PROVIDER_TIMEOUT",
                error_message="视频任务超过最大等待时间",
            )
            self.active_task_ids.discard(task_id)
            return updated
        provider_task_id = task.get("provider_task_id")
        if not provider_task_id:
            updated = self.repository.update_task(
                task_id,
                status=VideoTaskStatus.FAILED,
                error_code="SUBMISSION_INCOMPLETE",
                error_message="视频任务缺少供应商 task_id",
            )
            self.active_task_ids.discard(task_id)
            return updated
        provider = self.providers.get(task["provider"])
        if provider is None:
            updated = self.repository.update_task(
                task_id,
                status=VideoTaskStatus.FAILED,
                error_code="PROVIDER_NOT_CONFIGURED",
                error_message="视频供应商未配置",
            )
            self.active_task_ids.discard(task_id)
            return updated

        async with self._semaphore:
            try:
                snapshot = await provider.retrieve(provider_task_id)
            except VideoProviderError as exc:
                # A transient provider error should not destroy the job. The
                # next scheduler pass retries it with the same task ID.
                return self.repository.update_task(
                    task_id,
                    provider_status=exc.code,
                    error_code=exc.code,
                    error_message=str(exc),
                    next_poll_at=time.time() + min(self.poll_interval_seconds * 2, 120),
                    last_polled_at=time.time(),
                )
            except Exception:
                return self.repository.update_task(
                    task_id,
                    provider_status="REQUEST_ERROR",
                    error_code="PROVIDER_REQUEST_FAILED",
                    error_message="视频状态查询失败，将自动重试",
                    next_poll_at=time.time() + min(self.poll_interval_seconds * 2, 120),
                    last_polled_at=time.time(),
                )

        current_progress = int(task.get("progress") or 0)
        if snapshot.status is VideoTaskStatus.PENDING:
            progress = max(current_progress, 10)
        elif snapshot.status is VideoTaskStatus.RUNNING:
            progress = max(current_progress, min(90, current_progress + 10))
        elif snapshot.status is VideoTaskStatus.SUCCEEDED:
            progress = 100
        else:
            progress = current_progress
        effective_status = VideoTaskStatus.FAILED if snapshot.status is VideoTaskStatus.UNKNOWN else snapshot.status
        terminal = effective_status in TERMINAL_VIDEO_STATUSES
        local_asset_id: str | None = None
        if snapshot.status is VideoTaskStatus.SUCCEEDED and snapshot.video_url and self.asset_store is not None:
            try:
                asset = await self.asset_store.download(task_id, snapshot.video_url)  # type: ignore[attr-defined]
                local_asset_id = asset["id"]
            except Exception:
                updated = self.repository.update_task(
                    task_id,
                    status=VideoTaskStatus.FAILED,
                    error_code="ASSET_DOWNLOAD_FAILED",
                    error_message="视频已生成，但转存到本地失败，请重试",
                )
                self.active_task_ids.discard(task_id)
                return updated

        updated = self.repository.update_task(
            task_id,
            status=effective_status,
            progress=progress,
            provider_status=snapshot.provider_status,
            video_url=snapshot.video_url,
            local_asset_id=local_asset_id,
            error_code=snapshot.error_code or ("PROVIDER_TASK_UNKNOWN" if snapshot.status is VideoTaskStatus.UNKNOWN else ""),
            error_message=snapshot.error_message or ("供应商任务不存在或已过期" if snapshot.status is VideoTaskStatus.UNKNOWN else ""),
            next_poll_at=None if terminal else time.time() + self.poll_interval_seconds,
            last_polled_at=time.time(),
        )
        if terminal:
            self.active_task_ids.discard(task_id)
        return updated

    async def _run(self) -> None:
        while not self._stop_event.is_set():
            now = time.time()
            if not self.active_task_ids:
                await self.recover()
            due = []
            for task_id in tuple(self.active_task_ids):
                task = self.repository.get_task(task_id)
                if task is None:
                    self.active_task_ids.discard(task_id)
                elif task["status"] in {status.value for status in TERMINAL_VIDEO_STATUSES}:
                    self.active_task_ids.discard(task_id)
                elif task_id in self.submitting_task_ids:
                    continue
                elif float(task.get("next_poll_at") or 0) <= now:
                    due.append(task_id)
            if due:
                await asyncio.gather(*(self.poll_once(task_id) for task_id in due), return_exceptions=True)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
