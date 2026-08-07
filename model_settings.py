"""Persistent, validated model-provider settings for the application."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator


def ensure_direct_connection(base_url: str) -> None:
    """把 base_url 的域名并入 NO_PROXY，使 httpx 客户端直连该端点。

    Why: httpx/openai 客户端默认读取 HTTP_PROXY/HTTPS_PROXY 环境变量；在代理环境下
    国内端点（dashscope/bigmodel/deepseek）被错误代理会抛 ConnectError。客户端均为
    按请求新建，此处幂等更新环境变量后即刻生效，用户无需手工配置。
    """
    host = urlparse((base_url or "").strip()).hostname
    if not host:
        return
    existing = os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or ""
    entries = [item.strip() for item in existing.split(",") if item.strip()]
    if host not in entries:
        entries.append(host)
        os.environ["NO_PROXY"] = ",".join(entries)


@dataclass(frozen=True)
class ProviderCapabilities:
    """供应商/模型能力矩阵——所有能力判断的唯一入口。

    Why: 历史上能力判断靠 `"glm" in model.lower()` 字符串嗅探散布在 App.py/main.py
    各处，每接入一个供应商就要改 N 处。此处收口后，新供应商只需在本映射加规则。
    """

    supports_json_format: bool        # response_format=json_object 是否可靠
    thinking_control: str             # "glm" | "qwen_budget" | "none"
    supports_vision: bool             # 当前模型是否可直接消费多模态附件


def capabilities_for_model(model_id: str) -> ProviderCapabilities:
    """按模型 ID 解析能力。GLM 在 provider 层总有 vision_model_id 兜底，故 supports_vision 恒 True。"""
    name = (model_id or "").lower()
    if "glm" in name:
        # Why: GLM-5-turbo 在 json_object + stream 组合下 content 恒为空，必须禁用。
        return ProviderCapabilities(False, "glm", True)
    if "qwen" in name:
        return ProviderCapabilities(True, "qwen_budget", "vl" in name)
    return ProviderCapabilities(True, "none", False)


# 模型目录：前端 ModelQuickSwitcher / SettingsDialog 的单一数据源（GET /api/settings/model-catalog）。
MODEL_CATALOG: dict[str, list[dict]] = {
    "qwen": [
        {"value": "qwen:qwen3.8-max", "label": "千问 Qwen3.8 Max · 旗舰", "model_id": "qwen3.8-max",
         "supports_vision": False, "thinking_control": "budget", "input_context": 256_000, "output_context": 32_000},
        {"value": "qwen:qwen3.7-plus", "label": "千问 Qwen3.7 Plus · 均衡", "model_id": "qwen3.7-plus",
         "supports_vision": False, "thinking_control": "budget", "input_context": 256_000, "output_context": 16_000},
        {"value": "qwen:qwen3.7-flash", "label": "千问 Qwen3.7 Flash · 性价比", "model_id": "qwen3.7-flash",
         "supports_vision": False, "thinking_control": "budget", "input_context": 256_000, "output_context": 16_000},
        {"value": "qwen:qwen-vl-max", "label": "千问 Qwen-VL Max · 视觉", "model_id": "qwen-vl-max",
         "supports_vision": True, "thinking_control": "none", "input_context": 128_000, "output_context": 8_000},
    ],
    "glm": [
        {"value": "glm:glm-5", "label": "GLM-5", "model_id": "glm-5",
         "supports_vision": False, "thinking_control": "effort", "input_context": 128_000, "output_context": 16_000},
        {"value": "glm:glm-5.1", "label": "GLM-5.1", "model_id": "glm-5.1",
         "supports_vision": False, "thinking_control": "effort", "input_context": 128_000, "output_context": 16_000},
        {"value": "glm:glm-5.2", "label": "GLM-5.2", "model_id": "glm-5.2",
         "supports_vision": False, "thinking_control": "effort", "input_context": 128_000, "output_context": 16_000},
        {"value": "glm:glm-5-turbo", "label": "GLM-5 Turbo", "model_id": "glm-5-turbo",
         "supports_vision": False, "thinking_control": "effort", "input_context": 128_000, "output_context": 16_000},
        {"value": "glm:glm-5v-turbo", "label": "GLM-5V Turbo · 视觉", "model_id": "glm-5v-turbo",
         "supports_vision": True, "thinking_control": "effort", "input_context": 128_000, "output_context": 16_000},
    ],
    "deepseek": [
        {"value": "deepseek:deepseek-chat", "label": "DeepSeek Chat", "model_id": "deepseek-chat",
         "supports_vision": False, "thinking_control": "none", "input_context": 64_000, "output_context": 8_000},
    ],
}


class ModelSettings(BaseModel):
    provider: Literal["deepseek", "glm", "qwen", "custom"] = "deepseek"
    api_format: Literal["openai_chat_completions"] = "openai_chat_completions"
    base_url: str = "https://api.deepseek.com"
    model_id: str = "deepseek-chat"
    api_key: str = ""
    display_name: str = "DeepSeek Chat"
    model_family: str = "default"
    input_context: int = Field(default=64_000, ge=1, le=10_000_000)
    output_context: int = Field(default=8_000, ge=1, le=1_000_000)
    tool_call_rounds: int = Field(default=200, ge=1, le=1_000)
    full_url: bool = False
    multimodal: bool = False
    text_model_id: str = "glm-5-turbo"
    vision_model_id: str = "glm-5v-turbo"
    thinking_enabled: bool = True
    reasoning_effort: str = Field(default="high", max_length=16)
    # Why: 千问思考协议是 enable_thinking + thinking_budget（token 预算），
    # 与 GLM 的 reasoning_effort 档位互不复用，防止参数串协议导致 400。
    thinking_budget: int | None = Field(default=None, ge=256, le=65_536)
    temperature: float = Field(default=1.0, ge=0, le=2)
    max_tokens: int = Field(default=16_000, ge=1, le=65_536)

    @field_validator("reasoning_effort")
    @classmethod
    def validate_reasoning_effort(cls, value: str) -> str:
        value = (value or "high").strip().lower()
        allowed = {"max", "xhigh", "high", "medium", "low", "minimal", "none"}
        if value not in allowed:
            raise ValueError(f"reasoning_effort 必须是 {', '.join(sorted(allowed))} 之一")
        return value

    @field_validator("base_url", "model_id")
    @classmethod
    def required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("该字段不能为空")
        return value.rstrip("/")

    @field_validator("display_name")
    @classmethod
    def display_name_limit(cls, value: str) -> str:
        value = value.strip()
        if len(value) > 32:
            raise ValueError("展示名称不能超过 32 个字符")
        return value

    @field_validator("model_id")
    @classmethod
    def validate_provider_model_id(cls, value: str, info) -> str:
        provider = info.data.get("provider")
        if provider == "glm" and (value != value.lower() or " " in value):
            raise ValueError("GLM 模型 ID 必须使用官方小写标识，例如 glm-5v-turbo")
        return value


class ModelSettingsStore:
    def __init__(self, path: Path | None = None):
        self.path = path or Path(os.getenv(
            "MODEL_SETTINGS_PATH",
            Path(__file__).resolve().parent / "data" / "model_settings.json",
        ))
        self._lock = RLock()

    def _read_document(self) -> dict:
        if not self.path.exists():
            default = ModelSettings(api_key=os.getenv("DEEPSEEK_API_KEY", ""))
            return {"active_provider": "deepseek", "profiles": {"deepseek": default.model_dump()}}
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        if "profiles" not in raw:  # migrate the original single-profile format
            if raw.get("provider") == "glm" and raw.get("model_id") != str(raw.get("model_id", "")).lower().replace(" ", "-"):
                raw["model_id"] = "glm-5v-turbo"
            settings = ModelSettings.model_validate(raw)
            return {"active_provider": settings.provider, "profiles": {settings.provider: settings.model_dump()}}
        return raw

    def load(self, provider: str | None = None) -> ModelSettings:
        with self._lock:
            document = self._read_document()
            selected = provider or document.get("active_provider", "deepseek")
            profile = document.get("profiles", {}).get(selected)
            if profile:
                return ModelSettings.model_validate(profile)
            if selected == "glm":
                return ModelSettings(provider="glm", base_url="https://open.bigmodel.cn/api/paas/v4", model_id="glm-5v-turbo", display_name="GLM-5V Turbo", multimodal=True)
            if selected == "qwen":
                return ModelSettings(provider="qwen", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1", model_id="qwen3.7-plus", display_name="千问 Qwen3.7 Plus", thinking_budget=8_000)
            return ModelSettings(provider=selected)

    def save(self, settings: ModelSettings) -> ModelSettings:
        with self._lock:
            document = self._read_document()
            profiles = document.setdefault("profiles", {})
            existing = profiles.get(settings.provider, {})
            if not settings.api_key and existing.get("api_key"):
                settings.api_key = existing["api_key"]
            profiles[settings.provider] = settings.model_dump()
            document["active_provider"] = settings.provider
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_suffix(".tmp")
            temp.write_text(
                json.dumps(document, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp.replace(self.path)
            return settings

    def public(self, provider: str | None = None) -> dict:
        settings = self.load(provider)
        data = settings.model_dump(exclude={"api_key"})
        data["has_api_key"] = bool(settings.api_key)
        return data
