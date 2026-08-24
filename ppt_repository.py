"""Isolated SQLite persistence for the AI PowerPoint domain."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any, Iterator, Literal


TemplateSource = Literal["SYSTEM", "PRIVATE"]


class RepositoryConflict(RuntimeError):
    code = "PPT_REPOSITORY_CONFLICT"


@dataclass(frozen=True, slots=True)
class TemplateRecord:
    id: str
    owner_scope: str
    name: str
    description: str | None
    scene: str
    source: str
    status: str
    manifest: dict[str, Any]
    created_at: str
    updated_at: str


@dataclass(frozen=True, slots=True)
class TemplatePageRecord:
    template_id: str
    page_number: int
    thumbnail_asset_id: str | None
    preview_asset_id: str | None
    status: str
    error_code: str | None


@dataclass(frozen=True, slots=True)
class AssetRecord:
    id: str
    owner_scope: str
    kind: str
    storage_path: str
    mime_type: str
    size_bytes: int
    sha256: str
    source_url: str | None
    attribution: dict[str, Any] | None
    created_at: str


@dataclass(frozen=True, slots=True)
class PresentationRecord:
    id: str
    owner_scope: str
    template_id: str | None
    title: str
    current_revision: int
    document: dict[str, Any]
    created_at: str
    updated_at: str


@dataclass(frozen=True, slots=True)
class RunRecord:
    id: str
    presentation_id: str
    owner_scope: str
    status: str
    phase: str
    state: dict[str, Any]
    created_at: str
    updated_at: str


@dataclass(frozen=True, slots=True)
class RunEventRecord:
    run_id: str
    sequence: int
    event_type: str
    payload: dict[str, Any]
    created_at: str


@dataclass(frozen=True, slots=True)
class ExportRecord:
    id: str
    presentation_id: str
    owner_scope: str
    revision: int
    status: str
    asset_id: str | None
    error_code: str | None
    created_at: str
    updated_at: str


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _json_dump(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _json_load(value: str | None, fallback: Any) -> Any:
    return json.loads(value) if value else fallback


def _validate_storage_path(value: str) -> str:
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or "\\" in value or not path.parts:
        raise ValueError("asset storage path must be a safe relative POSIX path")
    return value


class PptRepository:
    def __init__(self, database_path: str | Path) -> None:
        self.database_path = Path(database_path).resolve()

    @contextmanager
    def _connection(self, *, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.database_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 30000")
        if immediate:
            connection.execute("BEGIN IMMEDIATE")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        schema = """
        CREATE TABLE IF NOT EXISTS ppt_schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ppt_templates (
            id TEXT PRIMARY KEY,
            owner_scope TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            scene TEXT NOT NULL,
            source TEXT NOT NULL CHECK (source IN ('SYSTEM', 'PRIVATE')),
            status TEXT NOT NULL,
            manifest_json TEXT NOT NULL,
            source_asset_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ppt_templates_owner
            ON ppt_templates(owner_scope, status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_ppt_templates_scene
            ON ppt_templates(scene, source, status);

        CREATE TABLE IF NOT EXISTS ppt_assets (
            id TEXT PRIMARY KEY,
            owner_scope TEXT NOT NULL,
            kind TEXT NOT NULL,
            storage_path TEXT NOT NULL UNIQUE,
            mime_type TEXT NOT NULL,
            size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
            sha256 TEXT NOT NULL,
            source_url TEXT,
            attribution_json TEXT,
            created_at TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ppt_assets_owner ON ppt_assets(owner_scope, kind);

        CREATE TABLE IF NOT EXISTS ppt_template_pages (
            template_id TEXT NOT NULL REFERENCES ppt_templates(id) ON DELETE CASCADE,
            page_number INTEGER NOT NULL CHECK (page_number >= 1),
            thumbnail_asset_id TEXT REFERENCES ppt_assets(id),
            preview_asset_id TEXT REFERENCES ppt_assets(id),
            status TEXT NOT NULL,
            error_code TEXT,
            PRIMARY KEY (template_id, page_number)
        );

        CREATE TABLE IF NOT EXISTS ppt_presentations (
            id TEXT PRIMARY KEY,
            owner_scope TEXT NOT NULL,
            template_id TEXT REFERENCES ppt_templates(id),
            title TEXT NOT NULL,
            current_revision INTEGER NOT NULL CHECK (current_revision >= 0),
            document_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ppt_presentations_owner
            ON ppt_presentations(owner_scope, updated_at DESC);

        CREATE TABLE IF NOT EXISTS ppt_revisions (
            presentation_id TEXT NOT NULL REFERENCES ppt_presentations(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL CHECK (revision >= 0),
            document_json TEXT NOT NULL,
            operations_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (presentation_id, revision)
        );

        CREATE TABLE IF NOT EXISTS ppt_applied_operations (
            presentation_id TEXT NOT NULL REFERENCES ppt_presentations(id) ON DELETE CASCADE,
            operation_id TEXT NOT NULL,
            revision INTEGER NOT NULL,
            payload_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (presentation_id, operation_id)
        );

        CREATE TABLE IF NOT EXISTS ppt_runs (
            id TEXT PRIMARY KEY,
            presentation_id TEXT NOT NULL REFERENCES ppt_presentations(id) ON DELETE CASCADE,
            owner_scope TEXT NOT NULL,
            status TEXT NOT NULL,
            phase TEXT NOT NULL,
            state_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ppt_runs_presentation
            ON ppt_runs(presentation_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS ppt_run_events (
            run_id TEXT NOT NULL REFERENCES ppt_runs(id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL CHECK (sequence >= 1),
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (run_id, sequence)
        );
        CREATE TRIGGER IF NOT EXISTS trg_ppt_run_events_no_update
        BEFORE UPDATE ON ppt_run_events
        BEGIN
            SELECT RAISE(ABORT, 'ppt_run_events is append-only');
        END;
        CREATE TRIGGER IF NOT EXISTS trg_ppt_run_events_no_delete
        BEFORE DELETE ON ppt_run_events
        BEGIN
            SELECT RAISE(ABORT, 'ppt_run_events is append-only');
        END;

        CREATE TABLE IF NOT EXISTS ppt_exports (
            id TEXT PRIMARY KEY,
            presentation_id TEXT NOT NULL REFERENCES ppt_presentations(id) ON DELETE CASCADE,
            owner_scope TEXT NOT NULL,
            revision INTEGER NOT NULL CHECK (revision >= 0),
            status TEXT NOT NULL,
            asset_id TEXT REFERENCES ppt_assets(id),
            error_code TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ppt_exports_presentation
            ON ppt_exports(presentation_id, created_at DESC);
        """
        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(schema)
            connection.execute(
                "INSERT OR IGNORE INTO ppt_schema_migrations(version, applied_at) VALUES (?, ?)",
                (1, _now()),
            )

    @staticmethod
    def _template(row: sqlite3.Row) -> TemplateRecord:
        return TemplateRecord(
            id=row["id"],
            owner_scope=row["owner_scope"],
            name=row["name"],
            description=row["description"],
            scene=row["scene"],
            source=row["source"],
            status=row["status"],
            manifest=_json_load(row["manifest_json"], {}),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create_template(
        self,
        *,
        template_id: str,
        owner_scope: str,
        name: str,
        scene: str,
        source: TemplateSource,
        status: str,
        manifest: dict[str, Any],
        description: str | None = None,
        source_asset_id: str | None = None,
    ) -> TemplateRecord:
        timestamp = _now()
        try:
            with self._connection() as connection:
                connection.execute(
                    """
                    INSERT INTO ppt_templates(
                        id, owner_scope, name, description, scene, source, status,
                        manifest_json, source_asset_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        template_id,
                        owner_scope,
                        name,
                        description,
                        scene,
                        source,
                        status,
                        _json_dump(manifest),
                        source_asset_id,
                        timestamp,
                        timestamp,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise RepositoryConflict(f"template already exists: {template_id}") from exc
        record = self.get_template(template_id, owner_scope=owner_scope)
        assert record is not None
        return record

    def get_template(self, template_id: str, *, owner_scope: str) -> TemplateRecord | None:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT * FROM ppt_templates
                WHERE id = ? AND deleted_at IS NULL
                  AND (source = 'SYSTEM' OR owner_scope = ?)
                """,
                (template_id, owner_scope),
            ).fetchone()
        return self._template(row) if row else None

    def list_templates(
        self,
        *,
        owner_scope: str,
        limit: int = 50,
        offset: int = 0,
        scene: str | None = None,
        source: TemplateSource | None = None,
        query: str | None = None,
    ) -> list[TemplateRecord]:
        limit = max(1, min(limit, 100))
        offset = max(0, offset)
        clauses = ["deleted_at IS NULL", "(source = 'SYSTEM' OR owner_scope = ?)"]
        parameters: list[Any] = [owner_scope]
        if scene:
            clauses.append("scene = ?")
            parameters.append(scene)
        if source:
            clauses.append("source = ?")
            parameters.append(source)
        if query:
            clauses.append("(name LIKE ? ESCAPE '\\' OR COALESCE(description, '') LIKE ? ESCAPE '\\')")
            escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            parameters.extend([f"%{escaped}%", f"%{escaped}%"])
        parameters.extend([limit, offset])
        sql = f"""
            SELECT * FROM ppt_templates
            WHERE {' AND '.join(clauses)}
            ORDER BY CASE source WHEN 'SYSTEM' THEN 0 ELSE 1 END, created_at DESC
            LIMIT ? OFFSET ?
        """
        with self._connection() as connection:
            rows = connection.execute(sql, parameters).fetchall()
        return [self._template(row) for row in rows]

    def delete_template(self, template_id: str, *, owner_scope: str) -> bool:
        timestamp = _now()
        with self._connection(immediate=True) as connection:
            cursor = connection.execute(
                """
                UPDATE ppt_templates SET deleted_at = ?, updated_at = ?
                WHERE id = ? AND owner_scope = ? AND source = 'PRIVATE' AND deleted_at IS NULL
                """,
                (timestamp, timestamp, template_id, owner_scope),
            )
        return cursor.rowcount == 1

    def update_template(
        self,
        template_id: str,
        *,
        owner_scope: str,
        name: str | None = None,
        description: str | None = None,
        scene: str | None = None,
    ) -> TemplateRecord | None:
        assignments: list[str] = []
        parameters: list[Any] = []
        if name is not None:
            assignments.append("name = ?")
            parameters.append(name)
        if description is not None:
            assignments.append("description = ?")
            parameters.append(description)
        if scene is not None:
            assignments.append("scene = ?")
            parameters.append(scene)
        if not assignments:
            return self.get_template(template_id, owner_scope=owner_scope)
        assignments.append("updated_at = ?")
        parameters.append(_now())
        parameters.extend([template_id, owner_scope])
        with self._connection(immediate=True) as connection:
            cursor = connection.execute(
                f"""
                UPDATE ppt_templates SET {', '.join(assignments)}
                WHERE id = ? AND owner_scope = ? AND source = 'PRIVATE' AND deleted_at IS NULL
                """,
                parameters,
            )
        if cursor.rowcount != 1:
            return None
        return self.get_template(template_id, owner_scope=owner_scope)

    def update_template_processing(
        self,
        template_id: str,
        *,
        owner_scope: str,
        status: str,
        manifest_patch: dict[str, Any] | None = None,
    ) -> TemplateRecord | None:
        """Atomically advance a private template parser and merge its manifest.

        Parsing runs in a background task, so status and progress must be durable
        before the browser polls again.  The patch is merged server-side rather
        than replacing the manifest, which keeps source metadata and page counts.
        """
        with self._connection(immediate=True) as connection:
            row = connection.execute(
                """
                SELECT manifest_json FROM ppt_templates
                WHERE id = ? AND owner_scope = ? AND source = 'PRIVATE' AND deleted_at IS NULL
                """,
                (template_id, owner_scope),
            ).fetchone()
            if row is None:
                return None
            manifest = _json_load(row["manifest_json"], {})
            if not isinstance(manifest, dict):
                manifest = {}
            if manifest_patch:
                manifest.update(manifest_patch)
            connection.execute(
                """
                UPDATE ppt_templates
                SET status = ?, manifest_json = ?, updated_at = ?
                WHERE id = ? AND owner_scope = ? AND source = 'PRIVATE' AND deleted_at IS NULL
                """,
                (status, _json_dump(manifest), _now(), template_id, owner_scope),
            )
        return self.get_template(template_id, owner_scope=owner_scope)

    def upsert_template_page(
        self,
        *,
        template_id: str,
        page_number: int,
        status: str,
        thumbnail_asset_id: str | None = None,
        preview_asset_id: str | None = None,
        error_code: str | None = None,
    ) -> None:
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO ppt_template_pages(
                    template_id, page_number, thumbnail_asset_id, preview_asset_id, status, error_code
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(template_id, page_number) DO UPDATE SET
                    thumbnail_asset_id=excluded.thumbnail_asset_id,
                    preview_asset_id=excluded.preview_asset_id,
                    status=excluded.status,
                    error_code=excluded.error_code
                """,
                (template_id, page_number, thumbnail_asset_id, preview_asset_id, status, error_code),
            )

    def list_template_pages(self, template_id: str, *, owner_scope: str) -> list[TemplatePageRecord]:
        if self.get_template(template_id, owner_scope=owner_scope) is None:
            return []
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM ppt_template_pages WHERE template_id = ? ORDER BY page_number",
                (template_id,),
            ).fetchall()
        return [
            TemplatePageRecord(
                template_id=row["template_id"],
                page_number=row["page_number"],
                thumbnail_asset_id=row["thumbnail_asset_id"],
                preview_asset_id=row["preview_asset_id"],
                status=row["status"],
                error_code=row["error_code"],
            )
            for row in rows
        ]

    def create_asset(
        self,
        *,
        asset_id: str,
        owner_scope: str,
        kind: str,
        storage_path: str,
        mime_type: str,
        size_bytes: int,
        sha256: str,
        source_url: str | None = None,
        attribution: dict[str, Any] | None = None,
    ) -> AssetRecord:
        storage_path = _validate_storage_path(storage_path)
        timestamp = _now()
        try:
            with self._connection() as connection:
                connection.execute(
                    """
                    INSERT INTO ppt_assets(
                        id, owner_scope, kind, storage_path, mime_type, size_bytes,
                        sha256, source_url, attribution_json, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        asset_id,
                        owner_scope,
                        kind,
                        storage_path,
                        mime_type,
                        size_bytes,
                        sha256,
                        source_url,
                        _json_dump(attribution) if attribution is not None else None,
                        timestamp,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise RepositoryConflict(f"asset already exists: {asset_id}") from exc
        record = self.get_asset(asset_id, owner_scope=owner_scope)
        assert record is not None
        return record

    def get_asset(self, asset_id: str, *, owner_scope: str) -> AssetRecord | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM ppt_assets WHERE id = ? AND owner_scope = ? AND deleted_at IS NULL",
                (asset_id, owner_scope),
            ).fetchone()
        if row is None:
            return None
        return AssetRecord(
            id=row["id"],
            owner_scope=row["owner_scope"],
            kind=row["kind"],
            storage_path=row["storage_path"],
            mime_type=row["mime_type"],
            size_bytes=row["size_bytes"],
            sha256=row["sha256"],
            source_url=row["source_url"],
            attribution=_json_load(row["attribution_json"], None),
            created_at=row["created_at"],
        )

    @staticmethod
    def _presentation(row: sqlite3.Row) -> PresentationRecord:
        return PresentationRecord(
            id=row["id"],
            owner_scope=row["owner_scope"],
            template_id=row["template_id"],
            title=row["title"],
            current_revision=row["current_revision"],
            document=_json_load(row["document_json"], {}),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create_presentation(
        self,
        *,
        presentation_id: str,
        owner_scope: str,
        title: str,
        document: dict[str, Any],
        template_id: str | None,
    ) -> PresentationRecord:
        revision = int(document.get("revision", 0))
        timestamp = _now()
        encoded = _json_dump(document)
        try:
            with self._connection(immediate=True) as connection:
                connection.execute(
                    """
                    INSERT INTO ppt_presentations(
                        id, owner_scope, template_id, title, current_revision,
                        document_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        presentation_id,
                        owner_scope,
                        template_id,
                        title,
                        revision,
                        encoded,
                        timestamp,
                        timestamp,
                    ),
                )
                connection.execute(
                    """
                    INSERT INTO ppt_revisions(
                        presentation_id, revision, document_json, operations_json, created_at
                    ) VALUES (?, ?, ?, '[]', ?)
                    """,
                    (presentation_id, revision, encoded, timestamp),
                )
        except sqlite3.IntegrityError as exc:
            raise RepositoryConflict(f"presentation could not be created: {presentation_id}") from exc
        record = self.get_presentation(presentation_id, owner_scope=owner_scope)
        assert record is not None
        return record

    def get_presentation(self, presentation_id: str, *, owner_scope: str) -> PresentationRecord | None:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT * FROM ppt_presentations
                WHERE id = ? AND owner_scope = ? AND deleted_at IS NULL
                """,
                (presentation_id, owner_scope),
            ).fetchone()
        return self._presentation(row) if row else None

    def commit_revision(
        self,
        *,
        presentation_id: str,
        owner_scope: str,
        expected_revision: int,
        document: dict[str, Any],
        operations: list[dict[str, Any]],
        operation_payloads: dict[str, str],
    ) -> None:
        new_revision = int(document.get("revision", -1))
        if new_revision != expected_revision + 1:
            raise RepositoryConflict("new document revision must increment expected revision by one")
        timestamp = _now()
        encoded_document = _json_dump(document)
        encoded_operations = _json_dump(operations)
        try:
            with self._connection(immediate=True) as connection:
                row = connection.execute(
                    """
                    SELECT current_revision FROM ppt_presentations
                    WHERE id = ? AND owner_scope = ? AND deleted_at IS NULL
                    """,
                    (presentation_id, owner_scope),
                ).fetchone()
                if row is None:
                    raise RepositoryConflict("presentation does not exist")
                if row["current_revision"] != expected_revision:
                    raise RepositoryConflict(
                        f"revision conflict: current revision is {row['current_revision']}"
                    )
                connection.execute(
                    """
                    INSERT INTO ppt_revisions(
                        presentation_id, revision, document_json, operations_json, created_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (presentation_id, new_revision, encoded_document, encoded_operations, timestamp),
                )
                for operation_id, payload_hash in operation_payloads.items():
                    connection.execute(
                        """
                        INSERT INTO ppt_applied_operations(
                            presentation_id, operation_id, revision, payload_hash, created_at
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        (presentation_id, operation_id, new_revision, payload_hash, timestamp),
                    )
                connection.execute(
                    """
                    UPDATE ppt_presentations
                    SET title = ?, current_revision = ?, document_json = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (document.get("title", "Untitled"), new_revision, encoded_document, timestamp, presentation_id),
                )
        except sqlite3.IntegrityError as exc:
            raise RepositoryConflict("revision or operation already exists") from exc

    def get_applied_operation_ids(
        self,
        presentation_id: str,
        operation_ids: list[str],
    ) -> set[str]:
        if not operation_ids:
            return set()
        placeholders = ",".join("?" for _ in operation_ids)
        with self._connection() as connection:
            rows = connection.execute(
                f"""
                SELECT operation_id FROM ppt_applied_operations
                WHERE presentation_id = ? AND operation_id IN ({placeholders})
                """,
                [presentation_id, *operation_ids],
            ).fetchall()
        return {row["operation_id"] for row in rows}

    def create_run(
        self,
        *,
        run_id: str,
        presentation_id: str,
        owner_scope: str,
        status: str,
        phase: str,
        state: dict[str, Any],
    ) -> RunRecord:
        timestamp = _now()
        try:
            with self._connection() as connection:
                connection.execute(
                    """
                    INSERT INTO ppt_runs(
                        id, presentation_id, owner_scope, status, phase,
                        state_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        presentation_id,
                        owner_scope,
                        status,
                        phase,
                        _json_dump(state),
                        timestamp,
                        timestamp,
                    ),
                )
        except sqlite3.IntegrityError as exc:
            raise RepositoryConflict(f"run could not be created: {run_id}") from exc
        record = self.get_run(run_id, owner_scope=owner_scope)
        assert record is not None
        return record

    def get_run(self, run_id: str, *, owner_scope: str) -> RunRecord | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM ppt_runs WHERE id = ? AND owner_scope = ?",
                (run_id, owner_scope),
            ).fetchone()
        if row is None:
            return None
        return RunRecord(
            id=row["id"],
            presentation_id=row["presentation_id"],
            owner_scope=row["owner_scope"],
            status=row["status"],
            phase=row["phase"],
            state=_json_load(row["state_json"], {}),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def list_runs(
        self,
        *,
        owner_scope: str,
        statuses: set[str] | frozenset[str] | None = None,
        limit: int = 20,
    ) -> list[RunRecord]:
        """Return durable runs for a user, newest updates first.

        The query intentionally lives in the repository so callers never need
        to reconstruct resumable sessions from the in-memory worker registry.
        """
        safe_limit = max(1, min(int(limit), 100))
        clauses = ["owner_scope = ?"]
        params: list[Any] = [owner_scope]
        if statuses:
            ordered_statuses = sorted(statuses)
            placeholders = ",".join("?" for _ in ordered_statuses)
            clauses.append(f"status IN ({placeholders})")
            params.extend(ordered_statuses)
        with self._connection() as connection:
            rows = connection.execute(
                f"""
                SELECT * FROM ppt_runs
                WHERE {' AND '.join(clauses)}
                ORDER BY updated_at DESC, created_at DESC
                LIMIT ?
                """,
                [*params, safe_limit],
            ).fetchall()
        return [
            RunRecord(
                id=row["id"],
                presentation_id=row["presentation_id"],
                owner_scope=row["owner_scope"],
                status=row["status"],
                phase=row["phase"],
                state=_json_load(row["state_json"], {}),
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )
            for row in rows
        ]

    def update_run(
        self,
        run_id: str,
        *,
        owner_scope: str,
        status: str,
        phase: str,
        state: dict[str, Any],
    ) -> bool:
        with self._connection(immediate=True) as connection:
            cursor = connection.execute(
                """
                UPDATE ppt_runs SET status = ?, phase = ?, state_json = ?, updated_at = ?
                WHERE id = ? AND owner_scope = ?
                """,
                (status, phase, _json_dump(state), _now(), run_id, owner_scope),
            )
        return cursor.rowcount == 1

    def append_run_event(
        self,
        *,
        run_id: str,
        sequence: int,
        event_type: str,
        payload: dict[str, Any],
    ) -> RunEventRecord:
        timestamp = _now()
        try:
            with self._connection() as connection:
                connection.execute(
                    """
                    INSERT INTO ppt_run_events(run_id, sequence, event_type, payload_json, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (run_id, sequence, event_type, _json_dump(payload), timestamp),
                )
        except sqlite3.IntegrityError as exc:
            raise RepositoryConflict(f"event sequence already exists: {run_id}/{sequence}") from exc
        return RunEventRecord(run_id, sequence, event_type, copy_dict(payload), timestamp)

    def list_run_events(
        self,
        run_id: str,
        *,
        after_sequence: int,
        limit: int,
    ) -> list[RunEventRecord]:
        limit = max(1, min(limit, 1_000))
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT * FROM ppt_run_events
                WHERE run_id = ? AND sequence > ?
                ORDER BY sequence LIMIT ?
                """,
                (run_id, max(0, after_sequence), limit),
            ).fetchall()
        return [
            RunEventRecord(
                run_id=row["run_id"],
                sequence=row["sequence"],
                event_type=row["event_type"],
                payload=_json_load(row["payload_json"], {}),
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def create_export(
        self,
        *,
        export_id: str,
        presentation_id: str,
        owner_scope: str,
        revision: int,
        status: str = "QUEUED",
    ) -> ExportRecord:
        timestamp = _now()
        try:
            with self._connection() as connection:
                connection.execute(
                    """
                    INSERT INTO ppt_exports(
                        id, presentation_id, owner_scope, revision, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (export_id, presentation_id, owner_scope, revision, status, timestamp, timestamp),
                )
        except sqlite3.IntegrityError as exc:
            raise RepositoryConflict(f"export could not be created: {export_id}") from exc
        record = self.get_export(export_id, owner_scope=owner_scope)
        assert record is not None
        return record

    def get_export(self, export_id: str, *, owner_scope: str) -> ExportRecord | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM ppt_exports WHERE id = ? AND owner_scope = ?",
                (export_id, owner_scope),
            ).fetchone()
        if row is None:
            return None
        return ExportRecord(
            id=row["id"],
            presentation_id=row["presentation_id"],
            owner_scope=row["owner_scope"],
            revision=row["revision"],
            status=row["status"],
            asset_id=row["asset_id"],
            error_code=row["error_code"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def update_export(
        self,
        export_id: str,
        *,
        owner_scope: str,
        status: str,
        asset_id: str | None = None,
        error_code: str | None = None,
    ) -> bool:
        with self._connection(immediate=True) as connection:
            cursor = connection.execute(
                """
                UPDATE ppt_exports
                SET status = ?, asset_id = ?, error_code = ?, updated_at = ?
                WHERE id = ? AND owner_scope = ?
                """,
                (status, asset_id, error_code, _now(), export_id, owner_scope),
            )
        return cursor.rowcount == 1


def copy_dict(value: dict[str, Any]) -> dict[str, Any]:
    """Return a JSON-safe copy without leaking caller mutations."""

    return _json_load(_json_dump(value), {})
