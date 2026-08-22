"""Narrow OOXML post-processing for generated PowerPoint files.

PptxGenJS owns the base document.  This module only adds features that are not
currently exposed by its public API (slide transitions and object animations).
It intentionally supports a small, tested subset of PresentationML so malformed
or untrusted archives do not reach the XML writer.
"""

from __future__ import annotations

import os
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET


P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
MAX_ARCHIVE_ENTRIES = 20_000
MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024

ET.register_namespace("p", P_NS)


class OoxmlPatchError(RuntimeError):
    """Raised when a presentation cannot be patched safely."""


@dataclass(frozen=True, slots=True)
class TransitionSpec:
    slide_number: int
    effect: str = "fade"
    speed: str = "med"
    advance_after_ms: int | None = None
    advance_on_click: bool = True


@dataclass(frozen=True, slots=True)
class AnimationSpec:
    slide_number: int
    shape_id: int
    effect: str = "fade"
    trigger: str = "on_click"
    duration_ms: int = 500
    delay_ms: int = 0


@dataclass(frozen=True, slots=True)
class OoxmlPatchResult:
    output_path: Path
    slides_patched: tuple[int, ...]
    transition_count: int
    animation_count: int


def _tag(name: str) -> str:
    return f"{{{P_NS}}}{name}"


def _validate_archive(archive: zipfile.ZipFile) -> None:
    entries = archive.infolist()
    if len(entries) > MAX_ARCHIVE_ENTRIES:
        raise OoxmlPatchError("archive contains too many entries")

    seen: set[str] = set()
    total_size = 0
    for entry in entries:
        member = PurePosixPath(entry.filename)
        if (
            member.is_absolute()
            or ".." in member.parts
            or "\\" in entry.filename
            or (member.parts and ":" in member.parts[0])
        ):
            raise OoxmlPatchError(f"unsafe archive member: {entry.filename}")
        if entry.filename in seen:
            raise OoxmlPatchError(f"duplicate archive member: {entry.filename}")
        if entry.flag_bits & 0x1:
            raise OoxmlPatchError("encrypted archives are not supported")
        seen.add(entry.filename)
        total_size += entry.file_size
        if total_size > MAX_UNCOMPRESSED_BYTES:
            raise OoxmlPatchError("archive exceeds uncompressed size limit")


def _validate_specs(
    transitions: tuple[TransitionSpec, ...],
    animations: tuple[AnimationSpec, ...],
) -> None:
    for spec in transitions:
        if spec.slide_number < 1:
            raise OoxmlPatchError("slide number must be positive")
        if spec.effect not in {"fade", "dissolve"}:
            raise OoxmlPatchError(f"unsupported transition effect: {spec.effect}")
        if spec.speed not in {"slow", "med", "fast"}:
            raise OoxmlPatchError(f"unsupported transition speed: {spec.speed}")
        if spec.advance_after_ms is not None and not 0 <= spec.advance_after_ms <= 3_600_000:
            raise OoxmlPatchError("transition advance time is out of range")

    for spec in animations:
        if spec.slide_number < 1 or spec.shape_id < 1:
            raise OoxmlPatchError("slide number and shape id must be positive")
        if spec.effect != "fade":
            raise OoxmlPatchError(f"unsupported animation effect: {spec.effect}")
        if spec.trigger not in {"on_click", "with_previous", "after_previous"}:
            raise OoxmlPatchError(f"unsupported animation trigger: {spec.trigger}")
        if not 1 <= spec.duration_ms <= 60_000 or not 0 <= spec.delay_ms <= 3_600_000:
            raise OoxmlPatchError("animation timing is out of range")


def _insert_in_slide_order(root: ET.Element, element: ET.Element, *, before: tuple[str, ...]) -> None:
    before_tags = {_tag(name) for name in before}
    for index, child in enumerate(root):
        if child.tag in before_tags:
            root.insert(index, element)
            return
    root.append(element)


