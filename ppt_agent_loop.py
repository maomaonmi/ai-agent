"""Durable, provider-neutral primitives for the AI PPT agent loop."""

from __future__ import annotations

import threading
import uuid
import os
from dataclasses import dataclass
from typing import Any, Literal, Mapping

from ppt_repository import PptRepository, RepositoryConflict, RunRecord


class SearchBatchLimitExceeded(ValueError):
    code = "PPT_SEARCH_BATCH_LIMIT_EXCEEDED"


SearchProvider = Literal["firecrawl", "qwen", "glm"]
SearchProviderSelection = Literal["auto", "firecrawl", "qwen", "glm"]


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

    def __init__(
        self,
        repository: PptRepository,
        *,
        search_adapters: Mapping[str, Any] | None = None,
        ai_image_adapter: Any | None = None,
        image_downloader: Any | None = None,
    ) -> None:
        self.repository = repository
        self._locks: dict[str, threading.Lock] = {}
        self._settings_backed = search_adapters is None
        # Providers are optional at runtime: use the same persisted settings as
        # the settings UI first, then fall back to environment variables for
        # headless deployments. Credentials never enter the durable run state.
        if search_adapters is None:
            from ppt_materials import build_settings_search_adapters, build_default_search_adapters

            search_adapters = build_settings_search_adapters()
            if not search_adapters:
                search_adapters = build_default_search_adapters()
        self.search_adapters = dict(search_adapters)
        if ai_image_adapter is None:
            from ppt_materials import AiImageAdapter, build_settings_ai_image_adapter

            ai_image_adapter = build_settings_ai_image_adapter()
            if ai_image_adapter is None and os.getenv("AI_IMAGE_API_KEY") and os.getenv("AI_IMAGE_URL"):
                ai_image_adapter = AiImageAdapter()
        if image_downloader is None:
            from ppt_materials import SafeImageDownloader

            image_downloader = SafeImageDownloader()
        self.ai_image_adapter = ai_image_adapter
        self.image_downloader = image_downloader

    def _refresh_settings_backed_adapters(self) -> None:
        """Reload persisted provider profiles for every run after a settings save."""

        if not self._settings_backed:
            return
        from ppt_materials import build_default_search_adapters, build_settings_ai_image_adapter, build_settings_search_adapters

        self.search_adapters = build_settings_search_adapters()
        if not self.search_adapters:
            self.search_adapters = build_default_search_adapters()
        self.ai_image_adapter = build_settings_ai_image_adapter()
        if self.ai_image_adapter is None and os.getenv("AI_IMAGE_API_KEY") and os.getenv("AI_IMAGE_URL"):
            from ppt_materials import AiImageAdapter

            self.ai_image_adapter = AiImageAdapter()

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
        model_provider: Literal["deepseek", "qwen", "glm"] = "deepseek",
        search_provider: SearchProviderSelection = "auto",
        search_limit: int = 20,
    ) -> tuple[RunRecord, bool]:
        if self.repository.get_presentation(presentation_id, owner_scope=owner_scope) is None:
            raise PresentationForRunNotFound(presentation_id)
        resolved_id = run_id or f"run-{uuid.uuid4().hex}"
        existing = self.repository.get_run(resolved_id, owner_scope=owner_scope)
        if existing is not None:
            if existing.presentation_id != presentation_id or existing.state.get("prompt") != prompt:
                raise RepositoryConflict("runId is already bound to a different task")
            return existing, False
        state = {
            "prompt": prompt,
            "iteration": 0,
            "maxIterations": max_iterations,
            "modelProvider": model_provider,
            "searchProvider": search_provider,
            "searchLimit": search_limit,
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
            self._refresh_settings_backed_adapters()
            from ppt_materials import MaterialGate, SearchCoordinator, SourceLedger, generate_required_ai_images

            material_gate = MaterialGate(SourceLedger())
            search_coordinator = SearchCoordinator(self.search_adapters)
            self._emit(run_id, owner_scope, "run.started", {"phase": "PLAN"}, status="RUNNING", phase="PLAN")
            for phase, label, details in self._PHASES:
                current = self.repository.get_run(run_id, owner_scope=owner_scope)
                if current is None or current.status == "CANCELLED":
                    return
                selected_provider = current.state.get("searchProvider", "auto")
                effective_provider = details.get("provider")
                effective_limit = int(current.state.get("searchLimit", details.get("limit", 20)))
                if phase.startswith("SEARCH") and selected_provider in {"firecrawl", "qwen", "glm"}:
                    effective_provider = selected_provider
                started_payload: dict[str, Any] = {"phase": phase, "label": label}
                if phase.startswith("SEARCH"):
                    SearchBatch(provider=effective_provider, query=current.state.get("prompt", "PPT"), limit=effective_limit)
                    started_payload.update({"provider": effective_provider, "limit": effective_limit})
                self._emit(run_id, owner_scope, "phase.started", started_payload, status="RUNNING", phase=phase)
                state_patch: dict[str, Any] = {}
                phase_details = dict(details)
                if phase.startswith("SEARCH"):
                    provider = effective_provider
                    query = current.state.get("prompt", "PPT")
                    SearchBatch(provider=provider, query=query, limit=effective_limit)
                    rounds = list(current.state.get("searchRounds", []))
                    configured_adapter = search_coordinator.adapters.get(provider)
                    if configured_adapter is not None:
                        try:
                            results = search_coordinator.search_round(provider=provider, query=query, limit=effective_limit)
                            phase_details.update({"provider": provider, "limit": effective_limit, "resultCount": len(results), "mode": "provider"})
                        except Exception as provider_error:
                            fallback_adapter = search_coordinator.adapters.get("firecrawl")
                            if provider == "firecrawl" or fallback_adapter is None:
                                raise
                            results = search_coordinator.search_round(provider="firecrawl", query=query, limit=effective_limit)
                            phase_details.update({
                                "provider": "firecrawl",
                                "requestedProvider": provider,
                                "limit": effective_limit,
                                "resultCount": len(results),
                                "mode": "provider-fallback",
                                "fallbackReason": type(provider_error).__name__,
                            })
                        rounds.append({"round": len(rounds) + 1, **phase_details, "results": results})
                    else:
                        phase_details["mode"] = "demo-fallback"
                        phase_details.update({"provider": provider, "limit": effective_limit, "resultCount": 0})
                        rounds.append({"round": len(rounds) + 1, **phase_details})
                    phase_details["sources"] = [
                        {
                            key: value
                            for key, value in {
                                "title": result.get("title") or result.get("name") or "未命名来源",
                                "url": result.get("url"),
                                "imageUrl": result.get("imageUrl"),
                                "pageUrl": result.get("pageUrl"),
                            }.items()
                            if isinstance(value, str) and value.strip()
                        }
                        for result in (results if configured_adapter is not None else [])[:20]
                        if isinstance(result, dict) and isinstance(result.get("url"), str) and result.get("url", "").startswith(("http://", "https://"))
                    ]
                    state_patch["searchRounds"] = rounds
                elif phase == "WEB_ASSETS":
                    real_sources = [
                        result
                        for round_state in current.state.get("searchRounds", [])
                        for result in round_state.get("results", [])
                        if isinstance(result, dict) and isinstance(result.get("imageUrl"), str) and isinstance(result.get("url"), str)
                    ]
                    downloaded_count = 0
                    if self.image_downloader is not None:
                        for source in real_sources[:3]:
                            material_gate.ledger.add_downloaded_web_image(
                                source["imageUrl"],
                                page_url=str(source.get("pageUrl") or source["url"]),
                                downloader=self.image_downloader,
                                alt=str(source.get("title", "")),
                            )
                            downloaded_count += 1
                    if downloaded_count < 3:
                        # This deterministic branch is deliberately marked in the
                        # state so demo runs are never mistaken for sourced assets.
                        for index in range(3 - downloaded_count):
                            material_gate.ledger.add_web_image(
                                f"https://images.example.com/ppt/{run_id}/{index}.jpg",
                                page_url="https://example.com/research",
                                alt=f"网页素材 {index + 1}",
                            )
                    state_patch["webImages"] = {
                        "candidateCount": max(details["candidateCount"], len(real_sources)),
                        "selectedCount": len(material_gate.ledger.web_images),
                        "downloadedCount": downloaded_count,
                        "mode": "provider" if downloaded_count >= 3 else "demo-fallback",
                    }
                    phase_details.update(state_patch["webImages"])
                elif phase == "AI_ASSETS":
                    if self.ai_image_adapter is not None:
                        generated = generate_required_ai_images(self.ai_image_adapter, prompt=current.state.get("prompt", "PPT"))
                        for asset in generated:
                            material_gate.record_ai_asset(asset)
                        state_patch["aiImages"] = {
                            "generatedCount": len(generated),
                            "requiredCount": details["requiredCount"],
                            "mode": "provider",
                            "assets": generated,
                        }
                    else:
                        for role in ("COVER", "MID_BACKGROUND", "END"):
                            material_gate.record_ai_image(role, f"asset-ai-{role.lower()}")
                        state_patch["aiImages"] = {
                            "generatedCount": details["generatedCount"],
                            "requiredCount": details["requiredCount"],
                            "mode": "demo-fallback",
                        }
                    phase_details.update(state_patch["aiImages"])
                elif phase == "BUILD" and not material_gate.ready_for_build():
                    raise RuntimeError("material gates are not satisfied")
                elif phase == "PLAN":
                    state_patch["iteration"] = details["iteration"]
                self._emit(run_id, owner_scope, "phase.completed", {"phase": phase, "label": label, **phase_details}, state_patch=state_patch)
            self._emit(run_id, owner_scope, "run.completed", {"slideCount": 16}, status="COMPLETED", phase="REVIEW")
        except Exception as exc:  # pragma: no cover - defensive worker boundary
            current = self.repository.get_run(run_id, owner_scope=owner_scope)
            failed_phase = current.phase if current is not None else "REVIEW"
            self._emit(run_id, owner_scope, "run.failed", {"phase": failed_phase, "message": str(exc)[:500]}, status="FAILED", phase=failed_phase)

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
