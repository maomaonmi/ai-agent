from pathlib import Path


ROOT = Path('frontend/ai-agent/src/features/ai-writing')


def test_layout_uses_tiptap_document_editor():
    source = (ROOT / 'layout/WritingDocumentEditor.tsx').read_text(encoding='utf-8')
    assert "@tiptap/react" in source
    assert "@tiptap/starter-kit" in source
    assert 'useEditor' in source
    assert 'EditorContent' in source
    assert 'immediatelyRender: false' in source


def test_editor_has_document_toolbar_and_page_canvas():
    source = (ROOT / 'layout/WritingDocumentEditor.tsx').read_text(encoding='utf-8')
    assert 'writing-editor-toolbar' in source
    assert 'writing-page-canvas' in source
    assert 'toggleHeading' in source
    assert 'toggleBold' in source


def test_layout_workspace_mounts_the_independent_layout_renderer():
    source = (ROOT / 'layout/WritingLayoutWorkspace.tsx').read_text(encoding='utf-8')
    assert 'createLayoutDocument' in source
    assert 'LayoutPageRenderer' in source
    assert 'WritingDocumentEditor' not in source


def test_layout_workspace_has_deterministic_page_count():
    source = (ROOT / 'layout/WritingLayoutWorkspace.tsx').read_text(encoding='utf-8')
    assert 'layoutDocument.pages.length' in source
    assert 'layoutDocument.pageHeight' in source


def test_layout_pages_use_fixed_a4_height_for_full_bleed_templates():
    source = (ROOT / 'layout/WritingLayoutWorkspace.tsx').read_text(encoding='utf-8')
    assert 'height: layoutDocument.pageHeight' in source


def test_editor_does_not_reset_cursor_after_local_updates():
    source = (ROOT / 'layout/WritingDocumentEditor.tsx').read_text(encoding='utf-8')
    assert 'internalUpdateRef' in source
    assert 'sectionsRef' in source
