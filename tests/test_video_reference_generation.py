from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from video_engine import QwenVideoProvider, VideoGenerationRequest
from video_engine import ProviderSubmission, VideoJobRepository, VideoTaskStatus
from video_monitor import VideoTaskMonitor
from video_reference import ReferenceAssetService, ReferenceAssetUploadRequest
from video_probe import VideoProbeResult


class Signer:
    def sign_put(self, object_key, *, content_type, expires): return f"https://oss.test/{object_key}?put"
    def sign_get(self, object_key, *, expires): return f"https://oss.test/{object_key}?get"
    def head(self, object_key): return {"content_length": 1, "content_type": "video/mp4"}
    def download(self, object_key, target): target.write_bytes(b"x")
    def delete(self, object_key): pass


class Probe:
    def probe(self, path): return VideoProbeResult(5, 1280, 720, "h264")


class CapturingProvider:
    def __init__(self): self.request = None
    async def submit(self, request):
        self.request = request
        return ProviderSubmission("remote-r2v", VideoTaskStatus.PENDING, "req-r2v")
    async def retrieve(self, provider_task_id): raise AssertionError("not polled")


def _request(model: str = "wan2.7-r2v", *, audio: bool | None = True) -> VideoGenerationRequest:
    return VideoGenerationRequest(
        mode="reference_to_video",
        prompt="Video 1 keeps the original motion while the scene becomes cinematic.",
        model=model,
        ratio="16:9",
        duration=5,
        resolution="720P",
        audio=audio,
        references=[
            {"assetId": "asset-video-1", "mediaKind": "reference_video", "purpose": "motion"},
        ],
    )


def test_reference_request_accepts_asset_contract_and_rejects_missing_assets():
    request = _request()
    assert request.references[0].asset_id == "asset-video-1"
    assert request.references[0].url is None

    with pytest.raises(ValueError, match="至少需要"):
        VideoGenerationRequest(mode="reference_to_video", prompt="参考动作", model="wan2.7-r2v", ratio="16:9", duration=5, resolution="720P")


def test_qwen_wan27_reference_payload_uses_media_alias_contract():
    captured = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.content)
        return httpx.Response(200, json={"request_id": "r2v-1", "output": {"task_id": "q-r2v-1", "task_status": "PENDING"}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = QwenVideoProvider(api_key="test-key", client=client, base_url="https://dashscope.test/api/v1")
    request = _request()
    request = request.model_copy(update={"references": [request.references[0].model_copy(update={"url": "https://oss.test/video.mp4"})]})
    asyncio.run(provider.submit(request))
    asyncio.run(client.aclose())

    body = captured["json"]
    assert body["model"] == "wan2.7-r2v"
    assert body["input"]["media"] == [{"type": "reference_video", "url": "https://oss.test/video.mp4"}]
    assert body["parameters"]["resolution"] == "720P"
    assert body["parameters"]["ratio"] == "16:9"


def test_qwen_wan26_reference_payload_uses_reference_urls_and_size():
    captured = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        captured["json"] = json.loads(request.content)
        return httpx.Response(200, json={"request_id": "r2v-2", "output": {"task_id": "q-r2v-2", "task_status": "PENDING"}})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = QwenVideoProvider(api_key="test-key", client=client, base_url="https://dashscope.test/api/v1")
    request = _request("wan2.6-r2v-flash").model_copy(update={"references": [
        _request().references[0].model_copy(update={"url": "https://oss.test/video.mp4"}),
    ]})
    asyncio.run(provider.submit(request))
    asyncio.run(client.aclose())

    body = captured["json"]
    assert body["model"] == "wan2.6-r2v-flash"
    assert body["input"]["reference_urls"] == ["https://oss.test/video.mp4"]
    assert body["parameters"]["size"] == "1280*720"
    assert "resolution" not in body["parameters"]


def test_wan26_r2v_regular_rejects_silent_output():
    with pytest.raises(ValueError, match="静音"):
        _request("wan2.6-r2v", audio=False)


def test_monitor_resolves_ready_asset_to_short_lived_provider_url(tmp_path):
    repository = VideoJobRepository(tmp_path / "video.sqlite3")
    assets = ReferenceAssetService(repository, Signer(), clock=lambda: 1000.0, probe=Probe(), work_dir=tmp_path / "work")
    upload = assets.create_upload(ReferenceAssetUploadRequest(filename="clip.mp4", content_type="video/mp4", size_bytes=1))
    assets.complete_upload(upload.asset_id)
    assets.process_upload(upload.asset_id)
    provider = CapturingProvider()
    monitor = VideoTaskMonitor(repository, {"qianwen": provider}, reference_assets=assets)
    request = _request().model_copy(update={"references": [
        _request().references[0].model_copy(update={"asset_id": upload.asset_id}),
    ]})
    task = repository.create_task(request)

    asyncio.run(monitor.submit_task(task["id"], request))

    assert provider.request.references[0].url.startswith("https://oss.test/")
    assert provider.request.model_dump().get("references")[0].get("url") is None
