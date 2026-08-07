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
    MIN_SAVE_INTERVAL = 5.0       # R3: 同会话两次自动 checkpoint 的最小间隔（秒）。
    MAX_KEEP = 10                 # R3: 单会话最多保留的 checkpoint 数。

    # 触发原因白名单：manual / auto / pre_patch / post_patch。
    # Why 仅自动类限频: manual（用户手动快照）与 pre_patch（补丁前安全网）必须落盘，
    # 限频会导致用户困惑或丢恢复点；仅 auto/post_patch 高频触发需要节流。
    _RATE_LIMITED_REASONS = frozenset({"auto", "post_patch"})

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

        now = time.time()
        json_bytes = json.dumps(vfs, ensure_ascii=False).encode("utf-8")
        if len(json_bytes) >= self.COMPRESS_THRESHOLD:
            blob = zlib.compress(json_bytes, level=6)
            is_compressed = 1
        else:
            blob = json_bytes
            is_compressed = 0

        # R3 限频：仅自动类（auto/post_patch）在最小间隔内重复触发时，
        # 不新增行，而是用最新 VFS 覆盖最近一条【自动类】checkpoint（upsert）。
        # Why 覆盖而非跳过: 跳过会丢失最新状态的恢复点（连续两次快速 patch 时
        # 第二次的 VFS 丢失）；覆盖既控制行数增长，又保证 restore 永远拿到最新 VFS。
        # Why 查询限定自动类: 最近一条若是 pre_patch（补丁前安全网）或 manual（用户手动
        # 快照），合并会覆盖安全网内容；限定 trigger_reason IN 自动类后，安全网行对
        # 限频逻辑不可见，永不被 clobber。合并时同步刷新 trigger_reason，保持语义一致。
        if trigger_reason in self._RATE_LIMITED_REASONS:
            with self._connection() as connection:
                row = connection.execute(
                    """
                    SELECT checkpoint_id, created_at FROM vfs_checkpoints
                    WHERE session_id = ?
                      AND trigger_reason IN ('auto', 'post_patch')
                    ORDER BY created_at DESC, checkpoint_id DESC
                    LIMIT 1
                    """,
                    (session_id,),
                ).fetchone()
                if row is not None and (now - float(row["created_at"])) < self.MIN_SAVE_INTERVAL:
                    connection.execute(
                        """
                        UPDATE vfs_checkpoints
                        SET run_id = ?, vfs_blob = ?, is_compressed = ?,
                            trigger_reason = ?, created_at = ?
                        WHERE checkpoint_id = ?
                        """,
                        (run_id, blob, is_compressed, trigger_reason, now, int(row["checkpoint_id"])),
                    )
                    logger.debug(
                        "VFS checkpoint coalesced into id=%d (interval<%.1fs) session=%s",
                        int(row["checkpoint_id"]),
                        self.MIN_SAVE_INTERVAL,
                        session_id,
                    )
                    return int(row["checkpoint_id"])

        if len(json_bytes) >= self.COMPRESS_THRESHOLD:
            logger.debug(
                "VFS checkpoint compressed: %d -> %d bytes (session=%s run=%s)",
                len(json_bytes),
                len(blob),
                session_id,
                run_id,
            )

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

        # R3 限量：写入后顺带回收，单会话最多保留 MAX_KEEP 个，防表无限膨胀。
        try:
            self.cleanup_old_checkpoints(session_id, keep=self.MAX_KEEP)
        except Exception:
            logger.exception("VFS checkpoint cleanup failed session=%s", session_id)

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
