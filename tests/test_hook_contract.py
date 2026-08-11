import json

from HOOK.hook_contract import (
    HookEvent,
    HookEventStatus,
    HookLifecycle,
    diff_payload,
    sanitize_payload,
)


def test_hook_event_serializes_with_stable_run_identity_and_status():
    event = HookEvent(
        event="completed",
        hook_id="pii_masking",
        hook_name="PII 脱敏",
        lifecycle=HookLifecycle.BEFORE_LLM_CALL,
        session_id="session-1",
        agent_run_id="run-1",
        sequence=3,
        timestamp_ms=123,
        duration_ms=4,
        status=HookEventStatus.CHANGED,
        summary="检测到手机号并完成脱敏",
    )

    payload = json.loads(json.dumps(event.to_dict(), ensure_ascii=False))

    assert payload["type"] == "hook_event"
    assert payload["lifecycle"] == "before_llm_call"
    assert payload["status"] == "changed"
    assert payload["agent_run_id"] == "run-1"
    assert payload["sequence"] == 3


def test_sanitize_payload_redacts_secrets_and_does_not_emit_full_prompt():
    payload = sanitize_payload(
        {
            "prompt": "请处理这段很长的用户输入",
            "api_key": "sk-secret",
            "nested": {"token": "bearer-secret", "safe": "ok"},
        }
    )

    assert payload["prompt"] == {"present": True, "length": 12}
    assert payload["api_key"] == "[REDACTED]"
    assert payload["nested"]["token"] == "[REDACTED]"
    assert payload["nested"]["safe"] == "ok"


def test_diff_payload_returns_field_level_changes_without_values():
    before = {"prompt": "原始手机号 13812345678", "command": "echo ok"}
    after = {"prompt": "原始手机号 [已脱敏]", "command": "echo ok"}

    diff = diff_payload(before, after)

    assert diff == {"prompt": {"changed": True}}
