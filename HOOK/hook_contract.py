"""Stable data contracts for observable Agent hooks.

The contract intentionally exposes summaries and field-level changes instead of
raw prompts or complete tool arguments.  It is shared by the hook runtime and
the future SSE/API adapters.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from enum import Enum
from typing import Any, Mapping


class HookLifecycle(str, Enum):
    ON_SESSION_START = "on_session_start"
    ON_CONVERSATION_START = "on_conversation_start"
    ON_CONVERSATION_END = "on_conversation_end"
    BEFORE_LLM_CALL = "before_llm_call"
    AFTER_LLM_CALL = "after_llm_call"
    BEFORE_TOOL_CALL = "before_tool_call"
    AFTER_TOOL_CALL = "after_tool_call"
    ON_ERROR = "on_error"


class HookEventStatus(str, Enum):
    RUNNING = "running"
    PASSED = "passed"
    CHANGED = "changed"
    BLOCKED = "blocked"
    FAILED = "failed"


_SECRET_KEY = re.compile(
    r"(?:api[_-]?key|access[_-]?token|auth(?:orization)?|cookie|password|secret|token)",
    re.IGNORECASE,
)
_SUMMARY_KEY = re.compile(
    r"(?:prompt|raw[_-]?prompt|content|command|tool[_-]?input|arguments?)",
    re.IGNORECASE,
)


def _summary(value: str) -> dict[str, Any]:
    return {"present": bool(value), "length": len(value)}


def sanitize_payload(value: Any, *, key: str | None = None) -> Any:
    """Return a JSON-safe payload with secrets and raw input summarized.

    Keys that look like credentials are replaced entirely.  Prompt/tool-like
    strings retain only presence and length; ordinary short values remain
    readable so the UI can explain a hook without exposing user input.
    """

    if key and _SECRET_KEY.search(key):
        return "[REDACTED]"
    if isinstance(value, Mapping):
        return {str(k): sanitize_payload(v, key=str(k)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_payload(item) for item in value]
    if isinstance(value, str) and key and _SUMMARY_KEY.search(key):
        return _summary(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def diff_payload(before: Mapping[str, Any], after: Mapping[str, Any]) -> dict[str, dict[str, bool]]:
    """Return changed top-level fields without including their values."""

    changed: dict[str, dict[str, bool]] = {}
    for key in before.keys() | after.keys():
        if before.get(key) != after.get(key):
            changed[str(key)] = {"changed": True}
    return changed


@dataclass(slots=True)
class HookEvent:
    event: str
    hook_id: str
    hook_name: str
    lifecycle: HookLifecycle
    session_id: str
    agent_run_id: str
    sequence: int
    timestamp_ms: int
    status: HookEventStatus
    duration_ms: int | None = None
    summary: str = ""
    diff: dict[str, dict[str, bool]] | None = None
    cancel_reason: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["type"] = "hook_event"
        payload["lifecycle"] = self.lifecycle.value
        payload["status"] = self.status.value
        return payload
