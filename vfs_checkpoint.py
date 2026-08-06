"""VFS (Virtual File System) checkpoint persistence with optional zlib compression.

Why: Agent runs operate on an in-memory VFS (dict[str, str]). Persisting checkpoints
allows crash recovery, audit trails, and pre/post-patch snapshots. Large VFS payloads
are zlib-compressed to keep the SQLite BLOB column lean.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
import zlib
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

logger = logging.getLogger("app.memory.vfs")

# Allowed trigger reasons for checkpoint creation.
# Why: constraining to a known set prevents typos and enables reliable filtering/auditing.
_TRIGGER_REASONS = frozenset({"manual", "auto", "pre_patch", "post_patch"})


class VFSCheckpointStore:
    """Persist and restore VFS snapshots in SQLite with adaptive zlib compression.

    Why: A single VFS dict can grow beyond hundreds of KB when an agent edits many
    files. Storing raw JSON for every checkpoint bloats the DB and slows restores.
    Compressing only payloads >= COMPRESS_THRESHOLD balances CPU cost and storage.
    """

    COMPRESS_THRESHOLD = 100_000  # 100KB: payloads at/above this size get zlib-compressed.

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
        """Ensure the vfs_checkpoints table exists.

        Why: SessionStore in session_memory.py also creates this table, but declaring
        it here with IF NOT EXISTS makes this module self-contained and idempotent
        regardless of initialization order.
        """
        with self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS vfs_checkpoints (
                    checkpoint_id  INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id     TEXT NOT NULL,
                    run_id         TEXT NOT NULL,
                    vfs_blob       BLOB NOT NULL,
                    is_compressed  INTEGER NOT NULL DEFAULT 0,
                    trigger_reason TEXT DEFAULT 'manual',
                    created_at     REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_vfs_session_time
                    ON vfs_checkpoints(session_id, created_at DESC);
                """
            )

    def save_checkpoint(
        self,
        session_id: str,
        run_id: str,
        vfs: dict[str, str],
        trigger_reason: str = "manual",
    ) -> int:
        """Serialize VFS and persist it, compressing with zlib when large.

        Why: VFS payloads vary widely in size. Compressing only those >= 100KB keeps
        small checkpoints cheap (no CPU/decode overhead) while capping storage growth
        for large ones. The is_compressed flag lets restore_vfs branch without probing.

        Args:
            session_id: Owning session identifier (non-empty).
            run_id: Agent run identifier (non-empty).
            vfs: Mapping of virtual path -> file content.
            trigger_reason: One of manual | auto | pre_patch | post_patch.

        Returns:
            checkpoint_id of the inserted row.

        Raises:
            ValueError: If identifiers are empty or trigger_reason is invalid.
        """
        if not session_id:
            raise ValueError("session_id must be non-empty")
        if not run_id:
            raise ValueError("run_id must be non-empty")
        if trigger_reason not in _TRIGGER_REASONS:
            raise ValueError(
                f"trigger_reason must be one of {sorted(_TRIGGER_REASONS)}, "
                f"got: {trigger_reason!r}"
            )

        json_bytes = json.dumps(vfs, ensure_ascii=False).encode("utf-8")

        if len(json_bytes) >= self.COMPRESS_THRESHOLD:
            blob = zlib.compress(json_bytes, level=6)
            is_compressed = 1
            logger.debug(
                "VFS checkpoint compressed: %d -> %d bytes (session=%s run=%s)",
                len(json_bytes),
                len(blob),
                session_id,
                run_id,
            )
        else:
            blob = json_bytes
            is_compressed = 0

        now = time.time()
        with self._connection() as connection:
            cursor = connection.execute(
                """
                INSERT INTO vfs_checkpoints
                    (session_id, run_id, vfs_blob, is_compressed, trigger_reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (session_id, run_id, blob, is_compressed, trigger_reason, now),
            )
        checkpoint_id = int(cursor.lastrowid)
        logger.info(
            "Saved VFS checkpoint id=%d session=%s run=%s reason=%s compressed=%s",
            checkpoint_id,
            session_id,
            run_id,
            trigger_reason,
            bool(is_compressed),
        )
        return checkpoint_id

    def restore_vfs(self, session_id: str) -> tuple[dict[str, str], int] | None:
        """Restore the most recent VFS checkpoint for a session.

        Why: On recovery we need the latest coherent snapshot. The is_compressed flag
        stored alongside the BLOB determines whether zlib.decompress is required,
        so callers don't need to probe byte magic.

        Args:
            session_id: Session whose latest checkpoint should be restored.

        Returns:
            (vfs_dict, checkpoint_id) if a checkpoint exists, else None.

        Raises:
            ValueError: If session_id is empty.
        """
        if not session_id:
            raise ValueError("session_id must be non-empty")

        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT checkpoint_id, vfs_blob, is_compressed
                FROM vfs_checkpoints
                WHERE session_id = ?
                ORDER BY created_at DESC, checkpoint_id DESC
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()

        if row is None:
            logger.info("No VFS checkpoint found for session=%s", session_id)
            return None

        blob: bytes = row["vfs_blob"]
        if row["is_compressed"]:
            json_bytes = zlib.decompress(blob)
        else:
            json_bytes = blob

        vfs: dict[str, str] = json.loads(json_bytes.decode("utf-8"))
        checkpoint_id = int(row["checkpoint_id"])
        logger.info(
            "Restored VFS checkpoint id=%d session=%s entries=%d",
            checkpoint_id,
            session_id,
            len(vfs),
        )
        return vfs, checkpoint_id

    def list_checkpoints(
        self, session_id: str, limit: int = 10
    ) -> list[dict[str, object]]:
        """List recent checkpoint metadata (excludes the heavy vfs_blob).

        Why: The BLOB can be large; listing views must not pull it. Returning metadata
        only keeps this call cheap for UI/audit listings.

        Args:
            session_id: Session whose checkpoints to list.
            limit: Max number of rows (must be >= 1).

        Returns:
            List of dicts with keys: checkpoint_id, session_id, run_id,
            is_compressed, trigger_reason, created_at.

        Raises:
            ValueError: If session_id is empty or limit < 1.
        """
        if not session_id:
            raise ValueError("session_id must be non-empty")
        if limit < 1:
            raise ValueError("limit must be >= 1")

        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT checkpoint_id, session_id, run_id, is_compressed,
                       trigger_reason, created_at
                FROM vfs_checkpoints
                WHERE session_id = ?
                ORDER BY created_at DESC, checkpoint_id DESC
                LIMIT ?
                """,
                (session_id, limit),
            ).fetchall()

        return [
            {
                "checkpoint_id": int(r["checkpoint_id"]),
                "session_id": r["session_id"],
                "run_id": r["run_id"],
                "is_compressed": bool(r["is_compressed"]),
                "trigger_reason": r["trigger_reason"],
                "created_at": float(r["created_at"]),
            }
            for r in rows
        ]

    def cleanup_old_checkpoints(self, session_id: str, keep: int = 10) -> int:
        """Delete old checkpoints, keeping only the most recent `keep`.

        Why: Checkpoints accumulate over many runs and can dominate DB size. Retaining
        only the latest N bounds storage while preserving a rollback window. Ordering
        by (created_at DESC, checkpoint_id DESC) gives a stable tiebreaker for rows
        sharing the same timestamp.

        Args:
            session_id: Session to clean up.
            keep: Number of most recent checkpoints to retain (must be >= 0;
                  0 deletes all).

        Returns:
            Number of deleted rows.

        Raises:
            ValueError: If session_id is empty or keep < 0.
        """
        if not session_id:
            raise ValueError("session_id must be non-empty")
        if keep < 0:
            raise ValueError("keep must be >= 0")

        with self._connection() as connection:
            cursor = connection.execute(
                """
                DELETE FROM vfs_checkpoints
                WHERE session_id = ?
                  AND checkpoint_id NOT IN (
                      SELECT checkpoint_id FROM vfs_checkpoints
                      WHERE session_id = ?
                      ORDER BY created_at DESC, checkpoint_id DESC
                      LIMIT ?
                  )
                """,
                (session_id, session_id, keep),
            )
        deleted = int(cursor.rowcount)
        logger.info(
            "Cleaned up %d old VFS checkpoints for session=%s (kept<= %d)",
            deleted,
            session_id,
            keep,
        )
        return deleted
