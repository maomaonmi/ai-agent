"""Runtime configuration for video uploads and media preprocessing.

The project deliberately keeps provider credentials out of application code.
For local development we support the user's ``OSS.env`` file while allowing
real process environment variables to take precedence over that file.
"""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path


_CONFIG_KEYS = (
    "OSS_ACCESS_KEY_ID",
    "OSS_ACCESS_KEY_SECRET",
    "OSS_REGION",
    "OSS_BUCKET",
    "OSS_ENDPOINT",
    "FFMPEG_PATH",
    "FFPROBE_PATH",
)


def load_env_file(path: str | Path, *, environ: dict[str, str] | None = None) -> dict[str, str]:
    """Load simple ``KEY=VALUE`` entries without overwriting real env vars.

    This intentionally supports only the subset needed by the local runtime:
    blank lines, comments, optional ``export`` and quoted values. It does not
    execute shell syntax.
    """

    target = environ if environ is not None else os.environ
    source = Path(path)
    if not source.is_file():
        return {}

    loaded: dict[str, str] = {}
    for raw_line in source.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key not in _CONFIG_KEYS:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        loaded[key] = value
        if key not in target:
            target[key] = value
    return loaded


@dataclass(frozen=True)
class VideoRuntimeConfig:
    access_key_id: str = ""
    access_key_secret: str = ""
    region: str = ""
    bucket: str = ""
    endpoint: str = ""
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"

    @property
    def oss_configured(self) -> bool:
        return all((self.access_key_id, self.access_key_secret, self.region, self.bucket, self.endpoint))

    def resolve_ffmpeg(self) -> str | None:
        return _resolve_executable(self.ffmpeg_path)

    def resolve_ffprobe(self) -> str | None:
        return _resolve_executable(self.ffprobe_path)


def _resolve_executable(raw_path: str) -> str | None:
    candidate = (raw_path or "").strip()
    if not candidate:
        return None
    path = Path(candidate)
    if path.is_file():
        return str(path.resolve())
    return shutil.which(candidate)


def load_video_runtime_config(env_file: str | Path | None = None) -> VideoRuntimeConfig:
    """Read video runtime settings, preferring process env over ``OSS.env``."""

    source = Path(env_file) if env_file else Path(__file__).resolve().parent / "OSS.env"
    load_env_file(source)
    return VideoRuntimeConfig(
        access_key_id=os.getenv("OSS_ACCESS_KEY_ID", ""),
        access_key_secret=os.getenv("OSS_ACCESS_KEY_SECRET", ""),
        region=os.getenv("OSS_REGION", ""),
        bucket=os.getenv("OSS_BUCKET", ""),
        endpoint=os.getenv("OSS_ENDPOINT", ""),
        ffmpeg_path=os.getenv("FFMPEG_PATH", "ffmpeg"),
        ffprobe_path=os.getenv("FFPROBE_PATH", "ffprobe"),
    )
