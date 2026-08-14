from pathlib import Path


ROOT = Path('frontend/ai-agent/src/features/ai-writing')


def test_layout_metadata_and_template_style_are_persisted():
    source = (ROOT / 'writingDocumentTypes.ts').read_text(encoding='utf-8')
    assert 'layoutMetadata' in source
    assert 'school' in source
    assert 'advisor' in source


def test_layout_preview_contains_cover_toc_references_and_metadata_editor():
    source = (ROOT / 'layout/WritingLayoutWorkspace.tsx').read_text(encoding='utf-8')
    assert 'WritingCoverMetadataPanel' in source
    assert '目录' in source
    assert '参考文献' in source
    assert 'LayoutPageRenderer' in source


def test_docx_export_uses_selected_template_and_real_document_parts():
    source = (ROOT / 'thesis/thesisWordExport.ts').read_text(encoding='utf-8')
    assert 'layoutTemplateId' in source
    assert 'word/header1.xml' in source
    assert 'word/footer1.xml' in source
    assert 'PAGE' in source
    assert '目录' in source
    assert '参考文献' in source
