"""Conversation-scoped token accounting for built-in HOOK observability.

The accumulator deliberately stores numeric usage only. Prompt/response text,
API keys and provider-specific response objects never cross this boundary.
"""

from __future__ import annotations

import time
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

from .agent_hook_engine import HookContext, HookRegistry, HookType


_CURRENT_TRACKER: ContextVar[Optional["TokenUsageConversation"]] = ContextVar(
    "current_token_usage_tracker", default=None
)


def normalize_usage(usage: Any) -> Dict[str, int]:
    """Normalize OpenAI-compatible usage objects into stable integer fields."""
    if usage is None:
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    def read(*names: str) -> int:
        for name in names:
            value = usage.get(name) if isinstance(usage, dict) else getattr(usage, name, None)
            if value is not None:
                try:
                    return max(0, int(value))
                except (TypeError, ValueError):
                    return 0
        return 0

    prompt = read("prompt_tokens", "input_tokens")
    completion = read("completion_tokens", "output_tokens")
    total = read("total_tokens") or prompt + completion
    return {"prompt_tokens": prompt, "completion_tokens": completion, "total_tokens": total}


def activate_tracker(tracker: "TokenUsageConversation") -> Token:
    return _CURRENT_TRACKER.set(tracker)


def deactivate_tracker(token: Token) -> None:
    _CURRENT_TRACKER.reset(token)


def observe_response(response: Any) -> Dict[str, Any]:
    """Extract and, when a conversation is active, record one model response."""
    usage = {
        "model": str(getattr(response, "model", "") or "unknown"),
        **normalize_usage(getattr(response, "usage", None)),
    }
    tracker = _CURRENT_TRACKER.get()
    if tracker is not None:
        tracker.record(
            model=usage["model"],
            prompt_tokens=usage["prompt_tokens"],
            completion_tokens=usage["completion_tokens"],
            total_tokens=usage["total_tokens"],
        )
    return usage


@dataclass
class TokenUsageConversation:
    session_id: Optional[str]
    mode: str
    started_at: float = field(default_factory=time.time)
    _models: Dict[str, Dict[str, int]] = field(default_factory=dict)
    _final_summary: Optional[Dict[str, Any]] = None

    def record(self, *, model: str, prompt_tokens: int = 0, completion_tokens: int = 0, total_tokens: int = 0) -> None:
        model_name = (model or "unknown").strip()[:120] or "unknown"
        normalized = normalize_usage({
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
        })
        bucket = self._models.setdefault(model_name, {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "calls": 0,
        })
        for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
            bucket[key] += normalized[key]
        bucket["calls"] += 1

    def finalize(self, memory_engine: Any) -> Dict[str, Any]:
        if self._final_summary is not None:
            return self._final_summary
        ended_at = time.time()
        models = {name: dict(values) for name, values in self._models.items()}
        summary: Dict[str, Any] = {
            "mode": self.mode,
            "models": models,
            "total_tokens": sum(item["total_tokens"] for item in models.values()),
            "started_at": self.started_at,
            "ended_at": ended_at,
            "duration_ms": max(0, int((ended_at - self.started_at) * 1000)),
        }
        if self.session_id:
            memory_engine.record_event(self.session_id, "token_usage", summary, chat_mode=True)
        for model, values in models.items():
            memory_engine.accumulate_token_usage(
                model=model,
                prompt_tokens=values["prompt_tokens"],
                completion_tokens=values["completion_tokens"],
                total_tokens=values["total_tokens"],
                session_id=self.session_id,
            )
        self._final_summary = summary
        return summary


def install_token_usage_hooks(registry: HookRegistry, memory_engine: Any) -> None:
    """Install conversation start/end hooks once on the shared registry."""
    registered = {item["id"] for item in registry.list_hooks()}
    if "token_usage_conversation_start" not in registered:

        @registry.register(
            HookType.ON_CONVERSATION_START,
            hook_id="token_usage_conversation_start",
            name="模型 Token 用量开始统计",
            priority=10,
            policy="observe",
        )
        def token_usage_start(ctx: HookContext) -> None:
            ctx.data["token_usage_tracker"] = TokenUsageConversation(
                session_id=ctx.session_id or None,
                mode=str(ctx.data.get("mode", "standard")),
            )

    if "token_usage_conversation_end" not in registered:

        @registry.register(
            HookType.ON_CONVERSATION_END,
            hook_id="token_usage_conversation_end",
            name="模型 Token 用量结束累计",
            priority=10,
            policy="observe",
        )
        def token_usage_end(ctx: HookContext) -> None:
            tracker = ctx.data.get("token_usage_tracker")
            if isinstance(tracker, TokenUsageConversation):
                tracker.finalize(memory_engine)
