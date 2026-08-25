"""Versioned domain contract for editable AI PowerPoint documents."""

from __future__ import annotations

import copy
from datetime import UTC, datetime
from typing import Annotated, Any, Literal, Union
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, model_validator


Identifier = Annotated[
    str,
    Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$"),
]
HexColor = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


class ContractModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        extra="forbid",
        populate_by_name=True,
        validate_assignment=True,
    )


class CanvasSize(ContractModel):
    width: Annotated[float, Field(gt=0, le=100)]
    height: Annotated[float, Field(gt=0, le=100)]


class ThemeColors(ContractModel):
    background: HexColor
    surface: HexColor
    text: HexColor
    muted_text: HexColor
    accent1: HexColor
    accent2: HexColor


class ThemeFonts(ContractModel):
    heading: Annotated[str, Field(min_length=1, max_length=128)]
    body: Annotated[str, Field(min_length=1, max_length=128)]
    mono: Annotated[str, Field(min_length=1, max_length=128)]


class PresentationTheme(ContractModel):
    name: Annotated[str, Field(min_length=1, max_length=128)]
    colors: ThemeColors
    fonts: ThemeFonts


class SolidBackground(ContractModel):
    type: Literal["SOLID"]
    color: HexColor


class GradientStop(ContractModel):
    offset: Annotated[float, Field(ge=0, le=1)]
    color: HexColor


class GradientBackground(ContractModel):
    type: Literal["GRADIENT"]
    angle: Annotated[float, Field(ge=0, le=360)]
    stops: Annotated[list[GradientStop], Field(min_length=2, max_length=8)]

    @model_validator(mode="after")
    def validate_stop_order(self) -> "GradientBackground":
        offsets = [stop.offset for stop in self.stops]
        if offsets != sorted(offsets):
            raise ValueError("gradient stops must be ordered")
        return self


class ImageBackground(ContractModel):
    type: Literal["IMAGE"]
    asset_id: Identifier
    opacity: Annotated[float, Field(ge=0, le=1)]
    fit: Literal["COVER", "CONTAIN", "STRETCH"]


SlideBackground = Annotated[
    Union[SolidBackground, GradientBackground, ImageBackground],
    Field(discriminator="type"),
]


class BaseElement(ContractModel):
    id: Identifier
    x: Annotated[float, Field(ge=0, le=1)]
    y: Annotated[float, Field(ge=0, le=1)]
    width: Annotated[float, Field(gt=0, le=1)]
    height: Annotated[float, Field(gt=0, le=1)]
    rotation: Annotated[float, Field(ge=-360, le=360)]
    z_index: Annotated[int, Field(ge=0, le=100_000)]
    opacity: Annotated[float, Field(ge=0, le=1)]
    is_locked: bool
    is_hidden: bool

    @model_validator(mode="after")
    def validate_normalized_bounds(self) -> "BaseElement":
        epsilon = 1e-9
        if self.x + self.width > 1 + epsilon or self.y + self.height > 1 + epsilon:
            raise ValueError("element geometry must remain inside normalized canvas")
        return self


class TextStyle(ContractModel):
    font_family: Annotated[str, Field(min_length=1, max_length=128)]
    font_size: Annotated[float, Field(gt=0, le=400)]
    color: HexColor
    bold: bool
    italic: bool
    underline: bool
    align: Literal["LEFT", "CENTER", "RIGHT", "JUSTIFY"]
    vertical_align: Literal["TOP", "MIDDLE", "BOTTOM"]


class TextElement(BaseElement):
    type: Literal["TEXT"]
    text: Annotated[str, Field(max_length=100_000)]
    style: TextStyle


class ImageElement(BaseElement):
    type: Literal["IMAGE"]
    asset_id: Identifier
    alt: Annotated[str, Field(max_length=1_000)]
    fit: Literal["COVER", "CONTAIN", "STRETCH"]


