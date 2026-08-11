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

SKILL_TYPES = {"code_pattern", "task_flow", "fix_template", "instruction"}

# Skill 生命周期：自动沉淀默认 pending（待人工确认，不参与匹配），
# 用户在记忆面板「上架」后置 published 才参与 match 注入。
SKILL_STATUS_PENDING = "pending"
SKILL_STATUS_PUBLISHED = "published"
SKILL_STATUSES = {SKILL_STATUS_PENDING, SKILL_STATUS_PUBLISHED}

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
    skill_type: str  # code_pattern | task_flow | fix_template | instruction
    trigger_condition: str
    trigger_keywords: list[str]
    standard_steps: list[str]
    required_params: list[str]
    validation_rules: list[str]
    success_count: int
    failure_count: int
    sample_envelope: str | None
    content_md: str | None
    created_at: float
    updated_at: float
    enabled: bool = True
    # Why 默认 pending: 自动沉淀/手动创建的新 Skill 一律待人工确认，
    # 防止噪声胶囊未经审核直接参与 prompt 注入（决策 1 人工确认上架）。
    status: str = SKILL_STATUS_PENDING
    # Why author/source: 市场目录（catalog）与手动创建引入后，需要区分来源——
    # 'Anthropic'（catalog 安装）/ '我'（手动/上传）/ 'agent'（code 沉淀）；
    # source 存 catalog_id 用于安装幂等判重与卸载回溯，非 catalog 来源为 None。
    author: str = "local"
    source: str | None = None

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
                    content_md        TEXT,
                    created_at        REAL NOT NULL,
                    updated_at        REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_skill_type
                    ON skill_capsules(skill_type);
                CREATE INDEX IF NOT EXISTS idx_skill_trigger_condition
                    ON skill_capsules(trigger_condition);
                """
            )
            # Why: enabled 列为后加字段，老库需幂等迁移（ALTER TABLE 无 IF NOT EXISTS，
            # 用 PRAGMA table_info 探测后补齐），默认 1 保持存量行为不变。
            columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(skill_capsules)")
            }
            if "enabled" not in columns:
                connection.execute(
                    "ALTER TABLE skill_capsules ADD COLUMN enabled INTEGER DEFAULT 1"
                )
            # Why: status 列为人工确认上架新增（决策 1）。存量数据是历史上已在用的
            # 有效胶囊，迁移默认 published 避免突然失效；新增沉淀走 create_skill /
            # maybe_create 默认 pending。
            if "status" not in columns:
                connection.execute(
                    "ALTER TABLE skill_capsules ADD COLUMN status TEXT NOT NULL DEFAULT 'published'"
                )
            # Why: author/source 列为 Skill 市场目录新增（计划书 §2.4）。存量行全部是
            # code 模式沉淀物，迁移时回填 author='agent'；列默认 'local' 仅兜底，
            # create_skill 之后总是显式传 author。
            if "author" not in columns:
                connection.execute(
                    "ALTER TABLE skill_capsules ADD COLUMN author TEXT NOT NULL DEFAULT 'local'"
                )
                connection.execute("UPDATE skill_capsules SET author = 'agent'")
            if "source" not in columns:
                connection.execute(
                    "ALTER TABLE skill_capsules ADD COLUMN source TEXT"
                )
            if "content_md" not in columns:
                connection.execute(
                    "ALTER TABLE skill_capsules ADD COLUMN content_md TEXT"
                )

    @staticmethod
    def _row_to_skill(row: sqlite3.Row) -> SkillCapsule:
        keys = row.keys()
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
            content_md=row["content_md"] if "content_md" in keys else None,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            # Why: 兼容迁移窗口内（列补齐前）的旧连接读取，缺列按启用处理。
            enabled=bool(row["enabled"]) if "enabled" in keys else True,
            # 缺列按 published 处理，与迁移默认值一致（存量视为已上架）。
            status=row["status"] if "status" in keys else SKILL_STATUS_PUBLISHED,
            author=row["author"] if "author" in keys else "local",
            source=row["source"] if "source" in keys else None,
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
        content_md: str | None = None,
        status: str = SKILL_STATUS_PENDING,
        author: str = "local",
        source: str | None = None,
    ) -> SkillCapsule:
        """手动创建 Skill 胶囊。

        Why 参数校验: skill_type 决定 quick_match/list_skills 的过滤分支，脏数据会
        污染匹配逻辑；standard_steps 为空表示 Skill 无可执行步骤，无沉淀价值。
        Why status 参数: 自动沉淀必须 pending 待人审（决策 1）；而市场安装/手动编写/
        上传解析本身是用户主动行为，调用方显式传 published 直接上架（计划书 §3）。
        """
        if skill_type not in SKILL_TYPES:
            raise ValueError(f"Unsupported skill_type: {skill_type}")
        if status not in SKILL_STATUSES:
            raise ValueError(f"Unsupported status: {status}")
        cleaned_name = skill_name.strip()
        cleaned_trigger = trigger_condition.strip()
        cleaned_author = author.strip() or "local"
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
                     success_count, failure_count, sample_envelope, content_md,
                     created_at, updated_at, status, author, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?)
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
                    content_md,
                    now,
                    now,
                    status,
                    cleaned_author,
                    source,
                ),
            )
            skill_id = cursor.lastrowid
        logger.debug(
            "created skill id=%s name=%s type=%s status=%s source=%s",
            skill_id, cleaned_name, skill_type, status, source,
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
            content_md=content_md,
            created_at=now,
            updated_at=now,
            status=status,
            author=cleaned_author,
            source=source,
        )

    def get_skill_by_source(self, source: str) -> SkillCapsule | None:
        """按 catalog source 查找（市场安装幂等判重）。"""
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM skill_capsules WHERE source = ?", (source,)
            ).fetchone()
        return self._row_to_skill(row) if row else None

    def get_skill(self, skill_id: int) -> SkillCapsule | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT * FROM skill_capsules WHERE skill_id = ?",
                (skill_id,),
            ).fetchone()
        return self._row_to_skill(row) if row is not None else None

    def list_skills(
        self,
        skill_type: str | None = None,
        status: str | None = None,
    ) -> list[SkillCapsule]:
        """列出 Skill 胶囊，可按类型 / 生命周期状态过滤。

        Why status 过滤: 上架确认后，运行设置 Skill 区块与匹配注入只需 published；
        记忆面板需同时看 pending（待确认）与 published，由调用方按需传参。
        """
        with self._connection() as connection:
            if skill_type is None and status is None:
                rows = connection.execute(
                    "SELECT * FROM skill_capsules ORDER BY updated_at DESC"
                ).fetchall()
            else:
                clauses: list[str] = []
                params: list[object] = []
                if skill_type is not None:
                    clauses.append("skill_type = ?")
                    params.append(skill_type)
                if status is not None:
                    clauses.append("status = ?")
                    params.append(status)
                where = " AND ".join(clauses)
                rows = connection.execute(
                    f"SELECT * FROM skill_capsules WHERE {where} ORDER BY updated_at DESC",
                    tuple(params),
                ).fetchall()
        return [self._row_to_skill(row) for row in rows]

    def set_skill_status(self, skill_id: int, status: str) -> None:
        """上架 / 下架 Skill（published / pending）。

        Why 单独方法: 状态流转是人工确认动作，与 set_skill_enabled（临时停用）语义
        不同——status 管"是否被审核上架"，enabled 管"上架后是否临时停用"，二者正交。
        """
        if status not in SKILL_STATUSES:
            raise ValueError(f"Unsupported skill status: {status}")
        with self._connection() as connection:
            cursor = connection.execute(
                "UPDATE skill_capsules SET status = ?, updated_at = ? WHERE skill_id = ?",
                (status, time.time(), skill_id),
            )
            if cursor.rowcount == 0:
                raise SkillNotFoundError(skill_id)
        logger.debug("set skill status id=%s status=%s", skill_id, status)

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

    def set_skill_enabled(self, skill_id: int, enabled: bool) -> None:
        """启停 Skill：停用的不参与 quick_match 注入，但保留数据供再启用。"""
        with self._connection() as connection:
            cursor = connection.execute(
                "UPDATE skill_capsules SET enabled = ?, updated_at = ? WHERE skill_id = ?",
                (1 if enabled else 0, time.time(), skill_id),
            )
            if cursor.rowcount == 0:
                raise SkillNotFoundError(skill_id)

    def update_skill(
        self,
        skill_id: int,
        *,
        skill_name: str | None = None,
        trigger_condition: str | None = None,
        trigger_keywords: Sequence[str] | None = None,
        standard_steps: Sequence[str] | None = None,
        content_md: str | None = None,
    ) -> SkillCapsule:
        """编辑 Skill 的可读字段（Skills 页签管理用）。仅更新非 None 字段。"""
        updates: list[str] = []
        params: list[object] = []
        if skill_name is not None:
            cleaned = skill_name.strip()
            if not cleaned:
                raise ValueError("skill_name must not be empty")
            updates.append("skill_name = ?")
            params.append(cleaned)
        if trigger_condition is not None:
            cleaned = trigger_condition.strip()
            if not cleaned:
                raise ValueError("trigger_condition must not be empty")
            updates.append("trigger_condition = ?")
            params.append(cleaned)
        if trigger_keywords is not None:
            updates.append("trigger_keywords = ?")
            params.append(self._dump_json_array(trigger_keywords))
        if standard_steps is not None:
            if not standard_steps:
                raise ValueError("standard_steps must not be empty")
            updates.append("standard_steps = ?")
            params.append(self._dump_json_array(standard_steps))
        if content_md is not None:
            updates.append("content_md = ?")
            params.append(content_md)
        if not updates:
            refreshed = self.get_skill(skill_id)
            if refreshed is None:
                raise SkillNotFoundError(skill_id)
            return refreshed
        updates.append("updated_at = ?")
        params.append(time.time())
        params.append(skill_id)
        with self._connection() as connection:
            cursor = connection.execute(
                f"UPDATE skill_capsules SET {', '.join(updates)} WHERE skill_id = ?",
                tuple(params),
            )
            if cursor.rowcount == 0:
                raise SkillNotFoundError(skill_id)
        refreshed = self.get_skill(skill_id)
        if refreshed is None:  # pragma: no cover - 刚更新必存在
            raise RuntimeError(f"skill {skill_id} vanished after update")
        return refreshed

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

    def quick_match(
        self,
        user_input: str,
        allowed_ids: "set[int] | None" = None,
    ) -> list[SkillCapsule]:
        """第一阶段：关键词快速预筛选。

        Why 纯字符串匹配: 不调 LLM，延迟 < 1ms，先过滤掉绝大多数无关 Skill，
        避免后续 LLM 调用的成本与延迟。仅返回 success_count >= AUTO_CREATE_THRESHOLD
        的 Skill——未达阈值的 Skill 统计显著性不足，不参与自动注入。

        allowed_ids: 会话级白名单（决策 2 三态挂载）。None=auto（全部 published
        参与）；空集=off（全拦）；非空集=custom（仅白名单内参与）。
        """
        # off：空集白名单 → 一个都不注入，直接短路。
        if allowed_ids is not None and not allowed_ids:
            return []
        haystack = user_input.lower()
        candidates: list[SkillCapsule] = []
        # Why 只查 published: pending（待人工确认）的 Skill 一律不参与注入，
        # 从源头杜绝未审核胶囊污染 prompt（决策 1）。
        for skill in self.list_skills(status=SKILL_STATUS_PUBLISHED):
            if not skill.enabled:
                continue  # 停用胶囊不参与注入（Skills 页签管理语义）
            if allowed_ids is not None and skill.skill_id not in allowed_ids:
                continue  # custom 模式：不在白名单内的 published 也跳过
            # Why: instruction 类型（市场安装/手动创建）不受 success_count 阈值
            #   和 trigger_keywords 约束——用户主动安装即表示信任，
            #   匹配逻辑改为 trigger_condition 子串匹配（用户输入包含触发条件关键词即命中）。
            if skill.skill_type == "instruction":
                if skill.trigger_condition and skill.trigger_condition.lower() in haystack:
                    candidates.append(skill)
                continue
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
        allowed_ids: "set[int] | None" = None,
    ) -> list[SkillCapsule]:
        """两阶段匹配入口。

        Why 两阶段: quick_match 先用关键词预筛选（< 1ms），无候选时直接返回空，
        跳过 LLM 调用以省成本；有候选时才调 llm_matcher 做语义精确匹配。
        llm_matcher 可选：不传则直接返回 quick_match 结果（便于离线/测试场景）。
        allowed_ids 透传给 quick_match 做会话级白名单过滤。
        """
        candidates = self.quick_match(user_input, allowed_ids=allowed_ids)
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
                author="agent",  # 自动沉淀产物，与手动创建/市场安装区分
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
