from __future__ import annotations

import os

from video_runtime import load_env_file, load_video_runtime_config


def test_load_env_file_does_not_overwrite_process_environment(tmp_path):
    env_file = tmp_path / "OSS.env"
    env_file.write_text(
        "OSS_BUCKET=file-bucket\n"
        "OSS_ACCESS_KEY_SECRET=secret-value\n"
        "export FFMPEG_PATH=custom-ffmpeg\n",
        encoding="utf-8",
    )
    environ = {"OSS_BUCKET": "process-bucket"}

    loaded = load_env_file(env_file, environ=environ)

    assert loaded["OSS_BUCKET"] == "file-bucket"
    assert environ["OSS_BUCKET"] == "process-bucket"
    assert environ["FFMPEG_PATH"] == "custom-ffmpeg"


def test_video_runtime_config_reads_oss_env_without_exposing_secret(tmp_path):
    env_file = tmp_path / "OSS.env"
    env_file.write_text(
        "OSS_ACCESS_KEY_ID=id\n"
        "OSS_ACCESS_KEY_SECRET=secret\n"
        "OSS_REGION=oss-cn-test\n"
        "OSS_BUCKET=bucket\n"
        "OSS_ENDPOINT=https://oss-cn-test.aliyuncs.com\n"
        "FFMPEG_PATH=missing-ffmpeg\n"
        "FFPROBE_PATH=missing-ffprobe\n",
        encoding="utf-8",
    )

    keys = ("OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_REGION", "OSS_BUCKET", "OSS_ENDPOINT", "FFMPEG_PATH", "FFPROBE_PATH")
    saved = {key: os.environ.get(key) for key in keys}
    try:
        for key in keys:
            os.environ.pop(key, None)
        config = load_video_runtime_config(env_file)
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    assert config.oss_configured
    assert config.access_key_secret == "secret"
    assert config.resolve_ffmpeg() is None
    assert config.resolve_ffprobe() is None
