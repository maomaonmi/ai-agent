"""Reference-video upload contracts and Aliyun OSS signed URL adapter."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from pathlib import PurePosixPath
from typing import Any, Protocol

from pydantic import BaseModel, Field, field_validator

from video_engine import VideoJobRepository
from video_probe import FFprobeService, VideoProbeError
from video_transcode import FFmpegService, VideoTranscodeError
from video_runtime import VideoRuntimeConfig


REFERENCE_VIDEO_MAX_BYTES = 100 * 1024 * 1024
REFERENCE_VIDEO_TTL_SECONDS = 24 * 60 * 60
REFERENCE_UPLOAD_URL_TTL_SECONDS = 30 * 60
_ALLOWED_MIME_TYPES = {"video/mp4", "video/quicktime", "video/webm"}
_ALLOWED_SUFFIXES = {".mp4", ".mov", ".webm"}


class ReferenceAssetError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class ReferenceAssetUploadRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    content_type: str = Field(min_length=1, max_length=100)
    size_bytes: int = Field(gt=0, le=REFERENCE_VIDEO_MAX_BYTES)

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        name = value.strip()
        if not name or name in {".", ".."}:
            raise ValueError("filename 无效")
        suffix = PurePosixPath(name.replace("\\", "/")).suffix.lower()
        if suffix not in _ALLOWED_SUFFIXES:
            raise ValueError("参考视频仅支持 MP4、MOV 或 WebM")
        return PurePosixPath(name.replace("\\", "/")).name

    @field_validator("content_type")
    @classmethod
    def validate_content_type(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in _ALLOWED_MIME_TYPES:
            raise ValueError("参考视频 MIME 类型不受支持")
        return normalized


@dataclass(frozen=True)
class SignedUpload:
    asset_id: str
    object_key: str
    upload_url: str
    expires_at: float
    headers: dict[str, str]


class SignedUrlProvider(Protocol):
    def sign_put(self, object_key: str, *, content_type: str, expires: int) -> str: ...

    def sign_get(self, object_key: str, *, expires: int) -> str: ...

    def head(self, object_key: str) -> dict[str, Any]: ...

    def download(self, object_key: str, target: str | Path) -> None: ...

    def delete(self, object_key: str) -> None: ...

    def upload(self, object_key: str, source: str | Path, *, content_type: str) -> None: ...


class AliyunOssSignedUrlProvider:
    def __init__(self, config: VideoRuntimeConfig):
        if not config.oss_configured:
            raise ReferenceAssetError("OSS_NOT_CONFIGURED", "OSS 私有桶配置不完整")
        try:
            import oss2
        except ImportError as exc:
            raise ReferenceAssetError("OSS_SDK_NOT_INSTALLED", "未安装 oss2，请执行 pip install oss2") from exc
        self._bucket = oss2.Bucket(
            oss2.Auth(config.access_key_id, config.access_key_secret),
            config.endpoint,
            config.bucket,
            region=config.region,
        )

    def sign_put(self, object_key: str, *, content_type: str, expires: int) -> str:
        return self._bucket.sign_url(
            "PUT",
            object_key,
            expires,
            headers={"Content-Type": content_type},
            slash_safe=True,
        )

    def sign_get(self, object_key: str, *, expires: int) -> str:
        return self._bucket.sign_url("GET", object_key, expires, slash_safe=True)

    def head(self, object_key: str) -> dict[str, Any]:
        result = self._bucket.head_object(object_key)
        return {
            "content_length": int(result.content_length),
            "content_type": str(result.content_type or "").split(";", 1)[0].lower(),
        }

    def download(self, object_key: str, target: str | Path) -> None:
        self._bucket.get_object_to_file(object_key, str(target))

    def delete(self, object_key: str) -> None:
        self._bucket.delete_object(object_key)

    def upload(self, object_key: str, source: str | Path, *, content_type: str) -> None:
        self._bucket.put_object_from_file(object_key, str(source), headers={"Content-Type": content_type})


class ReferenceAssetService:
    def __init__(
        self,
        repository: VideoJobRepository,
        signer: SignedUrlProvider,
        *,
        ttl_seconds: int = REFERENCE_VIDEO_TTL_SECONDS,
        upload_ttl_seconds: int | None = None,
        clock=time.time,
        probe: FFprobeService | None = None,
        transcode: FFmpegService | None = None,
        work_dir: str | Path | None = None,
    ):
        self.repository = repository
        self.signer = signer
        self.ttl_seconds = max(60, min(int(ttl_seconds), 24 * 60 * 60))
        self.upload_ttl_seconds = max(60, min(int(upload_ttl_seconds or min(self.ttl_seconds, REFERENCE_UPLOAD_URL_TTL_SECONDS)), 6 * 60 * 60))
        self.clock = clock
        self.probe = probe
        self.transcode = transcode
        self.work_dir = Path(work_dir or Path("data") / "video-studio" / "reference-work")
        self.work_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _needs_transcode(asset: dict[str, Any], codec_name: str | None) -> bool:
        suffix = PurePosixPath(str(asset.get("original_name") or "")).suffix.lower()
        return suffix != ".mp4" or (codec_name or "").lower() not in {"h264", "avc1"}

    def create_upload(self, request: ReferenceAssetUploadRequest) -> SignedUpload:
        asset_id = str(uuid.uuid4())
        suffix = PurePosixPath(request.filename).suffix.lower()
        object_key = f"video-references/{asset_id}{suffix}"
        expires_at = self.clock() + self.ttl_seconds
        upload_expires_at = self.clock() + self.upload_ttl_seconds
        upload_url = self.signer.sign_put(object_key, content_type=request.content_type, expires=self.upload_ttl_seconds)
        self.repository.create_reference_asset(
            asset_id=asset_id,
            object_key=object_key,
            original_name=request.filename,
            mime_type=request.content_type,
            size_bytes=request.size_bytes,
            expires_at=expires_at,
        )
        return SignedUpload(asset_id, object_key, upload_url, upload_expires_at, {"Content-Type": request.content_type})

    def complete_upload(self, asset_id: str) -> dict[str, Any]:
        asset = self.repository.get_reference_asset(asset_id)
        if asset is None:
            raise ReferenceAssetError("REFERENCE_ASSET_NOT_FOUND", "参考视频资产不存在")
        if asset["status"] in {"UPLOADED", "PROBING", "READY", "REJECTED"}:
            return asset
        if asset["status"] != "UPLOADING":
            raise ReferenceAssetError("REFERENCE_ASSET_NOT_UPLOADABLE", "参考视频不在等待上传状态")
        if asset["expires_at"] <= self.clock():
            raise ReferenceAssetError("REFERENCE_ASSET_EXPIRED", "参考视频上传凭证已过期")
        try:
            metadata = self.signer.head(asset["object_key"])
        except Exception as exc:
            raise ReferenceAssetError("REFERENCE_ASSET_NOT_UPLOADED", "OSS 中尚未找到参考视频") from exc
        if metadata["content_length"] != asset["size_bytes"]:
            raise ReferenceAssetError("REFERENCE_ASSET_SIZE_MISMATCH", "上传文件大小与预声明大小不一致")
        if metadata.get("content_type") and metadata["content_type"] != asset["mime_type"]:
            raise ReferenceAssetError("REFERENCE_ASSET_TYPE_MISMATCH", "上传文件类型与预声明类型不一致")
        return self.repository.mark_reference_asset_uploaded(asset_id, uploaded_at=self.clock()) or asset

    def process_upload(self, asset_id: str) -> dict[str, Any] | None:
        """Download the private object briefly and move it to READY/REJECTED."""

        asset = self.repository.get_reference_asset(asset_id)
        if asset is None:
            return None
        if asset["status"] == "READY":
            return asset
        if asset["status"] not in {"UPLOADED", "PROBING"}:
            return asset
        if self.probe is None:
            return self.repository.update_reference_asset(
                asset_id,
                status="REJECTED",
                progress=100,
                error_code="REFERENCE_PROBE_UNAVAILABLE",
                error_message="FFprobe 未配置，无法检查参考视频",
            )
        self.repository.update_reference_asset(asset_id, status="PROBING", progress=20)
        temp_path = self.work_dir / f"{asset_id}.source"
        normalized_path = self.work_dir / f"{asset_id}.normalized.mp4"
        try:
            self.signer.download(asset["object_key"], temp_path)
            result = self.probe.probe(temp_path)
            object_key = asset["object_key"]
            if self._needs_transcode(asset, result.codec_name):
                if self.transcode is None or not callable(getattr(self.signer, "upload", None)):
                    raise VideoTranscodeError("当前视频需要转码，但 FFmpeg/对象存储上传未配置")
                self.repository.update_reference_asset(asset_id, status="TRANSCODING", progress=45)
                self.transcode.normalize(temp_path, normalized_path)
                normalized_result = self.probe.probe(normalized_path)
                normalized_key = f"video-references/normalized/{asset_id}.mp4"
                self.signer.upload(normalized_key, normalized_path, content_type="video/mp4")
                object_key = normalized_key
                result = normalized_result
            return self.repository.update_reference_asset(
                asset_id,
                status="READY",
                progress=100,
                probed_at=self.clock(),
                duration_seconds=result.duration_seconds,
                width=result.width,
                height=result.height,
                error_code=None,
                error_message=None,
                normalized_object_key=object_key if object_key != asset["object_key"] else None,
            )
        except VideoProbeError as exc:
            return self.repository.update_reference_asset(
                asset_id,
                status="REJECTED",
                progress=100,
                probed_at=self.clock(),
                error_code="REFERENCE_VIDEO_INVALID",
                error_message=str(exc),
            )
        except VideoTranscodeError as exc:
            return self.repository.update_reference_asset(
                asset_id,
                status="REJECTED",
                progress=100,
                error_code="REFERENCE_VIDEO_TRANSCODE_FAILED",
                error_message=str(exc),
            )
        except Exception:
            return self.repository.update_reference_asset(
                asset_id,
                status="REJECTED",
                progress=100,
                error_code="REFERENCE_ASSET_DOWNLOAD_FAILED",
                error_message="参考视频暂时无法读取，请重新上传",
            )
        finally:
            temp_path.unlink(missing_ok=True)
            normalized_path.unlink(missing_ok=True)

    def get_reference_url(self, asset_id: str, *, expires: int = 6 * 60 * 60) -> str:
        asset = self.repository.get_reference_asset(asset_id)
        if asset is None:
            raise ReferenceAssetError("REFERENCE_ASSET_NOT_FOUND", "参考视频资产不存在")
        if asset["status"] != "READY":
            raise ReferenceAssetError("ASSET_NOT_READY", "参考视频仍在预处理中")
        if asset["expires_at"] <= self.clock():
            raise ReferenceAssetError("REFERENCE_ASSET_EXPIRED", "参考视频资产已过期")
        object_key = asset.get("normalized_object_key") or asset["object_key"]
        return self.signer.sign_get(object_key, expires=max(60, min(expires, 6 * 60 * 60)))

    def assert_ready(self, asset_ids: list[str]) -> None:
        for asset_id in asset_ids:
            asset = self.repository.get_reference_asset(asset_id)
            if asset is None:
                raise ReferenceAssetError("REFERENCE_ASSET_NOT_FOUND", "参考视频资产不存在")
            if asset["status"] != "READY":
                raise ReferenceAssetError("ASSET_NOT_READY", "参考视频仍在预处理中")
            if asset["expires_at"] <= self.clock():
                raise ReferenceAssetError("REFERENCE_ASSET_EXPIRED", "参考视频资产已过期")

    def delete_asset(self, asset_id: str) -> dict[str, Any] | None:
        asset = self.repository.get_reference_asset(asset_id)
        if asset is None:
            return None
        try:
            self.signer.delete(asset["object_key"])
            if asset.get("normalized_object_key"):
                self.signer.delete(asset["normalized_object_key"])
        except Exception as exc:
            raise ReferenceAssetError("REFERENCE_ASSET_DELETE_FAILED", "OSS 参考视频删除失败") from exc
        return self.repository.delete_reference_asset(asset_id)