def _add_transition(root: ET.Element, spec: TransitionSpec) -> None:
    existing = root.find(_tag("transition"))
    if existing is not None:
        root.remove(existing)

    attributes = {
        "spd": spec.speed,
        "advClick": "1" if spec.advance_on_click else "0",
    }
    if spec.advance_after_ms is not None:
        attributes["advTm"] = str(spec.advance_after_ms)
    transition = ET.Element(_tag("transition"), attributes)
    ET.SubElement(transition, _tag(spec.effect))
    _insert_in_slide_order(root, transition, before=("timing", "extLst"))


def _shape_ids(root: ET.Element) -> set[int]:
    result: set[int] = set()
    for node in root.iter(_tag("cNvPr")):
        try:
            result.add(int(node.attrib["id"]))
        except (KeyError, ValueError):
            continue
    return result


def _common_time_node(parent: ET.Element, node_id: int, **attributes: str) -> ET.Element:
    return ET.SubElement(parent, _tag("cTn"), {"id": str(node_id), **attributes})


def _animation_effect(parent: ET.Element, spec: AnimationSpec, node_id: int) -> None:
    effect = ET.SubElement(
        parent,
        _tag("animEffect"),
        {"transition": "in", "filter": "fade"},
    )
    behavior = ET.SubElement(effect, _tag("cBhvr"))
    _common_time_node(behavior, node_id, dur=str(spec.duration_ms), fill="hold")
    target = ET.SubElement(behavior, _tag("tgtEl"))
    ET.SubElement(target, _tag("spTgt"), {"spid": str(spec.shape_id)})


def _add_animations(root: ET.Element, specs: tuple[AnimationSpec, ...]) -> None:
    existing = root.find(_tag("timing"))
    if existing is not None:
        root.remove(existing)

    timing = ET.Element(_tag("timing"))
    time_node_list = ET.SubElement(timing, _tag("tnLst"))
    root_parallel = ET.SubElement(time_node_list, _tag("par"))
    root_node = _common_time_node(
        root_parallel,
        1,
        dur="indefinite",
        restart="never",
        nodeType="tmRoot",
    )
    root_children = ET.SubElement(root_node, _tag("childTnLst"))
    sequence = ET.SubElement(root_children, _tag("seq"), {"concurrent": "1", "nextAc": "seek"})
    sequence_node = _common_time_node(sequence, 2, dur="indefinite", nodeType="mainSeq")
    sequence_children = ET.SubElement(sequence_node, _tag("childTnLst"))

    next_node_id = 3
    trigger_node_types = {
        "on_click": "clickEffect",
        "with_previous": "withEffect",
        "after_previous": "afterEffect",
    }
    for spec in specs:
        parallel = ET.SubElement(sequence_children, _tag("par"))
        effect_node = _common_time_node(
            parallel,
            next_node_id,
            presetID="10",
            presetClass="entr",
            presetSubtype="0",
            fill="hold",
            grpId="0",
            nodeType=trigger_node_types[spec.trigger],
        )
        next_node_id += 1
        start_conditions = ET.SubElement(effect_node, _tag("stCondLst"))
        trigger_delay = spec.delay_ms
        if spec.trigger == "on_click" and spec.delay_ms == 0:
            trigger_delay = 0
        ET.SubElement(start_conditions, _tag("cond"), {"delay": str(trigger_delay)})
        effect_children = ET.SubElement(effect_node, _tag("childTnLst"))
        _animation_effect(effect_children, spec, next_node_id)
        next_node_id += 1

    previous_conditions = ET.SubElement(sequence, _tag("prevCondLst"))
    previous = ET.SubElement(previous_conditions, _tag("cond"), {"evt": "onPrev", "delay": "0"})
    previous_target = ET.SubElement(previous, _tag("tgtEl"))
    ET.SubElement(previous_target, _tag("sldTgt"))
    next_conditions = ET.SubElement(sequence, _tag("nextCondLst"))
    following = ET.SubElement(next_conditions, _tag("cond"), {"evt": "onNext", "delay": "0"})
    following_target = ET.SubElement(following, _tag("tgtEl"))
    ET.SubElement(following_target, _tag("sldTgt"))

    _insert_in_slide_order(root, timing, before=("extLst",))


