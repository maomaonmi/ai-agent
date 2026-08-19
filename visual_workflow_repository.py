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
from visual_workflow_run_state import InvalidStateTransition, RunStatus, transition_run_status


class WorkflowNotFound(LookupError):
    pass


class RevisionConflict(RuntimeError):
    def __init__(self, workflow_id: str, current_revision: int):
        super().__init__(f"workflow {workflow_id} is at revision {current_revision}")
        self.workflow_id = workflow_id
        self.current_revision = current_revision


class RunNotFound(LookupError):
    pass


class WorkflowRevisionNotFound(LookupError):
    pass


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

    def get_revision(self, workflow_id: str, revision: int) -> WorkflowDocument | None:
        """Return one immutable revision, respecting soft deletion."""
        with self._connect() as connection:
            workflow = connection.execute(
                "SELECT id FROM visual_workflows WHERE id = ? AND deleted_at IS NULL",
                (workflow_id,),
            ).fetchone()
            if workflow is None:
                return None
            row = connection.execute(
                "SELECT document_json FROM visual_workflow_revisions WHERE workflow_id = ? AND revision = ?",
                (workflow_id, revision),
            ).fetchone()
            return WorkflowDocument.model_validate(json.loads(row["document_json"])) if row else None

    def list_workflows(self, *, page: int = 1, page_size: int = 20) -> tuple[list[dict[str, Any]], int]:
        safe_page = max(1, int(page))
        safe_size = min(100, max(1, int(page_size)))
        with self._connect() as connection:
            total = int(connection.execute("SELECT COUNT(*) FROM visual_workflows WHERE deleted_at IS NULL").fetchone()[0])
            rows = connection.execute(
                "SELECT id FROM visual_workflows WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ? OFFSET ?",
                (safe_size, (safe_page - 1) * safe_size),
            ).fetchall()
            payloads: list[dict[str, Any]] = []
            for row in rows:
                payload = self._workflow_payload(connection, row["id"])
                if payload is not None:
                    payloads.append(payload)
            return payloads, total

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

    @staticmethod
    def _run_payload(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "workflow_id": row["workflow_id"],
            "revision": int(row["revision"]),
            "status": row["status"],
            "mode": row["mode"],
            "progress": int(row["progress"]),
            "requested_node_ids": json.loads(row["requested_node_ids"]),
            "client_request_id": row["client_request_id"],
            "created_at": row["created_at"],
            "started_at": row["started_at"],
            "completed_at": row["completed_at"],
        }

    def create_run(
        self,
        workflow_id: str,
        *,
        revision: int,
        mode: str,
        requested_node_ids: list[str] | None = None,
        client_request_id: str | None = None,
    ) -> dict[str, Any]:
        """Create a planned run, or return the existing idempotent request."""
        with self._connect() as connection:
            workflow = connection.execute(
                "SELECT id FROM visual_workflows WHERE id = ? AND deleted_at IS NULL",
                (workflow_id,),
            ).fetchone()
            if workflow is None:
                raise WorkflowNotFound(workflow_id)
            revision_row = connection.execute(
                "SELECT 1 FROM visual_workflow_revisions WHERE workflow_id = ? AND revision = ?",
                (workflow_id, revision),
            ).fetchone()
            if revision_row is None:
                raise WorkflowRevisionNotFound(f"{workflow_id}@{revision}")
            if client_request_id:
                existing = connection.execute(
                    "SELECT * FROM visual_workflow_runs WHERE client_request_id = ?",
                    (client_request_id,),
                ).fetchone()
                if existing is not None:
                    return self._run_payload(existing)
            run_id = str(uuid.uuid4())
            now = time.time()
            requested = json.dumps(requested_node_ids or [], ensure_ascii=False, separators=(",", ":"))
            try:
                connection.execute(
                    """
                    INSERT INTO visual_workflow_runs
                    (id, workflow_id, revision, status, mode, progress, requested_node_ids, client_request_id, created_at)
                    VALUES (?, ?, ?, 'PLANNED', ?, 0, ?, ?, ?)
                    """,
                    (run_id, workflow_id, revision, mode, requested, client_request_id, now),
                )
            except sqlite3.IntegrityError:
                if not client_request_id:
                    raise
                existing = connection.execute(
                    "SELECT * FROM visual_workflow_runs WHERE client_request_id = ?",
                    (client_request_id,),
                ).fetchone()
                if existing is None:
                    raise
                return self._run_payload(existing)
            created = connection.execute(
                "SELECT * FROM visual_workflow_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            if created is None:
                raise RuntimeError("run insert did not return a row")
            return self._run_payload(created)

    def get_run(self, workflow_id: str, run_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM visual_workflow_runs WHERE id = ? AND workflow_id = ?",
                (run_id, workflow_id),
            ).fetchone()
            return self._run_payload(row) if row else None

    @staticmethod
    def _node_run_payload(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "run_id": row["run_id"],
            "node_id": row["node_id"],
            "attempt": int(row["attempt"]),
            "status": row["status"],
            "cache_key": row["cache_key"],
            "is_cache_hit": bool(row["is_cache_hit"]),
            "provider": row["provider"],
            "provider_task_id": row["provider_task_id"],
            "input_artifacts": json.loads(row["input_artifacts_json"] or "[]"),
            "output_artifacts": json.loads(row["output_artifacts_json"] or "[]"),
            "error_code": row["error_code"],
            "error_message": row["error_message"],
            "started_at": row["started_at"],
            "completed_at": row["completed_at"],
        }

    def create_node_runs(self, run_id: str, node_ids: list[str]) -> list[dict[str, Any]]:
        """Create idempotent attempt-1 rows for the immutable execution plan."""

        with self._connect() as connection:
            run = connection.execute("SELECT id FROM visual_workflow_runs WHERE id = ?", (run_id,)).fetchone()
            if run is None:
                raise RunNotFound(run_id)
            for node_id in dict.fromkeys(node_ids):
                connection.execute(
                    """
                    INSERT OR IGNORE INTO visual_workflow_node_runs
                    (id, run_id, node_id, attempt, status)
                    VALUES (?, ?, ?, 1, 'PENDING')
                    """,
                    (str(uuid.uuid4()), run_id, node_id),
                )
            rows = connection.execute(
                "SELECT * FROM visual_workflow_node_runs WHERE run_id = ? ORDER BY rowid",
                (run_id,),
            ).fetchall()
            return [self._node_run_payload(row) for row in rows]

    def get_node_runs(self, workflow_id: str, run_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            exists = connection.execute(
                "SELECT 1 FROM visual_workflow_runs WHERE id = ? AND workflow_id = ?",
                (run_id, workflow_id),
            ).fetchone()
            if exists is None:
                return []
            rows = connection.execute(
                "SELECT * FROM visual_workflow_node_runs WHERE run_id = ? ORDER BY rowid",
                (run_id,),
            ).fetchall()
            return [self._node_run_payload(row) for row in rows]

    def update_node_run(self, run_id: str, node_id: str, *, status: str | None = None, **fields: Any) -> dict[str, Any]:
        """Update a node attempt using an allowlist, keeping JSON fields normalized."""

        allowed = {
            "cache_key", "is_cache_hit", "provider", "provider_task_id",
            "input_artifacts", "output_artifacts", "error_code", "error_message",
        }
        unknown = set(fields) - allowed
        if unknown:
            raise ValueError(f"unsupported node run fields: {sorted(unknown)}")
        assignments: list[str] = []
        values: list[Any] = []
        if status is not None:
            assignments.append("status = ?")
            values.append(status)
            if status == "RUNNING":
                assignments.append("started_at = COALESCE(started_at, ?)")
                values.append(time.time())
            if status in {"SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED"}:
                assignments.append("completed_at = ?")
                values.append(time.time())
        for name, value in fields.items():
            column = {
                "input_artifacts": "input_artifacts_json",
                "output_artifacts": "output_artifacts_json",
                "is_cache_hit": "is_cache_hit",
            }.get(name, name)
            assignments.append(f"{column} = ?")
            values.append(json.dumps(value, ensure_ascii=False, separators=(",", ":")) if name in {"input_artifacts", "output_artifacts"} else value)
        if not assignments:
            raise ValueError("node run update is empty")
        values.extend([run_id, node_id])
        with self._connect() as connection:
            connection.execute(
                f"UPDATE visual_workflow_node_runs SET {', '.join(assignments)} WHERE run_id = ? AND node_id = ? AND attempt = 1",
                values,
            )
            row = connection.execute(
                "SELECT * FROM visual_workflow_node_runs WHERE run_id = ? AND node_id = ? AND attempt = 1",
                (run_id, node_id),
            ).fetchone()
            if row is None:
                raise RunNotFound(f"{run_id}:{node_id}")
            return self._node_run_payload(row)

    def append_event(self, run_id: str, event_type: str, *, node_id: str | None = None, payload: dict[str, Any] | None = None) -> int:
        with self._connect() as connection:
            exists = connection.execute("SELECT 1 FROM visual_workflow_runs WHERE id = ?", (run_id,)).fetchone()
            if exists is None:
                raise RunNotFound(run_id)
            current = connection.execute("SELECT COALESCE(MAX(sequence), 0) FROM visual_workflow_events WHERE run_id = ?", (run_id,)).fetchone()[0]
            sequence = int(current) + 1
            connection.execute(
                "INSERT INTO visual_workflow_events (run_id, sequence, event_type, node_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (run_id, sequence, event_type, node_id, json.dumps(payload or {}, ensure_ascii=False, separators=(",", ":")), time.time()),
            )
            return sequence

    def list_events(self, workflow_id: str, run_id: str, *, after_sequence: int = 0) -> list[dict[str, Any]]:
        with self._connect() as connection:
            exists = connection.execute(
                "SELECT 1 FROM visual_workflow_runs WHERE id = ? AND workflow_id = ?",
                (run_id, workflow_id),
            ).fetchone()
            if exists is None:
                return []
            rows = connection.execute(
                "SELECT * FROM visual_workflow_events WHERE run_id = ? AND sequence > ? ORDER BY sequence",
                (run_id, max(0, int(after_sequence))),
            ).fetchall()
            return [{
                "id": row["id"],
                "run_id": row["run_id"],
                "sequence": int(row["sequence"]),
                "event_type": row["event_type"],
                "node_id": row["node_id"],
                "payload": json.loads(row["payload_json"] or "{}"),
                "created_at": row["created_at"],
            } for row in rows]

    def transition_run(
        self,
        workflow_id: str,
        run_id: str,
        target_status: RunStatus,
        *,
        progress: int | None = None,
    ) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM visual_workflow_runs WHERE id = ? AND workflow_id = ?",
                (run_id, workflow_id),
            ).fetchone()
            if row is None:
                raise RunNotFound(run_id)
            current = RunStatus(row["status"])
            next_status = transition_run_status(current, target_status)
            now = time.time()
            started_at = row["started_at"]
            completed_at = row["completed_at"]
            if next_status is RunStatus.RUNNING and started_at is None:
                started_at = now
            if next_status in {RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED}:
                completed_at = now
            next_progress = int(progress if progress is not None else row["progress"])
            next_progress = min(100, max(0, next_progress))
            connection.execute(
                "UPDATE visual_workflow_runs SET status = ?, progress = ?, started_at = ?, completed_at = ? WHERE id = ?",
                (next_status.value, next_progress, started_at, completed_at, run_id),
            )
            updated = connection.execute(
                "SELECT * FROM visual_workflow_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            if updated is None:
                raise RunNotFound(run_id)
            return self._run_payload(updated)

    def update_run_progress(self, workflow_id: str, run_id: str, progress: int) -> dict[str, Any]:
        """Update progress without changing the state-machine status."""

        with self._connect() as connection:
            cursor = connection.execute(
                "UPDATE visual_workflow_runs SET progress = ? WHERE id = ? AND workflow_id = ?",
                (min(100, max(0, int(progress))), run_id, workflow_id),
            )
            if cursor.rowcount == 0:
                raise RunNotFound(run_id)
            row = connection.execute("SELECT * FROM visual_workflow_runs WHERE id = ?", (run_id,)).fetchone()
            if row is None:
                raise RunNotFound(run_id)
            return self._run_payload(row)

    def request_run_cancel(self, workflow_id: str, run_id: str) -> dict[str, Any]:
        run = self.get_run(workflow_id, run_id)
        if run is None:
            raise RunNotFound(run_id)
        current = RunStatus(run["status"])
        if current is RunStatus.CANCELLED:
            return run
        if current in {RunStatus.SUCCEEDED, RunStatus.FAILED}:
            raise InvalidStateTransition("run", current.value, RunStatus.CANCELLED.value)
        target = RunStatus.CANCELLED if current is RunStatus.PLANNED else RunStatus.CANCEL_REQUESTED
        return self.transition_run(workflow_id, run_id, target)
