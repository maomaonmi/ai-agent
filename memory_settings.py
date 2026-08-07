"""Persistent, validated memory-engine settings for the application.

Why 本模块存在：memory_engine.py 的记忆阈值当前是硬编码模块常量
（SUMMARY_TURN_THRESHOLD / CHAT_SUMMARY_TURN_THRESHOLD 等），前端设置界面
无法调节。本模块提供两套完全独立的记忆画像配置（global 聊天 / code 代码），
持久化到独立 JSON 文件，供设置界面读写与 memory_engine 实时生效。

设计对齐 ModelSettingsStore：Pydantic 校验 + JSON 原子写（tmp+replace）+ RLock，
保持项目配置持久化风格统一。两套画像字段完全一致，仅默认值不同——
global 面向聊天（轮次快、内容短，更灵敏），code 面向代码任务（更长、更保守）。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from threading import RLock

from pydantic import BaseModel, Field


class MemoryProfile(BaseModel):
    """单套记忆画像的全部可调阈值。global 与 code 各持一份（字段一致，默认不同）。"""

    summary_turn_threshold: int = Field(default=8, ge=1, le=1000,
                                        description="未摘要轮数（ai_reply 事件数）达到即触发摘要压缩")
    summary_token_threshold: int = Field(default=6000, ge=100, le=10_000_000,
                                         description="未摘要内容估算 token 超过即触发摘要压缩")
    window_k: int = Field(default=6, ge=1, le=200,
                          description="L4 滑动窗口保留的轮/条数")
    event_keep: int = Field(default=500, ge=10, le=1_000_000,
                            description="事件账本每会话保留的最近条数（超量清理）")
    summary_keep: int = Field(default=20, ge=1, le=10_000,
                              description="摘要每会话保留的最近条数（超量清理）")
    keep_recent_events: int = Field(default=4, ge=0, le=500,
                                    description="摘要压缩区间保留的最近事件原文条数")
    fallback_chars: int = Field(default=2000, ge=100, le=1_000_000,
                                description="LLM 压缩失败时降级截断保留的字符数")
    scan_limit: int = Field(default=500, ge=10, le=1_000_000,
                            description="摘要素材扫描的最大事件数")
    profile_inactive_ttl_days: int = Field(default=30, ge=1, le=3650,
                                           description="失效档案卡保留天数（到期清理）")

    @classmethod
    def global_default(cls) -> "MemoryProfile":
        """聊天类（standard/deep/web/research）默认画像：轮次快、内容短，更灵敏。"""
        return cls(
            summary_turn_threshold=5,
            summary_token_threshold=4000,
            window_k=8,
            event_keep=800,
            summary_keep=20,
            keep_recent_events=4,
            fallback_chars=2000,
            scan_limit=500,
            profile_inactive_ttl_days=30,
        )

    @classmethod
    def code_default(cls) -> "MemoryProfile":
        """code 模式默认画像：任务长、内容密，更保守。"""
        return cls(
            summary_turn_threshold=8,
            summary_token_threshold=6000,
            window_k=6,
            event_keep=500,
            summary_keep=20,
            keep_recent_events=4,
            fallback_chars=2000,
            scan_limit=500,
            profile_inactive_ttl_days=30,
        )


class MemorySettings(BaseModel):
    """全局记忆配置：两套独立画像 + 共享的 Token 预算与 VFS 节流参数。"""

    global_memory: MemoryProfile = Field(default_factory=MemoryProfile.global_default)
    code_memory: MemoryProfile = Field(default_factory=MemoryProfile.code_default)
    # ---- 上下文合成 Token 预算（R5，两层共用）----
    profile_token_budget: int = Field(default=500, ge=0, le=100_000)
    summary_token_budget: int = Field(default=800, ge=0, le=100_000)
    window_token_budget: int = Field(default=2000, ge=0, le=500_000)
    # ---- VFS checkpoint 节流（code 模式专属）----
    vfs_min_save_interval: float = Field(default=5.0, ge=0.0, le=3600.0,
                                         description="同会话两次自动 checkpoint 的最小间隔（秒）")
    vfs_max_keep: int = Field(default=10, ge=1, le=10_000,
                              description="单会话最多保留的 checkpoint 数")


class MemorySettingsStore:
    """持久化两套记忆画像到独立 JSON 文件。

    与 ModelSettingsStore 同风格：Pydantic 校验、tmp+replace 原子写、RLock 线程安全。
    """

    def __init__(self, path: Path | None = None):
        self.path = path or Path(os.getenv(
            "MEMORY_SETTINGS_PATH",
            str(Path(__file__).resolve().parent / "data" / "memory_settings.json"),
        ))
        self._lock = RLock()

    def _read_document(self) -> dict:
        if not self.path.exists():
            return MemorySettings().model_dump()
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            # 配置损坏时回退默认，绝不因配置问题阻塞启动。
            return MemorySettings().model_dump()
        if not isinstance(raw, dict) or "global_memory" not in raw:
            # 缺关键字段视为旧格式/损坏，合并默认值而非整体丢弃，保留已存在字段。
            defaults = MemorySettings().model_dump()
            defaults.update(raw or {})
            return defaults
        return raw

    def load(self) -> MemorySettings:
        """读取当前配置（缺失字段自动回退默认，保证字段完整）。"""
        with self._lock:
            return MemorySettings.model_validate(self._read_document())

    def save(self, settings: MemorySettings) -> MemorySettings:
        """原子写配置并返回保存后的实例。"""
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_suffix(".tmp")
            temp.write_text(
                json.dumps(settings.model_dump(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp.replace(self.path)
            return settings

    def public(self) -> dict:
        """返回供前端渲染的完整配置（无敏感字段，全部可展示）。"""
        return self.load().model_dump()
