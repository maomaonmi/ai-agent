"""MiniMax-H3 视频生成 Provider（video_engine.VideoProvider 协议实现）。

官方协议（spec.md 协议事实表）：
- 创建：POST {VIDEO_API_BASE}/video_generation，多模态 content[] 结构
  （type ∈ text/image_url/video_url，role ∈ first_frame/last_frame/reference_image/reference_video）；
- 轮询：GET {VIDEO_API_BASE}/query/video_generation/{task_id}（官方推荐 10s 间隔）；
- ratio 规则：t2v/r2v 必填非 adaptive（auto 落默认 16:9）；i2v/首尾帧恒 adaptive；
- resolution：768P / 2K；duration 4–15 整数；
- succeeded 后 task.content.url 即成片地址；业务错误在 base_resp.status_code != 0。

Why 放本包：供应商协议细节（content[] 组装、base_resp 错误面）收敛在 minimax 包，
video_engine.py 仅注册能力条目，main.py 薄实例化（单向依赖，无循环 import）。
"""

from __future__ import annotations

from typing import Any

import httpx

from video_engine import (
    ProviderSubmission,
    ProviderTaskSnapshot,
    VideoGenerationRequest,
    VideoProviderError,
    VideoTaskStatus,
    _error_from_response,
    _json_or_none,
    _map_provider_status,
)

from .constants import VIDEO_API_BASE, VIDEO_MODEL_ID

_DEFAULT_BASE_URL = VIDEO_API_BASE


def _base_resp_error(payload: Any, *, stage: str) -> VideoProviderError | None:
    """MiniMax 业务错误统一出口：HTTP 200 但 base_resp.status_code != 0。"""
    base_resp = (payload or {}).get("base_resp") if isinstance(payload, dict) else None
    if not isinstance(base_resp, dict):
        return None
    code = int(base_resp.get("status_code") or 0)
    if code == 0:
        return None
    message = str(base_resp.get("status_msg") or "MiniMax 视频任务失败")
    return VideoProviderError("PROVIDER_REQUEST_FAILED", f"MiniMax 视频{stage}失败（{code}）：{message}")


class MiniMaxVideoProvider:
    def __init__(self, api_key: str, *, client: httpx.AsyncClient | None = None, base_url: str = _DEFAULT_BASE_URL):
        self.api_key = api_key
        self.client = client or httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
        self.base_url = base_url.rstrip("/")

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    @staticmethod
    def _build_content(request: VideoGenerationRequest) -> list[dict[str, Any]]:
        """统一模型请求 → H3 多模态 content[]。

        t2v：[text]；i2v/首尾帧：[text, first_frame(, last_frame)]；
        r2v：[text, reference_image*/reference_video*]。
        """
        content: list[dict[str, Any]] = [{"type": "text", "text": request.prompt}]
        if request.mode in {"image_to_video", "start_end_video"}:
            content.append({
                "type": "image_url",
                "image_url": {"url": request.first_frame_url},
                "role": "first_frame",
            })
            if request.last_frame_url:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": request.last_frame_url},
                    "role": "last_frame",
                })
        for reference in request.references:
            if reference.media_kind == "reference_video":
                content.append({
                    "type": "video_url",
                    "video_url": {"url": reference.url},
                    "role": "reference_video",
                })
            else:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": reference.url},
                    "role": "reference_image",
                })
        return content

    async def submit(self, request: VideoGenerationRequest) -> ProviderSubmission:
        payload: dict[str, Any] = {
            "model": request.model or VIDEO_MODEL_ID,
            "content": self._build_content(request),
            "duration": request.duration,
            "resolution": request.resolution,
        }
        # Why ratio 规则：官方要求 i2v（含首尾帧）恒 adaptive；t2v/r2v 必须显式非 adaptive，
        # 前端 "auto" 语义在此收敛为 16:9 默认档，保证请求永不携带非法 ratio。
        if request.mode in {"image_to_video", "start_end_video"}:
            payload["ratio"] = "adaptive"
        else:
            payload["ratio"] = request.ratio if request.ratio != "auto" else "16:9"

        response = await self.client.post(f"{self.base_url}/video_generation", headers=self._headers(), json=payload)
        body = _json_or_none(response)
        if response.is_error:
            raise _error_from_response(response, body)
        business_error = _base_resp_error(body, stage="任务创建")
        if business_error:
            raise business_error
        task_id = str((body or {}).get("task_id") or "")
        if not task_id:
            raise VideoProviderError("PROVIDER_RESPONSE_INVALID", "MiniMax 创建响应缺少 task_id")
        return ProviderSubmission(task_id, VideoTaskStatus.PENDING)

    async def retrieve(self, provider_task_id: str) -> ProviderTaskSnapshot:
        response = await self.client.get(
            f"{self.base_url}/query/video_generation/{provider_task_id}",
            headers=self._headers(),
        )
        body = _json_or_none(response)
        if response.is_error:
            raise _error_from_response(response, body)
        status_raw = str((body or {}).get("status") or "UNKNOWN")
        # Why: MiniMax 任务失败 = HTTP 200 + status="failed" + base_resp 带业务错误，
        # 必须落 FAILED 快照让轮询层终态收尾；只有 status 缺失且 base_resp 报错
        # （如 key 无效导致查询本身失败）才抛异常。
        if status_raw.upper() == "UNKNOWN":
            business_error = _base_resp_error(body, stage="任务查询")
            if business_error:
                raise business_error
        content = (body or {}).get("content") if isinstance(body, dict) else None
        video_url = (content or {}).get("url") if isinstance(content, dict) else None
        base_resp = (body or {}).get("base_resp") if isinstance(body, dict) else None
        failed = _map_provider_status(status_raw) == VideoTaskStatus.FAILED
        return ProviderTaskSnapshot(
            provider_task_id=provider_task_id,
            status=_map_provider_status(status_raw),
            provider_status=status_raw,
            video_url=video_url,
            error_code=str((base_resp or {}).get("status_code")) if failed else None,
            error_message=str((base_resp or {}).get("status_msg")) if failed else None,
            raw=body if isinstance(body, dict) else None,
        )
