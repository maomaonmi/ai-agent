from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from video_probe import FFprobeService, VideoProbeError, VideoProbeResult


def test_ffprobe_parses_and_validates_reference_video(tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"x" * 1024)

    def runner(command, **kwargs):
        assert command[0] == "ffprobe"
        return SimpleNamespace(stdout=json.dumps({
            "streams": [{"codec_name": "h264", "width": 1920, "height": 1080}],
            "format": {"duration": "5.25"},
        }))

    result = FFprobeService(runner=runner).probe(video)

    assert result == VideoProbeResult(5.25, 1920, 1080, "h264")
    assert result.aspect_ratio == pytest.approx(16 / 9)


@pytest.mark.parametrize(
    "result,message",
    [
        (VideoProbeResult(0.5, 1920, 1080, "h264"), "时长"),
        (VideoProbeResult(31, 1920, 1080, "h264"), "时长"),
        (VideoProbeResult(5, 100, 1080, "h264"), "宽高"),
        (VideoProbeResult(5, 4097, 1000, "h264"), "宽高"),
        (VideoProbeResult(5, 4096, 240, "h264"), "画幅"),
    ],
)
def test_ffprobe_rejects_provider_unsafe_specs(result, message):
    with pytest.raises(VideoProbeError, match=message):
        FFprobeService.validate(result, size_bytes=1024)


def test_ffprobe_rejects_oversized_file(tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"x")

    def runner(command, **kwargs):
        return SimpleNamespace(stdout=json.dumps({
            "streams": [{"codec_name": "h264", "width": 1920, "height": 1080}],
            "format": {"duration": "5"},
        }))

    service = FFprobeService(runner=runner)
    with pytest.raises(VideoProbeError, match="100MB"):
        service.validate(VideoProbeResult(5, 1920, 1080, "h264"), size_bytes=100 * 1024 * 1024 + 1)
