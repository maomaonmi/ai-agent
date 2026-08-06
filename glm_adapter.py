"""GLM text/multimodal request contracts and streaming adapter."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from model_settings import ModelSettings


class ChatAttachment(BaseModel):
    type: Literal["image_url", "video_url", "file_url"]
    url: str = Field(min_length=1, max_length=15_000_000)
    name: str = Field(default="", max_length=200)

    @field_validator("url")
    @classmethod
    def safe_url(cls, value: str, info) -> str:
        if value.startswith("https://"):
            return value
        if info.data.get("type") == "image_url" and value.startswith("data:image/") and ";base64," in value:
            return value
        raise ValueError("附件仅支持 HTTPS URL；本地图片可使用 Base64 data URL")


def validate_attachment_mix(attachments: list[ChatAttachment]) -> None:
    kinds = {item.type for item in attachments}
    if len(kinds) > 1:
        raise ValueError("同一次请求不能混合图片、视频和文件")
    if len(attachments) > 10:
        raise ValueError("单次请求最多包含 10 个附件")


def build_user_content(text: str, attachments: list[ChatAttachment]):
    validate_attachment_mix(attachments)
    if not attachments:
        return text
    content: list[dict] = []
    for attachment in attachments:
        content.append({
            "type": attachment.type,
            attachment.type: {"url": attachment.url},
        })
    content.append({"type": "text", "text": text})
    return content


def choose_glm_model(settings: ModelSettings, attachments: list[ChatAttachment]) -> str:
    validate_attachment_mix(attachments)
    return settings.vision_model_id if attachments else settings.text_model_id


def reasoning_from_delta(delta) -> str:
    return str(getattr(delta, "reasoning_content", None) or "")
