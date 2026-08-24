"""MiniMaxVideoProvider 单测：content[] 组装 / ratio 规则 / base_resp 错误面 / 状态映射 / 本地校验。

不发起真实网络请求——httpx.AsyncClient 通过替身注入（与 test_video_engine.py 同款手法）。
"""

import asyncio
import unittest

import httpx

from minimax.video import MiniMaxVideoProvider
from video_engine import (
    VideoGenerationRequest,
    VideoProviderError,
    VideoTaskStatus,
    get_video_capabilities,
    video_capability,
    _map_provider_status,
)


def _capture_client(responses: list[httpx.Response]):
    """顺序返回 responses 的假客户端；captured 记录每次请求参数。"""

    class _Client:
        def __init__(self):
            self.captured: list[dict] = []
            self._responses = list(responses)

        async def post(self, url, **kwargs):
            self.captured.append({"method": "POST", "url": url, **kwargs})
            return self._responses.pop(0)

        async def get(self, url, **kwargs):
            self.captured.append({"method": "GET", "url": url, **kwargs})
            return self._responses.pop(0)

    return _Client()


def _h3_request(**overrides) -> VideoGenerationRequest:
    payload = {
        "mode": "text_to_video",
        "prompt": "霓虹雨夜的赛博都市街景",
        "model": "MiniMax-H3",
        "ratio": "16:9",
        "duration": 6,
        "resolution": "768P",
    }
    payload.update(overrides)
    return VideoGenerationRequest(**payload)


def _hailuo_request(**overrides) -> VideoGenerationRequest:
    payload = {
        "mode": "text_to_video",
        "prompt": "霓虹雨夜的赛博都市街景",
        "model": "Hailuo2.3",
        "ratio": "16:9",
        "duration": 6,
        "resolution": "768P",
    }
    payload.update(overrides)
    return VideoGenerationRequest(**payload)


class CapabilityRegistryTests(unittest.TestCase):
    def test_h3_registered_with_full_modes(self):
        capability = video_capability("MiniMax-H3")
        self.assertEqual(capability["provider"], "minimax")
        self.assertEqual(
            capability["modes"],
            ["text_to_video", "image_to_video", "start_end_video", "reference_to_video"],
        )
        self.assertEqual(capability["resolutions"], ["768P", "2K"])
        self.assertEqual(capability["duration_min"], 4)
        self.assertEqual(capability["duration_max"], 15)
        self.assertEqual(capability["max_references"], 12)
        self.assertEqual(capability["max_reference_videos"], 3)
        # 注册表防御性拷贝：能力对前端 /api/video/models 可见。
        self.assertIn("MiniMax-H3", [item["id"] for item in get_video_capabilities()])

    def test_h3_prompt_limit_is_7000(self):
        request = _h3_request(prompt="长" * 6500)
        self.assertEqual(len(request.prompt), 6500)
        with self.assertRaises(ValueError):
            _h3_request(prompt="长" * 7001)

    def test_h3_reference_counts_rejected_before_api(self):
        images = [
            {"assetId": f"img-{i}", "mediaKind": "reference_image", "purpose": "subject"}
            for i in range(10)
        ]
        with self.assertRaises(ValueError):
            _h3_request(mode="reference_to_video", references=images)
        videos = [
            {"assetId": f"vid-{i}", "mediaKind": "reference_video", "purpose": "motion"}
            for i in range(4)
        ]
        with self.assertRaises(ValueError):
            _h3_request(mode="reference_to_video", references=videos)

    def test_h3_rejects_unsupported_resolution(self):
        with self.assertRaises(ValueError):
            _h3_request(resolution="1080P")


class StatusMappingTests(unittest.TestCase):
    def test_queued_and_preparing_map_to_pending(self):
        self.assertEqual(_map_provider_status("queued"), VideoTaskStatus.PENDING)
        self.assertEqual(_map_provider_status("Queueing"), VideoTaskStatus.PENDING)
        self.assertEqual(_map_provider_status("preparing"), VideoTaskStatus.PENDING)
        self.assertEqual(_map_provider_status("processing"), VideoTaskStatus.RUNNING)
        self.assertEqual(_map_provider_status("succeed"), VideoTaskStatus.SUCCEEDED)


