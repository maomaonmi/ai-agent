"""SQLite persistence for visual workflow definitions and immutable revisions."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from visual_workflow_models import WorkflowDocument


class WorkflowNotFound(LookupError):
    pass


class RevisionConflict(RuntimeError):
    def __init__(self, workflow_id: str, current_revision: int):
        super().__init__(f"workflow {workflow_id} is at revision {current_revision}")
        self.workflow_id = workflow_id
        self.current_revision = current_revision


class VisualWorkflowRepository:
    def __init__(self, database_path: str | Path):
        self.database_path = str(database_path)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _initialize(self) -> None:
        Path(self.database_path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS visual_workflows (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    current_revision INTEGER NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    deleted_at REAL
                );
                CREATE TABLE IF NOT EXISTS visual_workflow_revisions (
                    workflow_id TEXT NOT NULL REFERENCES visual_workflows(id) ON DELETE CASCADE,
                    revision INTEGER NOT NULL,
                    schema_version INTEGER NOT NULL,
                    document_json TEXT NOT NULL,
                    document_hash TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    PRIMARY KEY (workflow_id, revision)
                );
                CREATE TABLE IF NOT EXISTS visual_workflow_runs (
                    id TEXT PRIMARY KEY,
                    workflow_id TEXT NOT NULL REFERENCES visual_workflows(id) ON DELETE CASCADE,
                    revision INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    progress INTEGER NOT NULL DEFAULT 0,
                    requested_node_ids TEXT NOT NULL DEFAULT '[]',
                    client_request_id TEXT UNIQUE,
                    created_at REAL NOT NULL,
                    started_at REAL,
                    completed_at REAL
                );
                CREATE TABLE IF NOT EXISTS visual_workflow_node_runs (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL REFERENCES visual_workflow_runs(id) ON DELETE CASCADE,
                    node_id TEXT NOT NULL,
                    attempt INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    cache_key TEXT,
                    is_cache_hit INTEGER NOT NULL DEFAULT 0,
                    provider TEXT,
                    provider_task_id TEXT,
                    input_artifacts_json TEXT NOT NULL DEFAULT '[]',
                    output_artifacts_json TEXT NOT NULL DEFAULT '[]',
                    error_code TEXT,
                    error_message TEXT,
                    started_at REAL,
                    completed_at REAL,
                    UNIQUE (run_id, node_id, attempt)
                );
                CREATE TABLE IF NOT EXISTS visual_workflow_artifacts (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    storage_backend TEXT NOT NULL,
                    storage_key TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size_bytes INTEGER,
                    sha256 TEXT NOT NULL,
                    width INTEGER,
                    height INTEGER,
                    duration_seconds REAL,
                    created_at REAL NOT NULL,
                    expires_at REAL
                );
                CREATE TABLE IF NOT EXISTS visual_workflow_cache_entries (
                    cache_key TEXT PRIMARY KEY,
                    node_kind TEXT NOT NULL,
                    adapter_version TEXT NOT NULL,
                    output_artifacts_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    expires_at REAL,
                    last_hit_at REAL
                );
                CREATE TABLE IF NOT EXISTS visual_workflow_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL REFERENCES visual_workflow_runs(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL,
                    event_type TEXT NOT NULL,
                    node_id TEXT,
                    payload_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    UNIQUE (run_id, sequence)
                );
                CREATE INDEX IF NOT EXISTS idx_visual_workflows_updated
                    ON visual_workflows(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_visual_workflow_runs_workflow
                    ON visual_workflow_runs(workflow_id, created_at DESC);
                """
            )

    @staticmethod
    def _document_hash(document: WorkflowDocument) -> str:
        payload = document.model_dump(by_alias=True, mode="json")
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _document_json(document: WorkflowDocument) -> str:
        return json.dumps(document.model_dump(by_alias=True, mode="json"), ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def _decode_document(row: sqlite3.Row) -> WorkflowDocument:
        return WorkflowDocument.model_validate(json.loads(row["document_json"]))

    def _workflow_payload(self, connection: sqlite3.Connection, workflow_id: str) -> dict[str, Any] | None:
        row = connection.execute(
            "SELECT * FROM visual_workflows WHERE id = ? AND deleted_at IS NULL",
            (workflow_id,),
        ).fetchone()
        if row is None:
            return None
        revision = connection.execute(
            "SELECT document_json FROM visual_workflow_revisions WHERE workflow_id = ? AND revision = ?",
            (workflow_id, row["current_revision"]),
        ).fetchone()
        if revision is None:
            raise RuntimeError(f"workflow {workflow_id} has no current revision")
        document = WorkflowDocument.model_validate(json.loads(revision["document_json"]))
        return {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "current_revision": row["current_revision"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "document": document,
        }

    def create_workflow(self, name: str, *, description: str | None = None) -> dict[str, Any]:
        workflow_id = str(uuid.uuid4())
        now = time.time()
        document = WorkflowDocument(workflowId=workflow_id, revision=1, name=name)
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO visual_workflows (id, name, description, current_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (workflow_id, name, description, 1, now, now),
            )
            connection.execute(
                "INSERT INTO visual_workflow_revisions (workflow_id, revision, schema_version, document_json, document_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (workflow_id, 1, document.schema_version, self._document_json(document), self._document_hash(document), now),
            )
            return self._workflow_payload(connection, workflow_id) or {}

    def get_workflow(self, workflow_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            return self._workflow_payload(connection, workflow_id)

    def list_workflows(self, *, page: int = 1, page_size: int = 20) -> tuple[list[dict[str, Any]], int]:
        safe_page = max(1, int(page))
        safe_size = min(100, max(1, int(page_size)))
        with self._connect() as connection:
            total = int(connection.execute("SELECT COUNT(*) FROM visual_workflows WHERE deleted_at IS NULL").fetchone()[0])
            rows = connection.execute(
                "SELECT id FROM visual_workflows WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ? OFFSET ?",
                (safe_size, (safe_page - 1) * safe_size),
            ).fetchall()
            return [self._workflow_payload(connection, row["id"]) for row in rows if self._workflow_payload(connection, row["id"])], total

    def save_revision(self, workflow_id: str, *, base_revision: int, document: WorkflowDocument) -> dict[str, Any]:
        now = time.time()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT current_revision FROM visual_workflows WHERE id = ? AND deleted_at IS NULL",
                (workflow_id,),
            ).fetchone()
            if row is None:
                raise WorkflowNotFound(workflow_id)
            current_revision = int(row["current_revision"])
            if current_revision != base_revision:
                raise RevisionConflict(workflow_id, current_revision)
            next_revision = current_revision + 1
            persisted = document.model_copy(update={"workflow_id": workflow_id, "revision": next_revision})
            connection.execute(
                "INSERT INTO visual_workflow_revisions (workflow_id, revision, schema_version, document_json, document_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (workflow_id, next_revision, persisted.schema_version, self._document_json(persisted), self._document_hash(persisted), now),
            )
            connection.execute(
                "UPDATE visual_workflows SET name = ?, current_revision = ?, updated_at = ? WHERE id = ?",
                (persisted.name, next_revision, now, workflow_id),
            )
            return self._workflow_payload(connection, workflow_id) or {}

    def delete_workflow(self, workflow_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE visual_workflows SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
                (time.time(), time.time(), workflow_id),
            )
            return cursor.rowcount > 0

