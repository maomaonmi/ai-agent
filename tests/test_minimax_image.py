"""minimax/image.py 单测：协议解析 / 错误映射 / MIME 探测 / 落盘契约。

不发起真实网络请求——httpx.AsyncClient 通过 unittest.mock 替身注入。
"""

import asyncio
import base64
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from minimax.image import (
    GeneratedImage,
    MiniMaxImageError,
    generate_image,
    save_image,
    _sniff_mime,
)

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
# 最小合法 IHDR：宽高各 1px（MIME 探测只看文件头，长度不敏感）。
_MINIMAL_PNG = PNG_MAGIC + struct.pack(">I", 13) + b"IHDR" + b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
JPEG_MAGIC = b"\xff\xd8\xff\xe0"


def _fake_client(response_payload: dict, status_code: int = 200):
    """构造 httpx.AsyncClient 替身：post() 返回固定 JSON 响应。"""

    class _Response:
        def __init__(self, payload, status):
            self.status_code = status
            self._payload = payload

        def json(self):
            return self._payload

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, **kwargs):
            self.captured = kwargs
            return _Response(response_payload, status_code)

    return _Client()


class SniffMimeTests(unittest.TestCase):
    def test_png_and_jpeg_headers(self):
        self.assertEqual(_sniff_mime(PNG_MAGIC), "image/png")
        self.assertEqual(_sniff_mime(JPEG_MAGIC), "image/jpeg")
        self.assertEqual(_sniff_mime(b"\x00\x00"), "image/png")


class GenerateImageTests(unittest.TestCase):
    def _run(self, payload, status=200, key="test-key", count=6):
        client = _fake_client(payload, status)
        with patch("minimax.image.httpx.AsyncClient", return_value=client), \
             patch("minimax.image._resolve_api_key", return_value=key):
            images = asyncio.run(generate_image("一只赛博朋克猫", aspect_ratio="16:9", count=count))
        return images, client

    def test_decodes_base64_images_and_limits_n(self):
        encoded = base64.b64encode(_MINIMAL_PNG).decode()
        images, client = self._run({"base_resp": {"status_code": 0}, "data": {"image_base64": [encoded] * 6}}, count=6)
        # Why: count 收敛到官方上限 4，防止超限请求整单失败。
        self.assertEqual(client.captured["json"]["n"], 4)
        self.assertEqual(len(images), 6)  # 响应张数由供应商决定，本例返回 6 张全部解码
        self.assertEqual(images[0].mime_type, "image/png")

    def test_payload_contract_no_prompt_upsampling(self):
        encoded = base64.b64encode(_MINIMAL_PNG).decode()
        _, client = self._run({"base_resp": {"status_code": 0}, "data": {"image_base64": [encoded]}})
        payload = client.captured["json"]
        self.assertEqual(payload["model"], "image-01")
        self.assertEqual(payload["aspect_ratio"], "16:9")
        self.assertFalse(payload["prompt_upsampling"])
        self.assertEqual(payload["response_format"], "base64")
        self.assertNotIn("subject_reference", payload)

    def test_subject_reference_only_for_https(self):
        encoded = base64.b64encode(_MINIMAL_PNG).decode()
        payload_data = {"base_resp": {"status_code": 0}, "data": {"image_base64": [encoded]}}

        async def _call(reference):
            client = _fake_client(payload_data)
            with patch("minimax.image.httpx.AsyncClient", return_value=client), \
                 patch("minimax.image._resolve_api_key", return_value="k"):
                await generate_image("改写", subject_reference=reference)
            return client.captured["json"]

        https_payload = asyncio.run(_call("https://cdn.example.com/a.png"))
        self.assertEqual(https_payload["subject_reference"], "https://cdn.example.com/a.png")
        data_url_payload = asyncio.run(_call("data:image/png;base64,xxxx"))
        self.assertNotIn("subject_reference", data_url_payload)

    def test_base_resp_business_error_maps_to_503_for_auth_quota(self):
        with self.assertRaises(MiniMaxImageError) as ctx:
            self._run({"base_resp": {"status_code": 1004, "status_msg": "invalid api key"}})
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertIn("1004", str(ctx.exception))

    def test_base_resp_business_error_maps_to_502_for_other(self):
        with self.assertRaises(MiniMaxImageError) as ctx:
            self._run({"base_resp": {"status_code": 2049, "status_msg": "content filtered"}})
        self.assertEqual(ctx.exception.status_code, 502)

    def test_empty_image_list_raises(self):
        with self.assertRaises(MiniMaxImageError):
            self._run({"base_resp": {"status_code": 0}, "data": {"image_base64": []}})


class SaveImageTests(unittest.TestCase):
    def test_writes_asset_with_url_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            batch_dir = Path(tmp) / "batch-1"
            image = GeneratedImage(data=_MINIMAL_PNG, mime_type="image/png")
            asset = save_image(image, asset_id="asset-9", batch_dir=batch_dir)
            self.assertEqual(asset["url"], "/api/image/assets/asset-9")
            self.assertTrue(asset["local_path"].endswith("asset-9.png"))
            self.assertEqual(asset["mime_type"], "image/png")
            self.assertTrue(Path(asset["local_path"]).read_bytes().startswith(PNG_MAGIC))

    def test_jpeg_uses_jpg_extension(self):
        with tempfile.TemporaryDirectory() as tmp:
            asset = save_image(
                GeneratedImage(data=JPEG_MAGIC + b"rest", mime_type="image/jpeg"),
                asset_id="a1",
                batch_dir=Path(tmp),
            )
        self.assertTrue(asset["local_path"].endswith("a1.jpg"))


if __name__ == "__main__":
    unittest.main()
