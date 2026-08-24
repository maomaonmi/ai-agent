"""MiniMax-H3 视频生成 Provider（video_engine.VideoProvider 协议实现）。

MiniMax Hailuo 官方 v1 协议：
- 创建：POST {VIDEO_API_BASE}/video_generation，使用扁平 prompt/model/duration/resolution；
- 轮询：GET {VIDEO_API_BASE}/query/video_generation?task_id=...；
- 成功后通过 file_id 调用 /files/retrieve 获取 download_url；
- 业务错误在 base_resp.status_code != 0。

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

from .constants import VIDEO_API_BASE, VIDEO_MODEL_ID, VIDEO_MODEL_ID_HAILUO

_DEFAULT_BASE_URL = VIDEO_API_BASE

# API 能力目录使用短 ID，MiniMax v1 接口使用官方模型名。
_MODEL_ALIASES = {
    "Hailuo2.3": VIDEO_MODEL_ID_HAILUO,
    "Hailuo 2.3": VIDEO_MODEL_ID_HAILUO,
    "MiniMax-Hailuo-2.3": VIDEO_MODEL_ID_HAILUO,
}
_OFFICIAL_V1_MODELS = {
    "MiniMax-Hailuo-2.3",
    "MiniMax-Hailuo-2.3-Fast",
    "MiniMax-Hailuo-02",
    "T2V-01-Director",
    "T2V-01",
}


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
        normalized_base = base_url.rstrip("/")
        # 旧配置常残留 /v2；官方视频接口已统一在 /v1，避免环境变量把修复覆盖掉。
        if normalized_base == "https://api.minimaxi.com/v2":
            normalized_base = "https://api.minimaxi.com/v1"
        self.base_url = normalized_base
        self._uses_official_v1 = self.base_url.endswith("/v1")

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
        model_id = _MODEL_ALIASES.get(request.model or "", request.model or VIDEO_MODEL_ID)
        # MiniMax v1 的 Hailuo 请求是扁平结构；content[] 是另一套旧/实验协议，
        # 发送给 Hailuo 会得到 invalid params，即使提示词本身完全正确。
        if model_id in _OFFICIAL_V1_MODELS:
            payload: dict[str, Any] = {
                "model": model_id,
                "prompt": request.prompt,
                "duration": request.duration,
                "resolution": request.resolution,
            }
            if request.first_frame_url:
                payload["first_frame_image"] = request.first_frame_url
            if request.last_frame_url:
                payload["last_frame_image"] = request.last_frame_url
        else:
            # 保留尚未迁移的 H3/实验协议分支，避免影响已有自定义适配器。
            payload = {
                "model": model_id,
                "content": self._build_content(request),
                "duration": request.duration,
                "resolution": request.resolution,
            }
        # Hailuo capability 当前仅暴露 text_to_video；其他模型仍走旧适配分支。
        # 旧协议 ratio 规则：i2v（含首尾帧）恒 adaptive，t2v/r2v 使用显式比例。
        if model_id not in _OFFICIAL_V1_MODELS and request.mode in {"image_to_video", "start_end_video"}:
            payload["ratio"] = "adaptive"
        elif model_id not in _OFFICIAL_V1_MODELS:
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
        if self._uses_official_v1:
            response = await self.client.get(
                f"{self.base_url}/query/video_generation",
                headers=self._headers(),
                params={"task_id": provider_task_id},
            )
        else:
            response = await self.client.get(
                f"{self.base_url}/query/video_generation/{provider_task_id}",
                headers=self._headers(),
            )
        body = _json_or_none(response)
        if response.is_error:
            raise _error_from_response(response, body)
        # Why: MiniMax 查询响应 status 在 body.task.status 内（非顶层），需兼容两种格式。
        task_obj = (body or {}).get("task") if isinstance(body, dict) else None
        status_raw = str(
            (task_obj or {}).get("status")
            or (body or {}).get("status")
            or "UNKNOWN"
        )
        if status_raw.upper() == "UNKNOWN":
            import logging
            logging.getLogger(__name__).warning("[minimax][diag] retrieve unknown: task_id=%s http=%s body=%s", provider_task_id, response.status_code, body)
            business_error = _base_resp_error(body, stage="任务查询")
            if business_error:
                raise business_error
        # v1 成功响应返回 file_id，旧协议可能直接返回 content.url；两者都兼容。
        task_obj = (body or {}).get("task") if isinstance(body, dict) else None
        content = (task_obj or {}).get("content") if isinstance(task_obj, dict) else (body or {}).get("content") if isinstance(body, dict) else None
        video_url = (content or {}).get("url") if isinstance(content, dict) else None
        if self._uses_official_v1 and not video_url and status_raw.upper() in {"SUCCESS", "SUCCEEDED"}:
            file_id = (body or {}).get("file_id") if isinstance(body, dict) else None
            if file_id:
                file_response = await self.client.get(
                    f"{self.base_url}/files/retrieve",
                    headers=self._headers(),
                    params={"file_id": file_id},
                )
                file_body = _json_or_none(file_response)
                if file_response.is_error:
                    raise _error_from_response(file_response, file_body)
                file_obj = (file_body or {}).get("file") if isinstance(file_body, dict) else None
                video_url = (file_obj or {}).get("download_url") if isinstance(file_obj, dict) else None
        base_resp = (task_obj or {}).get("base_resp") if isinstance(task_obj, dict) else (body or {}).get("base_resp") if isinstance(body, dict) else None
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
