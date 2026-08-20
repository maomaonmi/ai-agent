"""FastAPI router for the AI PPT template market."""

from __future__ import annotations

import hashlib
import inspect
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ppt_models import parse_presentation_document
from ppt_operations import OperationRejected, RevisionConflict, apply_operations, parse_operations
from ppt_repository import PptRepository, RepositoryConflict
from ppt_service import (
    PresentationDocumentInvalid,
    PresentationNotFound,
    PptService,
    TemplateNotFound,
    TemplateReadOnly,
)


OwnerResolver = Callable[[Request], str | Awaitable[str]]


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


class UpdateTemplateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=1_000)
    scene: str | None = Field(default=None, min_length=1, max_length=64, pattern=r"^[A-Z][A-Z0-9_]*$")

    @model_validator(mode="after")
    def require_change(self) -> "UpdateTemplateRequest":
        if self.name is None and self.description is None and self.scene is None:
            raise ValueError("at least one field must be provided")
        return self


class CreatePresentationRequest(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, extra="forbid", populate_by_name=True)

    presentation_id: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
    template_id: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
    title: str | None = Field(default=None, min_length=1, max_length=500)
    document: dict[str, Any] | None = None


class ApplyOperationsRequest(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, extra="forbid", populate_by_name=True)

    base_revision: int = Field(ge=0)
    operations: list[dict[str, Any]] = Field(min_length=0, max_length=100)


