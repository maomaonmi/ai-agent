"""Atomic, idempotent operation reducer for editable PPT documents."""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from typing import Annotated, Any, Literal, Union

from pydantic import Field, TypeAdapter, ValidationError, field_validator

from ppt_models import (
    ContractModel,
    ElementAnimation,
    Identifier,
    PresentationDocument,
    SlideDocument,
    SlideElement,
)


class RevisionConflict(RuntimeError):
    code = "REVISION_CONFLICT"

    def __init__(self, current_revision: int) -> None:
        super().__init__(f"document revision is {current_revision}")
        self.current_revision = current_revision


class OperationRejected(ValueError):
    code = "PPT_OPERATION_REJECTED"


class OperationBase(ContractModel):
    operation_id: Identifier


class AddSlideOperation(OperationBase):
    type: Literal["ADD_SLIDE"]
    slide: SlideDocument


class DeleteSlideOperation(OperationBase):
    type: Literal["DELETE_SLIDE"]
    slide_id: Identifier


class MoveSlideOperation(OperationBase):
    type: Literal["MOVE_SLIDE"]
    slide_id: Identifier
    to_index: Annotated[int, Field(ge=0, le=199)]


class AddElementOperation(OperationBase):
    type: Literal["ADD_ELEMENT"]
    slide_id: Identifier
    element: SlideElement


