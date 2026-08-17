"""Safe local persistence for provider video URLs."""

from __future__ import annotations

import hashlib
import os
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx

from video_engine import VideoJobRepository


class VideoAssetError(RuntimeError):
    pass


class VideoAssetStore:
    def __init__(self, root: str | Path, repository: VideoJobRepository, *, client: httpx.AsyncClient | None = None, max_bytes: int = 512 * 1024 * 1024):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.repository = repository
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0), follow_redirects=False)
        self.max_bytes = max(1, max_bytes)

    async def download(self, task_id: str, video_url: str) -> dict:
        parsed = urlparse(video_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise VideoAssetError("视频结果 URL 必须是有效的 HTTP/HTTPS URL")
        task_dir = self.root / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        asset_id = str(uuid.uuid4())
        temp_path = task_dir / f".{asset_id}.part"
        final_path = task_dir / f"{asset_id}.mp4"
        digest = hashlib.sha256()
        size = 0
        try:
            async with self.client.stream("GET", video_url) as response:
                if response.status_code >= 400:
                    raise VideoAssetError(f"视频下载失败（HTTP {response.status_code}）")
                content_length = response.headers.get("content-length")
                if content_length and int(content_length) > self.max_bytes:
                    raise VideoAssetError("视频文件过大，已拒绝保存")
                mime_type = response.headers.get("content-type", "video/mp4").split(";", 1)[0].strip().lower()
                if mime_type not in {"video/mp4", "video/webm", "application/octet-stream"}:
                    raise VideoAssetError("视频响应的 MIME 类型不受支持")
                with temp_path.open("wb") as output:
                    async for chunk in response.aiter_bytes(1024 * 1024):
                        size += len(chunk)
                        if size > self.max_bytes:
                            raise VideoAssetError("视频文件过大，已拒绝保存")
                        digest.update(chunk)
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
            temp_path.replace(final_path)
            asset = self.repository.create_asset(
                task_id,
                asset_id=asset_id,
                storage_path=str(final_path),
                mime_type="video/mp4" if mime_type == "application/octet-stream" else mime_type,
                size_bytes=size,
                sha256=digest.hexdigest(),
            )
            return {**asset, "url": f"/api/video/assets/{asset_id}"}
        except VideoAssetError:
            temp_path.unlink(missing_ok=True)
            final_path.unlink(missing_ok=True)
            try:
                task_dir.rmdir()
            except OSError:
                pass
            raise
        except Exception as exc:
            temp_path.unlink(missing_ok=True)
            final_path.unlink(missing_ok=True)
            try:
                task_dir.rmdir()
            except OSError:
                pass
            raise VideoAssetError("视频下载或保存失败") from exc
