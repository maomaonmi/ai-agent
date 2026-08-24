"""Durable PPT template parsing and page rendering.

The market must never manufacture slide previews from a cover image.  This
module is the boundary that turns an uploaded office document into authentic
page rasters: LibreOffice converts the source to PDF, then PyMuPDF rasterizes
each PDF page into a large preview and a small thumbnail.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ppt_runtime import LibreOfficeRuntime, LibreOfficeRuntimeError


MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_PAGES = 200
ALLOWED_EXTENSIONS = frozenset({".pptx", ".potx", ".ppt", ".pot"})


class TemplatePipelineError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class RenderedPage:
    page_number: int
    title: str
    thumbnail_path: Path
    preview_path: Path
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class TemplateRenderResult:
    page_count: int
    width: int
    height: int
    pages: tuple[RenderedPage, ...]


def validate_source_path(source: Path) -> None:
    if source.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise TemplatePipelineError("PPT_TEMPLATE_UNSUPPORTED_FORMAT", "仅支持 PPT、PPTX、POT、POTX 文件")
    if not source.is_file():
        raise TemplatePipelineError("PPT_TEMPLATE_SOURCE_NOT_FOUND", "上传的 PPT 文件不存在")
    if source.stat().st_size > MAX_SOURCE_BYTES:
        raise TemplatePipelineError("PPT_TEMPLATE_TOO_LARGE", "PPT 文件不能超过 100 MB")


class PptTemplatePipeline:
    def __init__(self, runtime: LibreOfficeRuntime | None = None) -> None:
        self.runtime = runtime or LibreOfficeRuntime()

    def render(self, source: Path, output_dir: Path) -> TemplateRenderResult:
        validate_source_path(source)
        output_dir = output_dir.resolve()
        output_dir.mkdir(parents=True, exist_ok=True)
        try:
            pdf_path = self.runtime.convert_to_pdf(source.resolve(), output_dir)
        except LibreOfficeRuntimeError as exc:
            raise TemplatePipelineError(exc.code, str(exc)) from exc
        except OSError as exc:
            raise TemplatePipelineError("LIBREOFFICE_CONVERSION_FAILED", "无法读取 PPT 文件") from exc

        try:
            import fitz  # type: ignore[import-not-found]
        except ImportError as exc:
            raise TemplatePipelineError("PDF_RENDERER_NOT_AVAILABLE", "缺少 PDF 页面渲染组件 PyMuPDF") from exc
        try:
            from PIL import Image  # type: ignore[import-not-found]
        except ImportError as exc:
            raise TemplatePipelineError("IMAGE_RENDERER_NOT_AVAILABLE", "缺少图片编码组件 Pillow") from exc

        try:
            document = fitz.open(pdf_path)
        except Exception as exc:  # fitz raises a few different exception classes
            raise TemplatePipelineError("PPT_PDF_INVALID", "PPT 转换后的预览文件无效") from exc
        try:
            page_count = int(document.page_count)
            if page_count < 1:
                raise TemplatePipelineError("PPT_EMPTY_DOCUMENT", "PPT 中没有可预览的页面")
            if page_count > MAX_PAGES:
                raise TemplatePipelineError("PPT_TOO_MANY_PAGES", "PPT 页面数不能超过 200 页")
            pages: list[RenderedPage] = []
            canvas_width = 0
            canvas_height = 0
            for index in range(page_count):
                page = document.load_page(index)
                text = " ".join(line.strip() for line in page.get_text("text").splitlines() if line.strip())
                title = (text[:80] if text else f"第 {index + 1} 页")
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False, annots=True)
                width, height = int(pixmap.width), int(pixmap.height)
                canvas_width = max(canvas_width, width)
                canvas_height = max(canvas_height, height)
                image = Image.frombytes("RGB", (width, height), pixmap.samples)
                preview = _fit_image(image, max_width=1600, max_height=1000)
                thumbnail = _fit_image(image, max_width=420, max_height=280)
                preview_path = output_dir / f"page-{index + 1:04d}-preview.webp"
                thumbnail_path = output_dir / f"page-{index + 1:04d}-thumbnail.webp"
                preview.save(preview_path, "WEBP", quality=92, method=6)
                thumbnail.save(thumbnail_path, "WEBP", quality=80, method=6)
                pages.append(RenderedPage(index + 1, title, thumbnail_path, preview_path, width, height))
            return TemplateRenderResult(page_count, canvas_width, canvas_height, tuple(pages))
        finally:
            document.close()


def _fit_image(image: Any, *, max_width: int, max_height: int) -> Any:
    width, height = image.size
    scale = min(1.0, max_width / max(width, 1), max_height / max(height, 1))
    if scale >= 1:
        return image
    return image.resize((max(1, round(width * scale)), max(1, round(height * scale))), resample=1)
