from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from video_engine import QwenVideoProvider, VideoGenerationRequest, ZhipuVideoProvider, get_video_capabilities


def _capture_provider(provider_cls, request: VideoGenerationRequest):
    captured = {}

    async def handler(http_request: httpx.Request) -> httpx.Response:
        captured["url"] = str(http_request.url)
        captured["json"] = json.loads(http_request.content)
        return httpx.Response(200, json={"id": "z-1", "task_status": "PROCESSING"} if provider_cls is ZhipuVideoProvider else {"output": {"task_id": "q-1", "task_status": "PENDING"}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = provider_cls("key", client=client, base_url="https://provider.test/api/v1")
    asyncio.run(provider.submit(request))
    asyncio.run(client.aclose())
    return captured


def test_image_video_capability_matrix_lists_modes_and_models():
    models = {item["id"]: item for item in get_video_capabilities()}
    assert "image_to_video" in models["wan2.7-i2v"]["modes"]
    assert "start_end_video" in models["wan2.7-i2v"]["modes"]
    assert models["wan2.2-kf2v-flash"]["modes"] == ["start_end_video"]
    assert models["viduq1-image"]["durations"] == [5]
    assert models["viduq1-start-end"]["modes"] == ["start_end_video"]


def test_image_modes_require_public_frame_urls_and_correct_model_mode():
    with pytest.raises(ValueError, match="首帧"):
        VideoGenerationRequest(mode="image_to_video", model="wan2.7-i2v", prompt="推进", duration=5, resolution="720P")
    with pytest.raises(ValueError, match="尾帧"):
        VideoGenerationRequest(mode="start_end_video", model="wan2.7-i2v", prompt="过渡", first_frame_url="https://cdn.example/a.png", duration=5, resolution="720P")
    with pytest.raises(ValueError, match="公开"):
        VideoGenerationRequest(mode="image_to_video", model="wan2.6-i2v", prompt="推进", first_frame_url="http://127.0.0.1/a.png", duration=5, resolution="720P")
    with pytest.raises(ValueError, match="不支持模式"):
        VideoGenerationRequest(mode="start_end_video", model="wan2.6-i2v", prompt="过渡", first_frame_url="https://cdn.example/a.png", last_frame_url="https://cdn.example/b.png", duration=5, resolution="720P")


def test_all_image_models_accept_local_image_as_data_url_but_audio_stays_public_only():
    for model, mode, last in [
        ("wan2.7-i2v", "image_to_video", None),
        ("wan2.6-i2v-flash", "image_to_video", None),
        ("wan2.6-i2v", "image_to_video", None),
        ("wan2.2-kf2v-flash", "start_end_video", "data:image/png;base64,bbb"),
        ("viduq1-image", "image_to_video", None),
        ("viduq1-start-end", "start_end_video", "data:image/png;base64,bbb"),
    ]:
        request = VideoGenerationRequest(
            mode=mode, model=model, prompt="画面自然运动", first_frame_url="data:image/png;base64,aaa",
            last_frame_url=last, duration=5, resolution="1080P" if model.startswith("vidu") else "720P",
        )
        assert request.first_frame_url.startswith("data:image/")
    with pytest.raises(ValueError, match="公开"):
        VideoGenerationRequest(
            mode="image_to_video", model="wan2.6-i2v-flash", prompt="人物挥手",
            first_frame_url="data:image/png;base64,aaa", audio_url="data:audio/mp3;base64,aaa",
            duration=5, resolution="720P",
        )


def test_qwen_wan27_builds_media_contract_in_stable_order():
    captured = _capture_provider(QwenVideoProvider, VideoGenerationRequest(
        mode="start_end_video", model="wan2.7-i2v", prompt="从白天过渡到夜晚",
        first_frame_url="https://cdn.example/first.png", last_frame_url="https://cdn.example/last.png",
        audio_url="https://cdn.example/voice.mp3", negative_prompt="模糊", duration=8,
        resolution="1080P", seed=7,
    ))
    assert captured["json"]["input"] == {
        "prompt": "从白天过渡到夜晚",
        "media": [
            {"type": "first_frame", "url": "https://cdn.example/first.png"},
            {"type": "last_frame", "url": "https://cdn.example/last.png"},
            {"type": "driving_audio", "url": "https://cdn.example/voice.mp3"},
        ],
        "negative_prompt": "模糊",
    }
    assert captured["json"]["parameters"]["seed"] == 7


def test_qwen_wan26_builds_legacy_first_frame_contract():
    captured = _capture_provider(QwenVideoProvider, VideoGenerationRequest(
        mode="image_to_video", model="wan2.6-i2v-flash", prompt="人物挥手",
        first_frame_url="https://cdn.example/first.png", audio_url="https://cdn.example/voice.mp3",
        duration=5, resolution="720P", shot_type="multi", audio=False,
    ))
    assert captured["json"]["input"]["img_url"] == "https://cdn.example/first.png"
    assert captured["json"]["input"]["audio_url"] == "https://cdn.example/voice.mp3"
    assert captured["json"]["parameters"]["shot_type"] == "multi"
    assert captured["json"]["parameters"]["audio"] is False


def test_qwen_wan22_uses_kf2v_endpoint_and_explicit_frame_fields():
    captured = _capture_provider(QwenVideoProvider, VideoGenerationRequest(
        mode="start_end_video", model="wan2.2-kf2v-flash", prompt="自然转场",
        first_frame_url="https://cdn.example/first.png", last_frame_url="https://cdn.example/last.png",
        duration=5, resolution="720P",
    ))
    assert captured["url"].endswith("/services/aigc/image2video/video-synthesis")
    assert captured["json"]["input"]["first_frame_url"].endswith("first.png")
    assert captured["json"]["input"]["last_frame_url"].endswith("last.png")


def test_zhipu_vidu_uses_string_or_ordered_image_url_array():
    first = _capture_provider(ZhipuVideoProvider, VideoGenerationRequest(
        mode="image_to_video", model="viduq1-image", prompt="云朵流动",
        first_frame_url="https://cdn.example/first.png", duration=5, resolution="1080P",
    ))
    transition = _capture_provider(ZhipuVideoProvider, VideoGenerationRequest(
        mode="start_end_video", model="viduq1-start-end", prompt="季节变化",
        first_frame_url="https://cdn.example/first.png", last_frame_url="https://cdn.example/last.png",
        duration=5, resolution="1080P",
    ))
    assert first["json"]["image_url"] == "https://cdn.example/first.png"
    assert transition["json"]["image_url"] == ["https://cdn.example/first.png", "https://cdn.example/last.png"]
    assert transition["json"]["size"] == "1920x1080"
