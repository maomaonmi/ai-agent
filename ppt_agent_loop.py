"""Durable, provider-neutral primitives for the AI PPT agent loop."""

from __future__ import annotations

import threading
import uuid
import os
import base64
import hashlib
import re
import time
import copy
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Mapping

from ppt_repository import PptRepository, RepositoryConflict, RunRecord


class SearchBatchLimitExceeded(ValueError):
    code = "PPT_SEARCH_BATCH_LIMIT_EXCEEDED"


SearchProvider = Literal["firecrawl", "qwen", "glm", "minimax"]
SearchProviderSelection = Literal["auto", "firecrawl", "qwen", "glm", "minimax"]


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


@dataclass(frozen=True, slots=True)
class _InlineImage:
    """已解码的生成图片字节（MiniMax image-01 base64 直返路径专用）。

    Why: _persist_downloaded_asset 通过 duck-typing 读取 content/mime_type/
    sha256/url；用同构小对象让 base64 素材与下载素材共享一条持久化代码路径。
    """

    content: bytes
    mime_type: str
    sha256: str
    url: str = ""


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
        narrative_generator: Any | None = None,
        allow_demo_materials: bool = False,
        asset_root: str | Path | None = None,
    ) -> None:
        self.repository = repository
        self.asset_root = Path(asset_root) if asset_root is not None else repository.database_path.parent / "ppt-assets"
        self.asset_root = self.asset_root.resolve()
        self.asset_root.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, threading.Lock] = {}
        self._event_sequences: dict[str, int] = {}
        self._workers: dict[str, threading.Thread] = {}
        self._worker_guard = threading.Lock()
        self._settings_backed = search_adapters is None
        self._narrative_settings_backed = narrative_generator is None and self._settings_backed
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
        self.narrative_generator = narrative_generator
        self.allow_demo_materials = allow_demo_materials

    def _persist_downloaded_web_asset(
        self,
        downloaded: Any,
        *,
        owner_scope: str,
    ) -> dict[str, object]:
        """Persist downloaded bytes and return a browser-safe local URL."""
        mime_to_extension = {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/gif": "gif",
            "image/webp": "webp",
            "image/svg+xml": "svg",
        }
        mime_type = str(getattr(downloaded, "mime_type", "application/octet-stream"))
        extension = mime_to_extension.get(mime_type, "bin")
        owner_hash = hashlib.sha256(owner_scope.encode("utf-8")).hexdigest()[:10]
        asset_id = f"ppt-web-{str(getattr(downloaded, 'sha256', ''))[:32]}-{owner_hash}"
        if len(asset_id) <= len("ppt-web-"):
            asset_id = f"ppt-web-{uuid.uuid4().hex}"
        relative_path = Path("web") / f"{asset_id}.{extension}"
        target = (self.asset_root / relative_path).resolve()
        if self.asset_root not in target.parents:
            raise ValueError("PPT asset path escaped configured storage root")
        target.parent.mkdir(parents=True, exist_ok=True)
        content = bytes(getattr(downloaded, "content", b""))
        if not target.exists() or target.stat().st_size != len(content):
            temporary = target.with_suffix(target.suffix + ".part")
            temporary.write_bytes(content)
            temporary.replace(target)
        try:
            self.repository.create_asset(
                asset_id=asset_id,
                owner_scope=owner_scope,
                kind="PPT_WEB_IMAGE",
                storage_path=relative_path.as_posix(),
                mime_type=mime_type,
                size_bytes=len(content),
                sha256=str(getattr(downloaded, "sha256", "")),
                source_url=str(getattr(downloaded, "url", "")) or None,
            )
        except RepositoryConflict:
            if self.repository.get_asset(asset_id, owner_scope=owner_scope) is None:
                raise
        return {
            "assetId": asset_id,
            "sourceImageUrl": str(getattr(downloaded, "url", "")),
            "imageUrl": f"/api/ppt/assets/{asset_id}/content",
        }

    def _persist_downloaded_asset(
        self,
        downloaded: Any,
        *,
        owner_scope: str,
        kind: str,
        prefix: str,
    ) -> dict[str, object]:
        """Persist provider bytes once and expose a durable local URL.

        Search results and generated images used to keep expiring third-party
        URLs in the run state.  Keeping one persistence path for both asset
        families makes refresh/resume deterministic and lets the UI render the
        same bytes that will later be placed in the deck.
        """
        mime_to_extension = {
            "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
            "image/webp": "webp", "image/svg+xml": "svg",
        }
        mime_type = str(getattr(downloaded, "mime_type", "application/octet-stream"))
        extension = mime_to_extension.get(mime_type, "bin")
        owner_hash = hashlib.sha256(owner_scope.encode("utf-8")).hexdigest()[:10]
        digest = str(getattr(downloaded, "sha256", ""))[:32] or uuid.uuid4().hex
        asset_id = f"{prefix}-{digest}-{owner_hash}"
        directory = "web" if kind == "PPT_WEB_IMAGE" else "ai"
        relative_path = Path(directory) / f"{asset_id}.{extension}"
        target = (self.asset_root / relative_path).resolve()
        if self.asset_root not in target.parents:
            raise ValueError("PPT asset path escaped configured storage root")
        target.parent.mkdir(parents=True, exist_ok=True)
        content = bytes(getattr(downloaded, "content", b""))
        if not target.exists() or target.stat().st_size != len(content):
            temporary = target.with_suffix(target.suffix + ".part")
            temporary.write_bytes(content)
            temporary.replace(target)
        try:
            self.repository.create_asset(
                asset_id=asset_id,
                owner_scope=owner_scope,
                kind=kind,
                storage_path=relative_path.as_posix(),
                mime_type=mime_type,
                size_bytes=len(content),
                sha256=str(getattr(downloaded, "sha256", "")),
                source_url=str(getattr(downloaded, "url", "")) or None,
            )
        except RepositoryConflict:
            if self.repository.get_asset(asset_id, owner_scope=owner_scope) is None:
                raise
        return {
            "assetId": asset_id,
            "sourceImageUrl": str(getattr(downloaded, "url", "")),
            "imageUrl": f"/api/ppt/assets/{asset_id}/content",
            "mimeType": mime_type,
            "byteSize": len(content),
            "sha256": str(getattr(downloaded, "sha256", "")),
        }

    @staticmethod
    def _usable_image_source(result: Mapping[str, Any], image_url: str) -> bool:
        """Reject chrome (logos, tracking pixels and avatars) before download."""
        haystack = f"{image_url} {result.get('title', '')} {result.get('alt', '')}".lower()
        if re.search(r"logo|icon|avatar|sprite|pixel|tracking|favicon|heart|collect|toolbar", haystack):
            return False
        return image_url.startswith(("http://", "https://"))

    def repair_web_assets(self, run_id: str, *, owner_scope: str) -> RunRecord:
        """Rehydrate selected web images from older runs into local storage.

        Early versions persisted only third-party image URLs.  Repair is
        intentionally idempotent: assets already backed by a local asset API
        are left untouched, while remote URLs are downloaded once and linked
        to the durable run state.
        """
        with self._lock(run_id):
            current = self.get(run_id, owner_scope=owner_scope)
            web_images = current.state.get("webImages")
            ai_images = current.state.get("aiImages")
            if not isinstance(web_images, dict) and not isinstance(ai_images, dict):
                return current
            remote_to_local: dict[str, dict[str, object]] = {}
            repaired = 0
            failed = 0

            def repair_asset(raw: object, *, kind: str = "PPT_WEB_IMAGE", prefix: str = "ppt-web") -> dict[str, object] | None:
                nonlocal repaired, failed
                if not isinstance(raw, dict):
                    return None
                asset = dict(raw)
                image_url = asset.get("imageUrl")
                if not isinstance(image_url, str) or not image_url.startswith(("http://", "https://")):
                    return asset
                if image_url in remote_to_local:
                    asset.update(remote_to_local[image_url])
                    return asset
                try:
                    downloaded = self.image_downloader.download(image_url)
                    local = self._persist_downloaded_asset(downloaded, owner_scope=owner_scope, kind=kind, prefix=prefix)
                    remote_to_local[image_url] = local
                    asset.update(local)
                    repaired += 1
                except Exception:
                    failed += 1
                return asset

            if isinstance(web_images, dict):
                assets = web_images.get("assets")
                if isinstance(assets, list):
                    web_images["assets"] = [repair_asset(asset) for asset in assets]
                selection_rounds = web_images.get("selectionRounds")
                if isinstance(selection_rounds, list):
                    repaired_rounds: list[object] = []
                    for round_state in selection_rounds:
                        if not isinstance(round_state, dict):
                            repaired_rounds.append(round_state)
                            continue
                        next_round = dict(round_state)
                        round_assets = next_round.get("assets")
                        if isinstance(round_assets, list):
                            next_round["assets"] = [repair_asset(asset) for asset in round_assets]
                        repaired_rounds.append(next_round)
                    web_images["selectionRounds"] = repaired_rounds
                candidates = web_images.get("candidateSources")
                if isinstance(candidates, list) and remote_to_local:
                    web_images["candidateSources"] = [
                        ({**candidate, **remote_to_local[str(candidate["imageUrl"])]}
                         if isinstance(candidate, dict) and isinstance(candidate.get("imageUrl"), str) and candidate["imageUrl"] in remote_to_local
                         else candidate)
                        for candidate in candidates
                    ]
            if isinstance(ai_images, dict):
                assets = ai_images.get("assets")
                if isinstance(assets, list):
                    ai_images["assets"] = [repair_asset(asset, kind="PPT_AI_IMAGE", prefix="ppt-ai") for asset in assets]
            if repaired == 0 and failed == 0:
                return current
            next_state = {**current.state}
            if isinstance(web_images, dict):
                next_state["webImages"] = web_images
            if isinstance(ai_images, dict):
                next_state["aiImages"] = ai_images
            self.repository.append_run_event(
                run_id=run_id,
                sequence=self._next_sequence(run_id),
                event_type="assets.repaired",
                payload={"phase": "ASSETS", "repairedCount": repaired, "failedCount": failed},
            )
            self.repository.update_run(
                run_id,
                owner_scope=owner_scope,
                status=current.status,
                phase=current.phase,
                state=next_state,
            )
            return self.get(run_id, owner_scope=owner_scope)

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
        if self._narrative_settings_backed:
            from ppt_materials import build_settings_narrative_generator

            # The provider is selected per run, so this is refreshed lazily in
            # _execute; clearing a previously constructed writer here avoids
            # accidentally using a stale settings profile after a save.
            self.narrative_generator = None

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
        model_provider: Literal["deepseek", "qwen", "glm", "minimax"] = "deepseek",
        search_provider: SearchProviderSelection = "auto",
        search_limit: int = 20,
        resume: bool = False,
    ) -> tuple[RunRecord, bool]:
        if self.repository.get_presentation(presentation_id, owner_scope=owner_scope) is None:
            raise PresentationForRunNotFound(presentation_id)
        resolved_id = run_id or f"run-{uuid.uuid4().hex}"
        existing = self.repository.get_run(resolved_id, owner_scope=owner_scope)
        if existing is not None:
            if existing.presentation_id != presentation_id or existing.state.get("prompt") != prompt:
                raise RepositoryConflict("runId is already bound to a different task")
            if resume:
                resume_phase = self._first_incomplete_phase(existing.state)
                if existing.status in TERMINAL_RUN_STATUSES or existing.phase != resume_phase:
                    self.repository.update_run(
                        resolved_id,
                        owner_scope=owner_scope,
                        status="QUEUED",
                        phase=resume_phase,
                        state={**existing.state, "resumeRequested": True, "resumePhase": resume_phase},
                    )
                    self.repository.append_run_event(
                        run_id=resolved_id,
                        sequence=self._next_sequence(resolved_id),
                        event_type="run.resumed",
                        payload={"phase": resume_phase, "reason": "continue_audit"},
                    )
                    self._ensure_worker(resolved_id, owner_scope)
                    refreshed = self.repository.get_run(resolved_id, owner_scope=owner_scope)
                    assert refreshed is not None
                    return refreshed, False
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

    @classmethod
    def _first_incomplete_phase(cls, state: Mapping[str, Any]) -> str:
        """Find the earliest missing/failed artifact instead of restarting blindly."""
        rounds = state.get("searchRounds") if isinstance(state, Mapping) else None
        if not isinstance(rounds, list) or len(rounds) < 3:
            return f"SEARCH_{len(rounds or []) + 1}"
        for index, round_state in enumerate(rounds[:3]):
            if not isinstance(round_state, Mapping) or not isinstance(round_state.get("results"), list) or not round_state.get("results"):
                return f"SEARCH_{index + 1}"
        web = state.get("webImages") if isinstance(state, Mapping) else None
        web_assets = web.get("assets", []) if isinstance(web, Mapping) else []
        durable_web_count = sum(1 for asset in web_assets if isinstance(asset, Mapping) and str(asset.get("imageUrl", "")).startswith("/api/ppt/assets/")) if isinstance(web_assets, list) else 0
        if not isinstance(web, Mapping) or int(web.get("selectedCount", 0) or 0) < 3 or not isinstance(web_assets, list) or len(web_assets) < 3 or (web.get("mode") == "provider" and durable_web_count < 3):
            return "WEB_ASSETS"
        ai = state.get("aiImages") if isinstance(state, Mapping) else None
        ai_assets = ai.get("assets", []) if isinstance(ai, Mapping) else []
        required_ai = int(ai.get("requiredCount", 3) or 3) if isinstance(ai, Mapping) else 3
        # A completed provider generation is an existing artifact even when
        # the provider URL is not locally rehydrated yet.  Repair is allowed
        # to refresh the bytes, but “继续” must not spend another generation
        # request just because the old URL is remote.
        if not isinstance(ai, Mapping) or int(ai.get("generatedCount", 0) or 0) < required_ai or not isinstance(ai_assets, list) or len(ai_assets) < required_ai:
            return "AI_ASSETS"
        outline = state.get("outline") if isinstance(state, Mapping) else None
        if not isinstance(outline, Mapping) or int(outline.get("slideCount", 0) or 0) < 1:
            return "OUTLINE"
        build = state.get("build") if isinstance(state, Mapping) else None
        if (
            not isinstance(build, Mapping)
            or build.get("status") != "completed"
            or int(build.get("contentVersion", 0) or 0) < 3
            or int(build.get("layoutVersion", 0) or 0) < 2
            or build.get("contentMode") not in {"model-segmented", "demo-fallback"}
        ):
            return "BUILD"
        review = state.get("qualityReport") if isinstance(state, Mapping) else None
        if not isinstance(review, Mapping):
            return "REVIEW"
        return "REVIEW"

    def _next_sequence(self, run_id: str) -> int:
        cached = self._event_sequences.get(run_id)
        if cached is None:
            events = self.repository.list_run_events(run_id, after_sequence=0, limit=1_000)
            cached = events[-1].sequence if events else 0
        cached += 1
        self._event_sequences[run_id] = cached
        return cached

    @staticmethod
    def _layout_for_slide(index: int, section: str) -> str:
        """Rotate visual grammar instead of rendering every page as a clone."""
        normalized = section.strip()
        if index == 0:
            return "hero"
        if normalized in {"趋势", "指标", "对比"}:
            return "chart"
        if normalized in {"案例", "落地"}:
            return "image-focus"
        if normalized in {"方法", "路线图", "协作", "行动"}:
            return "timeline"
        if normalized in {"总结", "结尾"}:
            return "closing"
        return ("split", "grid", "quote")[index % 3]

    @staticmethod
    def _build_outline(prompt: str, search_rounds: list[dict[str, Any]], slide_count: int = 16) -> dict[str, Any]:
        """Create a stable, inspectable outline from the request and evidence."""
        source_titles = [
            str(result.get("title") or "资料来源")
            for round_state in search_rounds
            if isinstance(round_state, dict)
            for result in round_state.get("results", [])
            if isinstance(result, dict)
        ]
        source_urls = [
            str(result.get("url"))
            for round_state in search_rounds
            if isinstance(round_state, dict)
            for result in round_state.get("results", [])
            if isinstance(result, dict) and isinstance(result.get("url"), str)
        ]
        beats = [
            ("封面", "提出主题与核心问题"),
            ("背景", "为什么现在需要关注这个问题"),
            ("关键事实", "用资料建立共同事实基础"),
            ("趋势", "变化方向与主要驱动因素"),
            ("案例", "从真实案例观察落地方式"),
            ("对比", "不同方案的优势与代价"),
            ("洞察", "把资料提炼成可行动的判断"),
            ("方法", "给出可复用的实施框架"),
            ("路线图", "按阶段拆解下一步动作"),
            ("风险", "说明边界、风险与应对"),
            ("指标", "定义验证成效的指标"),
            ("协作", "明确角色、流程与交付物"),
            ("落地", "展示一个可执行的样例"),
            ("总结", "回收三条核心结论"),
            ("行动", "给出今天就能开始的动作"),
            ("结尾", "留下记忆点与讨论问题"),
        ]
        slides = [
            {
                "ordinal": index + 1,
                "section": title,
                "layout": AgentRunService._layout_for_slide(index, title),
                "title": prompt.strip()[:80] if index == 0 else title,
                "direction": direction,
                "sourceHint": source_titles[index % len(source_titles)] if source_titles else None,
                "body": (
                    f"本页围绕“{prompt.strip()[:36]}”展开，先建立问题背景，再把资料转化为可执行判断。"
                    if index == 0
                    else f"{direction}。结合公开资料与案例，提炼对团队最有价值的判断。"
                ),
                "keyPoints": [
                    f"核心观察：{direction}",
                    f"资料线索：{source_titles[index % len(source_titles)]}" if source_titles else "资料线索：等待来源补充",
                    "行动建议：明确下一步、责任人与验证指标",
                ],
                "sourceUrls": source_urls[index:index + 3],
                "status": "planned",
            }
            for index, (title, direction) in enumerate(beats[: max(1, min(slide_count, len(beats)))])
        ]
        return {"version": 1, "prompt": prompt, "slideCount": len(slides), "slides": slides}

    @staticmethod
    def _quality_report(document: dict[str, Any] | None, outline: dict[str, Any] | None, search_rounds: list[dict[str, Any]]) -> dict[str, Any]:
        slides = document.get("slides", []) if isinstance(document, dict) else []
        overflow: list[str] = []
        unreadable: list[str] = []
        for slide in slides if isinstance(slides, list) else []:
            if not isinstance(slide, dict):
                continue
            slide_id = str(slide.get("id") or "unknown")
            for element in slide.get("elements", []) if isinstance(slide.get("elements"), list) else []:
                if not isinstance(element, dict):
                    continue
                try:
                    if float(element.get("x", 0)) + float(element.get("width", 0)) > 1.001 or float(element.get("y", 0)) + float(element.get("height", 0)) > 1.001:
                        overflow.append(f"{slide_id}:{element.get('id', 'element')}")
                except (TypeError, ValueError):
                    overflow.append(f"{slide_id}:{element.get('id', 'element')}")
                if element.get("type") == "TEXT" and len(str(element.get("text", ""))) > 420:
                    unreadable.append(f"{slide_id}:{element.get('id', 'text')}")
        references = sum(
            len(round_state.get("results", []))
            for round_state in search_rounds
            if isinstance(round_state, dict) and isinstance(round_state.get("results"), list)
        )
        checks = {
            "overflow": {"passed": not overflow, "issues": overflow[:20]},
            "citations": {"passed": references > 0, "issues": [] if references > 0 else ["没有可引用的搜索来源"]},
            "readability": {"passed": not unreadable, "issues": unreadable[:20]},
            "compatibility": {"passed": isinstance(document, dict) and document.get("schemaVersion") == 1 and bool(slides), "issues": []},
        }
        passed = all(bool(check.get("passed")) for check in checks.values())
        return {"status": "passed" if passed else "needs_attention", "checks": checks, "slideCount": len(slides) if isinstance(slides, list) else 0, "outlineCount": int((outline or {}).get("slideCount", 0)), "referenceCount": references}

    @staticmethod
    def _slide_from_outline(
        slide: Mapping[str, Any],
        index: int,
        asset_id: str | None = None,
        background_asset_id: str | None = None,
    ) -> dict[str, Any]:
        slide_id = f"ai-slide-{index + 1}"
        layout = str(slide.get("layout") or AgentRunService._layout_for_slide(index, str(slide.get("section") or "")))
        dark = index % 2 == 0 or layout in {"hero", "quote", "closing"}
        text_color = "#FFFFFF" if dark else "#111827"
        muted_color = "#CBD5E1" if dark else "#64748B"
        key_points = slide.get("keyPoints") if isinstance(slide.get("keyPoints"), list) else []
        body = str(slide.get("body") or "").strip()
        if not body:
            body = "从资料、观点到下一步行动。"
        bullet_text = "\n".join(f"• {str(item).strip()}" for item in key_points[:3] if str(item).strip())
        # Keep the model-written paragraph visible on the slide. The old
        # renderer only showed bullets, which made BUILD look like a static
        # outline even after a model had produced the section prose.
        body_text = body[:420]
        if bullet_text:
            body_text = f"{body_text}\n\n{bullet_text}" if body_text else bullet_text
        elements: list[dict[str, Any]] = []

        def text_element(element_id: str, value: str, x: float, y: float, width: float, height: float, *, size: int = 15, color: str = text_color, bold: bool = False, align: str = "LEFT", z_index: int = 3) -> dict[str, Any]:
            return {"type": "TEXT", "id": f"{slide_id}-{element_id}", "x": x, "y": y, "width": width, "height": height, "rotation": 0, "zIndex": z_index, "opacity": 1, "isLocked": False, "isHidden": False, "text": value, "style": {"fontFamily": "Microsoft YaHei", "fontSize": size, "color": color, "bold": bold, "italic": False, "underline": False, "align": align, "verticalAlign": "MIDDLE" if align == "CENTER" else "TOP"}}

        def shape_element(element_id: str, x: float, y: float, width: float, height: float, *, fill: str = "#FFFFFF", stroke: str = "#CBD5E1", opacity: float = 0.14) -> dict[str, Any]:
            return {"type": "SHAPE", "id": f"{slide_id}-{element_id}", "x": x, "y": y, "width": width, "height": height, "rotation": 0, "zIndex": 1, "opacity": opacity, "isLocked": False, "isHidden": False, "shapeType": "ROUND_RECT", "fill": fill, "stroke": stroke, "strokeWidth": 1}

        eyebrow = text_element("eyebrow", f"{index + 1:02d} · {str(slide.get('section') or 'AI PPT').upper()}", 0.07, 0.07, 0.78, 0.05, size=12, color=muted_color, bold=True)
        title = str(slide.get("title") or slide.get("section") or f"第 {index + 1} 页")
        subtitle = str(slide.get("subtitle") or slide.get("direction") or "从资料、观点到下一步行动。")
        title_element = text_element("title", title, 0.07, 0.17, 0.68, 0.22, size=28, bold=True)
        subtitle_element = text_element("subtitle", subtitle, 0.07, 0.55, 0.62, 0.13, size=14, color=muted_color)
        body_element = text_element("body", body_text or "从资料、观点到下一步行动。", 0.07, 0.69, 0.58, 0.24, size=15)

        if layout == "hero":
            elements.extend([eyebrow, title_element, subtitle_element, body_element])
        elif layout == "split":
            title_element.update({"width": 0.43, "y": 0.16})
            subtitle_element.update({"width": 0.40, "y": 0.43})
            body_element.update({"width": 0.42, "y": 0.60, "height": 0.25})
            elements.extend([eyebrow, title_element, subtitle_element, body_element])
        elif layout == "grid":
            title_element.update({"width": 0.82, "y": 0.15})
            subtitle_element.update({"width": 0.82, "y": 0.38})
            body_element.update({"width": 0.82, "y": 0.84, "height": 0.10})
            elements.extend([eyebrow, title_element, subtitle_element, body_element])
            points = [str(item).strip() for item in key_points[:3] if str(item).strip()] or ["事实", "判断", "行动"]
            for point_index, point in enumerate(points):
                x = 0.07 + point_index * 0.29
                elements.append(shape_element(f"card-{point_index + 1}", x, 0.58, 0.25, 0.25, fill="#7C3AED" if dark else "#E2E8F0", stroke="#A78BFA" if dark else "#CBD5E1"))
                elements.append(text_element(f"card-{point_index + 1}-text", point, x + 0.02, 0.62, 0.21, 0.16, size=14, color=text_color, bold=True))
        elif layout == "quote":
            title_element.update({"width": 0.82, "y": 0.15})
            quote = text_element("body", f"“{body[:180]}”", 0.11, 0.36, 0.74, 0.28, size=23, color=text_color, bold=True, align="CENTER")
            source = text_element("source", str(slide.get("sourceHint") or "基于已收集资料的核心判断"), 0.16, 0.72, 0.68, 0.10, size=13, color=muted_color, align="CENTER")
            elements.extend([eyebrow, title_element, quote, source])
        elif layout == "chart":
            title_element.update({"width": 0.42, "y": 0.15})
            subtitle_element.update({"width": 0.40, "y": 0.40})
            body_element.update({"width": 0.38, "y": 0.57, "height": 0.26})
            elements.extend([eyebrow, title_element, subtitle_element, body_element])
        elif layout == "image-focus":
            title_element.update({"width": 0.38, "y": 0.16})
            subtitle_element.update({"width": 0.37, "y": 0.42})
            body_element.update({"width": 0.37, "y": 0.57, "height": 0.27})
            elements.extend([eyebrow, title_element, subtitle_element, body_element])
        elif layout == "timeline":
            title_element.update({"width": 0.82, "y": 0.15})
            subtitle_element.update({"width": 0.82, "y": 0.35})
            body_element.update({"width": 0.82, "y": 0.84, "height": 0.10})
            elements.extend([eyebrow, title_element, subtitle_element, body_element])
            points = [str(item).strip() for item in key_points[:4] if str(item).strip()] or ["准备", "验证", "执行", "复盘"]
            for point_index, point in enumerate(points):
                x = 0.08 + point_index * (0.78 / max(1, len(points) - 1))
                elements.append(shape_element(f"step-{point_index + 1}", x - 0.018, 0.59, 0.036, 0.036, fill="#8B5CF6", stroke="#C4B5FD", opacity=1))
                elements.append(text_element(f"step-{point_index + 1}-text", point, max(0.04, x - 0.08), 0.68, 0.16, 0.13, size=12, color=text_color, bold=True, align="CENTER"))
        else:  # closing
            title_element.update({"width": 0.82, "y": 0.24, "height": 0.25})
            subtitle_element.update({"width": 0.82, "y": 0.57})
            subtitle_element["style"]["align"] = "CENTER"
            body_element.update({"x": 0.17, "width": 0.66, "y": 0.72, "height": 0.12})
            body_element["style"]["align"] = "CENTER"
            elements.extend([eyebrow, title_element, subtitle_element, body_element])

        chart_spec = slide.get("chart") if isinstance(slide.get("chart"), Mapping) else None
        if layout == "chart":
            chart_spec = chart_spec or {"chartType": "BAR", "categories": ["阶段一", "阶段二", "阶段三"], "series": [{"name": "示意值", "values": [42, 68, 86], "color": "#8B5CF6"}], "showLegend": False}
            categories = chart_spec.get("categories") if isinstance(chart_spec.get("categories"), list) else ["阶段一", "阶段二", "阶段三"]
            series = chart_spec.get("series") if isinstance(chart_spec.get("series"), list) else [{"name": "示意值", "values": [42, 68, 86], "color": "#8B5CF6"}]
            elements.append({"type": "CHART", "id": f"{slide_id}-chart", "x": 0.53, "y": 0.20, "width": 0.39, "height": 0.55, "rotation": 0, "zIndex": 1, "opacity": 0.96, "isLocked": False, "isHidden": False, "chartType": str(chart_spec.get("chartType") or "BAR"), "categories": categories[:8], "series": series[:3], "showLegend": bool(chart_spec.get("showLegend", False))})
        if asset_id:
            image_position = (0.56, 0.19, 0.36, 0.58) if layout in {"split", "image-focus"} else (0.73, 0.18, 0.21, 0.45)
            elements.append({"type": "IMAGE", "id": f"{slide_id}-material", "x": image_position[0], "y": image_position[1], "width": image_position[2], "height": image_position[3], "rotation": 0, "zIndex": 1, "opacity": 0.94, "isLocked": False, "isHidden": False, "assetId": asset_id, "alt": "网页研究素材", "fit": "COVER"})
        source_urls = slide.get("sourceUrls") if isinstance(slide.get("sourceUrls"), list) else []
        notes = "[Sources]\n" + "\n".join(str(url) for url in source_urls[:5] if str(url).startswith("http"))
        if layout == "chart" and not isinstance(slide.get("chart"), Mapping):
            notes += "\n图表数据：示意性展示，需结合来源进一步核验。"
        return {
            "id": slide_id,
            "order": index,
            "background": ({"type": "IMAGE", "assetId": background_asset_id, "opacity": 1, "fit": "COVER"} if background_asset_id else {"type": "SOLID", "color": "#0B1020" if dark else "#F4EFE8"}),
            "elements": elements,
            "animations": [],
            "notes": (notes + f"\n布局：{layout}" + (f"\n素材线索：{slide.get('sourceHint')}" if slide.get("sourceHint") else "") + (f"\n演讲备注：{slide.get('speakerNotes')}" if slide.get("speakerNotes") else ""))[:2_000],
        }

    @staticmethod
    def _demo_narrative(slide: Mapping[str, Any], index: int) -> dict[str, object]:
        """Deterministic writer used only by injected/unit-test adapters.

        A settings-backed service never reaches this path: it must have a real
        configured text model or BUILD fails with a clear provider error.
        """
        direction = str(slide.get("direction") or "建立共同事实基础")
        section = str(slide.get("section") or f"第 {index + 1} 页")
        return {
            "title": str(slide.get("title") or section),
            "subtitle": direction,
            "body": f"本节围绕“{section}”展开，先结合已收集的资料说明背景，再把关键变化转化为可执行判断。团队应在明确目标之后验证事实、记录约束，并用阶段性指标检验下一步行动是否有效。",
            "keyPoints": list(slide.get("keyPoints") or [])[:3],
            "speakerNotes": f"讲解第 {index + 1} 页：说明{direction}，并引出下一页的论证。",
            "sourceUrls": list(slide.get("sourceUrls") or [])[:5],
        }

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
            # The caller already holds the run lock and the state just written
            # is fully known here. Avoid a second SELECT on every component
            # event; this matters once a page emits several component events.
            return RunRecord(
                id=current.id,
                presentation_id=current.presentation_id,
                owner_scope=current.owner_scope,
                status=next_status,
                phase=next_phase,
                state=state,
                created_at=current.created_at,
                updated_at=current.updated_at,
            )

    def _execute(self, run_id: str, owner_scope: str) -> None:
        try:
            self._refresh_settings_backed_adapters()
            from ppt_materials import MaterialGate, SearchCoordinator, SourceLedger, generate_required_ai_images
            restored = self.repository.get_run(run_id, owner_scope=owner_scope)
            if restored is None or restored.status == "CANCELLED":
                return
            restored_web = restored.state.get("webImages") if isinstance(restored.state, dict) else None
            ledger = SourceLedger()
            if isinstance(restored_web, dict) and isinstance(restored_web.get("assets"), list):
                # Local URLs are already validated at persistence time; load
                # them directly so a resumed worker does not lose its gate.
                ledger.web_images.extend(item for item in restored_web["assets"] if isinstance(item, dict) and isinstance(item.get("imageUrl"), str))
            restored_ai = restored.state.get("aiImages") if isinstance(restored.state, dict) else None
            ai_assets = list(restored_ai.get("assets", [])) if isinstance(restored_ai, dict) and isinstance(restored_ai.get("assets"), list) else []
            if not ai_assets and isinstance(restored_ai, dict) and int(restored_ai.get("generatedCount", 0) or 0) >= 3:
                ai_assets = [{"role": role, "assetId": f"restored-{role.lower()}"} for role in ("COVER", "MID_BACKGROUND", "END")]
            material_gate = MaterialGate(ledger)
            for asset in ai_assets:
                if isinstance(asset, dict):
                    try:
                        material_gate.record_ai_asset(asset)
                    except ValueError:
                        continue
            search_coordinator = SearchCoordinator(self.search_adapters)
            phase_order = {name: index for index, (name, _label, _details) in enumerate(self._PHASES)}
            start_index = phase_order.get(restored.phase, 0)
            self._emit(run_id, owner_scope, "run.started", {"phase": restored.phase, "resumed": start_index > 0}, status="RUNNING", phase=restored.phase)
            for phase_index, (phase, label, details) in enumerate(self._PHASES):
                if phase_index < start_index:
                    continue
                current = self.repository.get_run(run_id, owner_scope=owner_scope)
                if current is None or current.status == "CANCELLED":
                    return
                selected_provider = current.state.get("searchProvider", "auto")
                effective_provider = details.get("provider")
                effective_limit = int(current.state.get("searchLimit", details.get("limit", 20)))
                if phase.startswith("SEARCH"):
                    if selected_provider in {"firecrawl", "qwen", "glm", "minimax"}:
                        effective_provider = selected_provider
                    elif selected_provider == "auto":
                        # Why: auto 跟随 PPT 主模型走原生搜索——主模型用 MiniMax/千问/GLM 时
                        #   自动用对应原生搜索，避免默认落到 firecrawl（MiniMax 用户会受挫）。
                        #   deepseek 无原生搜索，保持阶段默认（firecrawl/qwen/glm）。
                        effective_provider = {"qwen": "qwen", "glm": "glm", "minimax": "minimax"}.get(
                            str(current.state.get("modelProvider") or "deepseek"),
                            details.get("provider"),
                        )
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
                            if not self._usable_image_source(result, image_url):
                                continue
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
                                        persist=lambda downloaded, owner=owner_scope: self._persist_downloaded_web_asset(downloaded, owner_scope=owner),
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
                            persisted: list[dict[str, object]] = []
                            for asset in generated:
                                normalized = dict(asset)
                                image_url = normalized.get("imageUrl")
                                image_data = normalized.get("imageData")
                                if isinstance(image_url, str) and image_url.startswith(("http://", "https://")) and self.image_downloader is not None:
                                    try:
                                        downloaded = self.image_downloader.download(image_url)
                                        normalized.update(self._persist_downloaded_asset(downloaded, owner_scope=owner_scope, kind="PPT_AI_IMAGE", prefix="ppt-ai"))
                                    except Exception:
                                        if not self.allow_demo_materials:
                                            raise
                                elif isinstance(image_data, str) and image_data:
                                    # Why: MiniMax image-01 走 base64 直返（无 https URL 可回源），
                                    # 在此处解码后复用与网页素材同一条落盘路径，保证 run state 里
                                    # 永远是持久化本地 URL。
                                    decoded = base64.b64decode(image_data)
                                    sniffed = "image/jpeg" if decoded.startswith(b"\xff\xd8\xff") else "image/png"
                                    normalized.pop("imageData", None)
                                    normalized.update(self._persist_downloaded_asset(
                                        _InlineImage(content=decoded, mime_type=sniffed, sha256=hashlib.sha256(decoded).hexdigest(), url="minimax:image-01"),
                                        owner_scope=owner_scope,
                                        kind="PPT_AI_IMAGE",
                                        prefix="ppt-ai",
                                    ))
                                persisted.append(normalized)
                            generated = persisted
                        except Exception as image_error:
                            raise RuntimeError(f"AI 图片生成失败：{type(image_error).__name__}: {str(image_error)[:180]}") from image_error
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
                elif phase == "OUTLINE":
                    outline = self._build_outline(
                        str(current.state.get("prompt", "PPT")),
                        [round_state for round_state in current.state.get("searchRounds", []) if isinstance(round_state, dict)],
                        slide_count=int(details.get("slideCount", 16)),
                    )
                    state_patch["outline"] = outline
                    phase_details.update({"slideCount": outline["slideCount"], "outline": outline})
                    self._emit(
                        run_id,
                        owner_scope,
                        "phase.progress",
                        {"phase": phase, "label": label, "slideCount": outline["slideCount"], "outline": outline},
                    )
                elif phase == "BUILD":
                    if not material_gate.ready_for_build():
                        raise RuntimeError("material gates are not satisfied")
                    outline = current.state.get("outline") if isinstance(current.state.get("outline"), dict) else self._build_outline(str(current.state.get("prompt", "PPT")), [], 16)
                    planned_slides = outline.get("slides", []) if isinstance(outline, dict) else []
                    presentation = self.repository.get_presentation(current.presentation_id, owner_scope=owner_scope)
                    if presentation is None:
                        raise RuntimeError("演示文稿不存在，无法逐页搭建")
                    existing_build = current.state.get("build") if isinstance(current.state.get("build"), dict) else {}
                    previous_records = existing_build.get("slides", []) if isinstance(existing_build, dict) else []
                    if not isinstance(previous_records, list):
                        previous_records = []
                    existing_document_slides = presentation.document.get("slides", [])
                    if not isinstance(existing_document_slides, list):
                        existing_document_slides = []
                    can_resume_build = (
                        isinstance(existing_build, dict)
                        and existing_build.get("contentMode") == "model-segmented"
                        and int(existing_build.get("layoutVersion", 0) or 0) >= 2
                        and int(existing_build.get("completedSlides", 0) or 0) > 0
                        and len(existing_document_slides) >= int(existing_build.get("completedSlides", 0) or 0)
                    )
                    completed_before = int(existing_build.get("completedSlides", 0) or 0) if can_resume_build else 0
                    built_slides: list[dict[str, Any]] = [
                        dict(item) for item in previous_records[:completed_before] if isinstance(item, dict)
                    ]
                    working_document = copy.deepcopy(presentation.document)
                    working_document["title"] = str(current.state.get("prompt", "新建 AI PPT"))[:500]
                    working_document["slides"] = copy.deepcopy(existing_document_slides[:completed_before]) if can_resume_build else []
                    build_attempt_id = uuid.uuid4().hex[:12]
                    web_asset_ids = [
                        str(asset.get("assetId"))
                        for asset in material_gate.ledger.web_images
                        if isinstance(asset, dict) and isinstance(asset.get("assetId"), str) and asset.get("assetId")
                    ]
                    ai_asset_ids = {
                        str(asset.get("role")): str(asset.get("assetId"))
                        for asset in material_gate.ai_images
                        if isinstance(asset, dict) and isinstance(asset.get("role"), str) and isinstance(asset.get("assetId"), str)
                    }
                    writer = self.narrative_generator
                    if writer is None and self._narrative_settings_backed:
                        from ppt_materials import build_settings_narrative_generator

                        writer = build_settings_narrative_generator(str(current.state.get("modelProvider") or "deepseek"))
                        if writer is None:
                            raise RuntimeError("逐页写作模型未配置，请先在设置中配置当前模型的 API Key")
                    evidence = [
                        dict(result)
                        for round_state in current.state.get("searchRounds", [])
                        if isinstance(round_state, dict)
                        for result in round_state.get("results", [])
                        if isinstance(result, dict)
                    ]
                    writer_provider = getattr(writer, "provider", "demo") if writer is not None else "demo"
                    for index, slide in enumerate(planned_slides if isinstance(planned_slides, list) else []):
                        if not isinstance(slide, dict):
                            continue
                        if index < completed_before and index < len(built_slides):
                            # A process restart after a successful commit must
                            # not regenerate an already-written page.
                            built = built_slides[index]
                            self._emit(
                                run_id,
                                owner_scope,
                                "phase.progress",
                                {
                                    "phase": phase,
                                    "label": label,
                                    "completedSlides": index + 1,
                                    "slideCount": len(planned_slides),
                                    "slide": built,
                                    "reused": True,
                                    "writerProvider": writer_provider,
                                },
                            )
                            continue
                        chapter = (index // 4) + 1
                        selected_evidence = evidence[index * 2:index * 2 + 8] or evidence[:8]
                        previous_sections = built_slides[-3:]
                        active_state = existing_build.get("activeSlide") if isinstance(existing_build, dict) else None
                        active_draft = active_state.get("slide") if isinstance(active_state, Mapping) else None
                        if isinstance(active_draft, Mapping) and int(active_draft.get("ordinal", 0) or 0) == index + 1:
                            # The model result itself is durable. If the
                            # process stopped between component commits, reuse
                            # it and only replay the missing canvas components.
                            built = dict(active_draft)
                            generated = None
                        elif writer is None:
                            generated = self._demo_narrative(slide, index)
                        else:
                            generated = writer.generate_slide(
                                prompt=str(current.state.get("prompt", "PPT")),
                                slide=slide,
                                chapter=chapter,
                                total_slides=len(planned_slides),
                                evidence=selected_evidence,
                                previous_sections=previous_sections,
                            )
                        if isinstance(generated, Mapping):
                            # Do not let a model invent citation URLs. Notes
                            # may only reference the durable search ledger.
                            allowed_urls = {
                                str(item.get("url"))
                                for item in selected_evidence
                                if isinstance(item, Mapping) and isinstance(item.get("url"), str)
                            }
                            generated = dict(generated)
                            generated["sourceUrls"] = [
                                str(url) for url in (generated.get("sourceUrls") or [])
                                if str(url) in allowed_urls
                            ][:5]
                        if not isinstance(active_draft, Mapping) or int(active_draft.get("ordinal", 0) or 0) != index + 1:
                            built = {
                                **slide,
                                **(generated if isinstance(generated, Mapping) else {}),
                                "status": "built",
                                "chapter": chapter,
                                "writingMode": "model-segmented" if writer is not None else "demo-fallback",
                            }
                        if not built.get("sourceUrls"):
                            built["sourceUrls"] = list(slide.get("sourceUrls") or [])[:5]
                        if index == 0:
                            background_asset_id = ai_asset_ids.get("COVER")
                        elif index == len(planned_slides) - 1:
                            background_asset_id = ai_asset_ids.get("END")
                        else:
                            background_asset_id = ai_asset_ids.get("MID_BACKGROUND")
                        asset_id = web_asset_ids[(index - 1) % len(web_asset_ids)] if web_asset_ids and index not in {0, len(planned_slides) - 1} else None
                        full_slide = self._slide_from_outline(built, index, asset_id, background_asset_id)
                        full_background = copy.deepcopy(full_slide.get("background"))
                        dark = index % 2 == 0
                        shell_background = (
                            {"type": "SOLID", "color": "#0B1020" if dark else "#F4EFE8"}
                            if isinstance(full_background, Mapping) and full_background.get("type") == "IMAGE"
                            else full_background
                        )
                        shell_slide = copy.deepcopy(full_slide)
                        shell_slide["background"] = shell_background
                        shell_slide["elements"] = []
                        working_document["slides"].append(shell_slide)
                        component_stages: list[tuple[str, str, object | None]] = [("canvas", "建立画布骨架", None)]
                        if isinstance(full_background, Mapping) and full_background.get("type") == "IMAGE":
                            component_stages.append(("background", "插入 AI 背景", full_background))
                        for element in full_slide.get("elements", []):
                            if not isinstance(element, Mapping):
                                continue
                            if element.get("type") == "IMAGE":
                                component_label = "插入网页图片素材"
                            elif str(element.get("id", "")).endswith("-title"):
                                component_label = "写入页面标题"
                            elif str(element.get("id", "")).endswith("-subtitle"):
                                component_label = "写入页面副标题"
                            elif str(element.get("id", "")).endswith("-body"):
                                component_label = "写入正文与要点"
                            else:
                                component_label = "写入页面标识"
                            component_stages.append(("element", component_label, copy.deepcopy(element)))
                        built["componentCount"] = len(component_stages)
                        # A retried BUILD phase must not reuse operation ids
                        # from an earlier partial attempt. Each component has
                        # its own operation and revision, so the canvas can
                        # visibly grow instead of appearing all at once.
                        for component_index, (component_type, component_label, component_payload) in enumerate(component_stages):
                            current_slide = working_document["slides"][-1]
                            if component_type == "background" and isinstance(component_payload, Mapping):
                                current_slide["background"] = copy.deepcopy(component_payload)
                            elif component_type == "element" and isinstance(component_payload, Mapping):
                                current_slide.setdefault("elements", []).append(copy.deepcopy(component_payload))
                            working_document["revision"] = presentation.current_revision + 1
                            working_document.setdefault("metadata", {})["updatedAt"] = time.time()
                            operation_id = f"ppt-agent-build-v4-{run_id}-{build_attempt_id}-{index + 1}-{component_index + 1}"
                            operation = {
                                "operationId": operation_id,
                                "type": "BUILD_COMPONENT",
                                "slideId": current_slide["id"],
                                "ordinal": index + 1,
                                "componentType": component_type,
                                "componentLabel": component_label,
                                "componentIndex": component_index + 1,
                                "componentCount": len(component_stages),
                            }
                            self.repository.commit_revision(
                                presentation_id=presentation.id,
                                owner_scope=owner_scope,
                                expected_revision=presentation.current_revision,
                                document=copy.deepcopy(working_document),
                                operations=[operation],
                                operation_payloads={operation_id: hashlib.sha256(json.dumps(operation, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()},
                            )
                            refreshed_presentation = self.repository.get_presentation(presentation.id, owner_scope=owner_scope)
                            if refreshed_presentation is None:
                                raise RuntimeError("逐组件搭建后无法读取演示文稿")
                            presentation = refreshed_presentation
                            page_completed = component_index == len(component_stages) - 1
                            self._emit(
                                run_id,
                                owner_scope,
                                "phase.progress",
                                {
                                    "phase": phase,
                                    "label": label,
                                    "completedSlides": index + 1 if page_completed else index,
                                    "slideCount": len(planned_slides),
                                    "slide": built,
                                    "canvasSlide": copy.deepcopy(current_slide),
                                    "section": built.get("section"),
                                    "title": built.get("title"),
                                    "bodyPreview": str(built.get("body") or "")[:180],
                                    "writerProvider": writer_provider,
                                    "componentIndex": component_index + 1,
                                    "componentCount": len(component_stages),
                                    "componentType": component_type,
                                    "componentLabel": component_label,
                                    "pageNumber": index + 1,
                                    "pageCompleted": page_completed,
                                },
                                state_patch={
                                    "build": {
                                        "status": "running",
                                        "contentVersion": 3,
                                        "layoutVersion": 2,
                                        "contentMode": "model-segmented" if writer is not None else "demo-fallback",
                                        "slideCount": len(planned_slides),
                                        "completedSlides": index + 1 if page_completed else index,
                                        "slides": list(built_slides),
                                        "activeSlide": None if page_completed else {
                                            "ordinal": index + 1,
                                            "title": built.get("title"),
                                            "slide": built,
                                            "componentIndex": component_index + 1,
                                            "componentCount": len(component_stages),
                                            "componentLabel": component_label,
                                        },
                                        "writerProvider": writer_provider,
                                        "updatedAt": time.time(),
                                    }
                                },
                            )
                        built_slides.append(built)
                    state_patch["build"] = {
                        "status": "completed",
                        "contentVersion": 3,
                        "layoutVersion": 2,
                        "contentMode": "model-segmented" if writer is not None else "demo-fallback",
                        "slideCount": len(built_slides),
                        "completedSlides": len(built_slides),
                        "slides": built_slides,
                        "writerProvider": writer_provider,
                        "completedAt": time.time(),
                    }
                    phase_details.update({"slideCount": len(built_slides), "componentMode": "component-incremental", "completedSlides": len(built_slides), "writerProvider": writer_provider})
                elif phase == "REVIEW":
                    presentation = self.repository.get_presentation(current.presentation_id, owner_scope=owner_scope)
                    report = self._quality_report(
                        presentation.document if presentation is not None else None,
                        current.state.get("outline") if isinstance(current.state.get("outline"), dict) else None,
                        [round_state for round_state in current.state.get("searchRounds", []) if isinstance(round_state, dict)],
                    )
                    state_patch["qualityReport"] = report
                    phase_details.update({"checks": report["checks"], "status": report["status"], "slideCount": report["slideCount"]})
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
