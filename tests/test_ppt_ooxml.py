from __future__ import annotations

import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

from ppt_ooxml import (
    AnimationSpec,
    OoxmlPatchError,
    TransitionSpec,
    patch_presentation,
)


P = "http://schemas.openxmlformats.org/presentationml/2006/main"


def _write_minimal_pptx(path: Path, *, shape_id: int = 7) -> None:
    slide = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="{P}">
  <p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="Title"/></p:nvSpPr></p:sp></p:spTree></p:cSld>
  <p:clrMapOvr/>
  <p:extLst/>
</p:sld>"""
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("ppt/slides/slide1.xml", slide)


def _read_slide(path: Path) -> ET.Element:
    with zipfile.ZipFile(path) as archive:
        return ET.fromstring(archive.read("ppt/slides/slide1.xml"))


def test_patch_adds_transition_before_timing_and_ext_list(tmp_path: Path) -> None:
    source = tmp_path / "source.pptx"
    output = tmp_path / "output.pptx"
    _write_minimal_pptx(source)

    result = patch_presentation(
        source,
        output,
        transitions=[TransitionSpec(slide_number=1, effect="fade", speed="fast")],
        animations=[AnimationSpec(slide_number=1, shape_id=7, effect="fade")],
    )

    root = _read_slide(output)
    children = [child.tag.rsplit("}", 1)[-1] for child in root]
    assert children == ["cSld", "clrMapOvr", "transition", "timing", "extLst"]
    assert root.find(f"{{{P}}}transition/{{{P}}}fade") is not None
    assert result.slides_patched == (1,)
    assert zipfile.ZipFile(output).testzip() is None


def test_patch_adds_fade_animation_for_existing_shape(tmp_path: Path) -> None:
    source = tmp_path / "source.pptx"
    output = tmp_path / "output.pptx"
    _write_minimal_pptx(source, shape_id=12)

    patch_presentation(
        source,
        output,
        animations=[
            AnimationSpec(
                slide_number=1,
                shape_id=12,
                effect="fade",
                trigger="on_click",
                duration_ms=750,
            )
        ],
    )

    root = _read_slide(output)
    effect = root.find(f".//{{{P}}}animEffect")
    target = root.find(f".//{{{P}}}animEffect/{{{P}}}cBhvr/{{{P}}}tgtEl/{{{P}}}spTgt")
    duration = root.find(f".//{{{P}}}animEffect/{{{P}}}cBhvr/{{{P}}}cTn")
    click_node = root.find(f".//{{{P}}}cTn[@nodeType='clickEffect']")
    assert effect is not None and effect.attrib == {"transition": "in", "filter": "fade"}
    assert target is not None and target.attrib["spid"] == "12"
    assert duration is not None and duration.attrib["dur"] == "750"
    assert click_node is not None and click_node.attrib["presetID"] == "10"


def test_patch_rejects_animation_target_that_is_not_on_slide(tmp_path: Path) -> None:
    source = tmp_path / "source.pptx"
    output = tmp_path / "output.pptx"
    _write_minimal_pptx(source, shape_id=3)

    with pytest.raises(OoxmlPatchError, match="shape 99"):
        patch_presentation(
            source,
            output,
            animations=[AnimationSpec(slide_number=1, shape_id=99)],
        )

    assert not output.exists()


def test_patch_rejects_unsafe_zip_member(tmp_path: Path) -> None:
    source = tmp_path / "unsafe.pptx"
    output = tmp_path / "output.pptx"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("../escape.xml", "bad")

    with pytest.raises(OoxmlPatchError, match="unsafe archive member"):
        patch_presentation(source, output)

    assert not output.exists()