class SubmitTests(unittest.TestCase):
    def _submit(self, request) -> tuple[object, object]:
        client = _capture_client([
            httpx.Response(200, json={"task_id": "mm-1", "base_resp": {"status_code": 0}}),
        ])
        provider = MiniMaxVideoProvider(api_key="k", client=client, base_url="https://minimax.test/v2")
        submission = asyncio.run(provider.submit(request))
        return submission, client

    def test_t2v_payload_contract(self):
        submission, client = self._submit(_h3_request())
        payload = client.captured[0]["json"]
        self.assertEqual(payload["model"], "MiniMax-H3")
        self.assertEqual(payload["ratio"], "16:9")
        self.assertEqual(payload["duration"], 6)
        self.assertEqual(payload["resolution"], "768P")
        self.assertEqual(payload["content"], [{"type": "text", "text": "霓虹雨夜的赛博都市街景"}])
        self.assertEqual(submission.provider_task_id, "mm-1")

    def test_t2v_auto_ratio_falls_back_to_16_9(self):
        _, client = self._submit(_h3_request(ratio="auto"))
        self.assertEqual(client.captured[0]["json"]["ratio"], "16:9")

    def test_i2v_ratio_forced_adaptive_with_frames(self):
        request = _h3_request(
            mode="start_end_video",
            ratio="16:9",
            first_frame_url="https://cdn.example.com/first.png",
            last_frame_url="https://cdn.example.com/last.png",
        )
        _, client = self._submit(request)
        payload = client.captured[0]["json"]
        # Why: 官方要求 i2v（含首尾帧）恒 adaptive，用户显式 16:9 也要覆盖。
        self.assertEqual(payload["ratio"], "adaptive")
        roles = [item.get("role") for item in payload["content"]]
        self.assertEqual(roles, [None, "first_frame", "last_frame"])

    def test_reference_content_uses_multimodal_types(self):
        request = _h3_request(
            mode="reference_to_video",
            references=[
                {"assetId": "img-1", "mediaKind": "reference_image", "purpose": "subject", "url": "https://cdn.example.com/a.png"},
                {"assetId": "vid-1", "mediaKind": "reference_video", "purpose": "motion", "url": "https://cdn.example.com/b.mp4"},
            ],
        )
        _, client = self._submit(request)
        content = client.captured[0]["json"]["content"]
        self.assertEqual(content[1], {"type": "image_url", "image_url": {"url": "https://cdn.example.com/a.png"}, "role": "reference_image"})
        self.assertEqual(content[2], {"type": "video_url", "video_url": {"url": "https://cdn.example.com/b.mp4"}, "role": "reference_video"})

    def test_base_resp_business_error_raises(self):
        client = _capture_client([
            httpx.Response(200, json={"base_resp": {"status_code": 2049, "status_msg": "content violation"}}),
        ])
        provider = MiniMaxVideoProvider(api_key="k", client=client, base_url="https://minimax.test/v2")
        with self.assertRaises(VideoProviderError) as ctx:
            asyncio.run(provider.submit(_h3_request()))
        self.assertIn("2049", str(ctx.exception))

    def test_missing_task_id_raises_invalid_response(self):
        client = _capture_client([httpx.Response(200, json={"base_resp": {"status_code": 0}})])
        provider = MiniMaxVideoProvider(api_key="k", client=client, base_url="https://minimax.test/v2")
        with self.assertRaises(VideoProviderError):
            asyncio.run(provider.submit(_h3_request()))

    def test_hailuo_uses_official_v1_flat_payload_and_model_id(self):
        client = _capture_client([
            httpx.Response(200, json={"task_id": "hailuo-1", "base_resp": {"status_code": 0}}),
        ])
        provider = MiniMaxVideoProvider(api_key="k", client=client)
        submission = asyncio.run(provider.submit(_hailuo_request()))
        request = client.captured[0]
        self.assertEqual(request["url"], "https://api.minimaxi.com/v1/video_generation")
        self.assertEqual(request["json"], {
            "model": "MiniMax-Hailuo-2.3",
            "prompt": "霓虹雨夜的赛博都市街景",
            "duration": 6,
            "resolution": "768P",
        })
        self.assertEqual(submission.provider_task_id, "hailuo-1")


class RetrieveTests(unittest.TestCase):
    def test_hailuo_v1_query_and_file_retrieve(self):
        client = _capture_client([
            httpx.Response(200, json={
                "task_id": "hailuo-1",
                "status": "Success",
                "file_id": "file-1",
                "base_resp": {"status_code": 0},
            }),
            httpx.Response(200, json={
                "file": {"file_id": "file-1", "download_url": "https://cdn.example.com/out.mp4"},
                "base_resp": {"status_code": 0},
            }),
        ])
        provider = MiniMaxVideoProvider(api_key="k", client=client)
        snapshot = asyncio.run(provider.retrieve("hailuo-1"))
        self.assertEqual(client.captured[0]["url"], "https://api.minimaxi.com/v1/query/video_generation")
        self.assertEqual(client.captured[0]["params"], {"task_id": "hailuo-1"})
        self.assertEqual(client.captured[1]["params"], {"file_id": "file-1"})
        self.assertEqual(snapshot.status, VideoTaskStatus.SUCCEEDED)
        self.assertEqual(snapshot.video_url, "https://cdn.example.com/out.mp4")

    def test_query_url_and_success_snapshot(self):
        client = _capture_client([
            httpx.Response(200, json={
                "status": "succeed",
                "content": {"url": "https://cdn.example.com/out.mp4"},
                "base_resp": {"status_code": 0},
            }),
        ])
        provider = MiniMaxVideoProvider(api_key="k", client=client, base_url="https://minimax.test/v2")
        snapshot = asyncio.run(provider.retrieve("mm-1"))
        self.assertIn("/query/video_generation/mm-1", client.captured[0]["url"])
        self.assertEqual(snapshot.status, VideoTaskStatus.SUCCEEDED)
        self.assertEqual(snapshot.video_url, "https://cdn.example.com/out.mp4")

    def test_failed_status_carries_base_resp_error(self):
        client = _capture_client([
            httpx.Response(200, json={
                "status": "failed",
                "base_resp": {"status_code": 1004, "status_msg": "invalid api key"},
            }),
        ])
        provider = MiniMaxVideoProvider(api_key="k", client=client, base_url="https://minimax.test/v2")
        snapshot = asyncio.run(provider.retrieve("mm-1"))
        self.assertEqual(snapshot.status, VideoTaskStatus.FAILED)
        self.assertEqual(snapshot.error_code, "1004")
        self.assertIn("invalid api key", snapshot.error_message or "")


if __name__ == "__main__":
    unittest.main()
