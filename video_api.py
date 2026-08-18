"""FastAPI router for the asynchronous video job engine."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from video_engine import TERMINAL_VIDEO_STATUSES, VideoGenerationRequest, VideoJobRepository, VideoTaskStatus, get_video_capabilities
from video_monitor import VideoTaskMonitor
from video_reference import ReferenceAssetError, ReferenceAssetService, ReferenceAssetUploadRequest


def _task_payload(row: dict[str, Any]) -> dict[str, Any]:
    try:
        request_snapshot = json.loads(row.get("request_snapshot") or "{}")
    except (TypeError, ValueError):
        request_snapshot = {}
    return {
        "id": row["id"],
        "status": row["status"],
        "progress": row["progress"],
        "provider": row["provider"],
        "model": row["model"],
        "prompt": row["prompt"],
        "mode": request_snapshot.get("mode", "text_to_video"),
        "parameters": {
            "ratio": row["ratio"],
            "duration": row["duration"],
            "resolution": row["resolution"],
            "audio_url": request_snapshot.get("audio_url"),
            "first_frame_url": request_snapshot.get("first_frame_url"),
            "last_frame_url": request_snapshot.get("last_frame_url"),
            "negative_prompt": request_snapshot.get("negative_prompt"),
            "seed": request_snapshot.get("seed"),
            "prompt_extend": request_snapshot.get("prompt_extend", True),
            "watermark": request_snapshot.get("watermark", False),
            "shot_type": request_snapshot.get("shot_type"),
            "references": request_snapshot.get("references", []),
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


def _reference_asset_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "assetId": row["id"],
        "status": row["status"],
        "progress": row.get("progress", 0),
        "filename": row["original_name"],
        "contentType": row["mime_type"],
        "sizeBytes": row["size_bytes"],
        "durationSeconds": row.get("duration_seconds"),
        "width": row.get("width"),
        "height": row.get("height"),
        "error": {
            "code": row.get("error_code"),
            "message": row.get("error_message"),
        } if row.get("error_code") or row.get("error_message") else None,
        "createdAt": row["created_at"],
        "updatedAt": row.get("updated_at", row["created_at"]),
        "expiresAt": row["expires_at"],
    }


def _sse_event(event: str, sequence: int, payload: dict[str, Any]) -> str:
    return f"id: {sequence}\nevent: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def create_video_router(
    repository: VideoJobRepository,
    monitor: VideoTaskMonitor,
    *,
    asset_root: str | None = None,
    reference_assets: ReferenceAssetService | None = None,
) -> APIRouter:
    router = APIRouter(tags=["video"])

    @router.get("/api/video/models")
    async def list_video_models() -> dict[str, Any]:
        return {"models": get_video_capabilities()}

    @router.post("/api/video/create_task", status_code=status.HTTP_202_ACCEPTED, response_model=None)
    async def create_video_task(request: VideoGenerationRequest) -> Any:
        if request.mode == "reference_to_video":
            if reference_assets is None:
                return _error_response("REFERENCE_STORAGE_NOT_CONFIGURED", "参考视频 OSS 存储未配置", status_code=503)
            try:
                reference_assets.assert_ready([reference.asset_id for reference in request.references])
            except ReferenceAssetError as exc:
                code_status = 404 if exc.code == "REFERENCE_ASSET_NOT_FOUND" else 409 if exc.code in {"ASSET_NOT_READY", "REFERENCE_ASSET_EXPIRED"} else 503
                return _error_response(exc.code, str(exc), status_code=code_status)
        existing = repository.get_by_client_request_id(request.client_request_id)
        if existing:
            return _task_payload(existing)
        task = repository.create_task(request, client_request_id=request.client_request_id)
        submitted = await monitor.submit_task(task["id"], request)
        return _task_payload(submitted)

    @router.post("/api/video/reference-assets", status_code=status.HTTP_201_CREATED, response_model=None)
    @router.post("/api/video/reference-assets/upload-url", status_code=status.HTTP_201_CREATED, response_model=None)
    async def create_reference_asset_upload(request: ReferenceAssetUploadRequest) -> dict[str, Any] | JSONResponse:
        if reference_assets is None:
            return _error_response("REFERENCE_STORAGE_NOT_CONFIGURED", "参考视频 OSS 存储未配置", status_code=503)
        try:
            plan = reference_assets.create_upload(request)
        except ReferenceAssetError as exc:
            status_code = 503 if exc.code in {"OSS_NOT_CONFIGURED", "OSS_SDK_NOT_INSTALLED"} else 422
            return _error_response(exc.code, str(exc), status_code=status_code)
        return {
            "assetId": plan.asset_id,
            "objectKey": plan.object_key,
            "uploadUrl": plan.upload_url,
            "expiresAt": plan.expires_at,
            "headers": plan.headers,
        }

    @router.post("/api/video/reference-assets/{asset_id}/complete", response_model=None)
    async def complete_reference_asset_upload(asset_id: str, background_tasks: BackgroundTasks) -> dict[str, Any] | JSONResponse:
        if reference_assets is None:
            return _error_response("REFERENCE_STORAGE_NOT_CONFIGURED", "参考视频 OSS 存储未配置", status_code=503)
        try:
            asset = reference_assets.complete_upload(asset_id)
            if asset.get("status") == "UPLOADED":
                background_tasks.add_task(reference_assets.process_upload, asset_id)
        except ReferenceAssetError as exc:
            status_code = 404 if exc.code == "REFERENCE_ASSET_NOT_FOUND" else 409 if exc.code.endswith("EXPIRED") or exc.code.endswith("UPLOADABLE") else 422
            return _error_response(exc.code, str(exc), status_code=status_code)
        return _reference_asset_payload(asset)

    @router.get("/api/video/reference-assets/{asset_id}", response_model=None)
    async def get_reference_asset(asset_id: str) -> dict[str, Any] | JSONResponse:
        if reference_assets is None:
            return _error_response("REFERENCE_STORAGE_NOT_CONFIGURED", "参考视频 OSS 存储未配置", status_code=503)
        asset = repository.get_reference_asset(asset_id)
        if asset is None:
            return _error_response("REFERENCE_ASSET_NOT_FOUND", "参考视频资产不存在", status_code=404)
        return _reference_asset_payload(asset)

    @router.delete("/api/video/reference-assets/{asset_id}", response_model=None)
    async def delete_reference_asset(asset_id: str) -> dict[str, Any] | JSONResponse:
        if reference_assets is None:
            return _error_response("REFERENCE_STORAGE_NOT_CONFIGURED", "参考视频 OSS 存储未配置", status_code=503)
        try:
            deleted = reference_assets.delete_asset(asset_id)
        except ReferenceAssetError as exc:
            return _error_response(exc.code, str(exc), status_code=502)
        if deleted is None:
            return _error_response("REFERENCE_ASSET_NOT_FOUND", "参考视频资产不存在", status_code=404)
        return {"deleted": True, "assetId": asset_id}

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

    @router.delete("/api/video/tasks/{task_id}")
    async def delete_video_task(task_id: str) -> Any:
        try:
            deleted = repository.delete_task(task_id)
        except ValueError as exc:
            return _error_response("TASK_NOT_TERMINAL", str(exc), status_code=409)
        if deleted is None:
            return _error_response("TASK_NOT_FOUND", "视频任务不存在", status_code=404)

        # Only remove files below the configured asset root.  The database row
        # is already gone, while an unlink failure merely leaves a recoverable
        # orphan for later storage cleanup.
        if asset_root:
            from pathlib import Path

            root = Path(asset_root).resolve()
            for asset in deleted["assets"]:
                path = Path(asset["storage_path"]).resolve()
                if root in path.parents and path.is_file():
                    try:
                        path.unlink()
                    except OSError:
                        pass
        return {"deleted": True, "task_id": task_id}

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