class ShapeElement(BaseElement):
    type: Literal["SHAPE"]
    shape_type: Literal["RECT", "ROUND_RECT", "ELLIPSE", "TRIANGLE", "LINE", "CHEVRON"]
    fill: HexColor
    stroke: HexColor
    stroke_width: Annotated[float, Field(ge=0, le=100)]


class TableCell(ContractModel):
    text: Annotated[str, Field(max_length=20_000)]
    fill: HexColor | None = None


class TableElement(BaseElement):
    type: Literal["TABLE"]
    rows: Annotated[list[list[TableCell]], Field(min_length=1, max_length=1_000)]
    border_color: HexColor

    @model_validator(mode="after")
    def validate_rectangular_table(self) -> "TableElement":
        column_counts = {len(row) for row in self.rows}
        if not column_counts or 0 in column_counts or len(column_counts) != 1:
            raise ValueError("table rows must contain the same non-zero number of cells")
        if next(iter(column_counts)) > 50:
            raise ValueError("table contains too many columns")
        return self


class ChartSeries(ContractModel):
    name: Annotated[str, Field(min_length=1, max_length=500)]
    values: Annotated[list[float], Field(min_length=1, max_length=1_000)]
    color: HexColor | None = None


class ChartElement(BaseElement):
    type: Literal["CHART"]
    chart_type: Literal["BAR", "LINE", "PIE", "DOUGHNUT", "AREA"]
    categories: Annotated[list[str], Field(min_length=1, max_length=1_000)]
    series: Annotated[list[ChartSeries], Field(min_length=1, max_length=50)]
    show_legend: bool

    @model_validator(mode="after")
    def validate_series_lengths(self) -> "ChartElement":
        expected = len(self.categories)
        if any(len(series.values) != expected for series in self.series):
            raise ValueError("chart series values must align with categories")
        return self


class MediaElement(BaseElement):
    type: Literal["MEDIA"]
    media_type: Literal["AUDIO", "VIDEO", "ONLINE"]
    asset_id: Identifier | None = None
    url: Annotated[str, Field(max_length=2_048)] | None = None
    poster_asset_id: Identifier | None = None

    @model_validator(mode="after")
    def validate_media_source(self) -> "MediaElement":
        if self.media_type == "ONLINE":
            if not self.url:
                raise ValueError("online media requires a URL")
            parsed = urlparse(self.url)
            if parsed.scheme != "https" or not parsed.netloc:
                raise ValueError("online media URL must use HTTPS")
            if self.asset_id is not None:
                raise ValueError("online media cannot also reference a local asset")
        elif self.asset_id is None or self.url is not None:
            raise ValueError("audio and video require an assetId and no URL")
        return self


class GroupElement(BaseElement):
    type: Literal["GROUP"]
    child_element_ids: Annotated[list[Identifier], Field(min_length=1, max_length=250)]

    @model_validator(mode="after")
    def validate_group_members(self) -> "GroupElement":
        if self.id in self.child_element_ids:
            raise ValueError("a group cannot contain itself")
        if len(self.child_element_ids) != len(set(self.child_element_ids)):
            raise ValueError("group child ids must be unique")
        return self


SlideElement = Annotated[
    Union[
        TextElement,
        ImageElement,
        ShapeElement,
        TableElement,
        ChartElement,
        MediaElement,
        GroupElement,
    ],
    Field(discriminator="type"),
]


class ElementAnimation(ContractModel):
    id: Identifier
    target_element_id: Identifier
    category: Literal["ENTRANCE", "EMPHASIS", "EXIT", "MOTION_PATH"]
    effect: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Z][A-Z0-9_]*$")]
    trigger: Literal["ON_CLICK", "WITH_PREVIOUS", "AFTER_PREVIOUS"]
    order: Annotated[int, Field(ge=0, le=10_000)]
    duration_ms: Annotated[int, Field(ge=1, le=60_000)]
    delay_ms: Annotated[int, Field(ge=0, le=3_600_000)]


