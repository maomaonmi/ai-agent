from pathlib import Path


def test_every_writing_scene_uses_the_same_body_editor_workspace():
    workspace = Path(
        "frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx"
    ).read_text(encoding="utf-8")

    assert "draft.scene !== 'thesis' && <article" not in workspace
    assert workspace.count("<ThesisBodyView") >= 2
    assert "showNavigation={false}" in workspace
    assert "showGenerationControls={false}" in workspace


def test_shared_body_editor_can_hide_thesis_only_controls():
    editor = Path(
        "frontend/ai-agent/src/features/ai-writing/thesis/ThesisBodyView.tsx"
    ).read_text(encoding="utf-8")

    assert "showNavigation?: boolean" in editor
    assert "showGenerationControls?: boolean" in editor
    assert "showNavigation &&" in editor
    assert "showGenerationControls &&" in editor
