from __future__ import annotations

import pytest
from pathlib import Path

from video_engine import VideoJobRepository
from video_probe import VideoProbeResult
from video_reference import ReferenceAssetError, ReferenceAssetService, ReferenceAssetUploadRequest


class FakeSigner:
    def __init__(self, *, exists=True, size=1024, content_type="video/mp4"):
        self.exists = exists
        self.size = size
        self.content_type = content_type
        self.calls = []
        self.deleted = []
        self.uploaded = []

    def sign_put(self, object_key, *, content_type, expires):
        self.calls.append((object_key, content_type, expires))
        return f"https://oss.test/{object_key}?signature=test"

    def head(self, object_key):
        if not self.exists:
            raise RuntimeError("not found")
        return {"content_length": self.size, "content_type": self.content_type}

    def sign_get(self, object_key, *, expires):
        return f"https://oss.test/{object_key}?get-signature=test"

    def download(self, object_key, target):
        target.write_bytes(b"fake-video")

    def delete(self, object_key):
        self.deleted.append(object_key)

    def upload(self, object_key, source, *, content_type):
        self.uploaded.append((object_key, Path(source).read_bytes(), content_type))


class FakeProbe:
    def probe(self, path):
        return VideoProbeResult(5.0, 1920, 1080, "h264")


class HevcProbe:
    def probe(self, path):
        return VideoProbeResult(5.0, 1920, 1080, "hevc")


class FakeTranscoder:
    def normalize(self, source, target):
        target.write_bytes(b"normalized-mp4")


def test_reference_upload_creates_private_object_plan(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    signer = FakeSigner(size=1024)
    service = ReferenceAssetService(repository, signer, ttl_seconds=600, clock=lambda: 1000.0)

    plan = service.create_upload(ReferenceAssetUploadRequest(filename="舞蹈.MP4", content_type="video/mp4", size_bytes=1024))

    assert plan.object_key.startswith("video-references/")
    assert plan.object_key.endswith(".mp4")
    assert plan.upload_url.startswith("https://oss.test/")
    assert plan.headers == {"Content-Type": "video/mp4"}
    assert repository.get_reference_asset(plan.asset_id)["status"] == "UPLOADING"
    assert signer.calls[0][1:] == ("video/mp4", 600)


def test_reference_upload_completion_checks_object_metadata(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    signer = FakeSigner(size=1024)
    service = ReferenceAssetService(repository, signer, ttl_seconds=600, clock=lambda: 1000.0)
    plan = service.create_upload(ReferenceAssetUploadRequest(filename="clip.mp4", content_type="video/mp4", size_bytes=1024))

    completed = service.complete_upload(plan.asset_id)

    assert completed["status"] == "UPLOADED"
    assert completed["uploaded_at"] == 1000.0


def test_reference_upload_rejects_missing_object(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    signer = FakeSigner(exists=False, size=1024)
    service = ReferenceAssetService(repository, signer, ttl_seconds=600, clock=lambda: 1000.0)
    plan = service.create_upload(ReferenceAssetUploadRequest(filename="clip.mp4", content_type="video/mp4", size_bytes=1024))

    with pytest.raises(ReferenceAssetError, match="尚未找到"):
        service.complete_upload(plan.asset_id)


def test_reference_upload_is_idempotent_and_processes_to_ready(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    signer = FakeSigner(size=1024)
    service = ReferenceAssetService(repository, signer, ttl_seconds=600, clock=lambda: 1000.0, probe=FakeProbe(), work_dir=tmp_path / "work")
    plan = service.create_upload(ReferenceAssetUploadRequest(filename="clip.mp4", content_type="video/mp4", size_bytes=1024))

    uploaded = service.complete_upload(plan.asset_id)
    assert service.complete_upload(plan.asset_id)["status"] == "UPLOADED"
    ready = service.process_upload(plan.asset_id)

    assert uploaded["status"] == "UPLOADED"
    assert ready["status"] == "READY"
    assert ready["progress"] == 100
    assert ready["duration_seconds"] == 5.0
    assert service.get_reference_url(plan.asset_id).startswith("https://oss.test/")


def test_reference_asset_delete_removes_object_and_database_row(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    signer = FakeSigner(size=1024)
    service = ReferenceAssetService(repository, signer, clock=lambda: 1000.0)
    plan = service.create_upload(ReferenceAssetUploadRequest(filename="clip.mp4", content_type="video/mp4", size_bytes=1024))

    deleted = service.delete_asset(plan.asset_id)

    assert deleted["id"] == plan.asset_id
    assert signer.deleted == [plan.object_key]
    assert repository.get_reference_asset(plan.asset_id) is None


def test_reference_asset_transcodes_non_mp4_or_non_h264_inputs(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    signer = FakeSigner(size=1024, content_type="video/quicktime")
    service = ReferenceAssetService(
        repository,
        signer,
        clock=lambda: 1000.0,
        probe=HevcProbe(),
        transcode=FakeTranscoder(),
        work_dir=tmp_path / "work",
    )
    plan = service.create_upload(ReferenceAssetUploadRequest(filename="clip.mov", content_type="video/quicktime", size_bytes=1024))

    service.complete_upload(plan.asset_id)
    ready = service.process_upload(plan.asset_id)

    assert ready["status"] == "READY"
    assert ready["normalized_object_key"].endswith(".mp4")
    assert signer.uploaded[0][2] == "video/mp4"
    assert "normalized/" in service.get_reference_url(plan.asset_id)


@pytest.mark.parametrize(
    "filename,content_type",
    [("clip.txt", "video/mp4"), ("clip.mp4", "application/octet-stream")],
)
def test_reference_upload_rejects_unsupported_input(filename, content_type):
    with pytest.raises(ValueError):
        ReferenceAssetUploadRequest(filename=filename, content_type=content_type, size_bytes=1024)
