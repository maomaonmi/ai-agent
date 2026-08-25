"""Business rules and public payload mapping for the AI PPT domain."""

from __future__ import annotations

import copy
import uuid
from dataclasses import dataclass
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

from ppt_models import parse_presentation_document
from ppt_repository import PptRepository, RepositoryConflict, TemplateRecord


class TemplateNotFound(LookupError):
    pass


class TemplateReadOnly(PermissionError):
    pass


class PresentationNotFound(LookupError):
    pass


class PresentationNotReady(RuntimeError):
    """Raised when an unfinished AI PPT is submitted to the template market."""

    code = "PPT_PRESENTATION_NOT_READY"


class PresentationDocumentInvalid(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class TemplatePage:
    page: int
    page_size: int
    has_more: bool
    templates: list[dict[str, Any]]


class PptService:
    DEFAULT_SYSTEM_TEMPLATES = (
        ("aurora-strategy", "极光战略发布", "适合商业策略、产品发布与年度汇报", "BUSINESS", 18),
        ("quiet-editorial", "静谧编辑叙事", "杂志感图文排版，适合作品集与品牌故事", "CREATIVE", 16),
        ("future-data", "未来数据洞察", "科技数据与研究结论的高密度呈现", "TECHNOLOGY", 20),
        ("brand-growth", "品牌增长提案", "从市场机会到执行路径的一体化方案", "MARKETING", 14),
        ("course-framework", "课程知识框架", "清晰的章节结构与教学重点呈现", "EDUCATION", 22),
        ("research-brief", "研究简报", "适合调研结论、案例分析与学术分享", "RESEARCH", 17),
    )

    def __init__(self, repository: PptRepository) -> None:
        self.repository = repository

    def ensure_system_templates(self) -> None:
        for template_id, name, description, scene, page_count in self.DEFAULT_SYSTEM_TEMPLATES:
            if self.repository.get_template(template_id, owner_scope="system") is not None:
                continue
            self.repository.create_template(
                template_id=template_id,
                owner_scope="system",
                name=name,
                description=description,
                scene=scene,
                source="SYSTEM",
                status="READY",
                manifest={"pageCount": page_count, "theme": "Aurora"},
            )

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @classmethod
    def blank_document(
        cls,
        *,
        presentation_id: str,
        title: str,
        template_id: str | None,
    ) -> dict[str, Any]:
        timestamp = cls._now()
        return {
            "schemaVersion": 1,
            "presentationId": presentation_id,
            "revision": 0,
            "title": title,
            "aspectRatio": "16:9",
            "canvas": {"width": 13.333, "height": 7.5},
            "theme": {
                "name": "Aurora",
                "colors": {
                    "background": "#0B1020",
                    "surface": "#151C33",
                    "text": "#F7F8FC",
                    "mutedText": "#AAB2C8",
                    "accent1": "#7657FF",
                    "accent2": "#39C6B4",
                },
                "fonts": {
                    "heading": "Microsoft YaHei",
                    "body": "Microsoft YaHei",
                    "mono": "Cascadia Mono",
                },
            },
            "slides": [
                {
                    "id": "slide-1",
                    "order": 0,
                    "background": {"type": "SOLID", "color": "#0B1020"},
                    "elements": [],
                    "animations": [],
                    "notes": "",
                }
            ],
            "metadata": {
                **({"templateId": template_id} if template_id else {}),
                "language": "zh-CN",
                "createdAt": timestamp,
                "updatedAt": timestamp,
            },
        }

    @staticmethod
    def presentation_payload(record: Any, *, ignored_operation_ids: list[str] | None = None) -> dict[str, Any]:
        payload = {
            "presentationId": record.id,
            "title": record.title,
            "templateId": record.template_id,
            "revision": record.current_revision,
            "document": copy.deepcopy(record.document),
            "createdAt": record.created_at,
            "updatedAt": record.updated_at,
        }
        if ignored_operation_ids is not None:
            payload["ignoredOperationIds"] = ignored_operation_ids
        return payload

    def create_presentation(
        self,
        *,
        owner_scope: str,
        presentation_id: str | None,
        title: str | None,
        template_id: str | None,
        document: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if template_id is not None and self.repository.get_template(template_id, owner_scope=owner_scope) is None:
            raise TemplateNotFound(template_id)
        resolved_id = (
            presentation_id
            or (str(document.get("presentationId")) if isinstance(document, dict) and document.get("presentationId") else None)
            or f"presentation-{uuid.uuid4().hex}"
        )
        candidate = copy.deepcopy(document) if document is not None else self.blank_document(
            presentation_id=resolved_id,
            title=title or "新建 AI PPT",
            template_id=template_id,
        )
        if candidate.get("presentationId") not in (None, resolved_id):
            raise PresentationDocumentInvalid("presentationId must match the request")
        candidate["presentationId"] = resolved_id
        if title is not None:
            candidate["title"] = title
        if template_id is not None:
            metadata = candidate.setdefault("metadata", {})
            metadata["templateId"] = template_id
        candidate["revision"] = 0
        try:
            parsed = parse_presentation_document(candidate)
        except (TypeError, ValueError) as exc:
            raise PresentationDocumentInvalid(str(exc)) from exc
        record = self.repository.create_presentation(
            presentation_id=resolved_id,
            owner_scope=owner_scope,
            title=parsed.title,
            document=parsed.model_dump(mode="json", by_alias=True, exclude_none=True),
            template_id=template_id,
        )
        return self.presentation_payload(record)

    def get_presentation(self, presentation_id: str, *, owner_scope: str) -> dict[str, Any]:
        record = self.repository.get_presentation(presentation_id, owner_scope=owner_scope)
        if record is None:
            raise PresentationNotFound(presentation_id)
        return self.presentation_payload(record)

    def _hydrate_published_template(self, record: TemplateRecord, *, owner_scope: str, persist: bool = True) -> TemplateRecord:
        """Backfill the source document for published templates created by older code."""
        if record.source != "PRIVATE" or not isinstance(record.manifest, dict):
            return record
        presentation_id = record.manifest.get("publishedPresentationId")
        if not isinstance(presentation_id, str) or not presentation_id:
            return record
        presentation = self.repository.get_presentation(presentation_id, owner_scope=owner_scope)
        if presentation is None:
            return record
        try:
            parsed = parse_presentation_document(presentation.document)
        except (TypeError, ValueError):
            return record
        canonical_document = parsed.model_dump(mode="json", by_alias=True, exclude_none=True)
        page_titles = []
        for index, slide in enumerate(canonical_document.get("slides", []), start=1):
            title = f"第 {index} 页"
            if isinstance(slide, dict):
                for element in slide.get("elements", []):
                    if isinstance(element, dict) and str(element.get("id", "")).endswith("-title") and str(element.get("text", "")).strip():
                        title = str(element["text"]).strip()[:120]
                        break
            page_titles.append(title)
        first_slide = canonical_document.get("slides", [{}])[0]
        cover_asset_id: str | None = None
        if isinstance(first_slide, dict):
            background = first_slide.get("background")
            if isinstance(background, dict) and background.get("type") == "IMAGE" and isinstance(background.get("assetId"), str):
                cover_asset_id = background["assetId"]
            if cover_asset_id is None:
                for element in first_slide.get("elements", []):
                    if isinstance(element, dict) and element.get("type") == "IMAGE" and isinstance(element.get("assetId"), str):
                        cover_asset_id = element["assetId"]
                        break
        desired_manifest = {
            "presentationDocument": canonical_document,
            "pageCount": len(parsed.slides),
            "pageTitles": page_titles,
            "theme": parsed.theme.name if parsed.theme is not None else "Aurora",
            **({"coverAssetId": cover_asset_id} if cover_asset_id else {}),
        }
        if all(record.manifest.get(key) == value for key, value in desired_manifest.items()):
            return record
        if not persist:
            return replace(record, manifest={**record.manifest, **desired_manifest})
        updated = self.repository.update_template_processing(
            record.id,
            owner_scope=owner_scope,
            status=record.status,
            manifest_patch=desired_manifest,
        )
        return updated or record

    def publish_presentation(self, presentation_id: str, *, owner_scope: str) -> dict[str, Any]:
        """Publish a completed AI PPT as a durable private market template."""
        record = self.repository.get_presentation(presentation_id, owner_scope=owner_scope)
        if record is None:
            raise PresentationNotFound(presentation_id)

        presentation_runs = [
            run for run in self.repository.list_runs(owner_scope=owner_scope, limit=100)
            if run.presentation_id == presentation_id
        ]
        latest_run = presentation_runs[0] if presentation_runs else None
        if latest_run is None or latest_run.status != "COMPLETED":
            raise PresentationNotReady("AI PPT 尚未完成，完成质量检查后才能发布到市场")
        completed_run = latest_run

        try:
            parsed = parse_presentation_document(record.document)
        except (TypeError, ValueError) as exc:
            raise PresentationDocumentInvalid(str(exc)) from exc
        if not parsed.slides:
            raise PresentationNotReady("演示文稿没有可发布的幻灯片")

        # Publishing is idempotent for a presentation. Repeated clicks return
        # the same market entry instead of creating duplicate cards.
        template_id = f"template-published-{uuid.uuid5(uuid.NAMESPACE_URL, f'{owner_scope}:{presentation_id}').hex}"
        existing = self.repository.get_template(template_id, owner_scope=owner_scope)
        if existing is not None:
            return self.template_payload(
                self._hydrate_published_template(existing, owner_scope=owner_scope),
                include_manifest=True,
            )

        canonical_document = parsed.model_dump(mode="json", by_alias=True, exclude_none=True)
        page_titles: list[str] = []
        for index, slide in enumerate(canonical_document.get("slides", []), start=1):
            title = f"第 {index} 页"
            if isinstance(slide, dict):
                for element in slide.get("elements", []):
                    if isinstance(element, dict) and str(element.get("id", "")).endswith("-title") and str(element.get("text", "")).strip():
                        title = str(element["text"]).strip()[:120]
                        break
            page_titles.append(title)
        theme = parsed.theme.name if parsed.theme is not None else "Aurora"
        first_slide = canonical_document.get("slides", [{}])[0]
        cover_asset_id: str | None = None
        if isinstance(first_slide, dict):
            background = first_slide.get("background")
            if isinstance(background, dict) and background.get("type") == "IMAGE" and isinstance(background.get("assetId"), str):
                cover_asset_id = background["assetId"]
            if cover_asset_id is None:
                for element in first_slide.get("elements", []):
                    if isinstance(element, dict) and element.get("type") == "IMAGE" and isinstance(element.get("assetId"), str):
                        cover_asset_id = element["assetId"]
                        break
        template_kwargs = {
            "template_id": template_id,
            "owner_scope": owner_scope,
            "name": record.title[:160] or "AI PPT 作品",
            "description": "已完成的 AI PPT 作品，可作为私有模板在市场中复用",
            "scene": "CUSTOM",
            "source": "PRIVATE",
            "status": "READY",
            "manifest": {
                "pageCount": len(parsed.slides),
                "pageTitles": page_titles,
                "theme": theme,
                "published": True,
                "publishedPresentationId": presentation_id,
                "publishedRunId": completed_run.id,
                "publishedAt": self._now(),
                "presentationDocument": canonical_document,
                **({"coverAssetId": cover_asset_id} if cover_asset_id else {}),
            },
        }
        try:
            template = self.repository.create_template(**template_kwargs)
        except RepositoryConflict:
            # A soft-deleted deterministic id is still unique in SQLite. Restore
            # only the owner's private row; a real cross-owner conflict remains a
            # conflict and is converted by the API into a stable 409 response.
            template = self.repository.restore_template(**template_kwargs)
            if template is None:
                existing = self.repository.get_template(template_id, owner_scope=owner_scope)
                if existing is None or existing.source != "PRIVATE" or existing.owner_scope != owner_scope:
                    raise
                template = existing
        return self.template_payload(template, include_manifest=True)

    @staticmethod
    def template_payload(record: TemplateRecord, *, include_manifest: bool = False) -> dict[str, Any]:
        manifest = record.manifest
        page_count = int(manifest.get("pageCount", 0))
        status = record.status
        # A private template cannot be READY without at least one rendered
        # page.  This also repairs old mock records that were persisted as
        # READY with only a synthetic cover.
        if record.source == "PRIVATE" and status == "READY" and page_count < 1:
            status = "FAILED"
        payload: dict[str, Any] = {
            "id": record.id,
            "name": record.name,
            "description": record.description,
            "scene": record.scene,
            "source": record.source,
            "isPrivate": record.source == "PRIVATE",
            "status": status,
            "pageCount": page_count,
            "coverUrl": (
                f"/api/ppt/assets/{manifest['coverAssetId']}/content"
                if manifest.get("coverAssetId")
                else None
            ),
            "createdAt": record.created_at,
            "updatedAt": record.updated_at,
        }
        if status == "FAILED" and record.status == "READY" and page_count < 1:
            payload["errorCode"] = "PPT_TEMPLATE_NO_PAGES"
            payload["errorMessage"] = "服务器没有保存任何可预览页面"
        if include_manifest:
            payload["manifest"] = manifest
        return payload

    def list_templates(
        self,
        *,
        owner_scope: str,
        page: int,
        page_size: int,
        scene: str | None,
        source: str | None,
        query: str | None,
    ) -> TemplatePage:
        records = self.repository.list_templates(
            owner_scope=owner_scope,
            limit=page_size + 1,
            offset=(page - 1) * page_size,
            scene=scene,
            source=source,  # type: ignore[arg-type]
            query=query,
        )
        records = [self._hydrate_published_template(record, owner_scope=owner_scope, persist=False) for record in records]
        has_more = len(records) > page_size
        return TemplatePage(
            page=page,
            page_size=page_size,
            has_more=has_more,
            templates=[self.template_payload(record) for record in records[:page_size]],
        )

    def get_template(self, template_id: str, *, owner_scope: str) -> dict[str, Any]:
        record = self.repository.get_template(template_id, owner_scope=owner_scope)
        if record is None:
            raise TemplateNotFound(template_id)
        record = self._hydrate_published_template(record, owner_scope=owner_scope, persist=False)
        return self.template_payload(record, include_manifest=True)

    def update_template(
        self,
        template_id: str,
        *,
        owner_scope: str,
        name: str | None,
        description: str | None,
        scene: str | None,
    ) -> dict[str, Any]:
        existing = self.repository.get_template(template_id, owner_scope=owner_scope)
        if existing is None:
            raise TemplateNotFound(template_id)
        if existing.source == "SYSTEM":
            raise TemplateReadOnly(template_id)
        updated = self.repository.update_template(
            template_id,
            owner_scope=owner_scope,
            name=name,
            description=description,
            scene=scene,
        )
        if updated is None:
            raise TemplateNotFound(template_id)
        return self.template_payload(updated, include_manifest=True)

    def delete_template(self, template_id: str, *, owner_scope: str) -> None:
        existing = self.repository.get_template(template_id, owner_scope=owner_scope)
        if existing is not None and existing.source == "SYSTEM":
            raise TemplateReadOnly(template_id)
        self.repository.delete_template(template_id, owner_scope=owner_scope)

    def list_template_pages(self, template_id: str, *, owner_scope: str) -> list[dict[str, Any]]:
        template = self.repository.get_template(template_id, owner_scope=owner_scope)
        if template is None:
            raise TemplateNotFound(template_id)
        pages = self.repository.list_template_pages(template_id, owner_scope=owner_scope)
        titles = template.manifest.get("pageTitles", [])
        return [
            {
                "pageNumber": page.page_number,
                "status": page.status,
                "thumbnailUrl": (
                    f"/api/ppt/assets/{page.thumbnail_asset_id}/content"
                    if page.thumbnail_asset_id
                    else None
                ),
                "previewUrl": (
                    f"/api/ppt/assets/{page.preview_asset_id}/content"
                    if page.preview_asset_id
                    else None
                ),
                **({"errorCode": page.error_code} if page.error_code else {}),
                **(
                    {"title": titles[page.page_number - 1]}
                    if isinstance(titles, list)
                    and 0 <= page.page_number - 1 < len(titles)
                    and isinstance(titles[page.page_number - 1], str)
                    else {}
                ),
            }
            for page in pages
        ]
