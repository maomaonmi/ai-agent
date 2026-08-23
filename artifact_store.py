"""Durable artifact, version, message-link, and derivation persistence."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

from session_memory import SessionNotFoundError


class ArtifactNotFoundError(LookupError):
    pass


class ArtifactVersionNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class ArtifactRecord:
    id: str
    project_id: str | None
    origin_conversation_id: str
    kind: str
    title: str
    summary: str
    status: str
    current_version_id: str
    metadata: dict[str, Any]
    created_at: float
    updated_at: float


@dataclass(frozen=True)
class ArtifactVersionRecord:
    id: str
    artifact_id: str
    version_number: int
    parent_version_id: str | None
    status: str
    source_ref: dict[str, Any]
    payload: Any
    summary: str
    created_by_message_id: str | None
    created_at: float


@dataclass(frozen=True)
class MessageArtifactLinkRecord:
    id: str
    conversation_id: str
    message_id: str
    artifact_id: str
    version_id: str
    relation: str
    display_order: int
    created_at: float


@dataclass(frozen=True)
class ArtifactRelationRecord:
    id: str
    source_artifact_id: str
    source_version_id: str | None
    target_artifact_id: str
    target_version_id: str | None
    relation: str
    created_at: float


class ArtifactStore:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS artifacts (
                    id TEXT PRIMARY KEY,
                    project_id TEXT,
                    origin_conversation_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    status TEXT NOT NULL,
                    current_version_id TEXT NOT NULL,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
                    FOREIGN KEY (origin_conversation_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_artifacts_project_updated
                    ON artifacts(project_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_artifacts_origin_updated
                    ON artifacts(origin_conversation_id, updated_at DESC);

                CREATE TABLE IF NOT EXISTS artifact_versions (
                    id TEXT PRIMARY KEY,
                    artifact_id TEXT NOT NULL,
                    version_number INTEGER NOT NULL,
                    parent_version_id TEXT,
                    status TEXT NOT NULL,
                    source_ref_json TEXT NOT NULL,
                    payload_json TEXT,
                    summary TEXT NOT NULL,
                    created_by_message_id TEXT,
                    created_at REAL NOT NULL,
                    UNIQUE (artifact_id, version_number),
                    FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
                    FOREIGN KEY (parent_version_id) REFERENCES artifact_versions(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact_number
                    ON artifact_versions(artifact_id, version_number DESC);

                CREATE TABLE IF NOT EXISTS message_artifact_links (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    version_id TEXT NOT NULL,
                    relation TEXT NOT NULL,
                    display_order INTEGER NOT NULL DEFAULT 0,
                    created_at REAL NOT NULL,
                    UNIQUE (message_id, artifact_id, version_id, relation),
                    FOREIGN KEY (conversation_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
                    FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
                    FOREIGN KEY (version_id) REFERENCES artifact_versions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_message_artifact_links_message
                    ON message_artifact_links(message_id, display_order ASC);
                CREATE INDEX IF NOT EXISTS idx_message_artifact_links_conversation
                    ON message_artifact_links(conversation_id, created_at ASC);

                CREATE TABLE IF NOT EXISTS artifact_relations (
                    id TEXT PRIMARY KEY,
                    source_artifact_id TEXT NOT NULL,
                    source_version_id TEXT,
                    target_artifact_id TEXT NOT NULL,
                    target_version_id TEXT,
                    relation TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    FOREIGN KEY (source_artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
                    FOREIGN KEY (source_version_id) REFERENCES artifact_versions(id) ON DELETE SET NULL,
                    FOREIGN KEY (target_artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
                    FOREIGN KEY (target_version_id) REFERENCES artifact_versions(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_artifact_relations_target
                    ON artifact_relations(target_artifact_id, created_at ASC);
                """
            )
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(artifact_versions)")}
            if "payload_json" not in columns:
                connection.execute("ALTER TABLE artifact_versions ADD COLUMN payload_json TEXT")

    @staticmethod
    def _artifact(row: sqlite3.Row) -> ArtifactRecord:
        return ArtifactRecord(
            id=row["id"], project_id=row["project_id"],
            origin_conversation_id=row["origin_conversation_id"], kind=row["kind"],
            title=row["title"], summary=row["summary"], status=row["status"],
            current_version_id=row["current_version_id"],
            metadata=json.loads(row["metadata_json"] or "{}"),
            created_at=row["created_at"], updated_at=row["updated_at"],
        )

    @staticmethod
    def _version(row: sqlite3.Row) -> ArtifactVersionRecord:
        return ArtifactVersionRecord(
            id=row["id"], artifact_id=row["artifact_id"],
            version_number=row["version_number"], parent_version_id=row["parent_version_id"],
            status=row["status"], source_ref=json.loads(row["source_ref_json"]),
            payload=json.loads(row["payload_json"]) if row["payload_json"] else None,
            summary=row["summary"], created_by_message_id=row["created_by_message_id"],
            created_at=row["created_at"],
        )

    @staticmethod
    def _link(row: sqlite3.Row) -> MessageArtifactLinkRecord:
        return MessageArtifactLinkRecord(**dict(row))

    @staticmethod
    def _relation(row: sqlite3.Row) -> ArtifactRelationRecord:
        return ArtifactRelationRecord(**dict(row))

    def create_with_version(
        self, *, conversation_id: str, message_id: str, kind: str, title: str,
        summary: str, source_ref: dict[str, Any], relation: str = "created",
        project_id: str | None = None, metadata: dict[str, Any] | None = None,
        status: str = "ready", payload: Any = None,
    ) -> tuple[ArtifactRecord, ArtifactVersionRecord, MessageArtifactLinkRecord]:
        now = time.time()
        artifact_id, version_id, link_id = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
        with self._connection() as connection:
            session = connection.execute(
                "SELECT project_id FROM sessions WHERE session_id = ?", (conversation_id,)
            ).fetchone()
            if session is None:
                raise SessionNotFoundError(conversation_id)
            effective_project_id = project_id if project_id is not None else session["project_id"]
            connection.execute(
                """INSERT INTO artifacts
                (id, project_id, origin_conversation_id, kind, title, summary, status,
                 current_version_id, metadata_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (artifact_id, effective_project_id, conversation_id, kind, title.strip()[:200],
                 summary, status, version_id, json.dumps(metadata or {}, ensure_ascii=False), now, now),
            )
            connection.execute(
                """INSERT INTO artifact_versions
                (id, artifact_id, version_number, parent_version_id, status, source_ref_json,
                 payload_json, summary, created_by_message_id, created_at)
                VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?)""",
                (version_id, artifact_id, status, json.dumps(source_ref, ensure_ascii=False),
                 json.dumps(payload, ensure_ascii=False) if payload is not None else None, summary, message_id, now),
            )
            connection.execute(
                """INSERT INTO message_artifact_links
                (id, conversation_id, message_id, artifact_id, version_id, relation, display_order, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?)""",
                (link_id, conversation_id, message_id, artifact_id, version_id, relation, now),
            )
        return self.get(artifact_id), self.get_version(version_id), self.get_link(link_id)

    def add_version(
        self, *, artifact_id: str, conversation_id: str, message_id: str,
        summary: str, source_ref: dict[str, Any], relation: str = "updated",
        status: str = "ready", payload: Any = None,
    ) -> tuple[ArtifactVersionRecord, MessageArtifactLinkRecord]:
        now, version_id, link_id = time.time(), str(uuid.uuid4()), str(uuid.uuid4())
        with self._connection() as connection:
            artifact = connection.execute(
                "SELECT current_version_id FROM artifacts WHERE id = ?", (artifact_id,)
            ).fetchone()
            if artifact is None:
                raise ArtifactNotFoundError(artifact_id)
            latest = connection.execute(
                "SELECT MAX(version_number) AS number FROM artifact_versions WHERE artifact_id = ?",
                (artifact_id,),
            ).fetchone()["number"]
            connection.execute(
                """INSERT INTO artifact_versions
                (id, artifact_id, version_number, parent_version_id, status, source_ref_json,
                 payload_json, summary, created_by_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (version_id, artifact_id, latest + 1, artifact["current_version_id"], status,
                 json.dumps(source_ref, ensure_ascii=False),
                 json.dumps(payload, ensure_ascii=False) if payload is not None else None, summary, message_id, now),
            )
            connection.execute(
                "UPDATE artifacts SET current_version_id = ?, summary = ?, status = ?, updated_at = ? WHERE id = ?",
                (version_id, summary, status, now, artifact_id),
            )
            connection.execute(
                """INSERT INTO message_artifact_links
                (id, conversation_id, message_id, artifact_id, version_id, relation, display_order, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?)""",
                (link_id, conversation_id, message_id, artifact_id, version_id, relation, now),
            )
        return self.get_version(version_id), self.get_link(link_id)

    def get(self, artifact_id: str) -> ArtifactRecord:
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM artifacts WHERE id = ?", (artifact_id,)).fetchone()
        if row is None: raise ArtifactNotFoundError(artifact_id)
        return self._artifact(row)

    def get_version(self, version_id: str) -> ArtifactVersionRecord:
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM artifact_versions WHERE id = ?", (version_id,)).fetchone()
        if row is None: raise ArtifactVersionNotFoundError(version_id)
        return self._version(row)

    def get_link(self, link_id: str) -> MessageArtifactLinkRecord:
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM message_artifact_links WHERE id = ?", (link_id,)).fetchone()
        if row is None: raise LookupError(link_id)
        return self._link(row)

    def list_versions(self, artifact_id: str) -> list[ArtifactVersionRecord]:
        self.get(artifact_id)
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version_number DESC", (artifact_id,)
            ).fetchall()
        return [self._version(row) for row in rows]

    def link_message(self, *, conversation_id: str, message_id: str, artifact_id: str,
                     version_id: str, relation: str, display_order: int = 0) -> MessageArtifactLinkRecord:
        self.get(artifact_id)
        version = self.get_version(version_id)
        if version.artifact_id != artifact_id: raise ArtifactVersionNotFoundError(version_id)
        link_id, now = str(uuid.uuid4()), time.time()
        with self._connection() as connection:
            connection.execute(
                """INSERT INTO message_artifact_links
                (id, conversation_id, message_id, artifact_id, version_id, relation, display_order, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (link_id, conversation_id, message_id, artifact_id, version_id, relation, display_order, now),
            )
        return self.get_link(link_id)

    def get_message_links(self, message_id: str) -> list[MessageArtifactLinkRecord]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT * FROM message_artifact_links WHERE message_id = ? ORDER BY display_order, created_at", (message_id,)
            ).fetchall()
        return [self._link(row) for row in rows]

    def list_links_for_conversation(self, conversation_id: str) -> list[MessageArtifactLinkRecord]:
        with self._connection() as connection:
            rows = connection.execute(
                """SELECT * FROM message_artifact_links WHERE conversation_id = ?
                ORDER BY created_at, display_order, id""",
                (conversation_id,),
            ).fetchall()
        return [self._link(row) for row in rows]

    def list_for_conversation(self, conversation_id: str) -> list[ArtifactRecord]:
        with self._connection() as connection:
            rows = connection.execute(
                """SELECT DISTINCT a.* FROM artifacts a JOIN message_artifact_links l ON l.artifact_id = a.id
                WHERE l.conversation_id = ? ORDER BY a.updated_at DESC, a.id""", (conversation_id,)
            ).fetchall()
        return [self._artifact(row) for row in rows]

    def search(self, query: str = "", *, limit: int = 20) -> list[ArtifactRecord]:
        """Search artifact summaries without loading immutable version payloads."""
        cleaned = query.strip().lower()
        pattern = f"%{cleaned}%"
        with self._connection() as connection:
            rows = connection.execute(
                """SELECT * FROM artifacts
                WHERE (? = '' OR lower(title) LIKE ? OR lower(summary) LIKE ?)
                ORDER BY updated_at DESC, id ASC LIMIT ?""",
                (cleaned, pattern, pattern, max(1, min(limit, 50))),
            ).fetchall()
        return [self._artifact(row) for row in rows]

    def list_for_project(self, project_id: str, *, limit: int = 20) -> list[ArtifactRecord]:
        with self._connection() as connection:
            rows = connection.execute(
                """SELECT * FROM artifacts WHERE project_id = ?
                ORDER BY updated_at DESC, id ASC LIMIT ?""",
                (project_id, max(1, min(limit, 50))),
            ).fetchall()
        return [self._artifact(row) for row in rows]

    def add_relation(self, *, source_artifact_id: str, target_artifact_id: str, relation: str,
                     source_version_id: str | None = None, target_version_id: str | None = None) -> ArtifactRelationRecord:
        self.get(source_artifact_id)
        self.get(target_artifact_id)
        if source_version_id is not None and self.get_version(source_version_id).artifact_id != source_artifact_id:
            raise ArtifactVersionNotFoundError(source_version_id)
        if target_version_id is not None and self.get_version(target_version_id).artifact_id != target_artifact_id:
            raise ArtifactVersionNotFoundError(target_version_id)
        relation_id, now = str(uuid.uuid4()), time.time()
        with self._connection() as connection:
            connection.execute(
                """INSERT INTO artifact_relations
                (id, source_artifact_id, source_version_id, target_artifact_id, target_version_id, relation, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (relation_id, source_artifact_id, source_version_id, target_artifact_id, target_version_id, relation, now),
            )
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM artifact_relations WHERE id = ?", (relation_id,)).fetchone()
        return self._relation(row)

    def list_relations(self, artifact_id: str) -> list[ArtifactRelationRecord]:
        self.get(artifact_id)
        with self._connection() as connection:
            rows = connection.execute(
                """SELECT * FROM artifact_relations WHERE source_artifact_id = ? OR target_artifact_id = ?
                ORDER BY created_at, id""", (artifact_id, artifact_id)
            ).fetchall()
        return [self._relation(row) for row in rows]
