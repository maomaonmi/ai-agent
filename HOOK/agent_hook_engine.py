"""Lifecycle hook registry used by the Agent runtime.

The module keeps the original teaching/demo hooks, while the registry now
supports deterministic ordering, safe enable/disable metadata and observable
execution events.
"""

from __future__ import annotations

import copy
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

try:  # Supports both ``python -m HOOK.agent_hook_engine`` and direct execution.
    from .hook_contract import HookEvent, HookEventStatus, HookLifecycle, diff_payload
except ImportError:  # pragma: no cover - only used for the standalone demo.
    from hook_contract import HookEvent, HookEventStatus, HookLifecycle, diff_payload


class HookType(str, Enum):
    ON_SESSION_START = "on_session_start"
    BEFORE_LLM_CALL = "before_llm_call"
    AFTER_LLM_CALL = "after_llm_call"
    BEFORE_TOOL_CALL = "before_tool_call"
    AFTER_TOOL_CALL = "after_tool_call"
    ON_ERROR = "on_error"


@dataclass
class HookContext:
    session_id: str
    event_type: HookType
    data: Dict[str, Any] = field(default_factory=dict)
    is_cancelled: bool = False
    cancel_reason: Optional[str] = None
    agent_run_id: str = ""


@dataclass
class HookRegistration:
    hook_id: str
    name: str
    hook_type: HookType
    handler: Callable[[HookContext], None]
    priority: int = 100
    enabled: bool = True
    policy: str = "observe"


class HookRegistry:
    def __init__(self, event_sink: Optional[Callable[[HookEvent], None]] = None):
        self.hooks: Dict[HookType, List[HookRegistration]] = {
            hook_type: [] for hook_type in HookType
        }
        self.event_sink = event_sink
        self._sequences: Dict[str, int] = {}

    def register(
        self,
        hook_type: HookType,
        *,
        hook_id: Optional[str] = None,
        name: Optional[str] = None,
        priority: int = 100,
        enabled: bool = True,
        policy: str = "observe",
    ):
        """Decorator for registering a handler with safe runtime metadata."""

        def decorator(func: Callable[[HookContext], None]):
            self.hooks[hook_type].append(
                HookRegistration(
                    hook_id=hook_id or func.__name__,
                    name=name or func.__name__,
                    hook_type=hook_type,
                    handler=func,
                    priority=priority,
                    enabled=enabled,
                    policy=policy,
                )
            )
            print(
                f"[Hook register] mounted '{func.__name__}' at [{hook_type.value}]"
            )
            return func

        return decorator

    def list_hooks(self) -> List[Dict[str, Any]]:
        """Return metadata suitable for the future management API."""

        registrations = [
            registration
            for items in self.hooks.values()
            for registration in items
        ]
        registrations.sort(key=lambda item: (item.hook_type.value, item.priority, item.hook_id))
        return [
            {
                "id": item.hook_id,
                "name": item.name,
                "lifecycle": item.hook_type.value,
                "enabled": item.enabled,
                "priority": item.priority,
                "policy": item.policy,
            }
            for item in registrations
        ]

    def _emit(self, event: HookEvent) -> None:
        if self.event_sink is None:
            return
        try:
            self.event_sink(event)
        except Exception as exc:
            # Observability must never break the Agent execution path.
            print(f"[Hook observe] event sink failed: {exc}")

    def _next_sequence(self, run_id: str) -> int:
        sequence = self._sequences.get(run_id, 0) + 1
        self._sequences[run_id] = sequence
        return sequence

    def trigger(self, hook_type: HookType, context: HookContext) -> HookContext:
        """Run enabled handlers in priority order and emit safe lifecycle events."""

        registrations = sorted(
            (item for item in self.hooks.get(hook_type, []) if item.enabled),
            key=lambda item: (item.priority, item.hook_id),
        )
        run_id = context.agent_run_id or context.session_id
        for registration in registrations:
            if context.is_cancelled:
                break

            before = copy.deepcopy(context.data)
            started_at = time.perf_counter()
            lifecycle = HookLifecycle(hook_type.value)
            self._emit(
                HookEvent(
                    event="started",
                    hook_id=registration.hook_id,
                    hook_name=registration.name,
                    lifecycle=lifecycle,
                    session_id=context.session_id,
                    agent_run_id=run_id,
                    sequence=self._next_sequence(run_id),
                    timestamp_ms=int(time.time() * 1000),
                    status=HookEventStatus.RUNNING,
                )
            )

            try:
                registration.handler(context)
                changes = diff_payload(before, context.data)
                status = (
                    HookEventStatus.BLOCKED
                    if context.is_cancelled
                    else HookEventStatus.CHANGED
                    if changes
                    else HookEventStatus.PASSED
                )
                event_name = "blocked" if context.is_cancelled else "completed"
                summary = context.cancel_reason or (
                    "Hook changed the payload"
                    if status is HookEventStatus.CHANGED
                    else "Hook completed"
                )
                self._emit(
                    HookEvent(
                        event=event_name,
                        hook_id=registration.hook_id,
                        hook_name=registration.name,
                        lifecycle=lifecycle,
                        session_id=context.session_id,
                        agent_run_id=run_id,
                        sequence=self._next_sequence(run_id),
                        timestamp_ms=int(time.time() * 1000),
                        duration_ms=int((time.perf_counter() - started_at) * 1000),
                        status=status,
                        summary=summary,
                        diff=changes or None,
                        cancel_reason=context.cancel_reason,
                    )
                )
            except Exception as exc:
                if hook_type != HookType.ON_ERROR:
                    context.data["error"] = str(exc)
                self._emit(
                    HookEvent(
                        event="errored",
                        hook_id=registration.hook_id,
                        hook_name=registration.name,
                        lifecycle=lifecycle,
                        session_id=context.session_id,
                        agent_run_id=run_id,
                        sequence=self._next_sequence(run_id),
                        timestamp_ms=int(time.time() * 1000),
                        duration_ms=int((time.perf_counter() - started_at) * 1000),
                        status=HookEventStatus.FAILED,
                        summary=str(exc),
                        error=str(exc),
                    )
                )
        return context


