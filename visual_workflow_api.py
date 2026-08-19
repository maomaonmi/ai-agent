"""REST router for visual workflow definitions and revisions."""

from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Query, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from visual_workflow_models import WorkflowDocument, ValidationIssue
from visual_workflow_registry import NodeDefinition, list_node_definitions
from visual_workflow_execution import WorkflowCompileError, compile_workflow
from visual_workflow_executor import VisualWorkflowExecutor
from visual_workflow_repository import (
    RevisionConflict,
    RunNotFound,
    VisualWorkflowRepository,
    WorkflowNotFound,
    WorkflowRevisionNotFound,
)
from visual_workflow_run_state import InvalidStateTransition
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


class CompileWorkflowRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    revision: int | None = Field(default=None, ge=1)
    requested_node_ids: list[str] | None = Field(default=None, alias="requestedNodeIds", max_length=200)
    require_inputs: bool = Field(default=False, alias="requireInputs")


class CreateRunRequest(CompileWorkflowRequest):
    mode: Literal["dry-run", "execute"] = "dry-run"
    client_request_id: str | None = Field(default=None, alias="clientRequestId", min_length=1, max_length=128)


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


def _run_payload(row: dict[str, Any], plan: dict[str, Any], node_runs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "workflowId": row["workflow_id"],
        "revision": row["revision"],
        "status": row["status"],
        "mode": row["mode"],
        "progress": row["progress"],
        "requestedNodeIds": row["requested_node_ids"],
        "clientRequestId": row["client_request_id"],
        "createdAt": row["created_at"],
        "startedAt": row["started_at"],
        "completedAt": row["completed_at"],
        "plan": plan,
        "nodeRuns": node_runs or [],
    }


