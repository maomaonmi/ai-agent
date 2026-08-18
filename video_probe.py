"""FFprobe-based validation for reference video inputs."""

from __future__ import annotations

import json
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


MAX_REFERENCE_VIDEO_BYTES = 100 * 1024 * 1024
MIN_REFERENCE_VIDEO_SECONDS = 1.0
MAX_REFERENCE_VIDEO_SECONDS = 30.0
MIN_REFERENCE_VIDEO_SIDE = 240
MAX_REFERENCE_VIDEO_SIDE = 4096


class VideoProbeError(ValueError):
    pass


@dataclass(frozen=True)
class VideoProbeResult:
    duration_seconds: float
    width: int
    height: int
    codec_name: str | None

    @property
    def aspect_ratio(self) -> float:
        return self.width / self.height


class FFprobeService:
    def __init__(self, executable: str = "ffprobe", *, runner: Callable[..., Any] = subprocess.run):
        self.executable = executable
        self.runner = runner

    def probe(self, path: str | Path) -> VideoProbeResult:
        target = Path(path)
        if not target.is_file():
            raise VideoProbeError("参考视频文件不存在")
        command = [
            self.executable,
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_name,width,height:format=duration",
            "-of", "json",
            str(target),
        ]
        try:
            completed = self.runner(command, capture_output=True, text=True, check=True)
            payload = json.loads(completed.stdout or "{}")
            stream = (payload.get("streams") or [{}])[0]
            duration = float((payload.get("format") or {}).get("duration"))
            width = int(stream.get("width"))
            height = int(stream.get("height"))
        except (OSError, subprocess.SubprocessError, ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            raise VideoProbeError("FFprobe 无法读取参考视频") from exc
        result = VideoProbeResult(duration, width, height, stream.get("codec_name"))
        self.validate(result, size_bytes=target.stat().st_size)
        return result

    @staticmethod
    def validate(result: VideoProbeResult, *, size_bytes: int) -> None:
        if size_bytes > MAX_REFERENCE_VIDEO_BYTES:
            raise VideoProbeError("参考视频不能超过 100MB")
        if not math.isfinite(result.duration_seconds) or not MIN_REFERENCE_VIDEO_SECONDS <= result.duration_seconds <= MAX_REFERENCE_VIDEO_SECONDS:
            raise VideoProbeError("参考视频时长必须在 1–30 秒之间")
        if not MIN_REFERENCE_VIDEO_SIDE <= result.width <= MAX_REFERENCE_VIDEO_SIDE or not MIN_REFERENCE_VIDEO_SIDE <= result.height <= MAX_REFERENCE_VIDEO_SIDE:
            raise VideoProbeError("参考视频宽高必须在 240–4096 像素之间")
        ratio = result.aspect_ratio
        if ratio < 1 / 8 or ratio > 8:
            raise VideoProbeError("参考视频画幅比例必须在 1:8–8:1 之间")
