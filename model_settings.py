"""Persistent, validated model-provider settings for the application."""

from __future__ import annotations

import json
import os
from pathlib import Path
from threading import RLock
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ModelSettings(BaseModel):
    provider: Literal["deepseek", "glm", "custom"] = "deepseek"
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
