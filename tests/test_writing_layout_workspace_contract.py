from pathlib import Path


ROOT = Path('frontend/ai-agent/src/features/ai-writing')


def test_layout_state_is_persisted_in_writing_document():
    types = (ROOT / 'writingDocumentTypes.ts').read_text(encoding='utf-8')
    assert 'layoutTemplateId' in types
    assert 'layoutStatus' in types


def test_layout_workspace_has_template_picker_and_page_controls():
    workspace = (ROOT / 'layout/WritingLayoutWorkspace.tsx').read_text(encoding='utf-8')
    picker = (ROOT / 'layout/WritingTemplatePicker.tsx').read_text(encoding='utf-8')
    assert '更换模板' in workspace
    assert '100%' in workspace
    assert 'WritingTemplatePicker' in workspace
    assert '全国高校模板' in picker
    assert '国际通用模板' in picker


def test_header_has_file_manifest_and_contextual_download_menu():
    workspace = (ROOT / 'WritingWorkspace.tsx').read_text(encoding='utf-8')
    assert 'WritingFileManifest' in workspace
    assert 'WritingDownloadMenu' in workspace
    assert '我要基于正文排版' in workspace
    assert "writingDoc.view === 'layout'" in workspace


def test_layout_workspace_does_not_receive_body_editor_mutation_callback():
    workspace = (ROOT / 'WritingWorkspace.tsx').read_text(encoding='utf-8')
    assert '<WritingLayoutWorkspace document={writingDoc} onTemplate={applyLayoutTemplate} onMetadata={updateLayoutMetadata}/>' in workspace
    assert 'onSectionsChange={updateLayoutSections}' not in workspace
