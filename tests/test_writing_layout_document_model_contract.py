from pathlib import Path


ROOT = Path('frontend/ai-agent/src/features/ai-writing/layout')


def test_layout_document_is_separate_from_writing_document():
    source = (ROOT / 'layoutDocumentTypes.ts').read_text(encoding='utf-8')
    assert 'export interface LayoutDocument' in source
    assert 'LayoutPageKind' in source
    assert "pageSize: 'A4'" in source


def test_layout_factory_builds_cover_toc_body_and_reference_pages():
    source = (ROOT / 'layoutDocumentFactory.ts').read_text(encoding='utf-8')
    assert 'createLayoutDocument' in source
    assert "kind: 'cover'" in source
    assert "kind: 'toc'" in source
    assert 'bodyPages' in source
    assert "kind: 'references'" in source


def test_layout_factory_has_deterministic_body_pagination():
    source = (ROOT / 'layoutDocumentFactory.ts').read_text(encoding='utf-8')
    assert 'BODY_CHAR_LIMIT' in source
    assert 'splitLongParagraph' in source


def test_template_picker_uses_the_same_cover_language_as_layout_renderer():
    source = (ROOT / 'TemplateCoverThumbnail.tsx').read_text(encoding='utf-8')
    assert '本科 / 硕士毕业论文' in source
    assert 'MODERN RESEARCH' in source
    assert 'template.accent' in source


def test_university_templates_use_a_formal_word_style_cover():
    source = (ROOT / 'WritingLayoutWorkspace.tsx').read_text(encoding='utf-8')
    assert 'FormalThesisCover' in source
    assert "template.category === 'university'" in source
    assert '分类号：' in source
    assert '本科/硕士/博士毕业论文' in source
    assert 'border-b border-slate-400' in source


def test_toc_uses_existing_hierarchy_without_duplicate_numbering():
    factory = (ROOT / 'layoutDocumentFactory.ts').read_text(encoding='utf-8')
    workspace = (ROOT / 'WritingLayoutWorkspace.tsx').read_text(encoding='utf-8')
    assert 'createTocBlocks' in factory
    assert 'stripLeadingNumber' in factory
    assert 'isUnnumberedFrontMatter' in factory
    assert 'grid-cols-[auto_1fr_auto]' in workspace
    assert "{index + 1}." not in workspace
