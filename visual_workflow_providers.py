"""HTTP adapters used by visual workflow image nodes.

The existing image studio has a larger route-oriented implementation.  This
module exposes the smaller provider contract needed by a DAG executor, keeps
credentials server-side, and validates every third-party response before it is
returned as a workflow artifact.
"""

from __future__ import annotations

import asyncio
import base64
from typing import Any, Mapping
from urllib.parse import urlparse

import httpx


class WorkflowImageProviderError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class WorkflowVisionProviderError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class HttpImageProvider:
    def __init__(
        self,
        api_keys: Mapping[str, str],
        *,
        client: httpx.AsyncClient | None = None,
        qwen_base_url: str = "https://dashscope.aliyuncs.com",
        zhipu_base_url: str = "https://open.bigmodel.cn/api/paas/v4",
        image_poll_interval_seconds: float = 2.0,
        max_image_polls: int = 150,
        request_timeout_seconds: float = 300.0,
    ):
        self.api_keys = {key: value for key, value in api_keys.items() if value}
        self.client = client
        self.qwen_base_url = qwen_base_url.rstrip("/")
        self.zhipu_base_url = zhipu_base_url.rstrip("/")
        self.image_poll_interval_seconds = max(0.0, float(image_poll_interval_seconds))
        self.max_image_polls = max(1, int(max_image_polls))
        self.request_timeout_seconds = max(10.0, float(request_timeout_seconds))

    async def generate(
        self,
        *,
        model: str,
        prompt: str,
        ratio: str,
        count: int,
        references: list[str],
        negative_prompt: str | None = None,
    ) -> list[str]:
        provider = "zhipu" if model.startswith(("cogview", "glm-image")) else "qwen"
        api_key = self.api_keys.get(provider)
        if not api_key:
            raise WorkflowImageProviderError("PROVIDER_NOT_CONFIGURED", f"未配置{provider}图片服务 API Key")
        if provider == "zhipu":
            if references:
                raise WorkflowImageProviderError("MODEL_UNSUPPORTED_REFERENCE", "当前智谱图片模型不支持多参考图输入")
            body = {
                "model": "cogView-4-250304" if model.startswith("cogview") else model,
                "prompt": prompt,
                "size": self._size(ratio),
            }
            response = await self._post(
                f"{self.zhipu_base_url}/images/generations",
                headers={"Authorization": f"Bearer {api_key}"},
                json=body,
            )
            payload = self._payload(response)
            urls = [str(item.get("url")) for item in payload.get("data", []) if isinstance(item, dict) and item.get("url")]
        else:
            content: list[dict[str, str]] = [{"text": prompt}]
            for url in references:
                content.append({"image": await self._normalize_image_input(url)})
            if model.startswith("wan2.7-image"):
                return await self._generate_qwen_wan27(
                    api_key=api_key,
                    model=model,
                    content=content,
                    ratio=ratio,
                    count=count,
                )
            body: dict[str, Any] = {
                "model": model,
                "input": {"messages": [{"role": "user", "content": content}]},
                "parameters": {"prompt_extend": True, "size": self._size(ratio).replace("x", "*"), "n": max(1, min(6, count)), "watermark": False},
            }
            if negative_prompt:
                body["parameters"]["negative_prompt"] = negative_prompt
            response = await self._post(
                f"{self.qwen_base_url}/api/v1/services/aigc/multimodal-generation/generation",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=body,
            )
            payload = self._payload(response)
            urls = [
                str(item.get("image"))
                for choice in payload.get("output", {}).get("choices", [])
                for item in choice.get("message", {}).get("content", [])
                if isinstance(item, dict) and item.get("image")
            ]
        validated = [self._public_url(url) for url in urls]
        return validated[: max(1, min(6, count))]

    async def _generate_qwen_wan27(
        self,
        *,
        api_key: str,
        model: str,
        content: list[dict[str, str]],
        ratio: str,
        count: int,
    ) -> list[str]:
        """Submit and poll Wan 2.7 Image using DashScope's async contract."""
        parameters = {
            "thinking_mode": True,
            "size": self._size(ratio).replace("x", "*"),
            "n": max(1, min(6, count)),
            "watermark": False,
        }
        response = await self._post(
            f"{self.qwen_base_url}/api/v1/services/aigc/image-generation/generation",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "X-DashScope-Async": "enable",
            },
            json={
                "model": model,
                "input": {"messages": [{"role": "user", "content": content}]},
                "parameters": parameters,
            },
        )
        payload = self._payload(response)
        output = payload.get("output") if isinstance(payload, dict) else None
        task_id = output.get("task_id") if isinstance(output, dict) else None
        if not task_id:
            raise WorkflowImageProviderError("PROVIDER_RESPONSE_INVALID", "千问图片创建响应缺少 task_id")

        for poll_index in range(self.max_image_polls):
            if poll_index and self.image_poll_interval_seconds:
                await asyncio.sleep(self.image_poll_interval_seconds)
            poll_response = await self._get(
                f"{self.qwen_base_url}/api/v1/tasks/{task_id}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            poll_payload = self._payload(poll_response)
            poll_output = poll_payload.get("output") if isinstance(poll_payload, dict) else None
            if not isinstance(poll_output, dict):
                raise WorkflowImageProviderError("PROVIDER_RESPONSE_INVALID", "千问图片查询响应缺少 output")
            status = str(poll_output.get("task_status") or "UNKNOWN").upper()
            if status in {"FAILED", "CANCELED", "CANCELLED"}:
                code = str(poll_output.get("code") or "PROVIDER_TASK_FAILED")
                message = str(poll_output.get("message") or "千问图片任务执行失败")
                raise WorkflowImageProviderError(code, message)
            if status == "SUCCEEDED":
                urls = [self._public_url(url) for url in self._extract_image_urls(poll_output)]
                if not urls:
                    raise WorkflowImageProviderError("PROVIDER_RESPONSE_INVALID", "千问图片任务完成但未返回图片 URL")
                return urls[: max(1, min(6, count))]

        raise WorkflowImageProviderError("PROVIDER_TIMEOUT", "千问图片任务轮询超时，请稍后在历史任务中查看")

    @staticmethod
    def _extract_image_urls(output: Mapping[str, Any]) -> list[str]:
        urls: list[str] = []
        choices = output.get("choices")
        if isinstance(choices, list):
            for choice in choices:
                content = choice.get("message", {}).get("content", []) if isinstance(choice, dict) else []
                if isinstance(content, list):
                    urls.extend(str(item["image"]) for item in content if isinstance(item, dict) and item.get("image"))
        for key in ("images", "results"):
            items = output.get(key)
            if isinstance(items, list):
                urls.extend(
                    str(item.get("url") or item.get("image"))
                    for item in items
                    if isinstance(item, dict) and (item.get("url") or item.get("image"))
                )
        return urls

    async def _normalize_image_input(self, value: str) -> str:
        """Turn local image-plaza URLs into provider-supported data URIs."""
        parsed = urlparse(value)
        if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1"}:
            return value
        if not parsed.path.startswith("/api/image/plaza/assets/"):
            raise WorkflowImageProviderError("INPUT_MEDIA_INVALID", "本地参考图片地址不受支持")
        response = await self._get(value, headers={})
        if response.status_code >= 400:
            raise WorkflowImageProviderError("INPUT_MEDIA_UNAVAILABLE", "本地参考图片读取失败")
        if len(response.content) > 10 * 1024 * 1024:
            raise WorkflowImageProviderError("INPUT_MEDIA_TOO_LARGE", "参考图片不能超过 10MB")
        mime_type = response.headers.get("content-type", "image/png").split(";", 1)[0].strip().lower()
        if mime_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/bmp"}:
            raise WorkflowImageProviderError("INPUT_MEDIA_INVALID", "本地参考文件不是受支持的图片格式")
        encoded = base64.b64encode(response.content).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"

    async def _post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> httpx.Response:
        try:
            if self.client is not None:
                return await self.client.post(url, headers=headers, json=json)
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self.request_timeout_seconds, connect=15.0),
                follow_redirects=False,
            ) as client:
                return await client.post(url, headers=headers, json=json)
        except httpx.TimeoutException as exc:
            raise WorkflowImageProviderError("PROVIDER_TIMEOUT", "图片供应商请求超时，请稍后重试") from exc
        except httpx.HTTPError as exc:
            raise WorkflowImageProviderError("PROVIDER_NETWORK_ERROR", "无法连接图片供应商，请检查网络或服务配置") from exc

    async def _get(self, url: str, *, headers: dict[str, str]) -> httpx.Response:
        try:
            if self.client is not None:
                return await self.client.get(url, headers=headers)
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self.request_timeout_seconds, connect=15.0),
                follow_redirects=False,
            ) as client:
                return await client.get(url, headers=headers)
        except httpx.TimeoutException as exc:
            raise WorkflowImageProviderError("PROVIDER_TIMEOUT", "图片任务查询超时，请稍后重试") from exc
        except httpx.HTTPError as exc:
            raise WorkflowImageProviderError("PROVIDER_NETWORK_ERROR", "无法连接图片任务服务，请检查网络或服务配置") from exc

    @staticmethod
    def _payload(response: httpx.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as exc:
            raise WorkflowImageProviderError("PROVIDER_RESPONSE_INVALID", "图片供应商返回了无效 JSON") from exc
        if response.status_code >= 400:
            code = str(payload.get("code") or payload.get("error_code") or "PROVIDER_REQUEST_FAILED") if isinstance(payload, dict) else "PROVIDER_REQUEST_FAILED"
            message = str(payload.get("message") or payload.get("error") or "图片供应商请求失败") if isinstance(payload, dict) else "图片供应商请求失败"
            if response.status_code in {401, 403}:
                code = "PROVIDER_AUTH_ERROR"
            elif response.status_code == 429:
                code = "PROVIDER_RATE_LIMITED"
            raise WorkflowImageProviderError(code, message)
        if not isinstance(payload, dict):
            raise WorkflowImageProviderError("PROVIDER_RESPONSE_INVALID", "图片供应商返回结构无效")
        return payload

    @staticmethod
    def _size(ratio: str) -> str:
        return {
            "1:1": "1280x1280",
            "4:3": "1472x1088",
            "3:4": "1088x1472",
            "16:9": "1728x960",
            "9:16": "960x1728",
        }.get(ratio, "1280x1280")

    @staticmethod
    def _public_url(value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.netloc:
            raise WorkflowImageProviderError("PROVIDER_RESPONSE_INVALID", "图片供应商返回了不安全的 URL")
        return value


class HttpVisionProvider:
    """OpenAI-compatible vision adapter used by the visual prompt node."""

    def __init__(self, providers: Mapping[str, Mapping[str, str]], *, client: httpx.AsyncClient | None = None):
        self.providers = {name: dict(config) for name, config in providers.items() if config.get("api_key")}
        self.client = client

    async def describe(self, references: list[str], *, instruction: str | None = None) -> str:
        if not references:
            raise WorkflowVisionProviderError("INPUT_REQUIRED", "视觉节点至少需要一张图片")
        prompt = instruction or "请把图片内容转换成可直接用于 AI 视频或图片生成的中文提示词，只输出提示词正文。描述主体、动作、镜头、构图、光线、色彩与风格，不要臆造不可见信息。"
        content: list[dict[str, Any]] = [{"type": "image_url", "image_url": {"url": value}} for value in references]
        content.append({"type": "text", "text": prompt})
        last_error: WorkflowVisionProviderError | None = None
        for provider_name in ("qwen", "zhipu"):
            config = self.providers.get(provider_name)
            if not config:
                continue
            try:
                base_url = str(config.get("base_url") or "").rstrip("/")
                endpoint = base_url if base_url.endswith("/chat/completions") else f"{base_url}/chat/completions"
                response = await self._post(
                    endpoint,
                    headers={"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"},
                    json={"model": config.get("model") or ("qwen3.7-flash" if provider_name == "qwen" else "glm-5v-turbo"), "messages": [{"role": "user", "content": content}], "temperature": 0.2, "max_tokens": 1200},
                )
                payload = self._payload(response)
                choices = payload.get("choices") if isinstance(payload, dict) else None
                message = choices[0].get("message") if isinstance(choices, list) and choices else None
                raw = message.get("content") if isinstance(message, dict) else ""
                if isinstance(raw, list):
                    raw = "".join(str(item.get("text", "")) for item in raw if isinstance(item, dict))
                result = str(raw or "").strip()
                if result:
                    return result[:5000]
                last_error = WorkflowVisionProviderError("PROVIDER_RESPONSE_INVALID", "视觉模型没有返回提示词")
            except WorkflowVisionProviderError as exc:
                last_error = exc
        raise last_error or WorkflowVisionProviderError("PROVIDER_NOT_CONFIGURED", "未配置可用的视觉模型")

    async def _post(self, url: str, *, headers: dict[str, str], json: dict[str, Any]) -> httpx.Response:
        if self.client is not None:
            return await self.client.post(url, headers=headers, json=json)
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0)) as client:
            return await client.post(url, headers=headers, json=json)

    @staticmethod
    def _payload(response: httpx.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError as exc:
            raise WorkflowVisionProviderError("PROVIDER_RESPONSE_INVALID", "视觉供应商返回了无效 JSON") from exc
        if response.status_code >= 400:
            raise WorkflowVisionProviderError("PROVIDER_REQUEST_FAILED", "视觉供应商请求失败")
        if not isinstance(payload, dict):
            raise WorkflowVisionProviderError("PROVIDER_RESPONSE_INVALID", "视觉供应商返回结构无效")
        return payload
