"""程序性记忆（Skill 胶囊）模块：Skill CRUD + 两阶段匹配 + 自动沉淀。

Why 两阶段匹配: 关键词预筛选 < 1ms 过滤掉绝大多数无关 Skill，仅当存在候选时
才调用 LLM 做语义精确匹配，兼顾延迟与精度（计划书 §4 Skill 匹配选型）。
Why 阈值沉淀: 单次成功可能是偶然，连续成功 AUTO_CREATE_THRESHOLD 次后才沉淀
为可注入 Skill，保证统计显著性、降低噪声（计划书 §5.2 方案 B）。
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Awaitable, Callable, Sequence

logger = logging.getLogger("app.memory.skill")

SKILL_TYPES = {"code_pattern", "task_flow", "fix_template"}

# 两阶段匹配第二阶段的 LLM 精确匹配器类型：
# 接收 (user_input, 候选 Skill 列表)，返回匹配的 Skill 列表；可同步或异步。
SkillMatcher = Callable[
    [str, "list[SkillCapsule]"],
    "Awaitable[list[SkillCapsule]] | list[SkillCapsule]",
]


class SkillNotFoundError(LookupError):
    """通过 skill_id 定位 Skill 胶囊但不存在时抛出。"""


@dataclass(frozen=True)
class SkillCapsule:
    skill_id: int
    skill_name: str
    skill_type: str  # code_pattern | task_flow | fix_template
    trigger_condition: str
    trigger_keywords: list[str]
    standard_steps: list[str]
    required_params: list[str]
    validation_rules: list[str]
    success_count: int
    failure_count: int
    sample_envelope: str | None
    created_at: float
    updated_at: float

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class SkillStore:
    AUTO_CREATE_THRESHOLD = 2  # 连续成功 2 次后自动沉淀，保证统计显著性

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
        """确保 skill_capsules 表与索引存在（与 SessionStore 共享同一 DB，DDL 幂等）。

        Why 幂等: SessionStore._initialize 已建此表；此处 CREATE ... IF NOT EXISTS
        保证 SkillStore 可独立实例化且不破坏既有结构。
        """
        with self._connection() as connection:
            connection.executescript(
                """
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
                CREATE INDEX IF NOT EXISTS idx_skill_type
                    ON skill_capsules(skill_type);
                CREATE INDEX IF NOT EXISTS idx_skill_trigger_condition
                    ON skill_capsules(trigger_condition);
                """
            )

    @staticmethod
    def _row_to_skill(row: sqlite3.Row) -> SkillCapsule:
        return SkillCapsule(
            skill_id=row["skill_id"],
            skill_name=row["skill_name"],
            skill_type=row["skill_type"],
            trigger_condition=row["trigger_condition"],
            trigger_keywords=json.loads(row["trigger_keywords"] or "[]"),
            standard_steps=json.loads(row["standard_steps"] or "[]"),
            required_params=json.loads(row["required_params"] or "[]"),
            validation_rules=json.loads(row["validation_rules"] or "[]"),
            success_count=row["success_count"],
            failure_count=row["failure_count"],
            sample_envelope=row["sample_envelope"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _dump_json_array(items: Sequence[str]) -> str:
        return json.dumps(list(items), ensure_ascii=False, separators=(",", ":"))

    def create_skill(
        self,
        skill_name: str,
        skill_type: str,
        trigger_condition: str,
        trigger_keywords: Sequence[str],
        standard_steps: Sequence[str],
        required_params: Sequence[str] | None = None,
        validation_rules: Sequence[str] | None = None,
        sample_envelope: str | None = None,
    ) -> SkillCapsule:
        """手动创建 Skill 胶囊。

        Why 参数校验: skill_type 决定 quick_match/list_skills 的过滤分支，脏数据会
        污染匹配逻辑；standard_steps 为空表示 Skill 无可执行步骤，无沉淀价值。
        """
        if skill_type not in SKILL_TYPES:
            raise ValueError(f"Unsupported skill_type: {skill_type}")
        cleaned_name = skill_name.strip()
        cleaned_trigger = trigger_condition.strip()
        if not cleaned_name:
            raise ValueError("skill_name must not be empty")
        if not cleaned_trigger:
            raise ValueError("trigger_condition must not be empty")
        if not standard_steps:
            raise ValueError("standard_steps must not be empty")

        now = time.time()
        keywords_json = self._dump_json_array(trigger_keywords)
        steps_json = self._dump_json_array(standard_steps)
        params_json = self._dump_json_array(required_params or [])
        rules_json = self._dump_json_array(validation_rules or [])

        with self._connection() as connection:
            cursor = connection.execute(
                """
                INSERT INTO skill_capsules
                    (skill_name, skill_type, trigger_condition, trigger_keywords,
                     standard_steps, required_params, validation_rules,
                     success_count, failure_count, sample_envelope,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
                """,
                (
                    cleaned_name,
                    skill_type,
                    cleaned_trigger,
                    keywords_json,
                    steps_json,
                    params_json,
                    rules_json,
                    sample_envelope,
                    now,
                    now,
                ),
            )
            skill_id = cursor.lastrowid
        logger.debug(
            "created skill id=%s name=%s type=%s", skill_id, cleaned_name, skill_type
        )
        # 直接由已知值构造，避免二次查询；字段与入库完全一致。
        return SkillCapsule(
            skill_id=skill_id,
            skill_name=cleaned_name,
            skill_type=skill_type,
            trigger_condition=cleaned_trigger,
            trigger_keywords=list(trigger_keywords),
            standard_steps=list(standard_steps),
            required_params=list(required_params or []),
            validation_rules=list(validation_rules or []),
            success_count=0,
            failure_count=0,
            sample_envelope=sample_envelope,
            created_at=now,
            updated_at=now,
        )

    def get_skill(self, skill_id: int) -> SkillCapsule | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM skill_capsules WHERE skill_id = ?",
                (skill_id,),
            ).fetchone()
        return self._row_to_skill(row) if row is not None else None

    def list_skills(self, skill_type: str | None = None) -> list[SkillCapsule]:
        with self._connection() as connection:
            if skill_type is None:
                rows = connection.execute(
                    "SELECT * FROM skill_capsules ORDER BY updated_at DESC"
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT * FROM skill_capsules
                    WHERE skill_type = ?
                    ORDER BY updated_at DESC
                    """,
                    (skill_type,),
                ).fetchall()
        return [self._row_to_skill(row) for row in rows]

    def delete_skill(self, skill_id: int) -> bool:
        with self._connection() as connection:
            cursor = connection.execute(
                "DELETE FROM skill_capsules WHERE skill_id = ?",
                (skill_id,),
            )
            deleted = cursor.rowcount > 0
        if deleted:
            logger.debug("deleted skill id=%s", skill_id)
        return deleted

    def record_success(self, skill_id: int) -> None:
        """success_count += 1, updated_at = now。

        Why 单独方法: 计数与时间戳必须原子更新，供 maybe_create 阈值判定使用。
        """
        now = time.time()
        with self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE skill_capsules
                SET success_count = success_count + 1, updated_at = ?
                WHERE skill_id = ?
                """,
                (now, skill_id),
            )
            if cursor.rowcount == 0:
                raise SkillNotFoundError(skill_id)
        logger.debug("recorded success skill_id=%s", skill_id)

    def record_failure(self, skill_id: int) -> None:
        """failure_count += 1, updated_at = now。"""
        now = time.time()
        with self._connection() as connection:
            cursor = connection.execute(
                """
                UPDATE skill_capsules
                SET failure_count = failure_count + 1, updated_at = ?
                WHERE skill_id = ?
                """,
                (now, skill_id),
            )
            if cursor.rowcount == 0:
                raise SkillNotFoundError(skill_id)
        logger.debug("recorded failure skill_id=%s", skill_id)

    def quick_match(self, user_input: str) -> list[SkillCapsule]:
        """第一阶段：关键词快速预筛选。

        Why 纯字符串匹配: 不调 LLM，延迟 < 1ms，先过滤掉绝大多数无关 Skill，
        避免后续 LLM 调用的成本与延迟。仅返回 success_count >= AUTO_CREATE_THRESHOLD
        的 Skill——未达阈值的 Skill 统计显著性不足，不参与自动注入。
        """
        haystack = user_input.lower()
        candidates: list[SkillCapsule] = []
        for skill in self.list_skills():
            if skill.success_count < self.AUTO_CREATE_THRESHOLD:
                continue
            if not skill.trigger_keywords:
                continue
            if any(kw and kw.lower() in haystack for kw in skill.trigger_keywords):
                candidates.append(skill)
        logger.debug(
            "quick_match input_len=%d candidates=%d",
            len(user_input),
            len(candidates),
        )
        return candidates

    def match_skills(
        self,
        user_input: str,
        llm_matcher: SkillMatcher | None = None,
    ) -> list[SkillCapsule]:
        """两阶段匹配入口。

        Why 两阶段: quick_match 先用关键词预筛选（< 1ms），无候选时直接返回空，
        跳过 LLM 调用以省成本；有候选时才调 llm_matcher 做语义精确匹配。
        llm_matcher 可选：不传则直接返回 quick_match 结果（便于离线/测试场景）。
        """
        candidates = self.quick_match(user_input)
        if not candidates:
            return []
        if llm_matcher is None:
            return candidates

        matched = llm_matcher(user_input, candidates)
        if inspect.isawaitable(matched):
            matched = self._resolve_awaitable(matched)
        if not isinstance(matched, list):
            logger.warning("llm_matcher returned non-list, fallback to quick_match")
            return candidates
        logger.debug(
            "llm_matcher narrowed %d -> %d", len(candidates), len(matched)
        )
        return matched

    @staticmethod
    def _resolve_awaitable(
        awaitable: Awaitable[list[SkillCapsule]],
    ) -> list[SkillCapsule] | None:
        """在同步上下文中解析 LLM 匹配器返回的协程。

        Why: match_skills 为同步签名（便于非异步调用方与测试使用），但 llm_matcher
        可能是 async callable。无运行中事件循环时用 asyncio.run 驱动；已在事件循环
        内时无法阻塞等待，记录告警并返回 None，由调用方回退到 quick_match 候选。
        """
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(awaitable)  # type: ignore[arg-type]
        logger.warning(
            "llm_matcher returned coroutine but event loop is running; "
            "cannot block - falling back to quick_match candidates"
        )
        return None

    def maybe_create_skill_from_success(
        self,
        trigger_condition: str,
        trigger_keywords: Sequence[str],
        standard_steps: Sequence[str],
        skill_type: str = "code_pattern",
        sample_envelope: str | None = None,
    ) -> SkillCapsule | None:
        """自动沉淀逻辑。

        Why 阈值沉淀: 单次成功可能是偶然，连续成功 AUTO_CREATE_THRESHOLD 次后才
        沉淀为可注入 Skill，保证统计显著性、降低噪声（计划书 §5.2 方案 B）。

        流程:
        1. 按 trigger_condition 查找已有 Skill
        2. 不存在 → 创建新 Skill 并记一次成功（success_count=1）
        3. 存在 → success_count += 1
        4. success_count 达到 AUTO_CREATE_THRESHOLD → 返回该 Skill（可自动注入）
        5. 未达阈值 → 返回 None
        """
        existing = self._find_by_trigger_condition(trigger_condition)
        if existing is None:
            new_skill = self.create_skill(
                skill_name=self._auto_skill_name(trigger_condition),
                skill_type=skill_type,
                trigger_condition=trigger_condition,
                trigger_keywords=list(trigger_keywords),
                standard_steps=list(standard_steps),
                sample_envelope=sample_envelope,
            )
            self.record_success(new_skill.skill_id)
            refreshed = self.get_skill(new_skill.skill_id)
            if refreshed is None:  # pragma: no cover - 刚写入必存在
                raise RuntimeError(
                    f"skill {new_skill.skill_id} vanished after record_success"
                )
            logger.info(
                "auto-created skill id=%s success_count=%d",
                new_skill.skill_id,
                refreshed.success_count,
            )
            return (
                refreshed
                if refreshed.success_count >= self.AUTO_CREATE_THRESHOLD
                else None
            )

        self.record_success(existing.skill_id)
        refreshed = self.get_skill(existing.skill_id)
        if refreshed is None:  # pragma: no cover - 刚更新必存在
            raise RuntimeError(
                f"skill {existing.skill_id} vanished after record_success"
            )
        if refreshed.success_count >= self.AUTO_CREATE_THRESHOLD:
            logger.info(
                "skill id=%s reached threshold success_count=%d",
                existing.skill_id,
                refreshed.success_count,
            )
            return refreshed
        return None

    def _find_by_trigger_condition(self, trigger_condition: str) -> SkillCapsule | None:
        """按 trigger_condition 查找已有胶囊：先精确匹配，未命中再做规范化比对。

        Why 规范化去重: 自动沉淀的 trigger_condition 来自用户原始指令，"加个搜索框"
        与"加个搜索框！"/"加个搜索框。" 字面不同会各沉淀一条语义重复的胶囊，导致
        匹配注入时重复占用 prompt 预算。规范化（小写 + 去非字母数字字符）后比对可
        合并这类变体；存储仍保留原文，不破坏审计与展示。胶囊量级为几十条，全表扫
        成本可忽略，无需为规范化值加索引列。
        """
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT * FROM skill_capsules
                WHERE trigger_condition = ?
                LIMIT 1
                """,
                (trigger_condition,),
            ).fetchone()
            if row is not None:
                return self._row_to_skill(row)
            normalized = self._normalize_trigger_condition(trigger_condition)
            if not normalized:
                return None
            rows = connection.execute("SELECT * FROM skill_capsules").fetchall()
        for candidate in rows:
            if self._normalize_trigger_condition(candidate["trigger_condition"]) == normalized:
                return self._row_to_skill(candidate)
        return None

    @staticmethod
    def _normalize_trigger_condition(text: str) -> str:
        """规范化触发条件用于去重比对：小写 + 仅保留字母数字（含中文）。

        Why 只用于比对键: 存储层保留用户原文，规范化值不落库，避免破坏既有
        UNIQUE(skill_name) 与审计语义。
        """
        return "".join(ch for ch in text.lower() if ch.isalnum())

    @staticmethod
    def _auto_skill_name(trigger_condition: str) -> str:
        """根据 trigger_condition 生成确定性 skill_name。

        Why 确定性: 同一 trigger_condition 多次调用应映射到同一 skill_name，
        使 _find_by_trigger_condition 能命中已沉淀记录；UNIQUE 约束兜底防止
        并发场景下重复插入。
        """
        digest = hashlib.md5(trigger_condition.encode("utf-8")).hexdigest()[:12]
        return f"auto_{digest}"
