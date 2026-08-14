from pathlib import Path


ROOT = Path('frontend/ai-agent/src/features/ai-writing')


def test_template_picker_escapes_workspace_clipping_with_portal():
    source = (ROOT / 'layout/WritingTemplatePicker.tsx').read_text(encoding='utf-8')
    assert 'createPortal' in source
    assert 'document.body' in source
    assert 'h-[86vh]' in source
    assert 'z-[200]' in source


def test_template_picker_mounts_portal_only_after_client_hydration():
    source = (ROOT / 'layout/WritingTemplatePicker.tsx').read_text(encoding='utf-8')
    assert 'portalHost' in source
    assert 'useEffect' in source
    assert 'if (!open || !portalHost)' in source


def test_change_template_button_has_a_direct_click_target():
    source = (ROOT / 'layout/WritingLayoutWorkspace.tsx').read_text(encoding='utf-8')
    assert 'data-testid="open-template-picker"' in source
    assert 'type="button"' in source
    assert 'pointer-events-none sticky bottom-5' not in source


def test_document_header_sits_above_scrollable_workspace():
    source = (ROOT / 'WritingWorkspace.tsx').read_text(encoding='utf-8')
    assert 'relative z-40 h-16' in source


def test_header_popovers_have_bounded_scrollable_content():
    manifest = (ROOT / 'layout/WritingFileManifest.tsx').read_text(encoding='utf-8')
    download = (ROOT / 'layout/WritingDownloadMenu.tsx').read_text(encoding='utf-8')
    assert 'max-h-[70vh]' in manifest
    assert 'max-h-[70vh]' in download