class SlideTransition(ContractModel):
    effect: Literal["NONE", "FADE", "DISSOLVE", "PUSH", "WIPE", "MORPH"]
    duration_ms: Annotated[int, Field(ge=0, le=60_000)]
    advance_on_click: bool
    advance_after_ms: Annotated[int, Field(ge=0, le=3_600_000)] | None = None


class SlideDocument(ContractModel):
    id: Identifier
    order: Annotated[int, Field(ge=0, le=10_000)]
    layout_id: Identifier | None = None
    background: SlideBackground
    elements: Annotated[list[SlideElement], Field(max_length=250)]
    animations: Annotated[list[ElementAnimation], Field(max_length=500)]
    transition: SlideTransition | None = None
    notes: Annotated[str, Field(max_length=100_000)] | None = None

    @model_validator(mode="after")
    def validate_element_references(self) -> "SlideDocument":
        element_ids = [element.id for element in self.elements]
        if len(element_ids) != len(set(element_ids)):
            raise ValueError("element ids must be unique within a slide")
        known_ids = set(element_ids)
        for animation in self.animations:
            if animation.target_element_id not in known_ids:
                raise ValueError(f"animation target does not exist: {animation.target_element_id}")
        animation_ids = [animation.id for animation in self.animations]
        if len(animation_ids) != len(set(animation_ids)):
            raise ValueError("animation ids must be unique within a slide")
        for element in self.elements:
            if isinstance(element, GroupElement):
                missing = set(element.child_element_ids) - known_ids
                if missing:
                    raise ValueError(f"group references missing elements: {sorted(missing)}")
        return self


class PresentationMetadata(ContractModel):
    template_id: Identifier | None = None
    language: Annotated[str, Field(min_length=2, max_length=35, pattern=r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")]
    created_at: str
    updated_at: str

    @model_validator(mode="after")
    def validate_timestamps(self) -> "PresentationMetadata":
        def parse(value: str) -> datetime:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))

        try:
            created = parse(self.created_at)
            updated = parse(self.updated_at)
        except ValueError as exc:
            raise ValueError("metadata timestamps must be ISO-8601") from exc
        if updated < created:
            raise ValueError("updatedAt cannot precede createdAt")
        return self


class PresentationDocument(ContractModel):
    schema_version: Literal[1]
    presentation_id: Identifier
    revision: Annotated[int, Field(ge=0)]
    title: Annotated[str, Field(min_length=1, max_length=500)]
    aspect_ratio: Literal["16:9", "4:3", "CUSTOM"]
    canvas: CanvasSize
    theme: PresentationTheme
    slides: Annotated[list[SlideDocument], Field(min_length=1, max_length=200)]
    metadata: PresentationMetadata

    @model_validator(mode="after")
    def validate_slide_identity_and_order(self) -> "PresentationDocument":
        ids = [slide.id for slide in self.slides]
        if len(ids) != len(set(ids)):
            raise ValueError("slide ids must be unique")
        orders = [slide.order for slide in self.slides]
        if orders != list(range(len(self.slides))):
            raise ValueError("slide order must be contiguous and match array order")
        expected_ratio = self.canvas.width / self.canvas.height
        if self.aspect_ratio == "16:9" and abs(expected_ratio - (16 / 9)) > 0.01:
            raise ValueError("canvas does not match 16:9 aspect ratio")
        if self.aspect_ratio == "4:3" and abs(expected_ratio - (4 / 3)) > 0.01:
            raise ValueError("canvas does not match 4:3 aspect ratio")
        return self


class UnsupportedPresentationSchema(ValueError):
    code = "PPT_SCHEMA_UNSUPPORTED"

    def __init__(self, version: object) -> None:
        super().__init__(f"unsupported presentation schema version: {version!r}")
        self.version = version


