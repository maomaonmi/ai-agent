from pathlib import Path


def test_body_workspace_has_editor_toolbar_and_navigation_drawer():
    root = Path('frontend/ai-agent/src/features/ai-writing/thesis')
    body = (root / 'ThesisBodyView.tsx').read_text(encoding='utf-8')
    assert 'WritingEditorToolbar' in body
    assert 'WritingNavigationPanel' in body
    assert 'contentEditable' in body
    assert 'onSectionChange' in body


def test_navigation_panel_has_outline_and_references_tabs():
    source = Path('frontend/ai-agent/src/features/ai-writing/thesis/WritingNavigationPanel.tsx').read_text(encoding='utf-8')
    assert '目录' in source
    assert '参考文献' in source
    assert 'chapter.references' in source
