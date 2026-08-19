from pathlib import Path
import json
import sqlite3

from session_memory import SessionStore


CHAT = Path('frontend/ai-agent/src/components/ChatInterface.tsx')
WRITING = Path('frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx')
API = Path('frontend/ai-agent/src/lib/api.ts')


def test_writing_session_state_is_flushed_and_global_restore_is_disabled():
    chat = CHAT.read_text(encoding='utf-8')
    writing = WRITING.read_text(encoding='utf-8')

    assert "if (mode === 'writing')" in chat
    assert 'if (!writingWorkspaceState) return;' in chat
    assert 'thesisOutline: writingWorkspaceState.thesisOutline' in chat
    assert "restoreFromSession ? EMPTY_THESIS_OUTLINE : readThesisOutline()" in writing
    assert "if (restoreFromSession) return;" in writing


def test_mcp_trace_is_bound_to_the_assistant_turn_and_request_generation():
    api = API.read_text(encoding='utf-8')
    chat = CHAT.read_text(encoding='utf-8')

    assert 'export type McpTraceItem' in api
    assert 'mcpTrace?: McpTraceItem[]' in api
    assert 'perRoundMcpTraceRef' in chat
    assert 'activeRequestTokenRef' in chat
    assert 'mcpTrace: perRoundMcpTraceRef.current' in chat
    assert 'isLoading && (mcpActive || mcpTrace.length > 0)' in chat


def test_restored_text_is_not_sliced_by_an_unstarted_typewriter():
    chat = CHAT.read_text(encoding='utf-8')

    assert 'answerPacingActive || answerPacedLength > 0' in chat
    assert 'reasonPacingActive || reasonPacedLength > 0' in chat


def test_legacy_research_messages_can_be_recovered_from_the_append_only_ledger(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    session = store.create('research')
    with sqlite3.connect(tmp_path / 'sessions.db') as connection:
        connection.execute(
            'INSERT INTO raw_event_ledger (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)',
            (session.session_id, 'user_input', json.dumps({'text': '研究主题'}), 1),
        )
        # Qwen feedback Step 2 used to record the original query a second
        # time. Recovery must keep one user card while preserving the report.
        connection.execute(
            'INSERT INTO raw_event_ledger (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)',
            (session.session_id, 'user_input', json.dumps({'text': '研究主题'}), 2),
        )
        connection.execute(
            'INSERT INTO raw_event_ledger (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)',
            (session.session_id, 'ai_reply', json.dumps({'text': '# 报告标题\n\n正文'}), 3),
        )
        connection.commit()
    assert store.recover_messages_from_ledger(session.session_id) == [
        {'role': 'user', 'content': '研究主题'},
        {'role': 'assistant', 'content': '# 报告标题\n\n正文'},
    ]


def test_qwen_feedback_event_recovers_as_an_interactive_card(tmp_path):
    store = SessionStore(tmp_path / 'sessions.db')
    session = store.create('research')
    with sqlite3.connect(tmp_path / 'sessions.db') as connection:
        connection.execute(
            'INSERT INTO raw_event_ledger (session_id, event_type, event_data, created_at) VALUES (?, ?, ?, ?)',
            (session.session_id, 'ai_reply', json.dumps({
                'text': '请说明研究范围',
                'type': 'qwen_feedback',
            }), 1),
        )
        connection.commit()
    assert store.recover_messages_from_ledger(session.session_id) == [{
        'role': 'assistant',
        'content': '',
        'type': 'qwen_feedback',
        'feedbackQuestion': '请说明研究范围',
    }]


def test_research_history_recovery_and_stale_snapshot_guard_are_wired():
    backend = Path('main.py').read_text(encoding='utf-8')
    chat = CHAT.read_text(encoding='utf-8')
    assert 'recover_messages_from_ledger' in backend
    assert 'dedupe_consecutive_user_messages' in backend
    assert 'feedback_answer or query' in backend
    assert 'message_type="qwen_feedback"' in backend
    assert 'messagesRef.current = normalizedMessages' in chat
    assert "if (mode === 'research' && snapshotMessages.length === 0) return;" in chat
    assert 'persistResearchMessages(requestSessionId, nextMessages)' in chat
    assert 'message.type === \'qwen_feedback\'' in chat
