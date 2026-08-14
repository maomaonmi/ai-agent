from pathlib import Path


def test_writing_timeline_is_restored_from_persisted_document_state():
    workspace = Path(
        'frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx'
    ).read_text(encoding='utf-8')
    persistence = Path(
        'frontend/ai-agent/src/features/ai-writing/writingTimelinePersistence.ts'
    ).read_text(encoding='utf-8')

    assert 'inferBodyArtifactStatus' in persistence
    assert 'inferOutlineArtifactLabel' in persistence
    assert 'inferBodyArtifactStatus(writingDoc)' in workspace
    assert 'inferOutlineArtifactLabel(thesisOutline)' in workspace
    assert '我要基于大纲生成正文' in workspace


def test_restored_word_card_download_does_not_depend_on_blob_url():
    workspace = Path(
        'frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx'
    ).read_text(encoding='utf-8')

    assert "displayedBodyArtifactStatus === 'complete'" in workspace
    assert 'onClick={() => void downloadWritingDocument()}' in workspace


def test_session_restore_prefers_original_writing_instruction_over_last_body_command():
    chat = Path(
        'frontend/ai-agent/src/components/ChatInterface.tsx'
    ).read_text(encoding='utf-8')

    assert 'history.snapshot.writingDraft?.instruction || lastUserMessage' in chat
