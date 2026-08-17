from __future__ import annotations

import asyncio

import httpx
import pytest

from video_assets import VideoAssetStore, VideoAssetError
from video_engine import VideoGenerationRequest, VideoJobRepository


def _task(repository: VideoJobRepository) -> str:
    return repository.create_task(
        VideoGenerationRequest(
            prompt="湖边的风吹过芦苇",
            model="wan2.6-t2v",
            ratio="16:9",
            duration=5,
            resolution="720P",
        )
    )["id"]


def test_asset_store_downloads_to_atomic_local_file_and_registers_asset(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    task_id = _task(repository)

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "video/mp4"}, content=b"fake-video")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    store = VideoAssetStore(tmp_path / "assets", repository, client=client, max_bytes=1024)
    asset = asyncio.run(store.download(task_id, "https://cdn.test/video.mp4"))
    asyncio.run(client.aclose())

    assert asset["mime_type"] == "video/mp4"
    assert (tmp_path / "assets" / task_id / f"{asset['id']}.mp4").read_bytes() == b"fake-video"
    assert repository.get_task(task_id)["local_asset_id"] == asset["id"]


def test_asset_store_rejects_oversized_download_without_leaving_partial_file(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    task_id = _task(repository)

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-length": "2048", "content-type": "video/mp4"}, content=b"x")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    store = VideoAssetStore(tmp_path / "assets", repository, client=client, max_bytes=1024)
    with pytest.raises(VideoAssetError, match="过大"):
        asyncio.run(store.download(task_id, "https://cdn.test/video.mp4"))
    asyncio.run(client.aclose())

    assert list((tmp_path / "assets").rglob("*")) == []


def test_asset_store_rejects_non_http_url(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    task_id = _task(repository)
    store = VideoAssetStore(tmp_path / "assets", repository, max_bytes=1024)

    with pytest.raises(VideoAssetError, match="URL"):
        asyncio.run(store.download(task_id, "file:///etc/passwd"))
