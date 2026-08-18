from pathlib import Path


PICTURE_ROOT = (
    Path(__file__).parents[1]
    / "frontend"
    / "ai-agent"
    / "src"
    / "features"
    / "picture"
)
STUDIO = (PICTURE_ROOT / "ImageStudioWorkspace.tsx").read_text(encoding="utf-8")
PLAZA = (PICTURE_ROOT / "ImagePlazaWorkspace.tsx").read_text(encoding="utf-8")


def test_studio_has_reference_upload_and_reference_preview_state():
    assert 'data-testid="reference-image-upload"' in STUDIO
    assert "referenceImage" in STUDIO
    assert "用作参考图" in STUDIO
    assert "setReferenceImage" in STUDIO


def test_studio_image_actions_include_zoom_and_use_as_reference():
    assert 'aria-label="放大图片"' in STUDIO
    assert 'aria-label="用作参考图"' in STUDIO
    assert "setPrompt(batch?.raw_prompt || prompt)" in STUDIO


def test_plaza_cards_can_fill_prompt_and_open_studio_with_reference_asset():
    assert "onUseAsReference" in PLAZA
    assert "setShowStudio(true)" in PLAZA
    assert "initialReferenceImage" in PLAZA
    assert 'aria-label="用作参考图"' in PLAZA

