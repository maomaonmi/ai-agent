"""FastAPI router for the AI PPT template market."""

from __future__ import annotations

import hashlib
import asyncio
import inspect
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ppt_models import parse_presentation_document
from ppt_operations import OperationRejected, RevisionConflict, apply_operations, parse_operations
from ppt_agent_loop import AgentRunService, PresentationForRunNotFound, RunNotFound
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


class CreateRunRequest(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, extra="forbid", populate_by_name=True)

    run_id: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
    presentation_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
    prompt: str = Field(min_length=1, max_length=50_000)
    max_iterations: int = Field(default=3, ge=1, le=8)
    model_provider: Literal["deepseek", "qwen", "glm", "minimax"] = "deepseek"
    search_provider: Literal["auto", "firecrawl", "qwen", "glm"] = "auto"
    search_limit: int = Field(default=20, ge=1, le=20)
    resume: bool = False


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
    asset_root: str | Path | None = None,
) -> APIRouter:
    repository.initialize()
    service = PptService(repository)
    service.ensure_system_templates()
    resolved_asset_root = (Path(asset_root) if asset_root is not None else repository.database_path.parent / "ppt-assets").resolve()
    resolved_asset_root.mkdir(parents=True, exist_ok=True)
    run_service = AgentRunService(repository, asset_root=resolved_asset_root)
    router = APIRouter(prefix="/api/ppt", tags=["ppt"])

    @router.get("/assets/{asset_id}/content", response_model=None)
    async def get_ppt_asset_content(asset_id: str, request: Request) -> FileResponse | JSONResponse:
        owner_scope = await _resolve_owner(owner_resolver, request)
        asset = repository.get_asset(asset_id, owner_scope=owner_scope)
        if asset is None:
            return _error("PPT_ASSET_NOT_FOUND", "PPT 素材不存在", status_code=404)
        root = resolved_asset_root.resolve()
        path = (root / asset.storage_path).resolve()
        if root not in path.parents or not path.is_file():
            return _error("PPT_ASSET_NOT_FOUND", "PPT 素材不存在", status_code=404)
        return FileResponse(path, media_type=asset.mime_type, filename=path.name)

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

    @router.post("/runs", response_model=None)
    async def create_run(request: Request, payload: dict[str, Any]) -> JSONResponse | dict[str, Any]:
        try:
            create = CreateRunRequest.model_validate(payload)
        except ValidationError as exc:
            return _validation_error(exc)
        owner_scope = await _resolve_owner(owner_resolver, request)
        try:
            run, created = run_service.create(
                run_id=create.run_id,
                presentation_id=create.presentation_id,
                owner_scope=owner_scope,
                prompt=create.prompt,
                max_iterations=create.max_iterations,
                model_provider=create.model_provider,
                search_provider=create.search_provider,
                search_limit=create.search_limit,
                resume=create.resume,
            )
        except PresentationForRunNotFound:
            return _error("PPT_PRESENTATION_NOT_FOUND", "演示文稿不存在", status_code=404)
        except RepositoryConflict:
            return _error("PPT_RUN_CONFLICT", "运行任务已存在", status_code=409)
        response = JSONResponse(status_code=status.HTTP_201_CREATED if created else status.HTTP_200_OK, content=run_service.payload(run))
        return response

    @router.get("/runs/resumable", response_model=None)
    async def list_resumable_runs(
        request: Request,
        limit: int = Query(default=20, ge=1, le=100),
    ) -> dict[str, Any]:
        owner_scope = await _resolve_owner(owner_resolver, request)
        return {"runs": [run_service.payload(run) for run in run_service.list_resumable(owner_scope=owner_scope, limit=limit)]}

    @router.get("/runs/history", response_model=None)
    async def list_history_runs(
        request: Request,
        limit: int = Query(default=50, ge=1, le=100),
    ) -> dict[str, Any]:
        owner_scope = await _resolve_owner(owner_resolver, request)
        return {"runs": run_service.history(owner_scope=owner_scope, limit=limit)}

    @router.get("/runs/{run_id}", response_model=None)
    async def get_run(run_id: str, request: Request) -> JSONResponse | dict[str, Any]:
        owner_scope = await _resolve_owner(owner_resolver, request)
        try:
            return run_service.payload(run_service.get(run_id, owner_scope=owner_scope))
        except RunNotFound:
            return _error("PPT_RUN_NOT_FOUND", "运行任务不存在", status_code=404)

    @router.post("/runs/{run_id}/repair-assets", response_model=None)
    async def repair_run_assets(run_id: str, request: Request) -> JSONResponse | dict[str, Any]:
        owner_scope = await _resolve_owner(owner_resolver, request)
        try:
            repaired = run_service.repair_web_assets(run_id, owner_scope=owner_scope)
            return run_service.payload(repaired)
        except RunNotFound:
            return _error("PPT_RUN_NOT_FOUND", "运行任务不存在", status_code=404)

    @router.get("/runs/{run_id}/events", response_model=None)
    async def stream_run_events(
        run_id: str,
        request: Request,
        follow: bool = Query(default=False),
        after: int = Query(default=0, ge=0),
    ) -> StreamingResponse | JSONResponse:
        owner_scope = await _resolve_owner(owner_resolver, request)
        try:
            run_service.get(run_id, owner_scope=owner_scope)
        except RunNotFound:
            return _error("PPT_RUN_NOT_FOUND", "运行任务不存在", status_code=404)
        header_value = request.headers.get("last-event-id")
        try:
            cursor = max(after, int(header_value or 0))
        except ValueError:
            cursor = after

        async def event_stream():
            nonlocal cursor
            deadline = asyncio.get_running_loop().time() + 60
            while True:
                events = repository.list_run_events(run_id, after_sequence=cursor, limit=1_000)
                for event in events:
                    cursor = event.sequence
                    payload = {"runId": run_id, "sequence": event.sequence, **event.payload}
                    import json
                    yield f"id: {event.sequence}\nevent: {event.event_type}\ndata: {json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\n\n"
                current = run_service.get(run_id, owner_scope=owner_scope)
                if not follow or current.status in {"COMPLETED", "CANCELLED", "FAILED"} or asyncio.get_running_loop().time() >= deadline:
                    yield "event: end\ndata: {}\n\n"
                    return
                await asyncio.sleep(0.2)

        return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @router.post("/runs/{run_id}/cancel", response_model=None)
    async def cancel_run(run_id: str, request: Request) -> JSONResponse | dict[str, Any]:
        owner_scope = await _resolve_owner(owner_resolver, request)
        try:
            return run_service.payload(run_service.cancel(run_id, owner_scope=owner_scope))
        except RunNotFound:
            return _error("PPT_RUN_NOT_FOUND", "运行任务不存在", status_code=404)

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
