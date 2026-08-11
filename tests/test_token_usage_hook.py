from HOOK.agent_hook_engine import HookContext, HookRegistry, HookType
from HOOK.token_usage_hook import TokenUsageConversation, install_token_usage_hooks
from memory_engine import MemoryEngine
from session_memory import SessionStore


class FakeMemory:
    def __init__(self):
        self.events = []
        self.usage = []

    def record_event(self, session_id, event_type, event_data, chat_mode=False):
        self.events.append((session_id, event_type, event_data, chat_mode))
        return True

    def accumulate_token_usage(self, model, prompt_tokens, completion_tokens, total_tokens, session_id=None):
        self.usage.append((model, prompt_tokens, completion_tokens, total_tokens, session_id))
        return True


def test_token_usage_conversation_aggregates_each_model_without_raw_prompt():
    memory = FakeMemory()
    usage = TokenUsageConversation(session_id="session-123", mode="standard")
    usage.record(model="model-a", prompt_tokens=12, completion_tokens=5, total_tokens=17)
    usage.record(model="model-a", prompt_tokens=3, completion_tokens=2, total_tokens=5)
    usage.record(model="model-b", prompt_tokens=4, completion_tokens=6, total_tokens=10)

    summary = usage.finalize(memory)

    assert summary["total_tokens"] == 32
    assert summary["models"]["model-a"]["prompt_tokens"] == 15
    assert summary["models"]["model-b"]["completion_tokens"] == 6
    assert memory.events[0][1] == "token_usage"
    assert memory.events[0][2]["models"]["model-a"]["calls"] == 2
    assert "raw_prompt" not in str(memory.events[0][2]).lower()
    assert len(memory.usage) == 2


def test_token_usage_finalize_is_idempotent():
    memory = FakeMemory()
    usage = TokenUsageConversation(session_id="session-123", mode="standard")
    usage.record(model="model-a", prompt_tokens=1, completion_tokens=1, total_tokens=2)

    first = usage.finalize(memory)
    second = usage.finalize(memory)

    assert first == second
    assert len(memory.events) == 1


def test_registered_start_and_end_hooks_persist_the_tracker():
    memory = FakeMemory()
    registry = HookRegistry()
    install_token_usage_hooks(registry, memory)
    started = registry.trigger(
        HookType.ON_CONVERSATION_START,
        HookContext(session_id="session-123", event_type=HookType.ON_CONVERSATION_START, data={"mode": "standard"}),
    )
    tracker = started.data["token_usage_tracker"]
    tracker.record(model="model-a", prompt_tokens=2, completion_tokens=3, total_tokens=5)

    registry.trigger(
        HookType.ON_CONVERSATION_END,
        HookContext(
            session_id="session-123",
            event_type=HookType.ON_CONVERSATION_END,
            data={"token_usage_tracker": tracker},
        ),
    )

    assert memory.events[0][1] == "token_usage"
    assert memory.usage[0][0] == "model-a"


def test_memory_engine_accumulates_usage_in_global_profile(tmp_path):
    db_path = tmp_path / "memory.db"
    session = SessionStore(db_path).create("standard", title="token test")
    engine = MemoryEngine(db_path)

    assert engine.accumulate_token_usage("model-a", 10, 4, 14, session_id=session.session_id)
    assert engine.accumulate_token_usage("model-a", 2, 3, 5, session_id=session.session_id)

    usage = engine.get_valid_profile(session.session_id)["token_usage"]["model-a"]
    assert usage == {"prompt_tokens": 12, "completion_tokens": 7, "total_tokens": 19, "calls": 2}
