"""MiniMax image-01 图像生成（文生图 + subject_reference 图生图）。

官方协议（spec.md 协议事实表）：
- POST {IMAGE_API_URL}，model=image-01；
- response_format="base64" → data.image_base64[]（避免 URL 回源下载，SSRF 面更小）；
- subject_reference 仅接受公网 https 图片 URL（单张，角色参考）；
- 业务错误在 base_resp.status_code != 0（HTTP 仍可能 200）。
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from .constants import IMAGE_API_URL, IMAGE_MODEL_ID

# image-01 单请求最多出 4 张（官方限制）。
MAX_IMAGE_OUTPUTS = 4
_TIMEOUT_SECONDS = 120.0


@dataclass(frozen=True)
class GeneratedImage:
    """单张生成结果：解码后的字节与探测的 MIME 类型（落盘由调用方负责）。"""

    data: bytes
    mime_type: str


class MiniMaxImageError(RuntimeError):
    """图像生成失败（Key 缺失 / 协议错误 / 供应商业务错误）。"""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _resolve_api_key() -> str:
    # Why: Key 解析与文本链路同源——settings 持久化优先，环境变量兜底，禁止明文回传。
    from model_settings import model_settings_store

    settings = model_settings_store.load("minimax")
    api_key = (settings.api_key or "").strip() or os.getenv("MINIMAX_API_KEY", "")
    if not api_key:
        raise MiniMaxImageError("MiniMax API Key 尚未配置", status_code=503)
    return api_key


def _sniff_mime(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return "image/png"


def _raise_for_base_resp(payload: dict[str, Any]) -> None:
    base_resp = payload.get("base_resp") or {}
    status_code = int(base_resp.get("status_code") or 0)
    if status_code == 0:
        return
    detail = str(base_resp.get("status_msg") or "MiniMax 图像生成失败")
    # Why: 1004+ 为鉴权/额度类错误，映射 503 让前端提示配置问题而非网关错误。
    http_status = 503 if status_code in (1001, 1002, 1004, 1005, 1027) else 502
    raise MiniMaxImageError(f"MiniMax 图像生成失败（{status_code}）：{detail}", status_code=http_status)


async def generate_image(
    prompt: str,
    *,
    aspect_ratio: str = "1:1",
    count: int = 1,
    subject_reference: str | None = None,
) -> list[GeneratedImage]:
    """调用 image-01 生成图片，返回解码后的字节列表。

    Args:
        prompt: 增强后的生成提示词（导演层产出）。
        aspect_ratio: 宽高比，取值与前端 ratio 契约一致（1:1/4:3/3:4/16:9/9:16）。
        count: 生成张数（1-4，超限自动收敛到官方上限）。
        subject_reference: 图生图参考图；仅接受 https URL，其他形式由调用方过滤。

    Raises:
        MiniMaxImageError: Key 缺失（503）/ 请求失败 / base_resp 业务错误。
    """
    payload: dict[str, Any] = {
        "model": IMAGE_MODEL_ID,
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "n": max(1, min(count, MAX_IMAGE_OUTPUTS)),
        "response_format": "base64",
        # Why: 导演层已产出增强提示词，官方 prompt_upsampling 二次改写会破坏导演语义。
        "prompt_upsampling": False,
    }
    if subject_reference and subject_reference.startswith("https://"):
        payload["subject_reference"] = subject_reference

    headers = {"Authorization": f"Bearer {_resolve_api_key()}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        response = await client.post(IMAGE_API_URL, headers=headers, json=payload)
    if response.status_code >= 400:
        raise MiniMaxImageError(f"MiniMax 图片生成请求失败（HTTP {response.status_code}）")
    data = response.json()
    _raise_for_base_resp(data)

    encoded_list = (data.get("data") or {}).get("image_base64") or []
    images: list[GeneratedImage] = []
    for encoded in encoded_list:
        try:
            raw = base64.b64decode(encoded)
        except (ValueError, TypeError) as exc:
            raise MiniMaxImageError("MiniMax 返回的图片数据无法解码") from exc
        if not raw:
            continue
        images.append(GeneratedImage(data=raw, mime_type=_sniff_mime(raw)))
    if not images:
        raise MiniMaxImageError("MiniMax 未返回任何图片")
    return images


def save_image(image: GeneratedImage, *, asset_id: str, batch_dir: Path) -> dict[str, str]:
    """把 base64 生成结果落盘为本地资产，返回与 _download_image 同构的资产 dict。

    Why: image-01 走 response_format=base64 直返字节，无 URL 回源下载环节；
    URL 前缀 /api/image/assets/ 与 main.py 既有资产路由契约一致，调用方只需传目录。
    """
    extension = "jpg" if image.mime_type == "image/jpeg" else "png"
    batch_dir.mkdir(parents=True, exist_ok=True)
    target = batch_dir / f"{asset_id}.{extension}"
    target.write_bytes(image.data)
    return {
        "id": asset_id,
        "url": f"/api/image/assets/{asset_id}",
        "local_path": str(target),
        "mime_type": image.mime_type,
    }