def _patch_slide(
    xml_data: bytes,
    transition: TransitionSpec | None,
    animations: tuple[AnimationSpec, ...],
) -> bytes:
    try:
        root = ET.fromstring(xml_data)
    except ET.ParseError as exc:
        raise OoxmlPatchError("slide XML is malformed") from exc
    if root.tag != _tag("sld"):
        raise OoxmlPatchError("slide XML has an unexpected root element")

    available_shape_ids = _shape_ids(root)
    for spec in animations:
        if spec.shape_id not in available_shape_ids:
            raise OoxmlPatchError(
                f"shape {spec.shape_id} does not exist on slide {spec.slide_number}"
            )

    if transition is not None:
        _add_transition(root, transition)
    if animations:
        _add_animations(root, animations)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def patch_presentation(
    source: str | os.PathLike[str],
    output: str | os.PathLike[str],
    *,
    transitions: list[TransitionSpec] | tuple[TransitionSpec, ...] = (),
    animations: list[AnimationSpec] | tuple[AnimationSpec, ...] = (),
) -> OoxmlPatchResult:
    """Write a patched copy of *source* to *output* atomically."""

    source_path = Path(source).resolve()
    output_path = Path(output).resolve()
    if not source_path.is_file():
        raise OoxmlPatchError(f"presentation does not exist: {source_path}")
    if source_path == output_path:
        raise OoxmlPatchError("source and output paths must be different")

    transition_specs = tuple(transitions)
    animation_specs = tuple(animations)
    _validate_specs(transition_specs, animation_specs)

    transitions_by_slide: dict[int, TransitionSpec] = {}
    for spec in transition_specs:
        if spec.slide_number in transitions_by_slide:
            raise OoxmlPatchError(f"duplicate transition for slide {spec.slide_number}")
        transitions_by_slide[spec.slide_number] = spec
    animations_by_slide: dict[int, list[AnimationSpec]] = {}
    for spec in animation_specs:
        animations_by_slide.setdefault(spec.slide_number, []).append(spec)

    requested_slides = set(transitions_by_slide) | set(animations_by_slide)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    patched_slides: set[int] = set()

    try:
        with zipfile.ZipFile(source_path, "r") as source_archive:
            _validate_archive(source_archive)
            member_names = set(source_archive.namelist())
            for slide_number in requested_slides:
                member_name = f"ppt/slides/slide{slide_number}.xml"
                if member_name not in member_names:
                    raise OoxmlPatchError(f"slide {slide_number} does not exist")

            with tempfile.NamedTemporaryFile(
                prefix="ppt-ooxml-",
                suffix=".pptx",
                dir=output_path.parent,
                delete=False,
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)

            with zipfile.ZipFile(
                temporary_path,
                "w",
                compression=zipfile.ZIP_DEFLATED,
                allowZip64=True,
            ) as output_archive:
                for entry in source_archive.infolist():
                    data = source_archive.read(entry)
                    if entry.filename.startswith("ppt/slides/slide") and entry.filename.endswith(".xml"):
                        slide_name = PurePosixPath(entry.filename).stem
                        try:
                            slide_number = int(slide_name.removeprefix("slide"))
                        except ValueError:
                            slide_number = -1
                        if slide_number in requested_slides:
                            data = _patch_slide(
                                data,
                                transitions_by_slide.get(slide_number),
                                tuple(animations_by_slide.get(slide_number, ())),
                            )
                            patched_slides.add(slide_number)
                    output_archive.writestr(entry, data)

        if patched_slides != requested_slides:
            missing = sorted(requested_slides - patched_slides)
            raise OoxmlPatchError(f"slides were not patched: {missing}")
        os.replace(temporary_path, output_path)
        temporary_path = None
    except (OSError, zipfile.BadZipFile) as exc:
        raise OoxmlPatchError("PowerPoint archive could not be patched") from exc
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)

    return OoxmlPatchResult(
        output_path=output_path,
        slides_patched=tuple(sorted(patched_slides)),
        transition_count=len(transition_specs),
        animation_count=len(animation_specs),
    )
