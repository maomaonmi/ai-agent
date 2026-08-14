from pathlib import Path


ROOT = Path('frontend/ai-agent/src/features/ai-writing/layout')


def test_template_overlay_does_not_blur_left_sidebar():
    source = (ROOT / 'WritingTemplatePicker.tsx').read_text(encoding='utf-8')
    assert 'backdrop-blur' not in source


def test_layout_renders_all_pages_for_native_wheel_scrolling():
    source = (ROOT / 'WritingLayoutWorkspace.tsx').read_text(encoding='utf-8')
    assert 'layoutDocument.pages.map((layoutPage, index)' in source
    assert 'data-layout-page' in source
    assert 'scrollIntoView' in source


def test_change_template_button_is_sticky_inside_layout_workspace():
    source = (ROOT / 'WritingLayoutWorkspace.tsx').read_text(encoding='utf-8')
    assert 'sticky bottom-5' in source
    assert 'fixed bottom-6' not in source