def _default_theme() -> dict[str, object]:
    return {
        "name": "Default",
        "colors": {
            "background": "#FFFFFF",
            "surface": "#F4F5F8",
            "text": "#171923",
            "mutedText": "#667085",
            "accent1": "#7657FF",
            "accent2": "#39C6B4",
        },
        "fonts": {
            "heading": "Microsoft YaHei",
            "body": "Microsoft YaHei",
            "mono": "Cascadia Mono",
        },
    }


def _migrate_v0(raw: dict[str, Any]) -> dict[str, Any]:
    presentation_id = raw.get("presentationId") or raw.get("id")
    slides: list[dict[str, Any]] = []
    for index, old_slide in enumerate(raw.get("slides") or []):
        if not isinstance(old_slide, dict):
            raise ValueError("legacy slides must be objects")
        slides.append(
            {
                "id": old_slide.get("id") or f"slide-{index + 1}",
                "order": index,
                "background": old_slide.get("background")
                or {"type": "SOLID", "color": "#FFFFFF"},
                "elements": old_slide.get("elements") or [],
                "animations": old_slide.get("animations") or [],
            }
        )
    if not slides:
        slides.append(
            {
                "id": "slide-1",
                "order": 0,
                "background": {"type": "SOLID", "color": "#FFFFFF"},
                "elements": [],
                "animations": [],
            }
        )
    return {
        "schemaVersion": 1,
        "presentationId": presentation_id,
        "revision": raw.get("revision", 0),
        "title": raw.get("title") or "Untitled presentation",
        "aspectRatio": raw.get("aspectRatio", "16:9"),
        "canvas": raw.get("canvas") or {"width": 13.333, "height": 7.5},
        "theme": raw.get("theme") or _default_theme(),
        "slides": slides,
        "metadata": raw.get("metadata")
        or {
            "language": "zh-CN",
            "createdAt": "1970-01-01T00:00:00Z",
            "updatedAt": "1970-01-01T00:00:00Z",
        },
    }


def parse_presentation_document(raw: dict[str, Any]) -> PresentationDocument:
    """Route a JSON document through explicit migrations, then validate v1."""

    if not isinstance(raw, dict):
        raise TypeError("presentation document must be an object")
    version = raw.get("schemaVersion", 0)
    candidate = copy.deepcopy(raw)
    if version == 0:
        candidate = _migrate_v0(candidate)
    elif version != 1:
        raise UnsupportedPresentationSchema(version)
    # A resumed BUILD from an older worker could append the same page twice
    # with the same stable id.  Collapse those replayed records and rebuild
    # the contiguous order before strict model validation.  This keeps old
    # completed presentations publishable without weakening the contract for
    # newly-written documents.
    slides = candidate.get("slides")
    if isinstance(slides, list):
        normalized_slides: list[dict[str, Any]] = []
        positions: dict[str, int] = {}
        for index, slide in enumerate(slides):
            if not isinstance(slide, dict):
                continue
            slide_copy = copy.deepcopy(slide)
            slide_id = str(slide_copy.get("id") or f"slide-{index + 1}")
            existing_position = positions.get(slide_id)
            if existing_position is None:
                positions[slide_id] = len(normalized_slides)
                normalized_slides.append(slide_copy)
            else:
                # Keep the latest replay, matching the agent's resumable
                # build dedupe policy.
                normalized_slides[existing_position] = slide_copy
        for index, slide in enumerate(normalized_slides):
            slide["order"] = index
        candidate["slides"] = normalized_slides
    # Older component-build workers persisted Unix timestamps directly into
    # metadata.  Keep those durable documents readable and emit the canonical
    # ISO-8601 representation expected by the versioned contract.
    metadata = candidate.get("metadata")
    if isinstance(metadata, dict):
        for key in ("createdAt", "updatedAt"):
            value = metadata.get(key)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                try:
                    metadata[key] = datetime.fromtimestamp(value, UTC).isoformat().replace("+00:00", "Z")
                except (OverflowError, OSError, ValueError):
                    # Let Pydantic report the original invalid value below.
                    pass
    return PresentationDocument.model_validate(candidate)
