"""Core contracts and persistence primitives for the asynchronous video engine.

The module intentionally has no FastAPI or application-global imports.  That keeps
the provider and repository contracts cheap to test and prevents importing the
large chat application just to validate a video request.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from copy import deepcopy
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Protocol

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class VideoTaskStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    UNKNOWN = "UNKNOWN"


TERMINAL_VIDEO_STATUSES = {
    VideoTaskStatus.SUCCEEDED,
    VideoTaskStatus.FAILED,
    VideoTaskStatus.CANCELLED,
}


# Source of truth for the UI and validation.  Values reflect the official
# model pages supplied for this feature; future input modes are deliberately
# advertised but not accepted by the V1 request schema.
_VIDEO_CAPABILITIES: tuple[dict[str, Any], ...] = (
    {
        "id": "happyhorse-1.1-t2v",
        "name": "HappyHorse 1.1",
        "provider": "qianwen",
        "description": "高动态画面与灵敏运镜响应",
        "modes": ["text_to_video"],
        "future_modes": [],
        "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
        "resolutions": ["720P", "1080P"],
        "duration_min": 3,
        "duration_max": 15,
        "durations": [],
        "supports_audio": True,
        "enabled": True,
        "docs_url": "https://platform.qianwenai.com/docs/api-reference/video-generation/happyhorse-text-to-video/create-task",
    },
    {
        "id": "happyhorse-1.0-t2v",
        "name": "HappyHorse 1.0",
        "provider": "qianwen",
        "description": "轻量低成本文生视频",
        "modes": ["text_to_video"],
        "future_modes": [],
        "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
        "resolutions": ["720P", "1080P"],
        "duration_min": 3,
        "duration_max": 15,
        "durations": [],
        "supports_audio": True,
        "enabled": True,
        "docs_url": "https://platform.qianwenai.com/docs/api-reference/video-generation/happyhorse-text-to-video/create-task",
    },
    {
        "id": "wan3.0-video",
        "name": "Wan 3.0 Video",
        "provider": "qianwen",
        "description": "文生、图生、首尾帧与全能参考视频",
        "modes": ["text_to_video"],
        "future_modes": ["image_to_video", "first_last_frame", "reference_to_video"],
        "ratios": ["auto", "16:9", "9:16", "1:1", "4:3", "3:4"],
        "resolutions": ["480P", "720P", "1080P"],
        "duration_min": 2,
        "duration_max": 30,
        "durations": [],
        "supports_audio": True,
        "enabled": True,
        "docs_url": "https://platform.qianwenai.com/docs/developer-guides/getting-started/video-models",
    },
    {
        "id": "wan2.7-t2v",
        "name": "Wan 2.7",
        "provider": "qianwen",
        "description": "高画质写实风景与多镜头叙事",
        "modes": ["text_to_video"],
        "future_modes": [],
        "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
        "resolutions": ["720P", "1080P"],
        "duration_min": 2,
        "duration_max": 15,
        "durations": [],
        "supports_audio": True,
        "enabled": True,
        "docs_url": "https://platform.qianwenai.com/docs/api-reference/video-generation/wan27-text-to-video/create-task",
    },
    {
        "id": "wan2.7-t2v-2026-06-12",
        "name": "Wan 2.7 T2V 快照",
        "provider": "qianwen",
        "description": "2026-06-12 快照版文生视频",
        "modes": ["text_to_video"],
        "future_modes": [],
        "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
        "resolutions": ["720P", "1080P"],
        "duration_min": 2,
        "duration_max": 15,
        "durations": [],
        "supports_audio": True,
        "enabled": True,
        "docs_url": "https://platform.qianwenai.com/docs/api-reference/video-generation/wan27-text-to-video/create-task",
    },
    {
        "id": "wan2.6-t2v",
        "name": "Wan 2.6",
        "provider": "qianwen",
        "description": "经典高性价比文生视频",
        "modes": ["text_to_video"],
        "future_modes": [],
        "ratios": ["16:9", "9:16", "1:1", "4:3", "3:4"],
        "resolutions": ["720P", "1080P"],
        "duration_min": 2,
        "duration_max": 15,
        "durations": [],
        "supports_audio": True,
        "enabled": True,
        "docs_url": "https://platform.qianwenai.com/docs/developer-guides/video-generation/text-to-video",
    },
    {
        "id": "cogvideox-3",
        "name": "CogVideoX-3",
        "provider": "zhipu",
        "description": "高流畅度、多镜头与中文语义",
        "modes": ["text_to_video"],
        "future_modes": ["image_to_video", "first_last_frame"],
        "ratios": ["16:9", "9:16", "1:1"],
        "resolutions": ["720P", "1080P", "2K", "4K"],
        "duration_min": 5,
        "duration_max": 10,
        "durations": [5, 10],
        "supports_audio": True,
        "enabled": True,
        "docs_url": "https://docs.bigmodel.cn/cn/guide/models/video-generation/cogvideox-3",
    },
)


def get_video_capabilities() -> list[dict[str, Any]]:
    """Return defensive copies so callers cannot mutate the registry."""

    return [deepcopy(item) for item in _VIDEO_CAPABILITIES]


def video_capability(model_id: str) -> dict[str, Any]:
    for capability in _VIDEO_CAPABILITIES:
        if capability["id"] == model_id:
            return deepcopy(capability)
    raise ValueError(f"不支持的视频模型：{model_id}")


class VideoGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=5000)
    model: str
    ratio: str = "16:9"
    duration: int = Field(default=5, ge=2, le=30)
    resolution: str = "720P"
    prompt_extend: bool = True
    watermark: bool = False
    audio: bool | None = None
    quality: str = "quality"
    fps: int = Field(default=30, ge=1, le=60)
    client_request_id: str | None = Field(default=None, max_length=128)

    @field_validator("prompt")
    @classmethod
    def trim_prompt(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("prompt 不能为空")
        return normalized

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        video_capability(value)
        return value

    @field_validator("resolution")
    @classmethod
    def normalize_resolution(cls, value: str) -> str:
        normalized = value.strip().upper()
        if normalized not in {"480P", "720P", "1080P", "2K", "4K"}:
            raise ValueError("resolution 必须是 480P、720P、1080P、2K 或 4K")
        return normalized

    @model_validator(mode="after")
    def validate_model_limits(self) -> "VideoGenerationRequest":
        capability = video_capability(self.model)
        if self.ratio not in capability["ratios"]:
            raise ValueError(f"{self.model} 不支持画幅 {self.ratio}")
        if self.model == "cogvideox-3" and len(self.prompt) > 512:
            raise ValueError("CogVideoX-3 的 prompt 不能超过 512 个字符")
        if self.resolution not in capability["resolutions"]:
            raise ValueError(f"{self.model} 不支持分辨率 {self.resolution}")
        if self.duration < capability["duration_min"] or self.duration > capability["duration_max"]:
            raise ValueError(
                f"{self.model} 的 duration 必须在 {capability['duration_min']}–{capability['duration_max']} 秒之间"
            )
        if capability["durations"] and self.duration not in capability["durations"]:
            raise ValueError(f"{self.model} 的 duration 只能是 {capability['durations']}")
        if self.audio is not None and not capability["supports_audio"]:
            raise ValueError(f"{self.model} 不支持音频")
        if self.model == "cogvideox-3" and self.quality not in {"quality", "speed"}:
            raise ValueError("CogVideoX-3 的 quality 必须是 quality 或 speed")
        return self


@dataclass(frozen=True)
class ProviderSubmission:
    provider_task_id: str
    provider_status: VideoTaskStatus
    request_id: str | None = None


@dataclass(frozen=True)
class ProviderTaskSnapshot:
    provider_task_id: str
    status: VideoTaskStatus
    provider_status: str
    video_url: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    raw: dict[str, Any] | None = None


class VideoProviderError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class VideoProvider(Protocol):
    async def submit(self, request: VideoGenerationRequest) -> ProviderSubmission: ...

    async def retrieve(self, provider_task_id: str) -> ProviderTaskSnapshot: ...


def _map_provider_status(value: Any) -> VideoTaskStatus:
    normalized = str(value or "UNKNOWN").upper()
    if normalized == "PENDING":
        return VideoTaskStatus.PENDING
    if normalized in {"RUNNING", "PROCESSING"}:
        return VideoTaskStatus.RUNNING
    if normalized in {"SUCCEEDED", "SUCCESS", "COMPLETED"}:
        return VideoTaskStatus.SUCCEEDED
    if normalized in {"FAILED", "ERROR"}:
        return VideoTaskStatus.FAILED
    if normalized in {"CANCELED", "CANCELLED"}:
        return VideoTaskStatus.CANCELLED
    return VideoTaskStatus.UNKNOWN


def _error_from_response(response: httpx.Response, payload: Any) -> VideoProviderError:
    if isinstance(payload, dict):
        code = str(payload.get("code") or payload.get("error_code") or "PROVIDER_REQUEST_FAILED")
        message = str(payload.get("message") or payload.get("error") or "视频供应商请求失败")
    else:
        code, message = "PROVIDER_RESPONSE_INVALID", "视频供应商返回了无效响应"
    if response.status_code == 401 or response.status_code == 403:
        code = "PROVIDER_AUTH_ERROR"
    elif response.status_code == 429:
        code = "PROVIDER_RATE_LIMITED"
    elif response.status_code >= 500:
        code = "PROVIDER_UNAVAILABLE"
    return VideoProviderError(code, message, status_code=response.status_code)


class QwenVideoProvider:
    def __init__(self, api_key: str, *, client: httpx.AsyncClient | None = None, base_url: str = "https://dashscope.aliyuncs.com/api/v1"):
        self.api_key = api_key
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
        self.base_url = base_url.rstrip("/")

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    async def submit(self, request: VideoGenerationRequest) -> ProviderSubmission:
        parameters: dict[str, Any] = {
            "resolution": request.resolution,
            "duration": request.duration,
            "prompt_extend": request.prompt_extend,
            "watermark": request.watermark,
        }
        if request.ratio != "auto":
            parameters["ratio"] = request.ratio
        if request.audio is not None:
            parameters["audio"] = request.audio
        response = await self.client.post(
            f"{self.base_url}/services/aigc/video-generation/video-synthesis",
            headers={**self._headers(), "X-DashScope-Async": "enable"},
            json={"model": request.model, "input": {"prompt": request.prompt}, "parameters": parameters},
        )
        payload = _json_or_none(response)
        if response.is_error:
            raise _error_from_response(response, payload)
        try:
            output = payload["output"]
            task_id = str(output["task_id"])
        except (TypeError, KeyError, ValueError) as exc:
            raise VideoProviderError("PROVIDER_RESPONSE_INVALID", "千问创建响应缺少 task_id") from exc
        return ProviderSubmission(task_id, _map_provider_status(output.get("task_status")), payload.get("request_id"))

    async def retrieve(self, provider_task_id: str) -> ProviderTaskSnapshot:
        response = await self.client.get(f"{self.base_url}/tasks/{provider_task_id}", headers=self._headers())
        payload = _json_or_none(response)
        if response.is_error:
            raise _error_from_response(response, payload)
        try:
            output = payload["output"]
            raw_status = str(output.get("task_status") or "UNKNOWN")
            status = _map_provider_status(raw_status)
        except (TypeError, KeyError) as exc:
            raise VideoProviderError("PROVIDER_RESPONSE_INVALID", "千问查询响应缺少 output") from exc
        return ProviderTaskSnapshot(
            provider_task_id=provider_task_id,
            status=status,
            provider_status=raw_status,
            video_url=output.get("video_url"),
            error_code=output.get("code"),
            error_message=output.get("message"),
            raw=payload,
        )


class ZhipuVideoProvider:
    def __init__(self, api_key: str, *, client: httpx.AsyncClient | None = None, base_url: str = "https://open.bigmodel.cn/api/paas/v4"):
        self.api_key = api_key
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
        self.base_url = base_url.rstrip("/")

    @staticmethod
    def _size(request: VideoGenerationRequest) -> str:
        base = {"720P": 720, "1080P": 1080, "2K": 2048, "4K": 3840}[request.resolution]
        if request.ratio == "16:9":
            return f"{round(base * 16 / 9)}x{base}"
        if request.ratio == "9:16":
            return f"{base}x{round(base * 16 / 9)}"
        if request.ratio == "1:1":
            return f"{base}x{base}"
        raise ValueError("CogVideoX-3 的 ratio/resolution 组合无法映射为官方 size")

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    async def submit(self, request: VideoGenerationRequest) -> ProviderSubmission:
        body = {
            "model": request.model,
            "prompt": request.prompt,
            "quality": request.quality,
            "with_audio": request.audio if request.audio is not None else True,
            "size": self._size(request),
            "fps": request.fps,
        }
        response = await self.client.post(f"{self.base_url}/videos/generations", headers=self._headers(), json=body)
        payload = _json_or_none(response)
        if response.is_error:
            raise _error_from_response(response, payload)
        try:
            task_id = str(payload["id"])
        except (TypeError, KeyError, ValueError) as exc:
            raise VideoProviderError("PROVIDER_RESPONSE_INVALID", "智谱创建响应缺少 id") from exc
        return ProviderSubmission(task_id, _map_provider_status(payload.get("task_status")), payload.get("request_id"))

    async def retrieve(self, provider_task_id: str) -> ProviderTaskSnapshot:
        response = await self.client.get(f"{self.base_url}/videos/{provider_task_id}", headers=self._headers())
        payload = _json_or_none(response)
        if response.is_error:
            raise _error_from_response(response, payload)
        raw_status = str(payload.get("task_status") or payload.get("status") or "UNKNOWN") if isinstance(payload, dict) else "UNKNOWN"
        output = payload.get("video_result") or payload.get("video") or payload.get("output") or {} if isinstance(payload, dict) else {}
        if not isinstance(output, dict):
            output = {}
        return ProviderTaskSnapshot(
            provider_task_id=provider_task_id,
            status=_map_provider_status(raw_status),
            provider_status=raw_status,
            video_url=output.get("video_url") or output.get("url") or (payload.get("video_url") if isinstance(payload, dict) else None),
            error_code=payload.get("error_code") if isinstance(payload, dict) else None,
            error_message=payload.get("message") if isinstance(payload, dict) else None,
            raw=payload if isinstance(payload, dict) else None,
        )


def _json_or_none(response: httpx.Response) -> Any:
    try:
        return response.json()
    except (ValueError, json.JSONDecodeError):
        return None


class VideoJobRepository:
    """SQLite repository for local tasks and replayable SSE events."""

    def __init__(self, database_path: str | Path):
        self.database_path = str(database_path)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        Path(self.database_path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS video_generation_tasks (
                    id TEXT PRIMARY KEY,
                    provider_task_id TEXT UNIQUE,
                    client_request_id TEXT UNIQUE,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    ratio TEXT NOT NULL,
                    duration INTEGER NOT NULL,
                    resolution TEXT NOT NULL,
                    request_snapshot TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    provider_status TEXT,
                    video_url TEXT,
                    local_asset_id TEXT,
                    error_code TEXT,
                    error_message TEXT,
                    created_at REAL NOT NULL,
                    submitted_at REAL,
                    started_at REAL,
                    completed_at REAL,
                    updated_at REAL NOT NULL,
                    last_polled_at REAL,
                    next_poll_at REAL
                );
                CREATE TABLE IF NOT EXISTS video_generation_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id TEXT NOT NULL REFERENCES video_generation_tasks(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL,
                    message TEXT,
                    payload TEXT,
                    created_at REAL NOT NULL,
                    UNIQUE(task_id, sequence)
                );
                CREATE TABLE IF NOT EXISTS video_generation_assets (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL REFERENCES video_generation_tasks(id) ON DELETE CASCADE,
                    storage_path TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_video_tasks_status_poll
                    ON video_generation_tasks(status, next_poll_at);
                CREATE INDEX IF NOT EXISTS idx_video_events_task_sequence
                    ON video_generation_events(task_id, sequence);
                """
            )

    def create_task(self, request: VideoGenerationRequest, *, client_request_id: str | None = None) -> dict[str, Any]:
        now = time.time()
        task_id = str(uuid.uuid4())
        capability = video_capability(request.model)
        snapshot = request.model_dump(mode="json")
        snapshot.pop("client_request_id", None)
        with self._connect() as connection:
            if client_request_id:
                existing = connection.execute(
                    "SELECT * FROM video_generation_tasks WHERE client_request_id = ?",
                    (client_request_id,),
                ).fetchone()
                if existing:
                    return dict(existing)
            connection.execute(
                """INSERT INTO video_generation_tasks
                (id, client_request_id, provider, model, prompt, ratio, duration, resolution,
                 request_snapshot, status, progress, created_at, updated_at, next_poll_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    task_id,
                    client_request_id,
                    capability["provider"],
                    request.model,
                    request.prompt,
                    request.ratio,
                    request.duration,
                    request.resolution,
                    json.dumps(snapshot, ensure_ascii=False),
                    VideoTaskStatus.PENDING.value,
                    0,
                    now,
                    now,
                    now,
                ),
            )
            self._append_event(connection, task_id, "snapshot", VideoTaskStatus.PENDING, 0, "任务已创建", {})
            row = connection.execute("SELECT * FROM video_generation_tasks WHERE id = ?", (task_id,)).fetchone()
            return dict(row)

    def get_task(self, task_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM video_generation_tasks WHERE id = ?", (task_id,)).fetchone()
            return dict(row) if row else None

    def get_by_client_request_id(self, client_request_id: str | None) -> dict[str, Any] | None:
        if not client_request_id:
            return None
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM video_generation_tasks WHERE client_request_id = ?",
                (client_request_id,),
            ).fetchone()
            return dict(row) if row else None

    def delete_task(self, task_id: str) -> dict[str, Any] | None:
        """Delete a terminal task and its replayable events/assets.

        Active provider jobs are intentionally protected: removing their local
        record would make the background monitor unable to reconcile them.
        SQLite foreign keys cascade the event and asset metadata rows.
        """

        with self._connect() as connection:
            row = connection.execute("SELECT * FROM video_generation_tasks WHERE id = ?", (task_id,)).fetchone()
            if row is None:
                return None
            status = VideoTaskStatus(row["status"])
            if status not in TERMINAL_VIDEO_STATUSES:
                raise ValueError("视频任务仍在生成中，不能删除")
            assets = connection.execute(
                "SELECT * FROM video_generation_assets WHERE task_id = ? ORDER BY created_at ASC",
                (task_id,),
            ).fetchall()
            connection.execute("DELETE FROM video_generation_tasks WHERE id = ?", (task_id,))
            return {"task": dict(row), "assets": [dict(asset) for asset in assets]}

    def list_tasks(self, *, status: str | None = None, page: int = 1, page_size: int = 20) -> list[dict[str, Any]]:
        safe_page = max(1, page)
        safe_size = min(100, max(1, page_size))
        clauses: list[str] = []
        values: list[Any] = []
        if status:
            clauses.append("status = ?")
            values.append(status)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        values.extend([safe_size, (safe_page - 1) * safe_size])
        with self._connect() as connection:
            rows = connection.execute(
                f"SELECT * FROM video_generation_tasks {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
                values,
            ).fetchall()
            return [dict(row) for row in rows]

    def list_active_tasks(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM video_generation_tasks WHERE status IN (?, ?) ORDER BY next_poll_at ASC",
                (VideoTaskStatus.PENDING.value, VideoTaskStatus.RUNNING.value),
            ).fetchall()
            return [dict(row) for row in rows]

    def update_task(self, task_id: str, *, status: VideoTaskStatus | None = None, progress: int | None = None, provider_task_id: str | None = None, provider_status: str | None = None, video_url: str | None = None, local_asset_id: str | None = None, error_code: str | None = None, error_message: str | None = None, next_poll_at: float | None = None, last_polled_at: float | None = None) -> dict[str, Any] | None:
        now = time.time()
        with self._connect() as connection:
            current = connection.execute("SELECT * FROM video_generation_tasks WHERE id = ?", (task_id,)).fetchone()
            if current is None:
                return None
            current_status = VideoTaskStatus(current["status"])
            if current_status in TERMINAL_VIDEO_STATUSES:
                return dict(current)
            next_status = status or current_status
            next_progress = max(int(current["progress"] or 0), min(100, max(0, int(progress if progress is not None else current["progress"] or 0))))
            updates: dict[str, Any] = {"status": next_status.value, "progress": next_progress, "updated_at": now}
            for field, value in {
                "provider_task_id": provider_task_id,
                "provider_status": provider_status,
                "video_url": video_url,
                "local_asset_id": local_asset_id,
                "error_code": error_code,
                "error_message": error_message,
                "next_poll_at": next_poll_at,
                "last_polled_at": last_polled_at,
            }.items():
                if value is not None:
                    updates[field] = value
            if provider_task_id and current["submitted_at"] is None:
                updates["submitted_at"] = now
            if next_status is VideoTaskStatus.RUNNING and current["started_at"] is None:
                updates["started_at"] = now
            if next_status in TERMINAL_VIDEO_STATUSES:
                updates["completed_at"] = current["completed_at"] or now
                if next_status is VideoTaskStatus.SUCCEEDED:
                    updates["progress"] = 100
            changed = any(current[key] != value for key, value in updates.items() if key in current.keys())
            if not changed:
                return dict(current)
            assignments = ", ".join(f"{key} = ?" for key in updates)
            connection.execute(f"UPDATE video_generation_tasks SET {assignments} WHERE id = ?", [*updates.values(), task_id])
            message = error_message or ("视频生成完成" if next_status is VideoTaskStatus.SUCCEEDED else "任务状态已更新")
            event_type = "result" if next_status is VideoTaskStatus.SUCCEEDED else "error" if next_status is VideoTaskStatus.FAILED else "status"
            self._append_event(connection, task_id, event_type, next_status, updates["progress"], message, {"provider_status": provider_status} if provider_status else {})
            refreshed = connection.execute("SELECT * FROM video_generation_tasks WHERE id = ?", (task_id,)).fetchone()
            return dict(refreshed)

    def list_events(self, task_id: str, *, after_sequence: int = 0) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM video_generation_events WHERE task_id = ? AND sequence > ? ORDER BY sequence ASC",
                (task_id, after_sequence),
            ).fetchall()
            return [dict(row) for row in rows]

    def create_asset(self, task_id: str, *, storage_path: str, mime_type: str, size_bytes: int, sha256: str, asset_id: str | None = None) -> dict[str, Any]:
        asset_id = asset_id or str(uuid.uuid4())
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO video_generation_assets
                (id, task_id, storage_path, mime_type, size_bytes, sha256, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (asset_id, task_id, storage_path, mime_type, size_bytes, sha256, time.time()),
            )
            connection.execute(
                "UPDATE video_generation_tasks SET local_asset_id = ?, updated_at = ? WHERE id = ?",
                (asset_id, time.time(), task_id),
            )
            row = connection.execute("SELECT * FROM video_generation_assets WHERE id = ?", (asset_id,)).fetchone()
            return dict(row)

    def get_asset(self, asset_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM video_generation_assets WHERE id = ?", (asset_id,)).fetchone()
            return dict(row) if row else None

    def _append_event(self, connection: sqlite3.Connection, task_id: str, event_type: str, status: VideoTaskStatus, progress: int, message: str, payload: dict[str, Any]) -> None:
        last = connection.execute("SELECT COALESCE(MAX(sequence), 0) FROM video_generation_events WHERE task_id = ?", (task_id,)).fetchone()[0]
        connection.execute(
            """INSERT INTO video_generation_events
            (task_id, sequence, event_type, status, progress, message, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (task_id, last + 1, event_type, status.value, progress, message, json.dumps(payload, ensure_ascii=False), time.time()),
        )
