from pathlib import Path


SOURCE = (
    Path(__file__).parents[1]
    / "frontend"
    / "ai-agent"
    / "src"
    / "features"
    / "picture"
    / "ImageStudioWorkspace.tsx"
).read_text(encoding="utf-8")


def test_workspace_exposes_regenerate_action_without_replacing_history():
    assert 'data-testid="regenerate-images"' in SOURCE
    assert "换一换" in SOURCE
    assert "setHistory((current) => [result, ...current.filter" in SOURCE


def test_workspace_flattens_every_history_image_into_selectable_candidates():
    assert "historyCandidates" in SOURCE
    assert ".flatMap((item" in SOURCE
    assert "selectedCandidate" in SOURCE
    assert 'aria-pressed={selectedCandidate?.image.id === image.id}' in SOURCE

