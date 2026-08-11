import asyncio
import json

from App import ToolExecutionContext, dispatch_tool, stream_tool_loop
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


def test_stream_tool_loop_triggers_before_and_after_llm_hooks():
    events = []
    registry = HookRegistry(event_sink=events.append)

    @registry.register(HookType.BEFORE_LLM_CALL, hook_id="llm-before")
    def llm_before(ctx: HookContext):
        assert ctx.data["model"] == "test-model"

    @registry.register(HookType.AFTER_LLM_CALL, hook_id="llm-after")
    def llm_after(ctx: HookContext):
        assert ctx.data["has_content"] is True

    class FakeCompletions:
        async def create(self, **kwargs):
            class Message:
                content = "done"
                tool_calls = []

            class Choice:
                message = Message()

            class Response:
                choices = [Choice()]

            return Response()

    class FakeClient:
        chat = type("Chat", (), {"completions": FakeCompletions()})()

    review = ToolExecutionContext(
        run_id="run-llm",
        session_id="session-llm",
        hook_registry=registry,
    )
    envelope, _ = asyncio.run(
        stream_tool_loop(FakeClient(), "test-model", [{"role": "user", "content": "hi"}], review)
    )

    assert envelope["summary"] == "done"
    assert [event.hook_id for event in events if event.event == "completed"] == ["llm-before", "llm-after"]
