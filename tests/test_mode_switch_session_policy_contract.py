from pathlib import Path


def test_new_mode_switches_start_fresh_sessions_except_for_code():
    source = Path(
        'frontend/ai-agent/src/components/ChatInterface.tsx'
    ).read_text(encoding='utf-8')

    assert "const restoreExistingSessionForMode = nextMode === 'code';" in source
    assert 'if (restoreExistingSessionForMode) {' in source
    assert "const target = sessions.find((session) => session.mode === nextMode);" in source
    assert 'startDraftSession(nextMode);' in source


def test_non_code_mode_switch_does_not_open_a_previous_mode_session():
    source = Path(
        'frontend/ai-agent/src/components/ChatInterface.tsx'
    ).read_text(encoding='utf-8')

    assert "if (nextMode === 'code')" in source
    assert source.count('startDraftSession(nextMode);') >= 2
