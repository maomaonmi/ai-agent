"""REST router for visual workflow definitions and revisions."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from visual_workflow_models import WorkflowDocument, ValidationIssue
from visual_workflow_registry import NodeDefinition, list_node_definitions
from visual_workflow_repository import RevisionConflict, VisualWorkflowRepository, WorkflowNotFound
from visual_workflow_validator import validate_workflow


class CreateWorkflowRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=1000)


class SaveRevisionRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    base_revision: int = Field(alias="baseRevision", ge=1)
    document: WorkflowDocument


class ValidateWorkflowRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    document: WorkflowDocument
    require_inputs: bool = Field(default=False, alias="requireInputs")


def _error(code: str, message: str, *, status_code: int, details: Any | None = None) -> JSONResponse:
    payload: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details is not None:
        payload["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=payload)


def _validation_error(exc: ValidationError) -> JSONResponse:
    details = [{"path": list(error.get("loc", ())), "message": error.get("msg", "输入无效")} for error in exc.errors()]
    return _error("VALIDATION_ERROR", "请求参数无效", status_code=422, details={"issues": details})


def _definition_payload(definition: NodeDefinition) -> dict[str, Any]:
    return {
        "kind": definition.kind,
        "version": definition.version,
        "category": definition.category,
        "inputs": [port.model_dump(by_alias=True) for port in definition.inputs],
        "outputs": [port.model_dump(by_alias=True) for port in definition.outputs],
        "configSchema": definition.config_schema,
        "cachePolicy": definition.cache_policy,
        "executorKey": definition.executor_key,
    }


def _workflow_payload(row: dict[str, Any]) -> dict[str, Any]:
    document: WorkflowDocument = row["document"]
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "currentRevision": row["current_revision"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "document": document.model_dump(by_alias=True, mode="json"),
    }


def _issue_payload(issue: ValidationIssue) -> dict[str, Any]:
    return issue.model_dump(by_alias=True, exclude_none=True)


def create_visual_workflow_router(repository: VisualWorkflowRepository) -> APIRouter:
    router = APIRouter(tags=["visual-workflow"])

    @router.get("/api/visual-workflow-node-definitions")
    async def get_node_definitions() -> dict[str, Any]:
        return {"definitions": [_definition_payload(definition) for definition in list_node_definitions()]}

    @router.post("/api/visual-workflows", status_code=status.HTTP_201_CREATED, response_model=None)
    async def create_workflow(payload: dict[str, Any]) -> dict[str, Any] | JSONResponse:
        try:
            request = CreateWorkflowRequest.model_validate(payload)
        except ValidationError as exc:
            return _validation_error(exc)
        return _workflow_payload(repository.create_workflow(request.name.strip(), description=request.description))

    @router.get("/api/visual-workflows", response_model=None)
    async def list_workflows(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=20, alias="pageSize", ge=1, le=100),
    ) -> dict[str, Any]:
        rows, total = repository.list_workflows(page=page, page_size=page_size)
        return {
            "workflows": [_workflow_payload(row) for row in rows],
            "pagination": {
                "page": page,
                "pageSize": page_size,
                "totalItems": total,
                "totalPages": (total + page_size - 1) // page_size,
            },
        }

    @router.get("/api/visual-workflows/{workflow_id}", response_model=None)
    async def get_workflow(workflow_id: str) -> dict[str, Any] | JSONResponse:
        row = repository.get_workflow(workflow_id)
        if row is None:
            return _error("WORKFLOW_NOT_FOUND", "工作流不存在", status_code=404)
        return _workflow_payload(row)

    @router.patch("/api/visual-workflows/{workflow_id}", response_model=None)
    async def save_workflow_revision(workflow_id: str, payload: dict[str, Any]) -> dict[str, Any] | JSONResponse:
        try:
            request = SaveRevisionRequest.model_validate(payload)
        except ValidationError as exc:
            return _validation_error(exc)
        issues = validate_workflow(request.document)
        if issues:
            return _error("WORKFLOW_INVALID", "工作流文档无效", status_code=422, details={"issues": [_issue_payload(issue) for issue in issues]})
        try:
            row = repository.save_revision(workflow_id, base_revision=request.base_revision, document=request.document)
        except WorkflowNotFound:
            return _error("WORKFLOW_NOT_FOUND", "工作流不存在", status_code=404)
        except RevisionConflict as exc:
            return _error("REVISION_CONFLICT", "工作流已被其他编辑器更新", status_code=409, details={"currentRevision": exc.current_revision})
        return _workflow_payload(row)

    @router.post("/api/visual-workflows/{workflow_id}/validate", response_model=None)
    async def validate_workflow_document(workflow_id: str, payload: dict[str, Any]) -> dict[str, Any] | JSONResponse:
        if repository.get_workflow(workflow_id) is None:
            return _error("WORKFLOW_NOT_FOUND", "工作流不存在", status_code=404)
        try:
            request = ValidateWorkflowRequest.model_validate(payload)
        except ValidationError as exc:
            return _validation_error(exc)
        issues = validate_workflow(request.document, require_inputs=request.require_inputs)
        if issues:
            return _error("WORKFLOW_INVALID", "工作流文档无效", status_code=422, details={"issues": [_issue_payload(issue) for issue in issues]})
        return {"valid": True, "issues": []}

    @router.delete("/api/visual-workflows/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
    async def delete_workflow(workflow_id: str) -> None | JSONResponse:
        if not repository.delete_workflow(workflow_id):
            return _error("WORKFLOW_NOT_FOUND", "工作流不存在", status_code=404)
        return None

    return router

