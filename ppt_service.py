"""Business rules and public payload mapping for the AI PPT domain."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ppt_repository import PptRepository, TemplateRecord


class TemplateNotFound(LookupError):
    pass


class TemplateReadOnly(PermissionError):
    pass


@dataclass(frozen=True, slots=True)
class TemplatePage:
    page: int
    page_size: int
    has_more: bool
    templates: list[dict[str, Any]]


class PptService:
    def __init__(self, repository: PptRepository) -> None:
        self.repository = repository

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