def _error(code: str, message: str, *, status_code: int, details: Any | None = None) -> JSONResponse:
    payload: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details is not None:
        payload["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=payload)


def _validation_error(exc: ValidationError) -> JSONResponse:
    issues = [
        {"path": list(error.get("loc", ())), "message": error.get("msg", "输入无效")}
        for error in exc.errors()
    ]
    return _error(
        "VALIDATION_ERROR",
        "请求参数无效",
        status_code=422,
        details={"issues": issues},
    )


async def _default_owner_resolver(_request: Request) -> str:
    # The current desktop product is single-user. Multi-user deployments inject
    # an authenticated principal resolver here; request headers are never trusted.
    return "local-user"


async def _resolve_owner(resolver: OwnerResolver, request: Request) -> str:
    result = resolver(request)
    owner = await result if inspect.isawaitable(result) else result
    if not owner or len(owner) > 128:
        raise ValueError("owner scope is unavailable")
    return owner


def create_ppt_router(
    repository: PptRepository,
    *,
    owner_resolver: OwnerResolver = _default_owner_resolver,
) -> APIRouter:
    repository.initialize()
    service = PptService(repository)
    router = APIRouter(prefix="/api/ppt", tags=["ppt"])

    @router.post("/presentations", status_code=status.HTTP_201_CREATED, response_model=None)
    async def create_presentation(request: Request, payload: dict[str, Any]) -> dict[str, Any] | JSONResponse:
        try:
            create = CreatePresentationRequest.model_validate(payload)
        except ValidationError as exc:
            return _validation_error(exc)
        owner_scope = await _resolve_owner(owner_resolver, request)
        try:
            return service.create_presentation(
                owner_scope=owner_scope,
                presentation_id=create.presentation_id,
                title=create.title,
                template_id=create.template_id,
                document=create.document,
            )
        except TemplateNotFound:
            return _error("PPT_TEMPLATE_NOT_FOUND", "模板不存在", status_code=404)
        except PresentationDocumentInvalid as exc:
            return _error("PPT_DOCUMENT_INVALID", str(exc), status_code=422)
        except RepositoryConflict:
            return _error("PPT_PRESENTATION_CONFLICT", "演示文稿已存在", status_code=409)

    @router.get("/presentations/{presentation_id}", response_model=None)
    async def get_presentation(presentation_id: str, request: Request) -> dict[str, Any] | JSONResponse:
        owner_scope = await _resolve_owner(owner_resolver, request)
        try:
            return service.get_presentation(presentation_id, owner_scope=owner_scope)
        except PresentationNotFound:
            return _error("PPT_PRESENTATION_NOT_FOUND", "演示文稿不存在", status_code=404)

    @router.post("/presentations/{presentation_id}/operations", response_model=None)
    async def apply_presentation_operations(
        presentation_id: str,
        request: Request,
        payload: dict[str, Any],
    ) -> dict[str, Any] | JSONResponse:
        try:
            command = ApplyOperationsRequest.model_validate(payload)
        except ValidationError as exc:
            return _validation_error(exc)
        owner_scope = await _resolve_owner(owner_resolver, request)
        record = repository.get_presentation(presentation_id, owner_scope=owner_scope)
        if record is None:
            return _error("PPT_PRESENTATION_NOT_FOUND", "演示文稿不存在", status_code=404)
        try:
            document = parse_presentation_document(record.document)
            operations = parse_operations(command.operations)
            known_ids = repository.get_applied_operation_ids(
                presentation_id,
                [operation.operation_id for operation in operations],
            )
            result = apply_operations(
                document,
                base_revision=command.base_revision,
                operations=operations,
                applied_operation_ids=known_ids,
            )
        except ValidationError as exc:
            return _validation_error(exc)
        except RevisionConflict as exc:
            return _error(
                "REVISION_CONFLICT",
                "演示文稿已被更新，请重新加载后再试",
                status_code=409,
                details={"currentRevision": exc.current_revision},
            )
        except OperationRejected as exc:
            return _error("PPT_OPERATION_REJECTED", str(exc), status_code=422)

        ignored = list(result.ignored_operation_ids)
        pending_ids = [
            operation.operation_id
            for operation in operations
            if operation.operation_id not in set(ignored)
        ]
        if pending_ids:
            operation_payloads = {
                operation.operation_id: hashlib.sha256(
                    operation.model_dump_json(by_alias=True, exclude_none=True).encode("utf-8")
                ).hexdigest()
                for operation in operations
                if operation.operation_id in pending_ids
            }
            try:
                repository.commit_revision(
                    presentation_id=presentation_id,
                    owner_scope=owner_scope,
                    expected_revision=record.current_revision,
                    document=result.document.model_dump(mode="json", by_alias=True, exclude_none=True),
                    operations=[operation.model_dump(mode="json", by_alias=True, exclude_none=True) for operation in operations],
                    operation_payloads=operation_payloads,
                )
            except RepositoryConflict:
                latest = repository.get_presentation(presentation_id, owner_scope=owner_scope)
                current_revision = latest.current_revision if latest else record.current_revision
                return _error(
                    "REVISION_CONFLICT",
                    "演示文稿已被更新，请重新加载后再试",
                    status_code=409,
                    details={"currentRevision": current_revision},
                )
            record = repository.get_presentation(presentation_id, owner_scope=owner_scope)
            assert record is not None
        return service.presentation_payload(record, ignored_operation_ids=ignored)

    @router.get("/templates", response_model=None)
    async def list_templates(
        request: Request,
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=24, alias="pageSize", ge=1, le=50),
        scene: str | None = Query(default=None, min_length=1, max_length=64),
        source: Literal["SYSTEM", "PRIVATE"] | None = Query(default=None),
        query: str | None = Query(default=None, alias="q", max_length=160),
    ) -> dict[str, Any]:
        owner_scope = await _resolve_owner(owner_resolver, request)
        result = service.list_templates(
            owner_scope=owner_scope,
            page=page,
            page_size=page_size,
            scene=scene,
            source=source,
            query=query,
        )
        return {
            "templates": result.templates,
            "pagination": {
                "page": result.page,
                "pageSize": result.page_size,
                "hasMore": result.has_more,
            },
        }

    @router.get("/templates/{template_id}", response_model=None)
    async def get_template(template_id: str, request: Request) -> dict[str, Any] | JSONResponse:
        owner_scope = await _resolve_owner(owner_resolver, request)
        try:
            return service.get_template(template_id, owner_scope=owner_scope)
        except TemplateNotFound:
            return _error("PPT_TEMPLATE_NOT_FOUND", "模板不存在", status_code=404)

    @router.patch("/templates/{template_id}", response_model=None)
    async def update_template(
        template_id: str,
        request: Request,
        payload: dict[str, Any],
    ) -> dict[str, Any] | JSONResponse:
        try:
            update = UpdateTemplateRequest.model_validate(payload)
        except ValidationError as exc:
            return _validation_error(exc)
        owner_scope = await _resolve_owner(owner_resolver, request)
        try:
            return service.update_template(
                template_id,
                owner_scope=owner_scope,
                name=update.name,
                description=update.description,
                scene=update.scene,
            )
        except TemplateNotFound:
            return _error("PPT_TEMPLATE_NOT_FOUND", "模板不存在", status_code=404)
        except TemplateReadOnly:
            return _error("PPT_TEMPLATE_READ_ONLY", "系统模板不可修改", status_code=403)

    @router.delete(
        "/templates/{template_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        response_model=None,
    )
    async def delete_template(template_id: str, request: Request) -> Response | JSONResponse:
        owner_scope = await _resolve_owner(owner_resolver, request)
        try:
            service.delete_template(template_id, owner_scope=owner_scope)
        except TemplateReadOnly:
            return _error("PPT_TEMPLATE_READ_ONLY", "系统模板不可删除", status_code=403)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @router.get("/templates/{template_id}/pages", response_model=None)
    async def list_template_pages(template_id: str, request: Request) -> dict[str, Any] | JSONResponse:
        owner_scope = await _resolve_owner(owner_resolver, request)
        try:
            pages = service.list_template_pages(template_id, owner_scope=owner_scope)
        except TemplateNotFound:
            return _error("PPT_TEMPLATE_NOT_FOUND", "模板不存在", status_code=404)
        return {"pages": pages}

    return router
