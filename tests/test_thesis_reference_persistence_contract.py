from pathlib import Path


def test_restored_thesis_chapters_only_skip_search_when_references_exist():
    source = Path(
        'frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx'
    ).read_text(encoding='utf-8')

    assert 'createRestoredReferenceSearchKeys(thesisOutline)' in source
    assert 'chapter.references.length > 0' in source
    assert "chapter.searchStatus === 'complete'" not in source


def test_reference_search_guard_has_a_pure_regression_testable_helper():
    source = Path(
        'frontend/ai-agent/src/features/ai-writing/thesis/thesisReferencePersistence.ts'
    ).read_text(encoding='utf-8')

    assert 'createRestoredReferenceSearchKeys' in source
    assert 'outline.chapters' in source
    assert "chapter.references.length > 0" in source
    assert "searchStatus !== 'idle'" not in source


def test_empty_reference_chapters_are_eligible_for_a_new_search():
    source = Path(
        'frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx'
    ).read_text(encoding='utf-8')

    assert "if (chapter.references.length > 0)" in source
    assert "chapter.searchStatus === 'complete'" not in source
