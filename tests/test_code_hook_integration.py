import asyncio
import json

from App import ToolExecutionContext, dispatch_tool
from HOOK.agent_hook_engine import HookContext, HookRegistry, HookType


def test_dispatch_tool_triggers_before_and_after_hooks():
    events = []
    registry = HookRegistry(event_sink=events.append)

    @registry.register(HookType.BEFORE_TOOL_CALL, hook_id="before")
    def before(ctx: HookContext):
        assert ctx.data["tool_name"] == "list_files"

    @registry.register(HookType.AFTER_TOOL_CALL, hook_id="after")
    def after(ctx: HookContext):
        assert ctx.data["tool_name"] == "list_files"
        assert ctx.data["ok"] is True

    review = ToolExecutionContext(
        run_id="run-1",
        session_id="session-1",
        hook_registry=registry,
    )

    result = asyncio.run(dispatch_tool("list_files", json.dumps({}), review))

    assert result["ok"] is True
    assert [event.hook_id for event in events if event.event == "completed"] == ["before", "after"]

