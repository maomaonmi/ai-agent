from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from video_api import create_video_router
from video_engine import VideoJobRepository
from video_monitor import VideoTaskMonitor
from video_reference import ReferenceAssetService


class FakeSigner:
    def sign_put(self, object_key, *, content_type, expires):
        return f"https://oss.test/{object_key}?signature=test"

    def head(self, object_key):
        return {"content_length": 1024, "content_type": "video/mp4"}


def test_reference_upload_api_returns_stable_contract(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    monitor = VideoTaskMonitor(repository, {})
    service = ReferenceAssetService(repository, FakeSigner(), clock=lambda: 1000.0)
    app = FastAPI()
    app.include_router(create_video_router(repository, monitor, reference_assets=service))

    with TestClient(app) as client:
        response = client.post(
            "/api/video/reference-assets/upload-url",
            json={"filename": "clip.mp4", "content_type": "video/mp4", "size_bytes": 1024},
        )

    assert response.status_code == 201
    payload = response.json()
    assert set(payload) == {"assetId", "objectKey", "uploadUrl", "expiresAt", "headers"}
    assert payload["headers"] == {"Content-Type": "video/mp4"}


def test_reference_upload_api_reports_missing_storage(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    monitor = VideoTaskMonitor(repository, {})
    app = FastAPI()
    app.include_router(create_video_router(repository, monitor))

    with TestClient(app) as client:
        response = client.post(
            "/api/video/reference-assets/upload-url",
            json={"filename": "clip.mp4", "content_type": "video/mp4", "size_bytes": 1024},
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "REFERENCE_STORAGE_NOT_CONFIGURED"
