"""生产级 Agent 记忆引擎：四层记忆 + 追加账本 + 上下文合成器。

Why 本模块存在：
    现有 SessionStore 只管会话元数据与 UI 快照，不承载 Agent 的"工作记忆"。
    本模块在同一 SQLite（data/agent_memory.db）上管理：
      - 追加账本（raw_event_ledger）：所有事件的不可变审计流水
      - 第 2 层 项目档案卡（profile_cards）：双时间戳时序治理，屏蔽向量检索噪声
      - 第 3 层 对话摘要（conversation_summaries）：LLM 异步压缩，替代长对话原始消息
      - 第 4 层 滑动窗口：最近 K 条原始消息（无存储，纯截取）
    并通过 build_context() 将四层合成为受 Token 预算约束的 system_prompt。

依赖约定：
    5 张表 DDL 已由 session_memory.SessionStore._initialize() 创建（CREATE TABLE IF NOT EXISTS），
    本模块信任 schema 已就位，不重复 DDL（避免 DRY 违规与双源漂移）。
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
import zlib
from collections import deque
from contextlib import contextmanager
from pathlib import Path

# 双时间戳远未来常量：valid_end == FAR_FUTURE 表示该记录当前生效。
FAR_FUTURE: float = 9999999999.0

# L2 全局画像哨兵会话：跨会话共享的用户偏好/画像。
# Why 用哨兵 session_id 而非新增 user_id 列：profile_cards 有 FOREIGN KEY 指向
# sessions，且 DDL 为 CREATE TABLE IF NOT EXISTS（存量库不会补列）。以哨兵会话
# 承载全局画像，既满足 FK 约束，又无需 ALTER TABLE 迁移，向后完全兼容。
# 单用户部署下 user_id 恒为 'global'；未来多用户时把哨兵值替换为真实 user_id 即可。
GLOBAL_PROFILE_SESSION: str = "__global__"
GLOBAL_USER_ID: str = "global"

# Token 预算硬上限（与 PLAN R5 对齐：总 ≤ 3300）
_PROFILE_TOKEN_BUDGET: int = 500
_SUMMARY_TOKEN_BUDGET: int = 800
_WINDOW_TOKEN_BUDGET: int = 2000

# §5.1 摘要双阈值触发（PLAN 决策 D：N=8轮 + Token>6000）
SUMMARY_TURN_THRESHOLD: int = 8        # 未摘要轮数（ai_reply 事件数）≥ 8 触发
SUMMARY_TOKEN_THRESHOLD: int = 6000    # 未摘要内容估算 token > 6000 触发
# 压缩区间保留最近 4 条事件原文（约 2 轮），近期上下文由滑动窗口层覆盖，
# 避免摘要与窗口重复占用 token 预算。
_SUMMARY_KEEP_RECENT_EVENTS: int = 4
# R1 降级：LLM 压缩不可用/失败时，截断保留摘要素材前 2000 字符，主流程零感知。
_SUMMARY_FALLBACK_CHARS: int = 2000
# 摘要素材扫描窗口：与 query_events 的防御性 clamp 对齐，turn 序号基于该窗口计数。
_SUMMARY_EVENT_SCAN_LIMIT: int = 500

# 惰性定期清理（R-Retention）：无后台线程，在写入路径同一事务内顺带执行，
# 与 VFSCheckpointStore.cleanup_old_checkpoints 同风格。Why 限量而非按时间:
# 会话活跃度差异大，按量保留可保证"最近上下文永远完整"，且 SQL 恒定简单。
_EVENT_KEEP_PER_SESSION: int = 500        # 事件账本每会话保留最近 500 条（与摘要扫描窗口对齐）
_SUMMARY_KEEP_PER_SESSION: int = 20       # 摘要每会话保留最近 20 条
_PROFILE_INACTIVE_TTL_SECONDS: float = 30 * 86400  # 失效档案卡保留 30 天后清理

# ---- 聊天类模式（standard/deep/web/research）专用阈值 ----
# 与 code 模式参数分离：聊天轮次快、内容短，需更灵敏的摘要触发与更大的窗口/保留量。
CHAT_SUMMARY_TURN_THRESHOLD: int = 5      # 聊天未摘要 ai_reply 轮数 ≥ 5 触发
CHAT_SUMMARY_TOKEN_THRESHOLD: int = 4000  # 聊天未摘要内容估算 token > 4000 触发
CHAT_WINDOW_K: int = 8                    # L4 滑窗保留轮数（聊天默认）
CHAT_EVENT_KEEP_PER_SESSION: int = 800    # 聊天事件账本每会话保留最近 800 条


def _extract_summary_topics(text: str) -> list[str]:
    """轻量话题提取：取长度 ≥2 的中英词元前 5 个（去重保序）。

    Why 引擎内置而不复用 App._extract_topics：App.py 是调用方层级，引擎反向依赖
    会造成循环 import；此处仅用于摘要 topics 标注，精度要求低，重复 ~10 行可接受。
    """
    import re

    tokens = re.findall(r"[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9_+-]{1,}", text or "")
    seen: set[str] = set()
    topics: list[str] = []
    for token in tokens:
        lowered = token.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        topics.append(token)
        if len(topics) >= 5:
            break
    return topics


def _normalize_summary_text(text: str) -> str:
    """摘要去重比对键：去全部空白字符 + 小写（仅字面级，不做语义相似）。"""
    return "".join(str(text).split()).lower()


def _estimate_tokens(text: str) -> int:
    """粗略估算 token 数。

    Why：1 token ≈ 1.5 中文字符 或 4 英文字符。混合文本按字符类型分别计权后求和，
    避免引入 tokenizer 依赖；偏差在可接受范围内（仅用于预算裁剪，非精确计费）。
    """
    if not text:
        return 0
    chinese_count = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    other_count = len(text) - chinese_count
    return int(chinese_count / 1.5 + other_count / 4)


def _truncate_to_budget(text: str, budget: int) -> str:
    """二分截断字符串至 token 预算内。

    Why：比例截断对中英混合文本不精确；二分法保证截断后 token 数 ≤ budget，
    且尽可能保留最长前缀（摘要的关键信息通常在前部）。
    """
    if budget <= 0:
        return ""
    if _estimate_tokens(text) <= budget:
        return text
    lo, hi, result = 0, len(text), ""
    while lo <= hi:
        mid = (lo + hi) // 2
        if _estimate_tokens(text[:mid]) <= budget:
            result = text[:mid]
            lo = mid + 1
        else:
            hi = mid - 1
    return result


class MemoryEngine:
    """四层记忆 + 追加账本的管理器。

    线程安全：每次操作独立连接（WAL mode），同会话串行写入；
    双时间戳更新在单事务内完成打断+插入，保证时序一致性。
    """

    def __init__(
        self,
        db_path: str | Path,
        settings: "object" | None = None,
    ) -> None:
        """初始化记忆引擎。

        Args:
            settings: 可选 MemorySettings 实例（来自 memory_settings.MemorySettings）。
                提供后，本实例的摘要/清理/窗口阈值从该配置读取（前端可实时调节）；
                为 None 时回退到模块级默认常量（向后兼容）。
        """
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._logger = logging.getLogger("app.memory")
        self._settings = settings
        # L4 内存 FIFO 滑窗：主路径（零 IO 低延迟）。key=session_id，value=deque。
        # 会话刷新/重启后为空，由 get_chat_window 从账本重建（兜底路径）。
        self._chat_windows: dict[str, deque[dict[str, object]]] = {}

    # ------------------------------------------------------------------
    # 可配置阈值解析（前端调节实时生效）
    # ------------------------------------------------------------------
    def _profile(self, chat_mode: bool) -> "object | None":
        """返回对应画像（MemoryProfile）：chat_mode=True → global，否则 → code。

        Why：两套画像字段一致、仅默认不同。从注入的 MemorySettings 取出，
        未注入时返回 None，调用方回退模块级常量。
        """
        if self._settings is None:
            return None
        return self._settings.global_memory if chat_mode else self._settings.code_memory

    def _event_keep(self, chat_mode: bool = False) -> int:
        """事件账本每会话保留条数：global 画像 event_keep 或模块默认。"""
        profile = self._profile(chat_mode)
        if profile is not None:
            return int(profile.event_keep)
        return CHAT_EVENT_KEEP_PER_SESSION if chat_mode else _EVENT_KEEP_PER_SESSION

    def _summary_keep(self) -> int:
        profile = self._settings
        if profile is not None:
            return int(profile.global_memory.summary_keep)
        return _SUMMARY_KEEP_PER_SESSION

    # ------------------------------------------------------------------
    # DB 连接管理（参考 session_memory.SessionStore._connection 模式）
    # ------------------------------------------------------------------
    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            # sqlite3 的 with connection：退出时自动 commit / 异常时 rollback，
            # 天然满足"打断+插入必须在同一事务"的强约束。
            with connection:
                yield connection
        finally:
            connection.close()

    # ==================================================================
    # 第 1 层：追加账本 (raw_event_ledger)
    # ==================================================================
    def record_event(
        self,
        session_id: str,
        event_type: str,
        event_data: dict[str, object],
        chat_mode: bool = False,
    ) -> bool:
        """向追加账本写入一条不可变事件。

        Why：账本 append-only，提供完整审计链与回放能力；所有用户输入、AI 回复、
        工具调用、VFS 变更均落账，便于事后追溯与摘要重建。

        Args:
            chat_mode: True 时按聊天画像 event_keep 做保留清理；False 用 code 画像。

        Returns: True 成功 / False 失败（已 log，不抛出）。
        """
        if not session_id or not event_type:
            self._logger.warning("record_event 参数非法: sid=%s type=%s", session_id, event_type)
            return False
        payload = json.dumps(event_data, ensure_ascii=False)
        keep = self._event_keep(chat_mode)
        try:
            with self._connection() as conn:
                conn.execute(
                    """
                    INSERT INTO raw_event_ledger
                        (session_id, event_type, event_data, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (session_id, event_type, payload, time.time()),
                )
                # R-Retention 惰性清理：同事务裁剪账本到最近 N 条，防无限膨胀。
                conn.execute(
                    """
                    DELETE FROM raw_event_ledger
                    WHERE session_id = ?
                      AND event_id NOT IN (
                          SELECT event_id FROM raw_event_ledger
                          WHERE session_id = ?
                          ORDER BY created_at DESC, event_id DESC
                          LIMIT ?
                      )
                    """,
                    (session_id, session_id, keep),
                )
            return True
        except sqlite3.Error as exc:
            self._logger.error(
                "record_event 失败: sid=%s type=%s err=%s", session_id, event_type, exc
            )
            return False

    def query_events(self, session_id: str, limit: int = 50) -> list[dict[str, object]]:
        """按时间倒序查询某会话的事件流。

        Args:
            limit: 最大返回条数，防御性 clamp 到 [1, 500]。
        """
        safe_limit = max(1, min(limit, 500))
        try:
            with self._connection() as conn:
                rows = conn.execute(
                    """
                    SELECT event_id, session_id, event_type, event_data, created_at
                    FROM raw_event_ledger
                    WHERE session_id = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                    """,
                    (session_id, safe_limit),
                ).fetchall()
        except sqlite3.Error as exc:
            self._logger.error("query_events 失败: sid=%s err=%s", session_id, exc)
            return []
        return [self._row_to_event(r) for r in rows]

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> dict[str, object]:
        try:
            data: object = json.loads(row["event_data"])
        except (json.JSONDecodeError, TypeError):
            data = {}
        return {
            "event_id": row["event_id"],
            "session_id": row["session_id"],
            "event_type": row["event_type"],
            "event_data": data,
            "created_at": row["created_at"],
        }

    # ==================================================================
    # 第 2 层：项目档案卡 (profile_cards) — 双时间戳时序治理
    # ==================================================================
    def update_profile_field(
        self,
        session_id: str,
        field_key: str,
        field_value: object,
        source: str = "inferred",
        scope: str = "session",
    ) -> bool:
        """更新档案卡字段（双时间戳时序治理）。

        Why：项目画像会随对话演进（如 tech_stack 从 React 变为 Vue）。
        直接 UPDATE 会丢失历史，导致无法回溯"何时变更"；纯 INSERT 会导致
        get_valid_profile 返回多个冲突值。双时间戳方案：
          1. 打断：将同 session+key 当前生效记录的 valid_end 置为 now（失效）
          2. 插入：新记录 valid_start=now, valid_end=FAR_FUTURE（生效）
        两步必须在同一事务，否则并发下可能出现"两条同时生效"的脏数据。

        Args:
            source: inferred(推断) | explicit(用户明示) | skill_derived(Skill 沉淀)
            scope: session(按会话隔离，默认) | global(跨会话全局画像)。
                scope='global' 时写入哨兵会话 GLOBAL_PROFILE_SESSION，
                供聊天类模式跨会话共享用户偏好。
        """
        if not session_id or not field_key:
            self._logger.warning("update_profile_field 参数非法: sid=%s key=%s", session_id, field_key)
            return False
        now = time.time()
        serialized = json.dumps(field_value, ensure_ascii=False)
        # 全局画像映射到哨兵会话：跨会话共享同一画像。
        effective_sid = GLOBAL_PROFILE_SESSION if scope == "global" else session_id
        try:
            with self._connection() as conn:
                if scope == "global":
                    self._ensure_global_session(conn)
                # 打断旧生效记录：valid_end > now 即"当前生效"，置为 now 使其失效。
                # 用 valid_end > now 而非 == FAR_FUTURE，兼容外部手动设置的有效期。
                conn.execute(
                    """
                    UPDATE profile_cards
                    SET valid_end = ?
                    WHERE session_id = ? AND field_key = ? AND valid_end > ?
                    """,
                    (now, effective_sid, field_key, now),
                )
                conn.execute(
                    """
                    INSERT INTO profile_cards
                        (session_id, field_key, field_value, valid_start, valid_end, source)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (effective_sid, field_key, serialized, now, FAR_FUTURE, source),
                )
                # R-Retention 惰性清理：同事务删除 TTL 天前已失效的历史卡。
                # 生效卡（valid_end > now）永不触碰，保证 build_context 输入稳定。
                ttl_seconds = _PROFILE_INACTIVE_TTL_SECONDS
                if self._settings is not None:
                    ttl_seconds = int(self._settings.global_memory.profile_inactive_ttl_days) * 86400
                conn.execute(
                    """
                    DELETE FROM profile_cards
                    WHERE session_id = ? AND valid_end <= ?
                    """,
                    (effective_sid, now - ttl_seconds),
                )
            return True
        except sqlite3.Error as exc:
            self._logger.error(
                "update_profile_field 失败: sid=%s key=%s err=%s", session_id, field_key, exc
            )
            return False

    @staticmethod
    def _ensure_global_session(conn: sqlite3.Connection) -> None:
        """确保哨兵全局会话存在于 sessions 表（profile_cards 的 FK 前提）。

        Why：profile_cards.session_id 有 FOREIGN KEY 指向 sessions，向哨兵会话写
        画像前必须先保证该行存在，否则 FK 校验失败。幂等：已存在则无操作。
        """
        conn.execute(
            """
            INSERT OR IGNORE INTO sessions (session_id, title, mode, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (GLOBAL_PROFILE_SESSION, "全局用户画像", "standard", time.time(), time.time()),
        )

    def get_valid_profile(self, session_id: str) -> dict[str, object]:
        """返回当前生效的 {field_key: field_value}。

        Why：构造上下文时只需"当前画像"，双时间戳过滤 valid_end > now 即可，
        天然屏蔽历史噪声——这是放弃向量检索、改用 KV 精确查找的核心收益。

        合并顺序：全局画像（哨兵会话）在前，会话画像（session_id）在后覆盖。
        同一字段会话级优先——用户在某会话内临时改的偏好，应局部覆盖全局默认。
        """
        now = time.time()
        try:
            with self._connection() as conn:
                rows = conn.execute(
                    """
                    SELECT field_key, field_value
                    FROM profile_cards
                    WHERE session_id IN (?, ?) AND valid_end > ?
                    ORDER BY CASE session_id WHEN ? THEN 0 ELSE 1 END
                    """,
                    (GLOBAL_PROFILE_SESSION, session_id, now, GLOBAL_PROFILE_SESSION),
                ).fetchall()
        except sqlite3.Error as exc:
            self._logger.error("get_valid_profile 失败: sid=%s err=%s", session_id, exc)
            return {}
        profile: dict[str, object] = {}
        for row in rows:
            try:
                profile[row["field_key"]] = json.loads(row["field_value"])
            except (json.JSONDecodeError, TypeError):
                profile[row["field_key"]] = row["field_value"]
        return profile

    def get_global_profile(self) -> dict[str, object]:
        """返回跨会话全局画像（哨兵会话的当前生效字段）。

        Why：供"仅需全局偏好、不关心某会话"的场景（如会话创建时的初始上下文）读取；
        与 get_valid_profile 的全局段同源，逻辑独立便于测试与审计。
        """
        return self.get_valid_profile(GLOBAL_PROFILE_SESSION)

    def accumulate_token_usage(
        self,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        cached_tokens: int = 0,
        cache_creation_input_tokens: int = 0,
        reasoning_tokens: int = 0,
        session_id: str | None = None,
    ) -> bool:
        """Accumulate model usage in the single-user global memory profile."""
        model_name = (model or "unknown").strip()[:120] or "unknown"
        current = self.get_valid_profile(GLOBAL_PROFILE_SESSION).get("token_usage", {})
        usage = dict(current) if isinstance(current, dict) else {}
        bucket = dict(usage.get(model_name, {})) if isinstance(usage.get(model_name), dict) else {}
        bucket["prompt_tokens"] = int(bucket.get("prompt_tokens", 0) or 0) + max(0, int(prompt_tokens or 0))
        bucket["completion_tokens"] = int(bucket.get("completion_tokens", 0) or 0) + max(0, int(completion_tokens or 0))
        bucket["total_tokens"] = int(bucket.get("total_tokens", 0) or 0) + max(0, int(total_tokens or 0))
        if cached_tokens:
            bucket["cached_tokens"] = int(bucket.get("cached_tokens", 0) or 0) + max(0, int(cached_tokens))
        if cache_creation_input_tokens:
            bucket["cache_creation_input_tokens"] = int(bucket.get("cache_creation_input_tokens", 0) or 0) + max(0, int(cache_creation_input_tokens))
        if reasoning_tokens:
            bucket["reasoning_tokens"] = int(bucket.get("reasoning_tokens", 0) or 0) + max(0, int(reasoning_tokens))
        bucket["calls"] = int(bucket.get("calls", 0) or 0) + 1
        usage[model_name] = bucket
        return self.update_profile_field(
            session_id or GLOBAL_PROFILE_SESSION,
            "token_usage",
            usage,
            source="hook_token_usage",
            scope="global",
        )

    def get_profile_history(self, session_id: str, field_key: str) -> list[dict[str, object]]:
        """返回某字段的全部历史记录（含已失效），按 valid_start 倒序。

        Why：支持"画像演进审计"——回答"tech_stack 何时从 React 变为 Vue"。
        """
        try:
            with self._connection() as conn:
                rows = conn.execute(
                    """
                    SELECT card_id, field_key, field_value, valid_start, valid_end, source
                    FROM profile_cards
                    WHERE session_id = ? AND field_key = ?
                    ORDER BY valid_start DESC
                    """,
                    (session_id, field_key),
                ).fetchall()
        except sqlite3.Error as exc:
            self._logger.error(
                "get_profile_history 失败: sid=%s key=%s err=%s", session_id, field_key, exc
            )
            return []
        history: list[dict[str, object]] = []
        for row in rows:
            try:
                value: object = json.loads(row["field_value"])
            except (json.JSONDecodeError, TypeError):
                value = row["field_value"]
            history.append(
                {
                    "card_id": row["card_id"],
                    "field_key": row["field_key"],
                    "field_value": value,
                    "valid_start": row["valid_start"],
                    "valid_end": row["valid_end"],
                    "source": row["source"],
                }
            )
        return history

    def delete_profile_card(self, card_id: int) -> bool:
        """删除单张档案卡（仅限已失效卡）。

        Why 限失效卡：生效卡（valid_end > now）是 build_context 的直接输入，
        误删会静默改变后续所有 AI 行为；失效卡仅具审计价值，删除安全。
        前端也仅对失效卡渲染删除按钮，与此约束保持一致。
        """
        now = time.time()
        try:
            with self._connection() as conn:
                cursor = conn.execute(
                    "DELETE FROM profile_cards WHERE card_id = ? AND valid_end <= ?",
                    (int(card_id), now),
                )
            deleted = cursor.rowcount > 0
            if not deleted:
                self._logger.warning(
                    "delete_profile_card 拒绝: card_id=%s 不存在或仍生效", card_id
                )
            return deleted
        except sqlite3.Error as exc:
            self._logger.error(
                "delete_profile_card 失败: card_id=%s err=%s", card_id, exc
            )
            return False

    # ==================================================================
    # 第 3 层：对话摘要 (conversation_summaries)
    # ==================================================================
    def save_summary(
        self,
        session_id: str,
        turn_start: int,
        turn_end: int,
        summary_text: str,
        topics: list[str],
    ) -> bool:
        """持久化一段对话的 LLM 压缩摘要。

        Why：长对话原始消息 token 成本高；摘要以结构化文本替代早期对话，
        使上下文 token 下降 60-80%。turn_start/turn_end 标注覆盖区间，避免重复摘要。
        """
        if not session_id or turn_end < turn_start:
            self._logger.warning(
                "save_summary 参数非法: sid=%s turn=[%s,%s]", session_id, turn_start, turn_end
            )
            return False
        topics_json = json.dumps(topics, ensure_ascii=False)
        keep = self._summary_keep()
        try:
            with self._connection() as conn:
                conn.execute(
                    """
                    INSERT INTO conversation_summaries
                        (session_id, turn_start, turn_end, summary_text, topics, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (session_id, turn_start, turn_end, summary_text, topics_json, time.time()),
                )
                # R-Retention 惰性清理：同事务裁剪摘要到最近 N 条。
                conn.execute(
                    """
                    DELETE FROM conversation_summaries
                    WHERE session_id = ?
                      AND summary_id NOT IN (
                          SELECT summary_id FROM conversation_summaries
                          WHERE session_id = ?
                          ORDER BY turn_end DESC, summary_id DESC
                          LIMIT ?
                      )
                    """,
                    (session_id, session_id, keep),
                )
            return True
        except sqlite3.Error as exc:
            self._logger.error("save_summary 失败: sid=%s err=%s", session_id, exc)
            return False

    def get_recent_summary(self, session_id: str) -> dict[str, object] | None:
        """返回最近一条摘要（按 turn_end 倒序）。无则返回 None。"""
        try:
            with self._connection() as conn:
                row = conn.execute(
                    """
                    SELECT summary_id, session_id, turn_start, turn_end,
                           summary_text, topics, created_at
                    FROM conversation_summaries
                    WHERE session_id = ?
                    ORDER BY turn_end DESC
                    LIMIT 1
                    """,
                    (session_id,),
                ).fetchone()
        except sqlite3.Error as exc:
            self._logger.error("get_recent_summary 失败: sid=%s err=%s", session_id, exc)
            return None
        return self._row_to_summary(row) if row is not None else None

    def get_all_summaries(self, session_id: str) -> list[dict[str, object]]:
        """返回全部摘要，按 turn_end 倒序（最近在前）。"""
        try:
            with self._connection() as conn:
                rows = conn.execute(
                    """
                    SELECT summary_id, session_id, turn_start, turn_end,
                           summary_text, topics, created_at
                    FROM conversation_summaries
                    WHERE session_id = ?
                    ORDER BY turn_end DESC
                    """,
                    (session_id,),
                ).fetchall()
        except sqlite3.Error as exc:
            self._logger.error("get_all_summaries 失败: sid=%s err=%s", session_id, exc)
            return []
        return [self._row_to_summary(r) for r in rows]

    @staticmethod
    def _row_to_summary(row: sqlite3.Row) -> dict[str, object]:
        try:
            topics: object = json.loads(row["topics"]) if row["topics"] else []
        except (json.JSONDecodeError, TypeError):
            topics = []
        return {
            "summary_id": row["summary_id"],
            "session_id": row["session_id"],
            "turn_start": row["turn_start"],
            "turn_end": row["turn_end"],
            "summary_text": row["summary_text"],
            "topics": topics,
            "created_at": row["created_at"],
        }

    def delete_summary(self, summary_id: int) -> bool:
        """删除单条对话摘要（手动纠偏入口）。

        Why 允许删任意摘要：删错至多触发 maybe_summarize 重算（其幂等性保证
        不会重复压缩已覆盖区间之外的内容），无安全风险。
        """
        try:
            with self._connection() as conn:
                cursor = conn.execute(
                    "DELETE FROM conversation_summaries WHERE summary_id = ?",
                    (int(summary_id),),
                )
            return cursor.rowcount > 0
        except sqlite3.Error as exc:
            self._logger.error(
                "delete_summary 失败: summary_id=%s err=%s", summary_id, exc
            )
            return False

    def clear_session_memory(self, session_id: str) -> dict[str, int]:
        """清空某会话的全部会话级记忆（事件/摘要/档案卡/VFS checkpoint）。

        Why 核弹操作：调试或隐私场景需要一键抹除会话痕迹。skill_capsules 是
        跨会话共享的全局资产，不属于任何会话，明确不在清理范围内。
        返回各表删除行数，供前端展示与审计。
        """
        result: dict[str, int] = {
            "events": 0, "summaries": 0, "profile_cards": 0, "vfs_checkpoints": 0,
        }
        if not session_id:
            return result
        try:
            with self._connection() as conn:
                for table, key in (
                    ("raw_event_ledger", "events"),
                    ("conversation_summaries", "summaries"),
                    ("profile_cards", "profile_cards"),
                    ("vfs_checkpoints", "vfs_checkpoints"),
                ):
                    cursor = conn.execute(
                        f"DELETE FROM {table} WHERE session_id = ?",  # noqa: S608 - 表名为内部常量
                        (session_id,),
                    )
                    result[key] = int(cursor.rowcount)
        except sqlite3.Error as exc:
            self._logger.error(
                "clear_session_memory 失败: sid=%s err=%s", session_id, exc
            )
        # 同步清空该会话的内存 FIFO 滑窗，避免清空后旧窗口残留注入。
        self.clear_chat_window(session_id)
        return result

    # ------------------------------------------------------------------
    # 记忆痕迹预览（供设置界面实时渲染 .md）
    # ------------------------------------------------------------------
    def build_traces_markdown(
        self,
        session_id: str | None = None,
        scope: str = "global",
    ) -> str:
        """实时从数据库渲染记忆痕迹为 Markdown（可预览的 .md 文件内容）。

        覆盖四层：全局/会话档案卡、对话摘要、事件账本（按 scope 过滤焦点）。
        scope="code" 时额外含 VFS checkpoint 与补丁痕迹，scope="global" 聚焦聊天事件。
        全程只读、best-effort：任何查询失败仅跳过该段，绝不抛出阻塞设置界面。

        Args:
            session_id: 指定会话时只渲染该会话；缺省渲染全部（按会话分组）。
            scope: "global" | "code"，决定事件账本展示焦点与是否含 VFS 痕迹。
        """
        try:
            target_sessions = self._trace_sessions(session_id)
        except Exception:
            self._logger.exception("build_traces_markdown 会话枚举失败")
            return "# 记忆痕迹\n\n（当前无可预览的记忆痕迹）\n"

        blocks: list[str] = ["# 模型记忆痕迹", ""]
        blocks.append(f"> 生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}")
        blocks.append(f"> 焦点：{'全部' if session_id is None else session_id} · 模式：{scope}")
        blocks.append("")

        if not target_sessions:
            blocks.append("（当前无可预览的记忆痕迹）")
            return "\n".join(blocks)

        for sid in target_sessions:
            blocks.append(f"## 会话 `{sid}`")
            blocks.append("")
            blocks.extend(self._trace_session_blocks(sid, scope))
        return "\n".join(blocks)

    def _trace_sessions(self, session_id: str | None) -> list[str]:
        """返回待渲染的会话 id 列表：指定则单会话，缺省枚举全部有痕迹的会话。"""
        if session_id:
            return [session_id]
        try:
            with self._connection() as conn:
                rows = conn.execute(
                    """
                    SELECT DISTINCT session_id FROM raw_event_ledger
                    ORDER BY MAX(created_at) DESC
                    """
                ).fetchall()
        except sqlite3.Error as exc:
            self._logger.error("_trace_sessions 失败 err=%s", exc)
            return []
        # 排除哨兵全局画像会话（其档案卡属于 L2 全局层，另行展示）。
        return [r["session_id"] for r in rows if r["session_id"] != GLOBAL_PROFILE_SESSION]

    def _trace_session_blocks(self, sid: str, scope: str) -> list[str]:
        """渲染单个会话的记忆痕迹段：档案卡 + 摘要 + 事件（+ code 模式 VFS）。"""
        out: list[str] = []

        # 档案卡（会话级 + 全局哨兵）
        profile = self.get_valid_profile(sid)
        if profile:
            out.append("### 档案卡")
            out.append("")
            for key, value in profile.items():
                out.append(f"- **{key}**：{json.dumps(value, ensure_ascii=False)}")
            out.append("")

        # 对话摘要
        summaries = self.get_all_summaries(sid)
        if summaries:
            out.append("### 对话摘要")
            out.append("")
            for summary in summaries[:5]:
                turn = f"{summary['turn_start']}–{summary['turn_end']}"
                out.append(f"- 覆盖轮次 [{turn}]：{str(summary['summary_text'])[:300]}")
            out.append("")

        # 事件账本
        events = self.query_events(sid, limit=30)
        chat_events = [e for e in events if e["event_type"] in {"user_input", "ai_reply"}]
        focus_events = chat_events if scope == "global" else events
        if focus_events:
            out.append("### 事件痕迹")
            out.append("")
            for event in reversed(focus_events):  # ASC
                etype = event["event_type"]
                data = event["event_data"]
                if etype == "user_input":
                    out.append(f"- **用户**：{str(data.get('text', ''))[:200]}")
                elif etype == "ai_reply":
                    out.append(f"- **助手**：{str(data.get('text', data.get('summary', '')))[:200]}")
                elif etype == "vfs_change":
                    files = data.get("changed_files")
                    if isinstance(files, list):
                        out.append(f"- **文件变更**：{', '.join(str(f) for f in files[:5])}")
                elif etype == "patch_success":
                    out.append(f"- **补丁成功**：{str(data.get('summary', ''))[:120]}")
                else:
                    out.append(f"- **{etype}**：{json.dumps(data, ensure_ascii=False)[:120]}")
            out.append("")

        # code 模式：VFS checkpoint 痕迹
        if scope == "code":
            checkpoints = self._trace_checkpoints(sid)
            if checkpoints:
                out.append("### VFS Checkpoint")
                out.append("")
                for cp in checkpoints:
                    out.append(
                        f"- `{cp['reason']}` @ {time.strftime('%m-%d %H:%M:%S', time.localtime(float(cp['created_at'])))}"
                        f" · 文件 {cp['file_count']} 个"
                    )
                out.append("")
        return out

    def _trace_checkpoints(self, sid: str) -> list[dict[str, object]]:
        """从 vfs_checkpoints 表读取该会话最近的 checkpoint 元信息（不含大 payload）。"""
        try:
            with self._connection() as conn:
                rows = conn.execute(
                    """
                    SELECT checkpoint_id, session_id, reason, created_at, payload
                    FROM vfs_checkpoints
                    WHERE session_id = ?
                    ORDER BY created_at DESC
                    LIMIT 10
                    """,
                    (sid,),
                ).fetchall()
        except sqlite3.Error as exc:
            self._logger.error("_trace_checkpoints 失败: sid=%s err=%s", sid, exc)
            return []
        result: list[dict[str, object]] = []
        for row in rows:
            file_count = 0
            try:
                raw = row["payload"]
                if isinstance(raw, bytes):
                    try:
                        raw = zlib.decompress(raw)
                    except zlib.error:
                        pass
                snap = json.loads(raw) if isinstance(raw, (bytes, str)) else {}
                file_count = len(snap) if isinstance(snap, dict) else 0
            except (json.JSONDecodeError, TypeError, zlib.error):
                file_count = 0
            result.append({
                "reason": row["reason"],
                "created_at": row["created_at"],
                "file_count": file_count,
            })
        return result

    def maybe_summarize(
        self,
        session_id: str,
        llm_compress: "object" = None,
        chat_mode: bool = False,
    ) -> bool:
        """§5.1 双阈值触发摘要压缩：未摘要 ≥N 轮 或 未摘要内容 >M token 时执行。

        Why 双阈值（PLAN 决策 D）：纯轮数触发对突发长对话反应滞后，纯 token 触发
        需要逐轮精确计数；两者取或，兼顾定期清理与突发膨胀。

        压缩源：raw_event_ledger 中未被最近摘要覆盖的事件（turn 序号 = 事件在
        最近 500 条扫描窗口内的 1-based 序号，与既有摘要的 turn_end 口径一致）。
        压缩区间保留最近 4 条事件原文（约 2 轮）——近期上下文由滑动窗口层供给，
        摘要只覆盖"早期对话"，避免两层重复占预算。

        R1 容错：llm_compress 失败最多重试 3 次，随后降级为截断素材前 2000 字符；
        任何异常仅 log 返回 False，绝不抛出阻塞主流程。

        Args:
            session_id: 目标会话。
            llm_compress: 可选 Callable[[str], str]，输入摘要素材返回压缩文本；
                None 时直接走降级截断（主链路默认，零 LLM 依赖；上层可注入真实
                LLM 客户端闭包以获得更高质量摘要）。
            chat_mode: True 时使用聊天类模式阈值（CHAT_SUMMARY_*，更灵敏），
                并构建九段式结构化摘要（对齐文档 L3 + 绘画记忆思想）；
                False 时沿用 code 模式阈值与通用摘要。

        Returns:
            True = 本次触发并落库了一条摘要；False = 未达阈值或失败。
        """
        if not session_id:
            return False
        profile = self._profile(chat_mode)
        # 阈值解析：注入配置优先，未注入回退模块默认（chat 用 CHAT_*，code 用 SUMMARY_*）。
        if profile is not None:
            turn_threshold = int(profile.summary_turn_threshold)
            token_threshold = int(profile.summary_token_threshold)
            keep_recent = int(profile.keep_recent_events)
            scan_limit = int(profile.scan_limit)
        else:
            turn_threshold = CHAT_SUMMARY_TURN_THRESHOLD if chat_mode else SUMMARY_TURN_THRESHOLD
            token_threshold = CHAT_SUMMARY_TOKEN_THRESHOLD if chat_mode else SUMMARY_TOKEN_THRESHOLD
            keep_recent = _SUMMARY_KEEP_RECENT_EVENTS
            scan_limit = _SUMMARY_EVENT_SCAN_LIMIT
        try:
            # ASC 事件序列（query_events 返回 DESC，反转；turn 序号基于此窗口）。
            events_desc = self.query_events(session_id, limit=scan_limit)
            events = list(reversed(events_desc))
            total = len(events)
            latest = self.get_recent_summary(session_id)
            covered = int(latest["turn_end"]) if latest else 0
            if total - covered < keep_recent + 1:
                return False  # 事件不足，保留窗口外无可压缩区间

            unsummarized = events[covered:]
            turns = sum(1 for e in unsummarized if e["event_type"] == "ai_reply")
            tokens = sum(
                _estimate_tokens(json.dumps(e["event_data"], ensure_ascii=False))
                for e in unsummarized
            )
            if turns < turn_threshold and tokens <= token_threshold:
                return False

            compress_end = total - keep_recent  # 1-based turn_end
            if chat_mode:
                digest = self._build_chat_digest(events[covered:compress_end])
            else:
                digest = self._build_summary_digest(events[covered:compress_end])
            if not digest.strip():
                return False

            summary_text = self._compress_digest(digest, llm_compress)
            # 重复性检测：与最近摘要规范化文本完全一致时跳过落库。
            # Why 只抓字面级: 用户重复相同诉求会压缩出雷同摘要，逐条落库只会
            # 稀释信息密度；语义级相似交给人工删除，避免误杀（R1 保守原则）。
            # 注意此时不前进覆盖区间（latest.turn_end 不变），下次触发会重算，
            # 幂等无状态错乱。
            if latest and _normalize_summary_text(
                str(latest["summary_text"])
            ) == _normalize_summary_text(summary_text):
                self._logger.info(
                    "maybe_summarize 跳过重复摘要: sid=%s turn=[%d,%d]",
                    session_id, covered + 1, compress_end,
                )
                return False
            topics = _extract_summary_topics(summary_text)
            return self.save_summary(
                session_id,
                turn_start=covered + 1,
                turn_end=compress_end,
                summary_text=summary_text,
                topics=topics,
            )
        except Exception:
            self._logger.exception("maybe_summarize 失败: sid=%s", session_id)
            return False

    @staticmethod
    def _build_summary_digest(events: list[dict[str, object]]) -> str:
        """把待压缩事件序列化为"指令→结果"摘要素材（逐行）。"""
        lines: list[str] = []
        for event in events:
            data = event.get("event_data")
            if not isinstance(data, dict):
                continue
            etype = event.get("event_type")
            if etype == "user_input":
                lines.append(f"用户: {str(data.get('text', ''))[:200]}")
            elif etype == "ai_reply":
                instruction = str(data.get("instruction", ""))[:200]
                summary = str(data.get("summary", ""))[:300]
                lines.append(f"指令: {instruction} → 结果: {summary}")
            elif etype == "vfs_change":
                files = data.get("changed_files")
                if isinstance(files, list) and files:
                    lines.append("变更文件: " + ", ".join(str(f) for f in files[:10]))
        return "\n".join(lines)

    @staticmethod
    def _build_chat_digest(events: list[dict[str, object]]) -> str:
        """把待压缩聊天事件序列化为"九段式增量笔记"素材（对齐视频绘画记忆思想）。

        Why 九段式（对齐文档 L3 结构化压缩）：纯"用户/助手"逐行对长对话信息密度低，
        LLM 直接压缩会丢失结构化记忆（当前状态、下一步计划、未完成事项等）。
        九段式把早期对话提炼成 {目标/技术/关键信息/踩坑/关键指令/未完成/当前状态/
        下一步计划}，供 build_context 以高浓度形态注入，削减 80% token 的同时保留
        语义走向与可执行锚点。"下一步计划"段交给 LLM 从用户原话中抽取，压缩后
        由 _compress_digest 保留。

        事件按时间升序传入；本方法按段聚合 user_input/ai_reply 原文。
        """
        user_lines: list[str] = []
        assistant_lines: list[str] = []
        for event in events:
            data = event.get("event_data")
            if not isinstance(data, dict):
                continue
            etype = event.get("event_type")
            text = str(data.get("text", ""))[:300]
            if etype == "user_input" and text:
                user_lines.append(text)
            elif etype == "ai_reply" and text:
                assistant_lines.append(text)
        sections = [
            "# 早期对话增量笔记",
            "## 初始目标",
            user_lines[0][:200] if user_lines else "（首轮意图）",
            "## 关键指令与诉求",
            "\n".join(user_lines[1:])[:600] or "（无）",
            "## 早期回复要点",
            "\n".join(assistant_lines)[:600] or "（无）",
            "## 未完成事项 / 当前状态 / 下一步计划",
            "请从以上原始对话中提炼：未完成事项、当前状态、下一步计划（尽量引用用户原话）。",
        ]
        return "\n".join(sections)

    def _compress_digest(self, digest: str, llm_compress: "object") -> str:
        """LLM 压缩（3 次重试）→ 失败降级截断（R1）。"""
        if callable(llm_compress):
            for attempt in range(3):
                try:
                    compressed = llm_compress(digest)
                    if isinstance(compressed, str) and compressed.strip():
                        return compressed.strip()
                except Exception:
                    self._logger.warning(
                        "llm_compress 第 %d 次失败", attempt + 1, exc_info=True
                    )
        # 降级：保留素材前 N 字符（信息密度最高的前部）。
        fallback = _SUMMARY_FALLBACK_CHARS
        if self._settings is not None:
            fallback = int(self._settings.global_memory.fallback_chars)
        return digest[:fallback]

    # ==================================================================
    # 第 4 层：滑动窗口（聊天类模式：内存 FIFO 双写 + 账本回放兜底）
    # ==================================================================
    def push_chat_turn(
        self,
        session_id: str,
        role: str,
        content: str,
    ) -> bool:
        """写入一轮聊天消息：内存 FIFO（主） + 事件账本（兜底，可回放重建）。

        Why 双写（对齐文档 L4 LangGraph 消息队列）：内存 deque 保证零 IO 低延迟
        注入；同时写账本保证会话刷新/重启后可从账本重建 FIFO，满足跨会话可恢复。
        两条路径产出相同消息形状，缓存纪律不受影响。

        Args:
            role: "user" | "assistant"。
            content: 本轮消息正文。
        """
        if not session_id:
            return False
        # 1) 内存 FIFO 主路径（容量 = 配置的 window_k，未注入则用模块默认）
        window_k = CHAT_WINDOW_K
        if self._settings is not None:
            window_k = int(self._settings.global_memory.window_k)
        window = self._chat_windows.setdefault(session_id, deque(maxlen=window_k))
        window.append({"role": role, "content": content})
        # 2) 账本兜底路径（best-effort，失败不阻断）
        return self.record_event(
            session_id,
            event_type="user_input" if role == "user" else "ai_reply",
            event_data={"text": content, "role": role},
            chat_mode=True,
        )

    def get_chat_window(
        self,
        session_id: str,
        k: int = CHAT_WINDOW_K,
    ) -> list[dict[str, object]]:
        """返回最近 K 轮聊天消息（升序：旧→新，符合缓存纪律）。

        主路径：内存 FIFO（若该会话本进程内已写入过）；否则从账本回放重建。
        Why 账本兜底：内存 FIFO 在会话刷新/进程重启后为空，需从持久化的
        raw_event_ledger 重建，保证跨会话可恢复。
        """
        if not session_id or k <= 0:
            return []
        window = self._chat_windows.get(session_id)
        if window is not None:
            return list(window)[-k:]
        # 兜底：账本回放最近 K 轮 user_input/ai_reply 配对（升序）。
        events_desc = self.query_events(session_id, limit=self._event_keep(chat_mode=True))
        turns: list[dict[str, object]] = []
        for event in reversed(events_desc):  # 转 ASC
            etype = event.get("event_type")
            if etype not in {"user_input", "ai_reply"}:
                continue
            data = event.get("event_data")
            if not isinstance(data, dict):
                continue
            text = str(data.get("text", "") or "")
            if not text:
                continue
            role = "user" if etype == "user_input" else "assistant"
            turns.append({"role": role, "content": text})
        return turns[-k:]

    def clear_chat_window(self, session_id: str) -> None:
        """清除某会话的内存 FIFO 滑窗（账本由 clear_session_memory 一并清理）。"""
        self._chat_windows.pop(session_id, None)

    def get_sliding_window(
        self,
        session_id: str,
        messages: list[dict[str, object]],
        k: int = 6,
    ) -> list[dict[str, object]]:
        """返回最近 K 条原始消息。

        Why：最近对话携带当前任务意图，需以原文（非摘要）送入 LLM；
        本层不落库——messages 由调用方维护，此处仅尾部截取，避免存储双写。
        session_id 保留用于接口对称与未来"持久化窗口"扩展，当前不参与截取逻辑。
        """
        if k <= 0 or not messages:
            return []
        return list(messages[-k:])

    # ==================================================================
    # 上下文合成器 (Context Synthesizer)
    # ==================================================================
    def build_context(
        self,
        session_id: str,
        user_input: str,
        messages: list[dict[str, object]],
        current_vfs: dict[str, str] | None = None,
    ) -> str:
        """合成 system_prompt：档案卡 + 摘要 + 滑动窗口 + 当前输入。

        Why：四层记忆叠加易致 prompt 膨胀（R5）。本方法按硬预算裁剪每层：
            档案卡 ≤ 500 token | 摘要 ≤ 800 token | 滑动窗口 ≤ 2000 token
        合计 ≤ 3300 token，保证下游 LLM 上下文不溢出。
        裁剪策略：
          - 档案卡：逐字段累加，超预算即停止（保留高频字段，dict 保序）。
          - 摘要：单条二分截断（关键信息在前部）。
          - 滑动窗口：从尾部向前累加，超预算即停止（优先保留最新消息）。
        """
        profile = self.get_valid_profile(session_id)
        summary = self.get_recent_summary(session_id)
        window = self.get_sliding_window(session_id, messages, k=6)

        # Token 预算：注入配置优先，未注入回退模块默认。
        if self._settings is not None:
            profile_budget = int(self._settings.profile_token_budget)
            summary_budget = int(self._settings.summary_token_budget)
            window_budget = int(self._settings.window_token_budget)
        else:
            profile_budget, summary_budget, window_budget = (
                _PROFILE_TOKEN_BUDGET, _SUMMARY_TOKEN_BUDGET, _WINDOW_TOKEN_BUDGET,
            )

        parts: list[str] = ["# Agent 记忆上下文"]

        # ---- 档案卡段（≤ profile_budget token）----
        profile_block = self._build_profile_block(profile, profile_budget)
        if profile_block:
            parts.append(profile_block)

        # ---- 摘要段（≤ summary_budget token）----
        summary_block = self._build_summary_block(summary, summary_budget)
        if summary_block:
            parts.append(summary_block)

        # ---- 滑动窗口段（≤ window_budget token）----
        window_block = self._build_window_block(window, window_budget)
        if window_block:
            parts.append(window_block)

        # ---- 当前用户输入 ----
        parts.append(f"## 当前用户输入\n{user_input}")

        # ---- VFS 文件清单（仅列文件名，避免 content 撑爆预算）----
        if current_vfs:
            vfs_names = ", ".join(current_vfs.keys())
            parts.append(f"## 当前 VFS 文件\n{vfs_names}")

        return "\n\n".join(parts)

    @staticmethod
    def _build_profile_block(profile: dict[str, object], budget: int) -> str:
        """逐字段累加至 token 预算。dict 保序（Python 3.7+），先入者优先保留。"""
        if not profile:
            return ""
        lines: list[str] = []
        used = 0
        for key, value in profile.items():
            line = f"- {key}: {value}"
            cost = _estimate_tokens(line)
            if used + cost > budget:
                break
            lines.append(line)
            used += cost
        if not lines:
            return ""
        return "## 项目档案卡\n" + "\n".join(lines)

    @staticmethod
    def _build_summary_block(summary: dict[str, object] | None, budget: int) -> str:
        if summary is None:
            return ""
        text = str(summary.get("summary_text", ""))
        if not text:
            return ""
        truncated = _truncate_to_budget(text, budget)
        topics = summary.get("topics")
        topic_line = ""
        if isinstance(topics, list) and topics:
            topic_line = "\n涉及话题: " + ", ".join(str(t) for t in topics)
        return "## 最近对话摘要\n" + truncated + topic_line

    @staticmethod
    def _build_window_block(window: list[dict[str, object]], budget: int) -> str:
        """从尾部向前累加，超预算即停止——最新消息优先保留。"""
        if not window:
            return ""
        lines: list[str] = []
        used = 0
        for msg in reversed(window):
            role = str(msg.get("role", "unknown"))
            content = str(msg.get("content", ""))
            line = f"[{role}]: {content}"
            cost = _estimate_tokens(line)
            if used + cost > budget:
                break
            lines.insert(0, line)
            used += cost
        if not lines:
            return ""
        return "## 最近对话\n" + "\n".join(lines)
