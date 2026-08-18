"""FFmpeg normalization for reference-video assets.

The provider adapters only receive public signed URLs.  This worker keeps the
private raw object in OSS, and uploads a short-lived MP4/H.264/AAC derivative
when the source container or codec is likely to be rejected by a provider.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any, Callable


class VideoTranscodeError(RuntimeError):
    pass


class FFmpegService:
    def __init__(
        self,
        executable: str = "ffmpeg",
        *,
        runner: Callable[..., Any] = subprocess.run,
        timeout_seconds: int = 10 * 60,
    ):
        self.executable = executable
        self.runner = runner
        self.timeout_seconds = max(30, int(timeout_seconds))

    def normalize(self, source: str | Path, target: str | Path) -> None:
        source_path = Path(source)
        target_path = Path(target)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        command = [
            self.executable,
            "-y",
            "-i", str(source_path),
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "veryfast",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            str(target_path),
        ]
        try:
            self.runner(command, capture_output=True, text=True, check=True, timeout=self.timeout_seconds)
        except (OSError, subprocess.SubprocessError) as exc:
            raise VideoTranscodeError("FFmpeg 无法完成参考视频标准化") from exc
        if not target_path.is_file() or target_path.stat().st_size <= 0:
            raise VideoTranscodeError("FFmpeg 未生成有效的标准化视频")

