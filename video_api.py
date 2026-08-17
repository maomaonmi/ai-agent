"""FastAPI router for the asynchronous video job engine."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from video_engine import TERMINAL_VIDEO_STATUSES, VideoGenerationRequest, VideoJobRepository, VideoTaskStatus, get_video_capabilities
from video_monitor import VideoTaskMonitor


def _task_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "status": row["status"],
        "progress": row["progress"],
        "provider": row["provider"],
        "model": row["model"],
        "prompt": row["prompt"],
        "parameters": {
            "ratio": row["ratio"],
            "duration": row["duration"],
            "resolution": row["resolution"],
        },
        "provider_status": row.get("provider_status"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "submitted_at": row.get("submitted_at"),
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
        "result": {
            "video_url": f"/api/video/assets/{row['local_asset_id']}" if row.get("local_asset_id") else row.get("video_url"),
            "asset_id": row.get("local_asset_id"),
        } if row.get("video_url") or row.get("local_asset_id") else None,
        "error": {
            "code": row.get("error_code"),
            "message": row.get("error_message"),
        } if row.get("error_code") or row.get("error_message") else None,
    }


def _error_response(code: str, message: str, *, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


def _sse_event(event: str, sequence: int, payload: dict[str, Any]) -> str:
    return f"id: {sequence}\nevent: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def create_video_router(repository: VideoJobRepository, monitor: VideoTaskMonitor, *, asset_root: str | None = None) -> APIRouter:
    router = APIRouter(tags=["video"])

    @router.get("/api/video/models")
    async def list_video_models() -> dict[str, Any]:
        return {"models": get_video_capabilities()}

    @router.post("/api/video/create_task", status_code=status.HTTP_202_ACCEPTED, response_model=None)
    async def create_video_task(request: VideoGenerationRequest) -> Any:
        existing = repository.get_by_client_request_id(request.client_request_id)
        if existing:
            return _task_payload(existing)
        task = repository.create_task(request, client_request_id=request.client_request_id)
        submitted = await monitor.submit_task(task["id"], request)
        return _task_payload(submitted)

    @router.get("/api/video/status/{task_id}", response_model=None)
    async def get_video_status(task_id: str) -> Any:
        task = repository.get_task(task_id)
        if task is None:
            return _error_response("TASK_NOT_FOUND", "视频任务不存在", status_code=404)
        return _task_payload(task)

    @router.get("/api/video/tasks")
    async def list_video_tasks(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
        task_status: str | None = Query(default=None, alias="status"),
    ) -> dict[str, Any]:
        rows = repository.list_tasks(status=task_status, page=page, page_size=page_size)
        return {"tasks": [_task_payload(row) for row in rows], "page": page, "pageSize": page_size}

    @router.get("/api/video/assets/{asset_id}")
    async def get_video_asset(asset_id: str) -> Any:
        asset = repository.get_asset(asset_id)
        if asset is None:
            return _error_response("ASSET_NOT_FOUND", "视频资产不存在", status_code=404)
        if not asset_root:
            return _error_response("ASSET_STORAGE_NOT_CONFIGURED", "视频资产存储未配置", status_code=503)
        from pathlib import Path

        root = Path(asset_root).resolve()
        path = Path(asset["storage_path"]).resolve()
        if root not in path.parents or not path.is_file():
            return _error_response("ASSET_NOT_FOUND", "视频资产不存在", status_code=404)
        return FileResponse(path, media_type=asset["mime_type"], filename=f"video-{asset_id}.mp4")

    @router.get("/api/video/stream/{task_id}", response_model=None)
    async def stream_video_task(task_id: str, request: Request) -> Any:
        if repository.get_task(task_id) is None:
            return _error_response("TASK_NOT_FOUND", "视频任务不存在", status_code=404)
        try:
            last_event_id = max(0, int(request.headers.get("last-event-id", "0")))
        except ValueError:
            last_event_id = 0

        async def events():
            last_sequence = last_event_id
            snapshot = repository.get_task(task_id)
            if snapshot is None:
                yield _sse_event("error", last_sequence, {"error": {"code": "TASK_NOT_FOUND", "message": "视频任务不存在"}})
                return
            yield _sse_event("snapshot", 0, _task_payload(snapshot))
            heartbeat_counter = 0
            while True:
                if await request.is_disconnected():
                    return
                rows = repository.list_events(task_id, after_sequence=last_sequence)
                for row in rows:
                    payload = {
                        "task_id": task_id,
                        "status": row["status"],
                        "progress": row["progress"],
                        "message": row["message"],
                        "payload": json.loads(row["payload"] or "{}"),
                    }
                    yield _sse_event(row["event_type"], row["sequence"], payload)
                    last_sequence = row["sequence"]
                latest = repository.get_task(task_id)
                if latest is None:
                    return
                if latest["status"] in {status.value for status in TERMINAL_VIDEO_STATUSES} and not repository.list_events(task_id, after_sequence=last_sequence):
                    return
                heartbeat_counter += 1
                if heartbeat_counter >= 30:
                    heartbeat_counter = 0
                    yield _sse_event("heartbeat", last_sequence, {"task_id": task_id})
                await asyncio.sleep(0.5)

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return router
