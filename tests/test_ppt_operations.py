from __future__ import annotations

import json
from pathlib import Path

import pytest

from ppt_models import parse_presentation_document
from ppt_operations import (
    OperationRejected,
    RevisionConflict,
    apply_operations,
    parse_operations,
)


FIXTURE = Path(__file__).parent / "fixtures" / "ppt_document_v1.json"


def _document():
    return parse_presentation_document(json.loads(FIXTURE.read_text(encoding="utf-8")))


def test_slide_add_move_and_delete_are_atomic_and_reindexed() -> None:
    document = _document()
    new_slide = document.slides[0].model_dump(mode="json", by_alias=True, exclude_none=True)
    new_slide["id"] = "slide-002"
    new_slide["order"] = 1
    new_slide["elements"] = []
    new_slide["animations"] = []
    operations = parse_operations(
        [
            {"operationId": "op-add", "type": "ADD_SLIDE", "slide": new_slide},
            {"operationId": "op-move", "type": "MOVE_SLIDE", "slideId": "slide-002", "toIndex": 0},
            {"operationId": "op-delete", "type": "DELETE_SLIDE", "slideId": "slide-001"},
        ]
    )

    result = apply_operations(document, base_revision=3, operations=operations)

    assert result.document.revision == 4
    assert [(slide.id, slide.order) for slide in result.document.slides] == [("slide-002", 0)]
    assert result.applied_operation_ids == frozenset({"op-add", "op-move", "op-delete"})


def test_all_element_operations_and_notes_are_reduced() -> None:
    document = _document()
    element = document.slides[0].elements[0].model_dump(mode="json", by_alias=True, exclude_none=True)
    element["id"] = "element-subtitle"
    element["text"] = "Initial"
    operations = parse_operations(
        [
            {"operationId": "op-add-element", "type": "ADD_ELEMENT", "slideId": "slide-001", "element": element},
            {
                "operationId": "op-update-element",
                "type": "UPDATE_ELEMENT",
                "slideId": "slide-001",
                "elementId": "element-subtitle",
                "patch": {"text": "Updated", "opacity": 0.8},
            },
            {"operationId": "op-notes", "type": "SET_NOTES", "slideId": "slide-001", "notes": "New notes"},
            {"operationId": "op-delete-element", "type": "DELETE_ELEMENT", "slideId": "slide-001", "elementId": "element-subtitle"},
        ]
    )

    result = apply_operations(document, base_revision=3, operations=operations)

    assert "element-subtitle" not in {item.id for item in result.document.slides[0].elements}
    assert result.document.slides[0].notes == "New notes"


def test_set_animations_validates_targets() -> None:
    document = _document()
    operations = parse_operations(
        [
            {
                "operationId": "op-animations",
                "type": "SET_ANIMATIONS",
                "slideId": "slide-001",
                "animations": [
                    {
                        "id": "animation-new",
                        "targetElementId": "missing-element",
                        "category": "ENTRANCE",
                        "effect": "FADE",
                        "trigger": "ON_CLICK",
                        "order": 0,
                        "durationMs": 500,
                        "delayMs": 0,
                    }
                ],
            }
        ]
    )

    with pytest.raises(OperationRejected, match="animation target"):
        apply_operations(document, base_revision=3, operations=operations)

    assert document.revision == 3


def test_duplicate_operation_id_is_idempotent() -> None:
    document = _document()
    operations = parse_operations(
        [{"operationId": "op-notes", "type": "SET_NOTES", "slideId": "slide-001", "notes": "Retried"}]
    )

    result = apply_operations(
        document,
        base_revision=2,
        operations=operations,
        applied_operation_ids={"op-notes"},
    )

    assert result.document is document
    assert result.document.revision == 3
    assert result.ignored_operation_ids == ("op-notes",)


def test_stale_revision_never_overwrites_unseen_operations() -> None:
    document = _document()
    operations = parse_operations(
        [{"operationId": "op-new", "type": "SET_NOTES", "slideId": "slide-001", "notes": "Stale write"}]
    )

    with pytest.raises(RevisionConflict) as exc_info:
        apply_operations(document, base_revision=2, operations=operations)

    assert exc_info.value.code == "REVISION_CONFLICT"
    assert exc_info.value.current_revision == 3
    assert document.slides[0].notes == "介绍 AI 工作流和素材来源。"


def test_element_patch_cannot_change_identity_or_add_unknown_fields() -> None:
    document = _document()
    for patch in ({"id": "replacement"}, {"surprise": True}):
        operations = parse_operations(
            [
                {
                    "operationId": f"op-{next(iter(patch))}",
                    "type": "UPDATE_ELEMENT",
                    "slideId": "slide-001",
                    "elementId": "element-title",
                    "patch": patch,
                }
            ]
        )
        with pytest.raises(OperationRejected):
            apply_operations(document, base_revision=3, operations=operations)


def test_cannot_delete_the_only_slide() -> None:
    document = _document()
    operations = parse_operations(
        [{"operationId": "op-delete", "type": "DELETE_SLIDE", "slideId": "slide-001"}]
    )

    with pytest.raises(OperationRejected, match="last slide"):
        apply_operations(document, base_revision=3, operations=operations)
