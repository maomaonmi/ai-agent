from __future__ import annotations

from pathlib import Path

import fitz
from PIL import Image

from ppt_template_pipeline import PptTemplatePipeline, TemplatePipelineError


class FakeRuntime:
    def convert_to_pdf(self, source: Path, output_dir: Path, *, timeout_seconds: int = 120) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        target = output_dir / f"{source.stem}.pdf"
        document = fitz.open()
        for number in range(3):
            page = document.new_page(width=960, height=540)
            page.insert_text((60, 100), f"真实页面 {number + 1}", fontsize=32)
        document.save(target)
        document.close()
        return target


def test_pipeline_renders_every_pdf_page_to_preview_and_thumbnail(tmp_path: Path) -> None:
    source = tmp_path / "uploaded.pptx"
    source.write_bytes(b"not a pptx; fake runtime owns conversion")

    result = PptTemplatePipeline(FakeRuntime()).render(source, tmp_path / "rendered")

    assert result.page_count == 3
    assert len(result.pages) == 3
    for page in result.pages:
        assert page.thumbnail_path.is_file()
        assert page.preview_path.is_file()
        assert Image.open(page.thumbnail_path).format == "WEBP"
        assert Image.open(page.preview_path).format == "WEBP"


def test_pipeline_rejects_unsupported_source_before_conversion(tmp_path: Path) -> None:
    source = tmp_path / "uploaded.pdf"
    source.write_bytes(b"pdf")

    try:
        PptTemplatePipeline(FakeRuntime()).render(source, tmp_path / "rendered")
    except TemplatePipelineError as exc:
        assert exc.code == "PPT_TEMPLATE_UNSUPPORTED_FORMAT"
    else:
        raise AssertionError("unsupported upload should fail before conversion")

