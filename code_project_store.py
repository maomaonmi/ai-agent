from __future__ import annotations

import json
import sqlite3
import time
import uuid
import zlib
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator


PROJECT_CATEGORIES = frozenset({"utility", "web", "interactive", "education"})
PROJECT_KINDS = frozenset({"frontend", "fullstack"})


class CodeProjectNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class CodeProject:
    project_id: str
    source_session_id: str | None
    title: str
    category: str
    prompt: str
    optimized_prompt: str | None
    cover_image: str
    vfs: dict[str, str]
    project_kind: str
    published_run_id: str
    draft_run_id: str
    created_at: float
    updated_at: float
    published_at: float

    @property
    def has_unpublished_changes(self) -> bool:
        return self.draft_run_id != self.published_run_id


class CodeProjectStore:
    """Persist published code independently from disposable chat sessions."""

    COMPRESS_THRESHOLD = 100_000

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
                CREATE TABLE IF NOT EXISTS published_code_projects (
                    project_id TEXT PRIMARY KEY,
                    source_session_id TEXT,
                    title TEXT NOT NULL,
                    category TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    optimized_prompt TEXT,
                    cover_image TEXT NOT NULL,
                    vfs_blob BLOB NOT NULL,
                    is_compressed INTEGER NOT NULL DEFAULT 0,
                    project_kind TEXT NOT NULL,
                    published_run_id TEXT NOT NULL,
                    draft_run_id TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    published_at REAL NOT NULL,
                    FOREIGN KEY (source_session_id)
                        REFERENCES sessions(session_id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_code_projects_category_updated
                    ON published_code_projects(category, updated_at DESC);
                """
            )

    @staticmethod
    def _encode_vfs(vfs: dict[str, str]) -> tuple[bytes, int]:
        payload = json.dumps(vfs, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(payload) >= CodeProjectStore.COMPRESS_THRESHOLD:
            return zlib.compress(payload), 1
        return payload, 0

    @staticmethod
    def _decode_vfs(blob: bytes, compressed: int) -> dict[str, str]:
        payload = zlib.decompress(blob) if compressed else blob
        value = json.loads(payload.decode("utf-8"))
        if not isinstance(value, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in value.items()):
            raise ValueError("Stored VFS must be a mapping of string paths to string content")
        return value

    @classmethod
    def _row_to_project(cls, row: sqlite3.Row) -> CodeProject:
        return CodeProject(
            project_id=row["project_id"],
            source_session_id=row["source_session_id"],
            title=row["title"],
            category=row["category"],
            prompt=row["prompt"],
            optimized_prompt=row["optimized_prompt"],
            cover_image=row["cover_image"],
            vfs=cls._decode_vfs(row["vfs_blob"], row["is_compressed"]),
            project_kind=row["project_kind"],
            published_run_id=row["published_run_id"],
            draft_run_id=row["draft_run_id"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            published_at=row["published_at"],
        )

    def create(
        self,
        *,
        source_session_id: str | None,
        title: str,
        category: str,
        prompt: str,
        cover_image: str,
        vfs: dict[str, str],
        project_kind: str,
        published_run_id: str,
        optimized_prompt: str | None = None,
    ) -> CodeProject:
        cleaned_title = title.strip()[:80]
        if not cleaned_title:
            raise ValueError("title must be non-empty")
        if category not in PROJECT_CATEGORIES:
            raise ValueError(f"unsupported category: {category}")
        if project_kind not in PROJECT_KINDS:
            raise ValueError(f"unsupported project kind: {project_kind}")
        if not prompt.strip() or not vfs or not published_run_id.strip():
            raise ValueError("prompt, vfs and published_run_id must be non-empty")

        project_id = str(uuid.uuid4())
        now = time.time()
        vfs_blob, is_compressed = self._encode_vfs(vfs)
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO published_code_projects (
                    project_id, source_session_id, title, category, prompt,
                    optimized_prompt, cover_image, vfs_blob, is_compressed,
                    project_kind, published_run_id, draft_run_id,
                    created_at, updated_at, published_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    project_id, source_session_id, cleaned_title, category,
                    prompt.strip(), optimized_prompt, cover_image, vfs_blob,
                    is_compressed, project_kind, published_run_id,
                    published_run_id, now, now, now,
                ),
            )
        return self.get(project_id)

    def upsert_for_session(self, **values) -> CodeProject:
        source_session_id = values.get("source_session_id")
        if not source_session_id:
            return self.create(**values)
        with self._connection() as connection:
            row = connection.execute(
                "SELECT project_id FROM published_code_projects WHERE source_session_id = ? ORDER BY created_at LIMIT 1",
                (source_session_id,),
            ).fetchone()
        if row is None:
            return self.create(**values)

        category = values["category"]
        project_kind = values["project_kind"]
        title = values["title"].strip()[:80]
        prompt = values["prompt"].strip()
        published_run_id = values["published_run_id"].strip()
        if not title or not prompt or not values["vfs"] or not published_run_id:
            raise ValueError("title, prompt, vfs and published_run_id must be non-empty")
        if category not in PROJECT_CATEGORIES or project_kind not in PROJECT_KINDS:
            raise ValueError("unsupported category or project kind")
        vfs_blob, is_compressed = self._encode_vfs(values["vfs"])
        now = time.time()
        with self._connection() as connection:
            connection.execute(
                """
                UPDATE published_code_projects SET
                    title = ?, category = ?, prompt = ?, optimized_prompt = ?,
                    cover_image = ?, vfs_blob = ?, is_compressed = ?, project_kind = ?,
                    published_run_id = ?, draft_run_id = ?, updated_at = ?, published_at = ?
                WHERE project_id = ?
                """,
                (title, category, prompt, values.get("optimized_prompt"), values["cover_image"],
                 vfs_blob, is_compressed, project_kind, published_run_id, published_run_id,
                 now, now, row["project_id"]),
            )
        return self.get(row["project_id"])

    def get(self, project_id: str) -> CodeProject:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM published_code_projects WHERE project_id = ?",
                (project_id,),
            ).fetchone()
        if row is None:
            raise CodeProjectNotFoundError(project_id)
        return self._row_to_project(row)

    def list(self, category: str | None = None) -> list[CodeProject]:
        if category is not None and category not in PROJECT_CATEGORIES:
            raise ValueError(f"unsupported category: {category}")
        with self._connection() as connection:
            if category is None:
                rows = connection.execute(
                    "SELECT * FROM published_code_projects ORDER BY updated_at DESC"
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM published_code_projects WHERE category = ? ORDER BY updated_at DESC",
                    (category,),
                ).fetchall()
        return [self._row_to_project(row) for row in rows]

    def delete(self, project_id: str) -> None:
        with self._connection() as connection:
            cursor = connection.execute(
                "DELETE FROM published_code_projects WHERE project_id = ?",
                (project_id,),
            )
        if cursor.rowcount == 0:
            raise CodeProjectNotFoundError(project_id)
