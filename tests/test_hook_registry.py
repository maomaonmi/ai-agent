from HOOK.agent_hook_engine import HookContext, HookRegistry, HookType
from HOOK.hook_contract import HookEventStatus


def test_registry_runs_enabled_hooks_by_priority_and_emits_change_event():
    events = []
    order = []
    registry = HookRegistry(event_sink=events.append)

    @registry.register(
        HookType.BEFORE_LLM_CALL,
        hook_id="second",
        priority=20,
        policy="observe",
    )
    def second(ctx):
        order.append("second")

    @registry.register(
        HookType.BEFORE_LLM_CALL,
        hook_id="first",
        priority=10,
        policy="transform",
    )
    def first(ctx):
        order.append("first")
        ctx.data["prompt"] = "masked"

    context = registry.trigger(
        HookType.BEFORE_LLM_CALL,
        HookContext("session-1", HookType.BEFORE_LLM_CALL, {"prompt": "raw"}, agent_run_id="run-1"),
    )

    assert order == ["first", "second"]
    assert context.data["prompt"] == "masked"
    completed = [event for event in events if event.event == "completed"]
    assert len(completed) == 2
    assert completed[0].status is HookEventStatus.CHANGED
    assert completed[0].diff == {"prompt": {"changed": True}}
    assert completed[0].agent_run_id == "run-1"
    assert [event.sequence for event in events] == [1, 2, 3, 4]


def test_registry_can_disable_hook_and_exposes_safe_metadata():
    registry = HookRegistry()

    @registry.register(HookType.BEFORE_TOOL_CALL, hook_id="firewall", enabled=False)
    def firewall(ctx):
        ctx.is_cancelled = True

    context = registry.trigger(
        HookType.BEFORE_TOOL_CALL,
        HookContext("session-1", HookType.BEFORE_TOOL_CALL, {"command": "rm -rf /"}),
    )

    assert context.is_cancelled is False
    assert registry.list_hooks() == [
        {
            "id": "firewall",
            "name": "firewall",
            "lifecycle": "before_tool_call",
            "enabled": False,
            "priority": 100,
            "policy": "observe",
        }
    ]


def test_registry_reports_handler_failure_without_blocking_context():
    events = []
    registry = HookRegistry(event_sink=events.append)

    @registry.register(HookType.BEFORE_LLM_CALL, hook_id="broken")
    def broken(ctx):
        raise RuntimeError("boom")

    context = registry.trigger(
        HookType.BEFORE_LLM_CALL,
        HookContext("session-1", HookType.BEFORE_LLM_CALL, {"prompt": "raw"}),
    )

    assert context.is_cancelled is False
    assert context.data["error"] == "boom"
    failed = [event for event in events if event.event == "errored"]
    assert len(failed) == 1
    assert failed[0].status is HookEventStatus.FAILED
