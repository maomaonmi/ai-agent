from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from ppt_models import (
    PresentationDocument,
    UnsupportedPresentationSchema,
    parse_presentation_document,
)


FIXTURE = Path(__file__).parent / "fixtures" / "ppt_document_v1.json"


def _golden() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_golden_document_round_trips_without_contract_drift() -> None:
    raw = _golden()

    document = parse_presentation_document(raw)

    assert isinstance(document, PresentationDocument)
    assert document.model_dump(mode="json", by_alias=True, exclude_none=True) == raw
    assert {element.type for element in document.slides[0].elements} == {
        "TEXT",
        "IMAGE",
        "SHAPE",
        "TABLE",
        "CHART",
        "MEDIA",
        "GROUP",
    }


def test_unknown_fields_are_rejected_at_every_level() -> None:
    raw = _golden()
    raw["slides"][0]["elements"][0]["surprise"] = True  # type: ignore[index]

    with pytest.raises(ValidationError, match="surprise"):
        parse_presentation_document(raw)


def test_geometry_cannot_escape_normalized_canvas() -> None:
    raw = _golden()
    raw["slides"][0]["elements"][0]["x"] = 0.9  # type: ignore[index]

    with pytest.raises(ValidationError, match="normalized canvas"):
        parse_presentation_document(raw)


def test_animation_target_must_exist_on_the_same_slide() -> None:
    raw = _golden()
    raw["slides"][0]["animations"][0]["targetElementId"] = "missing"  # type: ignore[index]

    with pytest.raises(ValidationError, match="animation target"):
        parse_presentation_document(raw)


def test_schema_zero_routes_through_explicit_migration() -> None:
    legacy = {
        "schemaVersion": 0,
        "id": "legacy-presentation",
        "title": "Legacy",
        "slides": [{"id": "legacy-slide", "elements": []}],
    }

    document = parse_presentation_document(copy.deepcopy(legacy))

    assert document.schema_version == 1
    assert document.presentation_id == "legacy-presentation"
    assert document.slides[0].background.type == "SOLID"


def test_future_schema_is_rejected_with_stable_error() -> None:
    raw = _golden()
    raw["schemaVersion"] = 99

    with pytest.raises(UnsupportedPresentationSchema) as exc_info:
        parse_presentation_document(raw)

    assert exc_info.value.code == "PPT_SCHEMA_UNSUPPORTED"
