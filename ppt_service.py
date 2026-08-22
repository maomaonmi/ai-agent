"""Business rules and public payload mapping for the AI PPT domain."""

from __future__ import annotations

import copy
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ppt_models import parse_presentation_document
from ppt_repository import PptRepository, TemplateRecord


class TemplateNotFound(LookupError):
    pass


class TemplateReadOnly(PermissionError):
    pass


class PresentationNotFound(LookupError):
    pass


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

    @staticmethod
    def template_payload(record: TemplateRecord, *, include_manifest: bool = False) -> dict[str, Any]:
        manifest = record.manifest
        payload: dict[str, Any] = {
            "id": record.id,
            "name": record.name,
            "description": record.description,
            "scene": record.scene,
            "source": record.source,
            "isPrivate": record.source == "PRIVATE",
            "status": record.status,
            "pageCount": int(manifest.get("pageCount", 0)),
            "coverUrl": (
                f"/api/ppt/assets/{manifest['coverAssetId']}/content"
                if manifest.get("coverAssetId")
                else None
            ),
            "createdAt": record.created_at,
            "updatedAt": record.updated_at,
        }
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
        if self.repository.get_template(template_id, owner_scope=owner_scope) is None:
            raise TemplateNotFound(template_id)
        pages = self.repository.list_template_pages(template_id, owner_scope=owner_scope)
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
            }
            for page in pages
        ]
