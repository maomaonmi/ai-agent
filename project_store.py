"""SQLite persistence for optional project ownership of conversations."""

from __future__ import annotations

import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterator

from session_memory import SessionNotFoundError


class ProjectNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class Project:
    id: str
    name: str
    description: str | None
    summary: str | None
    created_at: float
    updated_at: float
    archived_at: float | None

    def to_dict(self) -> dict:
        return asdict(self)


class ProjectStore:
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
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    summary TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    archived_at REAL
                )
                """
            )
            session_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(sessions)").fetchall()
            }
            if "project_id" not in session_columns:
                connection.execute(
                    """
                    ALTER TABLE sessions ADD COLUMN project_id TEXT
                    REFERENCES projects(id) ON DELETE SET NULL
                    """
                )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_sessions_project_updated ON sessions(project_id, updated_at DESC)"
            )

    @staticmethod
    def _from_row(row: sqlite3.Row) -> Project:
        return Project(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            summary=row["summary"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            archived_at=row["archived_at"],
        )

    def create(self, name: str, description: str | None = None) -> Project:
        cleaned_name = name.strip()
        if not cleaned_name:
            raise ValueError("Project name is required")
        now = time.time()
        project_id = str(uuid.uuid4())
        cleaned_description = description.strip() if description and description.strip() else None
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO projects (id, name, description, summary, created_at, updated_at, archived_at)
                VALUES (?, ?, ?, NULL, ?, ?, NULL)
                """,
                (project_id, cleaned_name[:80], cleaned_description, now, now),
            )
        return self.get(project_id)

    def list(self, *, include_archived: bool = False) -> list[Project]:
        where = "" if include_archived else "WHERE archived_at IS NULL"
        with self._connection() as connection:
            rows = connection.execute(
                f"""
                SELECT id, name, description, summary, created_at, updated_at, archived_at
                FROM projects {where}
                ORDER BY updated_at DESC, id ASC
                """
            ).fetchall()
        return [self._from_row(row) for row in rows]

    def get(self, project_id: str) -> Project:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT id, name, description, summary, created_at, updated_at, archived_at
                FROM projects WHERE id = ?
                """,
                (project_id,),
            ).fetchone()
        if row is None:
            raise ProjectNotFoundError(project_id)
        return self._from_row(row)

    def update(
        self,
        project_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        archived: bool | None = None,
    ) -> Project:
        current = self.get(project_id)
        next_name = current.name if name is None else name.strip()[:80]
        if not next_name:
            raise ValueError("Project name is required")
        next_description = current.description if description is None else (description.strip() or None)
        next_archived_at = current.archived_at
        if archived is True and next_archived_at is None:
            next_archived_at = time.time()
        elif archived is False:
            next_archived_at = None
        now = time.time()
        with self._connection() as connection:
            connection.execute(
                """
                UPDATE projects
                SET name = ?, description = ?, archived_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (next_name, next_description, next_archived_at, now, project_id),
            )
        return self.get(project_id)

    def delete(self, project_id: str) -> None:
        self.get(project_id)
        with self._connection() as connection:
            connection.execute("UPDATE sessions SET project_id = NULL WHERE project_id = ?", (project_id,))
            connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))

    def assign_conversation(self, project_id: str, session_id: str) -> None:
        self.get(project_id)
        now = time.time()
        with self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE sessions SET project_id = ?, updated_at = ?
                WHERE session_id = ?
                """,
                (project_id, now, session_id),
            )
            if cursor.rowcount == 0:
                raise SessionNotFoundError(session_id)
            connection.execute(
                "UPDATE projects SET updated_at = ? WHERE id = ?",
                (now, project_id),
            )
            has_artifacts = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'"
            ).fetchone()
            if has_artifacts:
                # Only origin artifacts move with their conversation. Artifacts
                # merely referenced from another project retain their owner.
                connection.execute(
                    "UPDATE artifacts SET project_id = ?, updated_at = ? WHERE origin_conversation_id = ?",
                    (project_id, now, session_id),
                )

    def remove_conversation(self, session_id: str) -> None:
        with self._connection() as connection:
            cursor = connection.execute(
                "UPDATE sessions SET project_id = NULL, updated_at = ? WHERE session_id = ?",
                (time.time(), session_id),
            )
            if cursor.rowcount == 0:
                raise SessionNotFoundError(session_id)
            has_artifacts = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'"
            ).fetchone()
            if has_artifacts:
                connection.execute(
                    "UPDATE artifacts SET project_id = NULL, updated_at = ? WHERE origin_conversation_id = ?",
                    (time.time(), session_id),
                )

    def get_conversation_project_id(self, session_id: str) -> str | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT project_id FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        if row is None:
            raise SessionNotFoundError(session_id)
        return row["project_id"]

    def list_conversation_ids(self, project_id: str) -> list[str]:
        self.get(project_id)
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT session_id FROM sessions
                WHERE project_id = ?
                ORDER BY updated_at DESC, session_id ASC
                """,
                (project_id,),
            ).fetchall()
        return [row["session_id"] for row in rows]
