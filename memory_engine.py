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
from contextlib import contextmanager
from pathlib import Path

# 双时间戳远未来常量：valid_end == FAR_FUTURE 表示该记录当前生效。
FAR_FUTURE: float = 9999999999.0

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

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._logger = logging.getLogger("app.memory")

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
    ) -> bool:
        """向追加账本写入一条不可变事件。

        Why：账本 append-only，提供完整审计链与回放能力；所有用户输入、AI 回复、
        工具调用、VFS 变更均落账，便于事后追溯与摘要重建。

        Returns: True 成功 / False 失败（已 log，不抛出）。
        """
        if not session_id or not event_type:
            self._logger.warning("record_event 参数非法: sid=%s type=%s", session_id, event_type)
            return False
        payload = json.dumps(event_data, ensure_ascii=False)
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
                    (session_id, session_id, _EVENT_KEEP_PER_SESSION),
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
        """
        if not session_id or not field_key:
            self._logger.warning("update_profile_field 参数非法: sid=%s key=%s", session_id, field_key)
            return False
        now = time.time()
        serialized = json.dumps(field_value, ensure_ascii=False)
        try:
            with self._connection() as conn:
                # 打断旧生效记录：valid_end > now 即"当前生效"，置为 now 使其失效。
                # 用 valid_end > now 而非 == FAR_FUTURE，兼容外部手动设置的有效期。
                conn.execute(
                    """
                    UPDATE profile_cards
                    SET valid_end = ?
                    WHERE session_id = ? AND field_key = ? AND valid_end > ?
                    """,
                    (now, session_id, field_key, now),
                )
                conn.execute(
                    """
                    INSERT INTO profile_cards
                        (session_id, field_key, field_value, valid_start, valid_end, source)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (session_id, field_key, serialized, now, FAR_FUTURE, source),
                )
                # R-Retention 惰性清理：同事务删除 30 天前已失效的历史卡。
                # 生效卡（valid_end > now）永不触碰，保证 build_context 输入稳定。
                conn.execute(
                    """
                    DELETE FROM profile_cards
                    WHERE session_id = ? AND valid_end <= ?
                    """,
                    (session_id, now - _PROFILE_INACTIVE_TTL_SECONDS),
                )
            return True
        except sqlite3.Error as exc:
            self._logger.error(
                "update_profile_field 失败: sid=%s key=%s err=%s", session_id, field_key, exc
            )
            return False

    def get_valid_profile(self, session_id: str) -> dict[str, object]:
        """返回当前生效的 {field_key: field_value}。

        Why：构造上下文时只需"当前画像"，双时间戳过滤 valid_end > now 即可，
        天然屏蔽历史噪声——这是放弃向量检索、改用 KV 精确查找的核心收益。
        """
        now = time.time()
        try:
            with self._connection() as conn:
                rows = conn.execute(
                    """
                    SELECT field_key, field_value
                    FROM profile_cards
                    WHERE session_id = ? AND valid_end > ?
                    """,
                    (session_id, now),
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
                    (session_id, session_id, _SUMMARY_KEEP_PER_SESSION),
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
        return result

    def maybe_summarize(
        self,
        session_id: str,
        llm_compress: "object" = None,
    ) -> bool:
        """§5.1 双阈值触发摘要压缩：未摘要 ≥8 轮 或 未摘要内容 >6000 token 时执行。

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

        Returns:
            True = 本次触发并落库了一条摘要；False = 未达阈值或失败。
        """
        if not session_id:
            return False
        try:
            # ASC 事件序列（query_events 返回 DESC，反转；turn 序号基于此窗口）。
            events_desc = self.query_events(session_id, limit=_SUMMARY_EVENT_SCAN_LIMIT)
            events = list(reversed(events_desc))
            total = len(events)
            latest = self.get_recent_summary(session_id)
            covered = int(latest["turn_end"]) if latest else 0
            if total - covered < _SUMMARY_KEEP_RECENT_EVENTS + 1:
                return False  # 事件不足，保留窗口外无可压缩区间

            unsummarized = events[covered:]
            turns = sum(1 for e in unsummarized if e["event_type"] == "ai_reply")
            tokens = sum(
                _estimate_tokens(json.dumps(e["event_data"], ensure_ascii=False))
                for e in unsummarized
            )
            if turns < SUMMARY_TURN_THRESHOLD and tokens <= SUMMARY_TOKEN_THRESHOLD:
                return False

            compress_end = total - _SUMMARY_KEEP_RECENT_EVENTS  # 1-based turn_end
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
        # 降级：保留素材前 2000 字符（信息密度最高的前部）。
        return digest[:_SUMMARY_FALLBACK_CHARS]

    # ==================================================================
    # 第 4 层：滑动窗口（无存储，纯截取）
    # ==================================================================
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

        parts: list[str] = ["# Agent 记忆上下文"]

        # ---- 档案卡段（≤ 500 token）----
        profile_block = self._build_profile_block(profile, _PROFILE_TOKEN_BUDGET)
        if profile_block:
            parts.append(profile_block)

        # ---- 摘要段（≤ 800 token）----
        summary_block = self._build_summary_block(summary, _SUMMARY_TOKEN_BUDGET)
        if summary_block:
            parts.append(summary_block)

        # ---- 滑动窗口段（≤ 2000 token）----
        window_block = self._build_window_block(window, _WINDOW_TOKEN_BUDGET)
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