class UpdateElementOperation(OperationBase):
    type: Literal["UPDATE_ELEMENT"]
    slide_id: Identifier
    element_id: Identifier
    patch: dict[str, Any]

    @field_validator("patch")
    @classmethod
    def validate_patch_size(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not value or len(value) > 50:
            raise ValueError("element patch must contain 1-50 fields")
        try:
            encoded = json.dumps(value, ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError) as exc:
            raise ValueError("element patch must be JSON serializable") from exc
        if len(encoded.encode("utf-8")) > 256_000:
            raise ValueError("element patch is too large")
        return value


class DeleteElementOperation(OperationBase):
    type: Literal["DELETE_ELEMENT"]
    slide_id: Identifier
    element_id: Identifier


class SetNotesOperation(OperationBase):
    type: Literal["SET_NOTES"]
    slide_id: Identifier
    notes: Annotated[str, Field(max_length=100_000)]


class SetAnimationsOperation(OperationBase):
    type: Literal["SET_ANIMATIONS"]
    slide_id: Identifier
    animations: Annotated[list[ElementAnimation], Field(max_length=500)]


PresentationOperation = Annotated[
    Union[
        AddSlideOperation,
        DeleteSlideOperation,
        MoveSlideOperation,
        AddElementOperation,
        UpdateElementOperation,
        DeleteElementOperation,
        SetNotesOperation,
        SetAnimationsOperation,
    ],
    Field(discriminator="type"),
]

_OPERATIONS_ADAPTER = TypeAdapter(list[PresentationOperation])
_ELEMENT_ADAPTER = TypeAdapter(SlideElement)


@dataclass(frozen=True, slots=True)
class OperationApplyResult:
    document: PresentationDocument
    applied_operation_ids: frozenset[str]
    ignored_operation_ids: tuple[str, ...]


def parse_operations(raw: list[dict[str, Any]]) -> list[PresentationOperation]:
    return _OPERATIONS_ADAPTER.validate_python(raw)


def _slide(state: dict[str, Any], slide_id: str) -> dict[str, Any]:
    for slide in state["slides"]:
        if slide["id"] == slide_id:
            return slide
    raise OperationRejected(f"slide does not exist: {slide_id}")


def _element(slide: dict[str, Any], element_id: str) -> tuple[int, dict[str, Any]]:
    for index, element in enumerate(slide["elements"]):
        if element["id"] == element_id:
            return index, element
    raise OperationRejected(f"element does not exist: {element_id}")


def _normalize_slide_order(state: dict[str, Any]) -> None:
    for index, slide in enumerate(state["slides"]):
        slide["order"] = index


def _deep_merge(original: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(original)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def _delete_element_references(slide: dict[str, Any], deleted_id: str) -> None:
    deleted_ids = {deleted_id}
    changed = True
    while changed:
        changed = False
        next_elements: list[dict[str, Any]] = []
        for element in slide["elements"]:
            if element["id"] in deleted_ids:
                continue
            if element["type"] == "GROUP":
                children = [child for child in element["childElementIds"] if child not in deleted_ids]
                if not children:
                    deleted_ids.add(element["id"])
                    changed = True
                    continue
                element["childElementIds"] = children
            next_elements.append(element)
        slide["elements"] = next_elements
    slide["animations"] = [
        animation
        for animation in slide["animations"]
        if animation["targetElementId"] not in deleted_ids
    ]


def _apply_operation(state: dict[str, Any], operation: PresentationOperation) -> None:
    if isinstance(operation, AddSlideOperation):
        slide = operation.slide.model_dump(mode="json", by_alias=True, exclude_none=True)
        index = min(slide["order"], len(state["slides"]))
        state["slides"].insert(index, slide)
        _normalize_slide_order(state)
        return
    if isinstance(operation, DeleteSlideOperation):
        if len(state["slides"]) == 1:
            raise OperationRejected("cannot delete the last slide")
        index = next(
            (index for index, slide in enumerate(state["slides"]) if slide["id"] == operation.slide_id),
            None,
        )
        if index is None:
            raise OperationRejected(f"slide does not exist: {operation.slide_id}")
        state["slides"].pop(index)
        _normalize_slide_order(state)
        return
    if isinstance(operation, MoveSlideOperation):
        if operation.to_index >= len(state["slides"]):
            raise OperationRejected("slide destination is out of range")
        index = next(
            (index for index, slide in enumerate(state["slides"]) if slide["id"] == operation.slide_id),
            None,
        )
        if index is None:
            raise OperationRejected(f"slide does not exist: {operation.slide_id}")
        slide = state["slides"].pop(index)
        state["slides"].insert(operation.to_index, slide)
        _normalize_slide_order(state)
        return

    slide = _slide(state, operation.slide_id)
    if isinstance(operation, AddElementOperation):
        if any(element["id"] == operation.element.id for element in slide["elements"]):
            raise OperationRejected(f"element already exists: {operation.element.id}")
        slide["elements"].append(
            operation.element.model_dump(mode="json", by_alias=True, exclude_none=True)
        )
    elif isinstance(operation, UpdateElementOperation):
        if {"id", "type"} & operation.patch.keys():
            raise OperationRejected("element id and type cannot be patched")
        index, existing = _element(slide, operation.element_id)
        candidate = _deep_merge(existing, operation.patch)
        try:
            validated = _ELEMENT_ADAPTER.validate_python(candidate)
        except ValidationError as exc:
            raise OperationRejected(f"invalid element patch: {exc.errors()[0]['msg']}") from exc
        slide["elements"][index] = validated.model_dump(
            mode="json",
            by_alias=True,
            exclude_none=True,
        )
    elif isinstance(operation, DeleteElementOperation):
        _element(slide, operation.element_id)
        _delete_element_references(slide, operation.element_id)
    elif isinstance(operation, SetNotesOperation):
        slide["notes"] = operation.notes
    elif isinstance(operation, SetAnimationsOperation):
        slide["animations"] = [
            animation.model_dump(mode="json", by_alias=True, exclude_none=True)
            for animation in operation.animations
        ]


def apply_operations(
    document: PresentationDocument,
    *,
    base_revision: int,
    operations: list[PresentationOperation],
    applied_operation_ids: set[str] | frozenset[str] = frozenset(),
) -> OperationApplyResult:
    """Apply a batch exactly once and increment revision once on success."""

    known_ids = set(applied_operation_ids)
    ignored: list[str] = []
    pending: list[PresentationOperation] = []
    payload_by_id: dict[str, str] = {}
    for operation in operations:
        operation_id = operation.operation_id
        payload = operation.model_dump_json(by_alias=True, exclude_none=True)
        if operation_id in known_ids:
            ignored.append(operation_id)
            continue
        if operation_id in payload_by_id:
            if payload_by_id[operation_id] != payload:
                raise OperationRejected(f"operationId is reused with different payload: {operation_id}")
            ignored.append(operation_id)
            continue
        payload_by_id[operation_id] = payload
        pending.append(operation)

    if base_revision != document.revision and pending:
        raise RevisionConflict(document.revision)
    if not pending:
        return OperationApplyResult(
            document=document,
            applied_operation_ids=frozenset(known_ids),
            ignored_operation_ids=tuple(ignored),
        )

    state = document.model_dump(mode="json", by_alias=True, exclude_none=True)
    try:
        for operation in pending:
            _apply_operation(state, operation)
        state["revision"] = document.revision + 1
        updated = PresentationDocument.model_validate(state)
    except OperationRejected:
        raise
    except (ValidationError, ValueError, KeyError, TypeError) as exc:
        message = exc.errors()[0]["msg"] if isinstance(exc, ValidationError) else str(exc)
        raise OperationRejected(f"operation batch is invalid: {message}") from exc

    applied_ids = known_ids | {operation.operation_id for operation in pending}
    return OperationApplyResult(
        document=updated,
        applied_operation_ids=frozenset(applied_ids),
        ignored_operation_ids=tuple(ignored),
    )
