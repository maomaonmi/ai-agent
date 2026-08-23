"""SQLite-backed chat session metadata and UI snapshot persistence."""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


SESSION_MODES = {
    "omni",
    "standard",
    "deep",
    "web",
    "research",
    "agent",
    "plan",
    "distributed_plan",
    "code",
    "writing",
}


class SessionNotFoundError(LookupError):
    pass


@dataclass(frozen=True)
class Session:
    session_id: str
    title: str
    mode: str
    created_at: float
    updated_at: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class SessionStore:
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
    def _connection(self):
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
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS session_snapshots (
                    session_id TEXT PRIMARY KEY,
                    snapshot_json TEXT NOT NULL,
                    updated_at REAL NOT NULL,
                    FOREIGN KEY (session_id)
                        REFERENCES sessions(session_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
                    ON sessions(updated_at DESC);

                -- ============================================================
                -- 记忆系统扩展表（四层记忆 + Skill 胶囊 + 追加账本）
                -- ============================================================

                -- 表 1: 追加账本（所有事件的原始记录，永不删除）
                CREATE TABLE IF NOT EXISTS raw_event_ledger (
                    event_id     INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id   TEXT NOT NULL,
                    event_type   TEXT NOT NULL,
                    event_data   TEXT NOT NULL,
                    created_at   REAL NOT NULL,
                    FOREIGN KEY (session_id)
                        REFERENCES sessions(session_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_ledger_session_time
                    ON raw_event_ledger(session_id, created_at DESC);

                -- 表 2: 项目档案卡（双时间戳时序治理）
                CREATE TABLE IF NOT EXISTS profile_cards (
                    card_id      INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id   TEXT NOT NULL,
                    field_key    TEXT NOT NULL,
                    field_value  TEXT NOT NULL,
                    valid_start  REAL NOT NULL,
                    valid_end    REAL NOT NULL DEFAULT 9999999999.0,
                    source       TEXT DEFAULT 'inferred',
                    FOREIGN KEY (session_id)
                        REFERENCES sessions(session_id) ON DELETE CASCADE
                );
                -- 补丁1: valid_end 加入复合索引，覆盖 WHERE session_id=? AND field_key=? AND valid_start<=? AND valid_end>?
                CREATE INDEX IF NOT EXISTS idx_profile_valid
                    ON profile_cards(session_id, field_key, valid_start, valid_end);

                -- 表 3: 对话摘要（异步 LLM 压缩）
                CREATE TABLE IF NOT EXISTS conversation_summaries (
                    summary_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id   TEXT NOT NULL,
                    turn_start   INTEGER NOT NULL,
                    turn_end     INTEGER NOT NULL,
                    summary_text TEXT NOT NULL,
                    topics       TEXT DEFAULT '[]',
                    created_at   REAL NOT NULL,
                    FOREIGN KEY (session_id)
                        REFERENCES sessions(session_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_summary_session_turns
                    ON conversation_summaries(session_id, turn_end DESC);

                -- 表 4: VFS Checkpoint（虚拟文件系统持久化，补丁2: BLOB + zlib 压缩）
                CREATE TABLE IF NOT EXISTS vfs_checkpoints (
                    checkpoint_id  INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id     TEXT NOT NULL,
                    run_id         TEXT NOT NULL,
                    vfs_blob       BLOB NOT NULL,
                    is_compressed  INTEGER NOT NULL DEFAULT 0,
                    trigger_reason TEXT DEFAULT 'manual',
                    created_at     REAL NOT NULL,
                    FOREIGN KEY (session_id)
                        REFERENCES sessions(session_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_vfs_session_time
                    ON vfs_checkpoints(session_id, created_at DESC);

                -- 表 5: Skill 胶囊（程序性记忆）
                CREATE TABLE IF NOT EXISTS skill_capsules (
                    skill_id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    skill_name        TEXT NOT NULL UNIQUE,
                    skill_type        TEXT NOT NULL,
                    trigger_condition TEXT NOT NULL,
                    trigger_keywords  TEXT DEFAULT '[]',
                    standard_steps    TEXT NOT NULL,
                    required_params   TEXT DEFAULT '[]',
                    validation_rules  TEXT DEFAULT '[]',
                    success_count     INTEGER DEFAULT 0,
                    failure_count     INTEGER DEFAULT 0,
                    sample_envelope   TEXT,
                    created_at        REAL NOT NULL,
                    updated_at        REAL NOT NULL
                );
                """
            )

    @staticmethod
    def _row_to_session(row: sqlite3.Row) -> Session:
        return Session(
            session_id=row["session_id"],
            title=row["title"],
            mode=row["mode"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    def create(self, mode: str, title: str = "新会话") -> Session:
        if mode not in SESSION_MODES:
            raise ValueError(f"Unsupported session mode: {mode}")
        now = time.time()
        session = Session(
            session_id=str(uuid.uuid4()),
            title=(title.strip() or "新会话")[:40],
            mode=mode,
            created_at=now,
            updated_at=now,
        )
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO sessions
                    (session_id, title, mode, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    session.session_id,
                    session.title,
                    session.mode,
                    session.created_at,
                    session.updated_at,
                ),
            )
        return session

    def list(self) -> list[Session]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                SELECT session_id, title, mode, created_at, updated_at
                FROM sessions
                ORDER BY updated_at DESC
                """
            ).fetchall()
        return [self._row_to_session(row) for row in rows]

    def get(self, session_id: str) -> Session:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT session_id, title, mode, created_at, updated_at
                FROM sessions WHERE session_id = ?
                """,
                (session_id,),
            ).fetchone()
        if row is None:
            raise SessionNotFoundError(session_id)
        return self._row_to_session(row)

    def update_title(self, session_id: str, title: str) -> Session:
        cleaned_title = title.strip()[:40] or "新会话"
        now = time.time()
        with self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE sessions SET title = ?, updated_at = ?
                WHERE session_id = ?
                """,
                (cleaned_title, now, session_id),
            )
            if cursor.rowcount == 0:
                raise SessionNotFoundError(session_id)
        return self.get(session_id)

    def save_snapshot(
        self, session_id: str, snapshot: dict[str, Any]
    ) -> Session:
        serialized = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
        now = time.time()
        with self._connection() as connection:
            exists = connection.execute(
                "SELECT 1 FROM sessions WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if exists is None:
                raise SessionNotFoundError(session_id)
            connection.execute(
                """
                INSERT INTO session_snapshots
                    (session_id, snapshot_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    snapshot_json = excluded.snapshot_json,
                    updated_at = excluded.updated_at
                """,
                (session_id, serialized, now),
            )
            connection.execute(
                "UPDATE sessions SET updated_at = ? WHERE session_id = ?",
                (now, session_id),
            )
        return self.get(session_id)

    def get_history(self, session_id: str) -> dict[str, Any]:
        session = self.get(session_id)
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT snapshot_json FROM session_snapshots
                WHERE session_id = ?
                """,
                (session_id,),
            ).fetchone()
        snapshot = json.loads(row["snapshot_json"]) if row else {}
        return {"session": session.to_dict(), "snapshot": snapshot}

    def recover_messages_from_ledger(self, session_id: str) -> list[dict[str, Any]]:
        """Recover chat turns when an older client saved only top-level state."""
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT event_type, event_data FROM raw_event_ledger WHERE session_id = ? ORDER BY event_id",
                (session_id,),
            ).fetchall()
        messages: list[dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(row["event_data"])
            except (TypeError, json.JSONDecodeError):
                continue
            if row["event_type"] == "user_input" and str(payload.get("text", "")).strip():
                messages.append({"role": "user", "content": str(payload["text"])})
            elif row["event_type"] == "ai_reply" and str(payload.get("text", "")).strip():
                if payload.get("type") == "qwen_feedback":
                    messages.append({
                        "role": "assistant",
                        "content": "",
                        "type": "qwen_feedback",
                        "feedbackQuestion": str(payload["text"]),
                    })
                else:
                    messages.append({"role": "assistant", "content": str(payload["text"])})
        return self.dedupe_consecutive_user_messages(messages)

    @staticmethod
    def dedupe_consecutive_user_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Drop an accidental repeated user turn without merging real turns.

        Some research engines call their streaming endpoint twice (the second
        call carries the feedback answer). Older versions wrote the original
        query to the memory ledger on both calls. Only identical user turns
        with no assistant message between them are safe to collapse; repeated
        questions in separate turns remain intact.
        """
        normalized: list[dict[str, Any]] = []
        for message in messages:
            if not isinstance(message, dict):
                continue
            role = message.get("role")
            content = str(message.get("content", "") or "")
            if (
                role == "user"
                and normalized
                and normalized[-1].get("role") == "user"
                and str(normalized[-1].get("content", "") or "").strip() == content.strip()
            ):
                continue
            normalized.append(message)
        return normalized

    def delete(self, session_id: str) -> None:
        with self._connection() as connection:
            cursor = connection.execute(
                "DELETE FROM sessions WHERE session_id = ?",
                (session_id,),
            )
            if cursor.rowcount == 0:
                raise SessionNotFoundError(session_id)

    def clear(self) -> int:
        with self._connection() as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM sessions"
            ).fetchone()[0]
            connection.execute("DELETE FROM sessions")
        return int(count)
