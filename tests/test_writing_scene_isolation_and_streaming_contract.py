from pathlib import Path


WORKSPACE = Path('frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx')
CHAT = Path('frontend/ai-agent/src/components/ChatInterface.tsx')


def test_non_thesis_scene_does_not_render_thesis_timeline():
    source = WORKSPACE.read_text(encoding='utf-8')
    assert "draft.scene === 'thesis'" in source
    assert 'data-thesis-timeline' in source
    assert 'data-standard-writing-timeline' in source
    assert 'stored?.scene === scene' in source


def test_standard_writing_forwards_real_stream_tokens_to_workspace():
    workspace = WORKSPACE.read_text(encoding='utf-8')
    chat = CHAT.read_text(encoding='utf-8')
    assert 'onStreamToken' in workspace
    assert 'onStreamToken(token)' in chat
    assert 'setWritingSessionRestore({' not in chat[chat.index('const submitWritingDraft'):chat.index('const handleThesisBodyRequest')]


def test_new_and_deleted_writing_sessions_clear_all_global_draft_keys():
    source = CHAT.read_text(encoding='utf-8')
    for key in ('ai-writing-draft-v1', 'ai-writing-document-v2', 'ai-writing-submitted-instruction-v1', 'ai-writing-thesis-outline-v1'):
        assert source.count(key) >= 2