class CoreAgentEngine:
    def __init__(self, hook_registry: HookRegistry):
        self.hooks = hook_registry

    def run_cycle(self, session_id: str, user_prompt: str):
        ctx = HookContext(
            session_id=session_id,
            event_type=HookType.BEFORE_LLM_CALL,
            data={"prompt": user_prompt},
        )
        ctx = self.hooks.trigger(HookType.BEFORE_LLM_CALL, ctx)
        if ctx.is_cancelled:
            return

        tool_ctx = HookContext(
            session_id=session_id,
            event_type=HookType.BEFORE_TOOL_CALL,
            data={"tool_name": "terminal", "command": "rm -rf /workspace/important_data"},
        )
        tool_ctx = self.hooks.trigger(HookType.BEFORE_TOOL_CALL, tool_ctx)
        if tool_ctx.is_cancelled:
            return


global_hook_registry = HookRegistry()


@global_hook_registry.register(
    HookType.BEFORE_LLM_CALL,
    hook_id="pii_masking",
    name="PII 脱敏",
    policy="transform",
)
def pii_masking_hook(ctx: HookContext):
    raw_prompt = ctx.data.get("prompt", "")
    masked_prompt = re.sub(r"1[3-9]\d{9}", "[隐私手机号已自动屏蔽]", raw_prompt)
    if raw_prompt != masked_prompt:
        ctx.data["prompt"] = masked_prompt


@global_hook_registry.register(
    HookType.BEFORE_TOOL_CALL,
    hook_id="command_firewall",
    name="高危命令防火墙",
    policy="block",
)
def command_firewall_hook(ctx: HookContext):
    command = ctx.data.get("command", "")
    for pattern in (r"rm\s+-rf", r"mkfs", r"dd\s+if=", r"shutdown"):
        if re.search(pattern, command):
            ctx.is_cancelled = True
            ctx.cancel_reason = f"Blocked dangerous command matching {pattern}"
            break


if __name__ == "__main__":
    CoreAgentEngine(global_hook_registry).run_cycle(
        "session_001", "我的手机号是 13812345678，请查询账单。"
    )
