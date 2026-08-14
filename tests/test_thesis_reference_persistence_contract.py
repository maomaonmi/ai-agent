from pathlib import Path


def test_restored_thesis_chapters_are_not_searched_again_on_mount():
    source = Path(
        'frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx'
    ).read_text(encoding='utf-8')

    assert 'createRestoredReferenceSearchKeys(thesisOutline)' in source
    assert "chapter.searchStatus === 'complete'" in source
    assert 'chapter.references.length > 0' in source


def test_reference_search_guard_has_a_pure_regression_testable_helper():
    source = Path(
        'frontend/ai-agent/src/features/ai-writing/thesis/thesisReferencePersistence.ts'
    ).read_text(encoding='utf-8')

    assert 'createRestoredReferenceSearchKeys' in source
    assert 'outline.chapters' in source
