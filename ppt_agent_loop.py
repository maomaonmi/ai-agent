"""Durable, provider-neutral primitives for the AI PPT agent loop."""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from ppt_repository import PptRepository, RepositoryConflict, RunRecord


class SearchBatchLimitExceeded(ValueError):
    code = "PPT_SEARCH_BATCH_LIMIT_EXCEEDED"


SearchProvider = Literal["firecrawl", "qwen", "glm"]


@dataclass(frozen=True, slots=True)
class SearchBatch:
    provider: SearchProvider
    query: str
    limit: int = 20

    def __post_init__(self) -> None:
        if not self.query.strip():
            raise ValueError("search query cannot be empty")
        if self.limit < 1:
            raise ValueError("search limit must be positive")
        if self.limit > 20:
            raise SearchBatchLimitExceeded("each search round may return at most 20 results")


class RunNotFound(LookupError):
    pass


class PresentationForRunNotFound(LookupError):
    pass


TERMINAL_RUN_STATUSES = frozenset({"COMPLETED", "CANCELLED", "FAILED"})


class AgentRunService:
    """Small durable run coordinator; providers can be attached at phase boundaries later."""

    _PHASES: tuple[tuple[str, str, dict[str, Any]], ...] = (
        ("PLAN", "需求理解与任务规划", {"iteration": 1}),
        ("SEARCH_1", "联网检索 · 第 1 轮", {"provider": "firecrawl", "resultCount": 18, "limit": 20}),
        ("SEARCH_2", "联网检索 · 第 2 轮", {"provider": "qwen", "resultCount": 16, "limit": 20}),
        ("SEARCH_3", "联网检索 · 第 3 轮", {"provider": "glm", "resultCount": 12, "limit": 20}),
        ("WEB_ASSETS", "网页图片素材收集", {"candidateCount": 6, "selectedCount": 3}),
        ("AI_ASSETS", "AI 生成图片", {"generatedCount": 3, "requiredCount": 3}),
        ("OUTLINE", "叙事与视觉方案", {"slideCount": 16}),
        ("BUILD", "逐页搭建", {"componentMode": "incremental"}),
        ("REVIEW", "质量检查与导出", {"checks": ["overflow", "citations", "compatibility"]}),
    )

    def __init__(self, repository: PptRepository) -> None:
        self.repository = repository
        self._locks: dict[str, threading.Lock] = {}

    def _lock(self, run_id: str) -> threading.Lock:
        return self._locks.setdefault(run_id, threading.Lock())

    @staticmethod
    def payload(record: RunRecord) -> dict[str, Any]:
        return {
            "runId": record.id,
            "presentationId": record.presentation_id,
            "status": record.status,
            "phase": record.phase,
            "state": record.state,
            "createdAt": record.created_at,
            "updatedAt": record.updated_at,
        }

    def create(
        self,
        *,
        run_id: str | None,
        presentation_id: str,
        owner_scope: str,
        prompt: str,
        max_iterations: int,
    ) -> tuple[RunRecord, bool]:
        if self.repository.get_presentation(presentation_id, owner_scope=owner_scope) is None:
            raise PresentationForRunNotFound(presentation_id)
        resolved_id = run_id or f"run-{uuid.uuid4().hex}"
        existing = self.repository.get_run(resolved_id, owner_scope=owner_scope)
        if existing is not None:
            return existing, False
        state = {
            "prompt": prompt,
            "iteration": 0,
            "maxIterations": max_iterations,
            "searchRounds": [],
            "webImages": {"candidateCount": 0, "selectedCount": 0},
            "aiImages": {"generatedCount": 0, "requiredCount": 3},
        }
        try:
            record = self.repository.create_run(
                run_id=resolved_id,
                presentation_id=presentation_id,
                owner_scope=owner_scope,
                status="QUEUED",
                phase="PLAN",
                state=state,
            )
            self.repository.append_run_event(
                run_id=resolved_id,
                sequence=1,
                event_type="run.created",
                payload={"presentationId": presentation_id, "prompt": prompt},
            )
        except RepositoryConflict:
            existing = self.repository.get_run(resolved_id, owner_scope=owner_scope)
            if existing is None:
                raise
            return existing, False
        worker = threading.Thread(target=self._execute, args=(resolved_id, owner_scope), daemon=True)
        worker.start()
        return record, True

    def _next_sequence(self, run_id: str) -> int:
        events = self.repository.list_run_events(run_id, after_sequence=0, limit=1_000)
        return (events[-1].sequence if events else 0) + 1

    def _emit(self, run_id: str, owner_scope: str, event_type: str, payload: dict[str, Any], *, status: str | None = None, phase: str | None = None, state_patch: dict[str, Any] | None = None) -> RunRecord | None:
        with self._lock(run_id):
            current = self.repository.get_run(run_id, owner_scope=owner_scope)
            if current is None:
                return None
            state = {**current.state, **(state_patch or {})}
            next_status = status or current.status
            next_phase = phase or current.phase
            self.repository.append_run_event(
                run_id=run_id,
                sequence=self._next_sequence(run_id),
                event_type=event_type,
                payload=payload,
            )
            self.repository.update_run(
                run_id,
                owner_scope=owner_scope,
                status=next_status,
                phase=next_phase,
                state=state,
            )
            return self.repository.get_run(run_id, owner_scope=owner_scope)

    def _execute(self, run_id: str, owner_scope: str) -> None:
        try:
            self._emit(run_id, owner_scope, "run.started", {"phase": "PLAN"}, status="RUNNING", phase="PLAN")
            for phase, label, details in self._PHASES:
                current = self.repository.get_run(run_id, owner_scope=owner_scope)
                if current is None or current.status == "CANCELLED":
                    return
                self._emit(run_id, owner_scope, "phase.started", {"phase": phase, "label": label}, status="RUNNING", phase=phase)
                state_patch: dict[str, Any] = {}
                if phase.startswith("SEARCH"):
                    SearchBatch(provider=details["provider"], query=current.state.get("prompt", "PPT"), limit=details["limit"])
                    rounds = list(current.state.get("searchRounds", []))
                    rounds.append({"round": len(rounds) + 1, **details})
                    state_patch["searchRounds"] = rounds
                elif phase == "WEB_ASSETS":
                    state_patch["webImages"] = {"candidateCount": details["candidateCount"], "selectedCount": details["selectedCount"]}
                elif phase == "AI_ASSETS":
                    state_patch["aiImages"] = {"generatedCount": details["generatedCount"], "requiredCount": details["requiredCount"]}
                elif phase == "PLAN":
                    state_patch["iteration"] = details["iteration"]
                self._emit(run_id, owner_scope, "phase.completed", {"phase": phase, "label": label, **details}, state_patch=state_patch)
                time.sleep(0.035)
            self._emit(run_id, owner_scope, "run.completed", {"slideCount": 16}, status="COMPLETED", phase="REVIEW")
        except Exception as exc:  # pragma: no cover - defensive worker boundary
            self._emit(run_id, owner_scope, "run.failed", {"message": str(exc)[:500]}, status="FAILED", phase="REVIEW")

    def get(self, run_id: str, *, owner_scope: str) -> RunRecord:
        record = self.repository.get_run(run_id, owner_scope=owner_scope)
        if record is None:
            raise RunNotFound(run_id)
        return record

    def cancel(self, run_id: str, *, owner_scope: str) -> RunRecord:
        with self._lock(run_id):
            current = self.get(run_id, owner_scope=owner_scope)
            if current.status not in TERMINAL_RUN_STATUSES:
                self.repository.append_run_event(
                    run_id=run_id,
                    sequence=self._next_sequence(run_id),
                    event_type="run.cancelled",
                    payload={"reason": "user"},
                )
                self.repository.update_run(
                    run_id,
                    owner_scope=owner_scope,
                    status="CANCELLED",
                    phase=current.phase,
                    state={**current.state, "cancelledBy": "user"},
                )
            return self.get(run_id, owner_scope=owner_scope)