def create_visual_workflow_router(
    repository: VisualWorkflowRepository,
    executor: VisualWorkflowExecutor | None = None,
) -> APIRouter:
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

    @router.post("/api/visual-workflows/{workflow_id}/compile", response_model=None)
    async def compile_workflow_document(workflow_id: str, payload: dict[str, Any]) -> dict[str, Any] | JSONResponse:
        try:
            request = CompileWorkflowRequest.model_validate(payload)
        except ValidationError as exc:
            return _validation_error(exc)
        workflow = repository.get_workflow(workflow_id)
        if workflow is None:
            return _error("WORKFLOW_NOT_FOUND", "工作流不存在", status_code=404)
        revision = request.revision or int(workflow["current_revision"])
        document = repository.get_revision(workflow_id, revision)
        if document is None:
            return _error("WORKFLOW_REVISION_NOT_FOUND", "工作流修订版本不存在", status_code=404)
        try:
            plan = compile_workflow(
                document,
                requested_node_ids=request.requested_node_ids,
                require_inputs=request.require_inputs,
            )
        except WorkflowCompileError as exc:
            return _error(
                "WORKFLOW_NOT_EXECUTABLE",
                "工作流无法生成执行计划",
                status_code=422,
                details={"issues": [_issue_payload(issue) for issue in exc.issues]},
            )
        return {"plan": plan.to_payload()}

    @router.post("/api/visual-workflows/{workflow_id}/runs", status_code=status.HTTP_201_CREATED, response_model=None)
    async def create_workflow_run(workflow_id: str, payload: dict[str, Any], background_tasks: BackgroundTasks) -> dict[str, Any] | JSONResponse:
        try:
            request = CreateRunRequest.model_validate(payload)
        except ValidationError as exc:
            return _validation_error(exc)
        if request.mode == "execute" and executor is None:
            return _error("EXECUTION_NOT_AVAILABLE", "真实模型执行器尚未配置", status_code=409)
        workflow = repository.get_workflow(workflow_id)
        if workflow is None:
            return _error("WORKFLOW_NOT_FOUND", "工作流不存在", status_code=404)
        revision = request.revision or int(workflow["current_revision"])
        document = repository.get_revision(workflow_id, revision)
        if document is None:
            return _error("WORKFLOW_REVISION_NOT_FOUND", "工作流修订版本不存在", status_code=404)
        try:
            plan = compile_workflow(
                document,
                requested_node_ids=request.requested_node_ids,
                require_inputs=request.require_inputs or request.mode == "execute",
            )
        except WorkflowCompileError as exc:
            return _error(
                "WORKFLOW_NOT_EXECUTABLE",
                "工作流无法创建运行计划",
                status_code=422,
                details={"issues": [_issue_payload(issue) for issue in exc.issues]},
            )
        try:
            run = repository.create_run(
                workflow_id,
                revision=revision,
                mode=request.mode,
                requested_node_ids=list(plan.node_ids),
                client_request_id=request.client_request_id,
            )
        except WorkflowNotFound:
            return _error("WORKFLOW_NOT_FOUND", "工作流不存在", status_code=404)
        except WorkflowRevisionNotFound:
            return _error("WORKFLOW_REVISION_NOT_FOUND", "工作流修订版本不存在", status_code=404)
        node_runs = repository.create_node_runs(run["id"], list(plan.node_ids))
        if request.mode == "execute" and run["status"] == "PLANNED" and executor is not None:
            background_tasks.add_task(executor.execute, workflow_id, run["id"], document, plan)
        return _run_payload(run, plan.to_payload(), node_runs)

    @router.get("/api/visual-workflows/{workflow_id}/runs/{run_id}", response_model=None)
    async def get_workflow_run(workflow_id: str, run_id: str) -> dict[str, Any] | JSONResponse:
        run = repository.get_run(workflow_id, run_id)
        if run is None:
            return _error("RUN_NOT_FOUND", "运行记录不存在", status_code=404)
        document = repository.get_revision(workflow_id, int(run["revision"]))
        if document is None:
            return _error("WORKFLOW_REVISION_NOT_FOUND", "工作流修订版本不存在", status_code=404)
        try:
            plan = compile_workflow(document, requested_node_ids=run["requested_node_ids"])
        except WorkflowCompileError as exc:
            return _error("WORKFLOW_NOT_EXECUTABLE", "运行记录对应的工作流已无法编译", status_code=422, details={"issues": [_issue_payload(issue) for issue in exc.issues]})
        return _run_payload(run, plan.to_payload(), repository.get_node_runs(workflow_id, run_id))

    @router.post("/api/visual-workflows/{workflow_id}/runs/{run_id}/cancel", response_model=None)
    async def cancel_workflow_run(workflow_id: str, run_id: str) -> dict[str, Any] | JSONResponse:
        try:
            run = repository.request_run_cancel(workflow_id, run_id)
        except RunNotFound:
            return _error("RUN_NOT_FOUND", "运行记录不存在", status_code=404)
        except InvalidStateTransition:
            return _error("RUN_TERMINAL", "运行已经结束，不能取消", status_code=409)
        document = repository.get_revision(workflow_id, int(run["revision"]))
        if document is None:
            return _error("WORKFLOW_REVISION_NOT_FOUND", "工作流修订版本不存在", status_code=404)
        try:
            plan = compile_workflow(document, requested_node_ids=run["requested_node_ids"])
        except WorkflowCompileError as exc:
            return _error("WORKFLOW_NOT_EXECUTABLE", "运行记录对应的工作流已无法编译", status_code=422, details={"issues": [_issue_payload(issue) for issue in exc.issues]})
        return _run_payload(run, plan.to_payload(), repository.get_node_runs(workflow_id, run_id))

    @router.get("/api/visual-workflows/{workflow_id}/runs/{run_id}/stream", response_model=None)
    async def stream_workflow_run(workflow_id: str, run_id: str, request: Request) -> Any:
        initial = repository.get_run(workflow_id, run_id)
        if initial is None:
            return _error("RUN_NOT_FOUND", "运行记录不存在", status_code=404)
        try:
            last_event_id = max(0, int(request.headers.get("last-event-id", "0")))
        except ValueError:
            last_event_id = 0

        async def events():
            nonlocal last_event_id
            run = repository.get_run(workflow_id, run_id)
            if run is None:
                return
            document = repository.get_revision(workflow_id, int(run["revision"]))
            if document is None:
                return
            try:
                plan = compile_workflow(document, requested_node_ids=run["requested_node_ids"])
            except WorkflowCompileError:
                return
            yield f"event: snapshot\ndata: {json.dumps(_run_payload(run, plan.to_payload(), repository.get_node_runs(workflow_id, run_id)), ensure_ascii=False)}\n\n"
            heartbeat = 0
            while True:
                if await request.is_disconnected():
                    return
                rows = repository.list_events(workflow_id, run_id, after_sequence=last_event_id)
                for row in rows:
                    last_event_id = row["sequence"]
                    payload = {"sequence": last_event_id, "eventType": row["event_type"], "nodeId": row["node_id"], "payload": row["payload"]}
                    yield f"id: {last_event_id}\nevent: {row['event_type']}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                latest = repository.get_run(workflow_id, run_id)
                if latest is None:
                    return
                if latest["status"] in {"SUCCEEDED", "FAILED", "CANCELLED"} and not repository.list_events(workflow_id, run_id, after_sequence=last_event_id):
                    return
                heartbeat += 1
                if heartbeat >= 30:
                    heartbeat = 0
                    yield f"event: heartbeat\ndata: {json.dumps({'runId': run_id})}\n\n"
                await asyncio.sleep(0.5)

        return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"})

    @router.delete("/api/visual-workflows/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
    async def delete_workflow(workflow_id: str) -> None | JSONResponse:
        if not repository.delete_workflow(workflow_id):
            return _error("WORKFLOW_NOT_FOUND", "工作流不存在", status_code=404)
        return None

    return router
