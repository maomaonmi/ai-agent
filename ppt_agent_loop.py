"""Durable, provider-neutral primitives for the AI PPT agent loop."""

from __future__ import annotations

import threading
import uuid
import os
from concurrent.futures import ThreadPoolExecutor
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
        web_image_extractor: Any | None = None,
        allow_demo_materials: bool = False,
    ) -> None:
        self.repository = repository
        self._locks: dict[str, threading.Lock] = {}
        self._workers: dict[str, threading.Thread] = {}
        self._worker_guard = threading.Lock()
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
        if web_image_extractor is None:
            from ppt_materials import WebPageImageExtractor

            web_image_extractor = WebPageImageExtractor()
        self.ai_image_adapter = ai_image_adapter
        self.image_downloader = image_downloader
        self.web_image_extractor = web_image_extractor
        self.allow_demo_materials = allow_demo_materials

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

    def _ensure_worker(self, run_id: str, owner_scope: str) -> None:
        """Resume a durable non-terminal run when this process has no worker for it."""
        with self._worker_guard:
            worker = self._workers.get(run_id)
            if worker is not None and worker.is_alive():
                return
            worker = threading.Thread(target=self._execute, args=(run_id, owner_scope), daemon=True)
            self._workers[run_id] = worker
            worker.start()

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
            if existing.status not in TERMINAL_RUN_STATUSES:
                self._ensure_worker(resolved_id, owner_scope)
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
            if existing.status not in TERMINAL_RUN_STATUSES:
                self._ensure_worker(resolved_id, owner_scope)
            return existing, False
        self._ensure_worker(resolved_id, owner_scope)
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
            # A worker may begin just after a user cancels a queued run. Do
            # not let its late ``run.started`` event resurrect that terminal
            # run (and make it appear resumable again).
            if current.status in TERMINAL_RUN_STATUSES and next_status not in TERMINAL_RUN_STATUSES:
                return current
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
            phase_order = {name: index for index, (name, _label, _details) in enumerate(self._PHASES)}
            restored = self.repository.get_run(run_id, owner_scope=owner_scope)
            start_index = phase_order.get(restored.phase if restored is not None else "PLAN", 0)
            for phase_index, (phase, label, details) in enumerate(self._PHASES):
                if phase_index < start_index:
                    continue
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
                    focus = {
                        "SEARCH_1": "概念定义与权威背景",
                        "SEARCH_2": "行业研究与案例数据",
                        "SEARCH_3": "最新实践与可视化素材",
                    }.get(phase, "补充资料")
                    search_query = f"{query}\n检索方向：{focus}"
                    SearchBatch(provider=provider, query=search_query, limit=effective_limit)
                    rounds = list(current.state.get("searchRounds", []))
                    seen_urls = {
                        str(result.get("url", ""))
                        for round_state in rounds
                        for result in round_state.get("results", [])
                        if isinstance(result, dict) and isinstance(result.get("url"), str)
                    }
                    configured_adapter = search_coordinator.adapters.get(provider)
                    if configured_adapter is not None:
                        try:
                            results = search_coordinator.search_round(provider=provider, query=search_query, limit=effective_limit, exclude_urls=seen_urls)
                            phase_details.update({"provider": provider, "limit": effective_limit, "resultCount": len(results), "mode": "provider"})
                        except Exception as provider_error:
                            fallback_adapter = search_coordinator.adapters.get("firecrawl")
                            if provider == "firecrawl" or fallback_adapter is None:
                                raise
                            results = search_coordinator.search_round(provider="firecrawl", query=search_query, limit=effective_limit, exclude_urls=seen_urls)
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
                    rounds = [
                        {**round_state, "results": [dict(result) for result in round_state.get("results", []) if isinstance(result, dict)]}
                        for round_state in current.state.get("searchRounds", [])
                        if isinstance(round_state, dict)
                    ]
                    real_sources: list[dict[str, Any]] = []
                    seen_images: set[str] = set()
                    max_page_sources = 12
                    page_sources: list[dict[str, Any]] = []

                    def add_image_sources(result: dict[str, Any], image_urls: list[str]) -> None:
                        for image_url in image_urls:
                            if image_url in seen_images:
                                continue
                            seen_images.add(image_url)
                            real_sources.append({**result, "imageUrl": image_url})

                    for round_state in rounds:
                        for result in round_state["results"]:
                            if not isinstance(result.get("url"), str):
                                continue
                            image_urls = [result["imageUrl"]] if isinstance(result.get("imageUrl"), str) else []
                            if image_urls:
                                add_image_sources(result, image_urls)
                            elif self.web_image_extractor is not None and len(page_sources) < max_page_sources:
                                page_sources.append(result)
                            self._emit(
                                run_id,
                                owner_scope,
                                "phase.progress",
                                {"phase": phase, "label": label, "candidateCount": len(real_sources), "selectedCount": 0, "downloadedCount": 0},
                                state_patch={
                                    "webImages": {
                                        "candidateCount": max(details["candidateCount"], len(real_sources)),
                                        "selectedCount": 0,
                                        "downloadedCount": 0,
                                        "mode": "collecting",
                                        "assets": [],
                                    }
                                },
                            )
                    if self.web_image_extractor is not None and page_sources:
                        def extract_page(result: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
                            try:
                                return result, self.web_image_extractor.extract(result["url"], limit=3)
                            except Exception:
                                return result, []

                        with ThreadPoolExecutor(max_workers=4, thread_name_prefix="ppt-web-image") as executor:
                            extracted_pages = list(executor.map(extract_page, page_sources))
                        for result, image_urls in extracted_pages:
                            add_image_sources(result, image_urls)
                            self._emit(
                                run_id,
                                owner_scope,
                                "phase.progress",
                                {"phase": phase, "label": label, "candidateCount": len(real_sources), "selectedCount": 0, "downloadedCount": 0},
                                state_patch={
                                    "webImages": {
                                        "candidateCount": max(details["candidateCount"], len(real_sources)),
                                        "selectedCount": 0,
                                        "downloadedCount": 0,
                                        "mode": "collecting",
                                        "assets": [],
                                    }
                                },
                            )
                    downloaded_count = 0
                    web_assets: list[dict[str, object]] = []
                    selection_rounds: list[dict[str, Any]] = []
                    if len(real_sources) >= 9:
                        selection_round_count = min(4, max(3, (len(real_sources) + 11) // 12))
                    else:
                        selection_round_count = max(1, (len(real_sources) + 2) // 3)

                    def persist_web_progress(*, round_number: int | None = None, round_selected_count: int = 0, candidate_count: int | None = None, failed_count: int = 0) -> None:
                        candidate_total = len(real_sources) if candidate_count is None else candidate_count
                        self._emit(
                            run_id,
                            owner_scope,
                            "phase.progress",
                            {
                                "phase": phase,
                                "label": label,
                                "candidateCount": candidate_total,
                                "selectedCount": len(web_assets),
                                "downloadedCount": downloaded_count,
                                "selectionRound": round_number,
                                "selectionRoundCount": selection_round_count,
                                "roundSelectedCount": round_selected_count,
                                "failedCount": failed_count,
                                "candidateSources": list(real_sources),
                                "assets": list(web_assets),
                            },
                            state_patch={
                                "webImages": {
                                    "candidateCount": max(details["candidateCount"], candidate_total),
                                    "selectedCount": len(web_assets),
                                    "downloadedCount": downloaded_count,
                                    "selectionRound": round_number,
                                    "selectionRoundCount": selection_round_count,
                                    "selectionRounds": list(selection_rounds),
                                    "failedCount": failed_count,
                                    "mode": "provider" if downloaded_count >= 3 else "collecting",
                                    "candidateSources": list(real_sources),
                                    "assets": list(web_assets),
                                }
                            },
                        )

                    if self.image_downloader is not None:
                        source_index = 0
                        for round_number in range(1, selection_round_count + 1):
                            round_assets: list[dict[str, object]] = []
                            failed_count = 0
                            while len(round_assets) < 3 and source_index < len(real_sources):
                                source = real_sources[source_index]
                                source_index += 1
                                try:
                                    material_gate.ledger.add_downloaded_web_image(
                                        source["imageUrl"],
                                        page_url=str(source.get("pageUrl") or source["url"]),
                                        downloader=self.image_downloader,
                                        alt=str(source.get("title", "")),
                                    )
                                    web_assets = list(material_gate.ledger.web_images)
                                    round_assets.append(web_assets[-1])
                                    downloaded_count += 1
                                except Exception:
                                    failed_count += 1
                                persist_web_progress(round_number=round_number, round_selected_count=len(round_assets), failed_count=failed_count)
                            if round_assets:
                                selection_rounds.append({"round": round_number, "selectedCount": len(round_assets), "assets": list(round_assets)})
                            if not round_assets and source_index >= len(real_sources):
                                break
                    if downloaded_count < 3:
                        if not self.allow_demo_materials:
                            raise RuntimeError(f"网页图片素材不足：仅成功下载 {downloaded_count} / 3 张（候选 {len(real_sources)} 个）")
                        # Injectable unit-test runs without a downloader retain a
                        # deterministic fallback, explicitly marked as demo data.
                        for index in range(3 - downloaded_count):
                            material_gate.ledger.add_web_image(f"https://images.example.com/ppt/{run_id}/{index}.jpg", page_url="https://example.com/research", alt=f"网页素材 {index + 1}")
                        web_assets = list(material_gate.ledger.web_images)
                        selection_rounds = [{"round": 1, "selectedCount": len(web_assets), "assets": list(web_assets)}]
                    state_patch["searchRounds"] = rounds
                    state_patch["webImages"] = {
                        "candidateCount": max(details["candidateCount"], len(real_sources)),
                        "selectedCount": len(material_gate.ledger.web_images),
                        "downloadedCount": downloaded_count,
                        "selectionRoundCount": selection_round_count,
                        "selectionRounds": list(selection_rounds),
                        "mode": "provider" if downloaded_count >= 3 else "demo-fallback",
                        "candidateSources": list(real_sources),
                        "assets": list(web_assets),
                    }
                    phase_details.update(state_patch["webImages"])
                elif phase == "AI_ASSETS":
                    if self.ai_image_adapter is not None:
                        try:
                            generated = generate_required_ai_images(self.ai_image_adapter, prompt=current.state.get("prompt", "PPT"))
                        except Exception as image_error:
                            raise RuntimeError(f"AI 图片生成失败（GLM-Image）：{type(image_error).__name__}") from image_error
                        for asset in generated:
                            material_gate.record_ai_asset(asset)
                        state_patch["aiImages"] = {
                            "generatedCount": len(generated),
                            "requiredCount": details["requiredCount"],
                            "mode": "provider",
                            "assets": generated,
                        }
                    else:
                        if not self.allow_demo_materials:
                            raise RuntimeError("AI 图片生成 provider 未配置，无法生成封面、中段背景与结尾主视觉")
                        for role in ("COVER", "MID_BACKGROUND", "END"):
                            material_gate.record_ai_image(role, f"asset-ai-{role.lower()}")
                        state_patch["aiImages"] = {
                            "generatedCount": len(material_gate.ai_images),
                            "requiredCount": details["requiredCount"],
                            "mode": "demo-fallback",
                        }
                    phase_details.update(state_patch["aiImages"])
                elif phase == "BUILD" and not material_gate.ready_for_build():
                    raise RuntimeError("material gates are not satisfied")
                elif phase == "PLAN":
                    state_patch["iteration"] = details["iteration"]
                next_phase = self._PHASES[min(phase_index + 1, len(self._PHASES) - 1)][0]
                self._emit(
                    run_id,
                    owner_scope,
                    "phase.completed",
                    {"phase": phase, "label": label, **phase_details},
                    phase=next_phase,
                    state_patch=state_patch,
                )
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

    def list_resumable(self, *, owner_scope: str, limit: int = 20) -> list[RunRecord]:
        return self.repository.list_runs(
            owner_scope=owner_scope,
            statuses={"QUEUED", "RUNNING", "PAUSED"},
            limit=limit,
        )

    def history(self, *, owner_scope: str, limit: int = 50) -> list[dict[str, Any]]:
        """Return every durable PPT run, including terminal history entries.

        The main chat sidebar needs a compact record to navigate back to a
        specific presentation/run pair. Full workflow state remains available
        through ``GET /runs/{run_id}``; keeping it out of this list keeps the
        sidebar payload small while preserving the durable source of truth.
        """
        history: list[dict[str, Any]] = []
        for run in self.repository.list_runs(owner_scope=owner_scope, limit=limit):
            presentation = self.repository.get_presentation(run.presentation_id, owner_scope=owner_scope)
            prompt = run.state.get("prompt") if isinstance(run.state, dict) else None
            history.append({
                "runId": run.id,
                "presentationId": run.presentation_id,
                "title": presentation.title if presentation is not None else "AI PPT",
                "templateId": presentation.template_id if presentation is not None else None,
                "status": run.status,
                "phase": run.phase,
                "prompt": prompt if isinstance(prompt, str) else "",
                "createdAt": run.created_at,
                "updatedAt": run.updated_at,
            })
        return history

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
