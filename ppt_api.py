"""FastAPI router for the AI PPT template market."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ppt_repository import PptRepository
from ppt_service import PptService, TemplateNotFound, TemplateReadOnly


OwnerResolver = Callable[[Request], str | Awaitable[str]]


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
