from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from ppt_repository import PptRepository, RepositoryConflict


FIXTURE = Path(__file__).parent / "fixtures" / "ppt_document_v1.json"


def _document() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_initialize_is_repeatable_and_creates_all_domain_tables(tmp_path: Path) -> None:
    database = tmp_path / "ppt.db"
    repository = PptRepository(database)

    repository.initialize()
    repository.initialize()

    with sqlite3.connect(database) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
    assert {
        "ppt_templates",
        "ppt_template_pages",
        "ppt_presentations",
        "ppt_revisions",
        "ppt_runs",
        "ppt_run_events",
        "ppt_assets",
        "ppt_exports",
        "ppt_applied_operations",
    } <= tables


def test_private_templates_and_assets_are_owner_filtered(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    repository.create_template(
        template_id="template-private-a",
        owner_scope="owner-a",
        name="Private A",
        scene="BUSINESS",
        source="PRIVATE",
        status="READY",
        manifest={"theme": "violet"},
    )
    repository.create_template(
        template_id="template-system",
        owner_scope="system",
        name="System",
        scene="EDUCATION",
        source="SYSTEM",
        status="READY",
        manifest={"theme": "clean"},
    )
    repository.create_asset(
        asset_id="asset-private-a",
        owner_scope="owner-a",
        kind="TEMPLATE_SOURCE",
        storage_path="owners/owner-a/template-private-a/source.pptx",
        mime_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        size_bytes=123,
        sha256="a" * 64,
    )

    assert repository.get_template("template-private-a", owner_scope="owner-b") is None
    assert repository.get_template("template-system", owner_scope="owner-b") is not None
    assert {item.id for item in repository.list_templates(owner_scope="owner-b")} == {"template-system"}
    assert repository.get_asset("asset-private-a", owner_scope="owner-b") is None


def test_presentation_revision_and_operation_ids_commit_together(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    document = _document()
    repository.create_presentation(
        presentation_id="presentation-001",
        owner_scope="owner-a",
        title="Deck",
        document=document,
        template_id=None,
    )
    document["revision"] = 4
    document["title"] = "Updated"

    repository.commit_revision(
        presentation_id="presentation-001",
        owner_scope="owner-a",
        expected_revision=3,
        document=document,
        operations=[{"operationId": "op-title", "type": "SET_TITLE"}],
        operation_payloads={"op-title": "hash-1"},
    )

    stored = repository.get_presentation("presentation-001", owner_scope="owner-a")
    assert stored is not None and stored.current_revision == 4
    assert stored.document["title"] == "Updated"
    assert repository.get_applied_operation_ids("presentation-001", ["op-title", "missing"]) == {"op-title"}
    with pytest.raises(RepositoryConflict, match="revision"):
        repository.commit_revision(
            presentation_id="presentation-001",
            owner_scope="owner-a",
            expected_revision=3,
            document=document,
            operations=[],
            operation_payloads={},
        )


def test_run_events_have_unique_sequence_and_are_append_only(tmp_path: Path) -> None:
    database = tmp_path / "ppt.db"
    repository = PptRepository(database)
    repository.initialize()
    repository.create_presentation(
        presentation_id="presentation-001",
        owner_scope="owner-a",
        title="Deck",
        document=_document(),
        template_id=None,
    )
    repository.create_run(
        run_id="run-001",
        presentation_id="presentation-001",
        owner_scope="owner-a",
        status="RUNNING",
        phase="PLAN",
        state={"iteration": 1},
    )
    repository.append_run_event(
        run_id="run-001",
        sequence=1,
        event_type="phase.started",
        payload={"phase": "PLAN"},
    )

    with pytest.raises(RepositoryConflict, match="sequence"):
        repository.append_run_event(
            run_id="run-001",
            sequence=1,
            event_type="phase.started",
            payload={"phase": "DUPLICATE"},
        )
    with sqlite3.connect(database) as connection:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            connection.execute("UPDATE ppt_run_events SET event_type='changed'")
    events = repository.list_run_events("run-001", after_sequence=0, limit=100)
    assert [(event.sequence, event.event_type) for event in events] == [(1, "phase.started")]


def test_template_delete_is_idempotent_and_does_not_expose_storage_path(tmp_path: Path) -> None:
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    repository.create_template(
        template_id="template-private-a",
        owner_scope="owner-a",
        name="Private A",
        scene="BUSINESS",
        source="PRIVATE",
        status="READY",
        manifest={},
    )

    assert repository.delete_template("template-private-a", owner_scope="owner-a") is True
    assert repository.delete_template("template-private-a", owner_scope="owner-a") is False
    assert repository.get_template("template-private-a", owner_scope="owner-a") is None
