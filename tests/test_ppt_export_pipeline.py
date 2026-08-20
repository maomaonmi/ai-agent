from __future__ import annotations

import shutil
import subprocess
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import pytest

from ppt_ooxml import AnimationSpec, TransitionSpec, patch_presentation
from ppt_runtime import LibreOfficeRuntime


P = "http://schemas.openxmlformats.org/presentationml/2006/main"
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = REPOSITORY_ROOT / "frontend" / "ai-agent"
SMOKE_SCRIPT = FRONTEND_ROOT / "test" / "pptxPipelineSmoke.ts"


def _shape_id_by_name(presentation: Path, name: str) -> int:
    with zipfile.ZipFile(presentation) as archive:
        root = ET.fromstring(archive.read("ppt/slides/slide1.xml"))
    for node in root.iter(f"{{{P}}}cNvPr"):
        if node.attrib.get("name") == name:
            return int(node.attrib["id"])
    raise AssertionError(f"shape named {name!r} was not exported")


def test_generated_pptx_with_effects_renders_to_pdf(tmp_path: Path) -> None:
    node = shutil.which("node")
    runtime = LibreOfficeRuntime()
    if node is None:
        pytest.skip("Node.js is not installed")
    if not runtime.probe().available:
        pytest.skip("LibreOffice is not installed")

    base_pptx = tmp_path / "base.pptx"
    enhanced_pptx = tmp_path / "enhanced.pptx"
    subprocess.run(
        [
            node,
            "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
            "--experimental-strip-types",
            str(SMOKE_SCRIPT),
            str(base_pptx),
        ],
        cwd=FRONTEND_ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
        shell=False,
    )
    shape_id = _shape_id_by_name(base_pptx, "Animated card")

    patch_presentation(
        base_pptx,
        enhanced_pptx,
        transitions=[TransitionSpec(slide_number=1, effect="fade")],
        animations=[AnimationSpec(slide_number=1, shape_id=shape_id, effect="fade")],
    )
    pdf = runtime.convert_to_pdf(enhanced_pptx, tmp_path / "rendered")

    assert pdf.read_bytes().startswith(b"%PDF-")
    assert pdf.stat().st_size > 1_000
