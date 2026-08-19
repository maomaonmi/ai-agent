"""Execution bridge from visual-workflow artifacts to real model adapters.

The executor is deliberately provider-agnostic.  Video adapters implement the
existing :class:`video_engine.VideoProvider` protocol, while image generation is
represented by a small async protocol so tests can use a deterministic fake and
the application can inject the configured Qwen/Zhipu adapter.
"""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Mapping, Protocol
from urllib.parse import urlparse

from visual_workflow_execution import WorkflowCompilePlan
from visual_workflow_models import WorkflowDocument, WorkflowEdge, WorkflowNode
from visual_workflow_repository import VisualWorkflowRepository
from visual_workflow_providers import WorkflowImageProviderError, WorkflowVisionProviderError
from video_engine import (
    TERMINAL_VIDEO_STATUSES,
    ProviderTaskSnapshot,
    VideoGenerationRequest,
    VideoProvider,
    VideoProviderError,
    VideoTaskStatus,
    video_capability,
)


class WorkflowImageProvider(Protocol):
    async def generate(
        self,
        *,
        model: str,
        prompt: str,
        ratio: str,
        count: int,
        references: list[str],
        negative_prompt: str | None = None,
    ) -> list[str]: ...


class WorkflowVisionProvider(Protocol):
    async def describe(self, references: list[str], *, instruction: str | None = None) -> str: ...


class WorkflowReferenceAssetResolver(Protocol):
    def get_reference_url(self, asset_id: str, *, expires: int = 6 * 60 * 60) -> str: ...


class WorkflowNodeExecutionError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class NodeArtifact:
    port: str
    type: str
    value: str
    media_kind: str | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"port": self.port, "type": self.type, "value": self.value}
        if self.media_kind:
            payload["mediaKind"] = self.media_kind
        return payload


class VisualWorkflowExecutor:
    """Run one immutable workflow revision in deterministic topological batches."""

    def __init__(
        self,
        repository: VisualWorkflowRepository,
        video_providers: Mapping[str, VideoProvider],
        *,
        image_provider: WorkflowImageProvider | None = None,
        vision_provider: WorkflowVisionProvider | None = None,
        reference_assets: WorkflowReferenceAssetResolver | None = None,
        poll_interval_seconds: float = 2.0,
        max_provider_polls: int = 180,
    ):
        self.repository = repository
        self.video_providers = dict(video_providers)
        self.image_provider = image_provider
        self.vision_provider = vision_provider
        self.reference_assets = reference_assets
        self.poll_interval_seconds = max(0.05, poll_interval_seconds)
        self.max_provider_polls = max(1, max_provider_polls)

    async def execute(
        self,
        workflow_id: str,
        run_id: str,
        document: WorkflowDocument,
        plan: WorkflowCompilePlan,
    ) -> dict[str, Any]:
        self.repository.create_node_runs(run_id, list(plan.node_ids))
        run = self.repository.get_run(workflow_id, run_id)
        if run is None:
            raise WorkflowNodeExecutionError("RUN_NOT_FOUND", "工作流运行记录不存在")
        if run["status"] in {"SUCCEEDED", "FAILED", "CANCELLED"}:
            return run
        if run["status"] == "PLANNED":
            self.repository.transition_run(workflow_id, run_id, "QUEUED", progress=0)
            self.repository.append_event(run_id, "run_queued", payload={"revision": document.revision})
        run = self.repository.get_run(workflow_id, run_id) or run
        if run["status"] == "QUEUED":
            self.repository.transition_run(workflow_id, run_id, "RUNNING", progress=0)
            self.repository.append_event(run_id, "run_started", payload={"nodeCount": len(plan.node_ids)})

        node_map = {node.id: node for node in document.nodes}
        edges_by_target: dict[str, list[WorkflowEdge]] = defaultdict(list)
        for edge in document.edges:
            edges_by_target[edge.target_node_id].append(edge)
        outputs_by_node: dict[str, dict[str, list[NodeArtifact]]] = {}
        completed = 0

        try:
            for batch in plan.batches:
                current = self.repository.get_run(workflow_id, run_id)
                if current is None:
                    raise WorkflowNodeExecutionError("RUN_NOT_FOUND", "工作流运行记录不存在")
                if current["status"] == "CANCEL_REQUESTED":
                    self.repository.transition_run(workflow_id, run_id, "CANCELLED", progress=round(completed / max(1, len(plan.node_ids)) * 100))
                    self.repository.append_event(run_id, "run_cancelled", payload={"completedNodes": completed})
                    return self.repository.get_run(workflow_id, run_id) or {}
                tasks = [
                    self._execute_node(
                        run_id,
                        node_map[node_id],
                        edges_by_target.get(node_id, []),
                        outputs_by_node,
                    )
                    for node_id in batch
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                for node_id, result in zip(batch, results, strict=True):
                    if isinstance(result, BaseException):
                        error = result if isinstance(result, WorkflowNodeExecutionError) else WorkflowNodeExecutionError("NODE_EXECUTION_FAILED", "节点执行失败")
                        self.repository.update_node_run(run_id, node_id, status="FAILED", error_code=error.code, error_message=str(error))
                        self.repository.append_event(run_id, "node_failed", node_id=node_id, payload={"code": error.code, "message": str(error)})
                        raise error
                    outputs_by_node[node_id] = result
                    completed += 1
                    flat_outputs = [artifact.to_payload() for artifacts in result.values() for artifact in artifacts]
                    self.repository.update_node_run(run_id, node_id, status="SUCCEEDED", output_artifacts=flat_outputs)
                    self.repository.append_event(
                        run_id,
                        "node_succeeded",
                        node_id=node_id,
                        payload={"outputs": flat_outputs, "progress": round(completed / max(1, len(plan.node_ids)) * 100)},
                    )
                self.repository.update_run_progress(workflow_id, run_id, round(completed / max(1, len(plan.node_ids)) * 100))
        except WorkflowNodeExecutionError:
            self.repository.transition_run(workflow_id, run_id, "FAILED", progress=round(completed / max(1, len(plan.node_ids)) * 100))
            self.repository.append_event(run_id, "run_failed", payload={"completedNodes": completed})
            return self.repository.get_run(workflow_id, run_id) or {}

        self.repository.transition_run(workflow_id, run_id, "SUCCEEDED", progress=100)
        self.repository.append_event(run_id, "run_succeeded", payload={"completedNodes": completed})
        return self.repository.get_run(workflow_id, run_id) or {}

    async def _execute_node(
        self,
        run_id: str,
        node: WorkflowNode,
        incoming_edges: list[WorkflowEdge],
        outputs_by_node: dict[str, dict[str, list[NodeArtifact]]],
    ) -> dict[str, list[NodeArtifact]]:
        self.repository.update_node_run(run_id, node.id, status="RUNNING", input_artifacts=self._incoming_payload(incoming_edges, outputs_by_node))
        self.repository.append_event(run_id, "node_started", node_id=node.id, payload={"kind": node.kind})
        incoming = self._incoming(incoming_edges, outputs_by_node)
        try:
            result = await self._execute_node_impl(node, incoming)
            return result
        except WorkflowNodeExecutionError:
            raise
        except (ValueError, KeyError, TypeError) as exc:
            raise WorkflowNodeExecutionError("NODE_INPUT_INVALID", str(exc)) from exc
        except VideoProviderError as exc:
            raise WorkflowNodeExecutionError(exc.code, str(exc)) from exc
        except WorkflowImageProviderError as exc:
            raise WorkflowNodeExecutionError(exc.code, str(exc)) from exc
        except WorkflowVisionProviderError as exc:
            raise WorkflowNodeExecutionError(exc.code, str(exc)) from exc
        except Exception as exc:
            raise WorkflowNodeExecutionError("NODE_EXECUTION_FAILED", "节点执行失败，请查看运行日志") from exc

    async def _execute_node_impl(self, node: WorkflowNode, incoming: dict[str, list[NodeArtifact]]) -> dict[str, list[NodeArtifact]]:
        config = node.config or {}
        if node.kind == "prompt_input":
            text = str(config.get("text") or config.get("prompt") or "").strip()
            if not text:
                raise WorkflowNodeExecutionError("INPUT_REQUIRED", "提示词输入不能为空")
            return {"prompt": [NodeArtifact("prompt", "prompt.text", text)]}
        if node.kind in {"image_input", "video_input", "audio_url_input"}:
            return self._input_media(node)
        if node.kind == "prompt_template":
            prompt_values = self._values(incoming.get("prompt_in")) or self._all_values(incoming)
            if not prompt_values:
                raise WorkflowNodeExecutionError("INPUT_REQUIRED", "提示词模板缺少输入")
            template = str(config.get("template") or "{prompt}")
            value = template.replace("{prompt}", "\n".join(prompt_values))
            return {"prompt": [NodeArtifact("prompt", "prompt.text", value.strip())]}
        if node.kind == "vision_to_prompt":
            if self.vision_provider is None:
                raise WorkflowNodeExecutionError("PROVIDER_NOT_CONFIGURED", "视觉模型适配器尚未配置")
            references = self._dedupe(self._values(incoming.get("image")))
            prompt = await self.vision_provider.describe(
                references,
                instruction=str(config.get("instruction") or "") or None,
            )
            if not prompt.strip():
                raise WorkflowNodeExecutionError("PROVIDER_RESPONSE_INVALID", "视觉模型没有返回提示词")
            return {"prompt": [NodeArtifact("prompt", "prompt.text", prompt.strip())]}
        if node.kind in {"image_generate", "image_edit"}:
            return await self._execute_image(node, incoming)
        if node.kind in {"text_to_video", "image_to_video", "start_end_video", "reference_to_video"}:
            return {"video": [NodeArtifact("video", "video.asset", await self._execute_video(node, incoming))]}
        if node.kind in {"preview_output", "gallery_output", "image_compare"}:
            return self._passthrough(node, incoming)
        raise WorkflowNodeExecutionError("NODE_UNSUPPORTED", f"暂不支持节点类型：{node.kind}")

    def _input_media(self, node: WorkflowNode) -> dict[str, list[NodeArtifact]]:
        config = node.config or {}
        asset_id = str(config.get("referenceAssetId") or "").strip()
        if node.kind == "video_input" and asset_id:
            if self.reference_assets is None:
                raise WorkflowNodeExecutionError("REFERENCE_STORAGE_NOT_CONFIGURED", "参考视频 OSS 存储未配置")
            try:
                resolved_url = self.reference_assets.get_reference_url(asset_id)
            except Exception as exc:
                code = getattr(exc, "code", "REFERENCE_ASSET_NOT_READY")
                raise WorkflowNodeExecutionError(str(code), str(exc)) from exc
            raw_values: Any = [resolved_url]
        else:
            raw_values = config.get("urls") or config.get("values") or config.get("url") or config.get("value")
        values = raw_values if isinstance(raw_values, list) else [raw_values]
        values = [str(value).strip() for value in values if str(value or "").strip()]
        if not values:
            raise WorkflowNodeExecutionError("INPUT_REQUIRED", f"{node.kind} 缺少 URL/资产地址")
        if node.kind == "audio_url_input":
            return {"audio": [NodeArtifact("audio", "audio.url", values[0])]}
        data_type = "image.asset" if node.kind == "image_input" else "video.asset"
        port = "image" if node.kind == "image_input" else "video"
        return {port: [NodeArtifact(port, data_type, value, "reference_image" if data_type == "image.asset" else "reference_video") for value in values]}

    async def _execute_image(self, node: WorkflowNode, incoming: dict[str, list[NodeArtifact]]) -> dict[str, list[NodeArtifact]]:
        if self.image_provider is None:
            raise WorkflowNodeExecutionError("PROVIDER_NOT_CONFIGURED", "图片模型适配器尚未配置")
        prompt = self._first_value(incoming.get("prompt"))
        references = self._values(incoming.get("references")) + self._values(incoming.get("reference_image"))
        if not prompt:
            raise WorkflowNodeExecutionError("INPUT_REQUIRED", "图片节点缺少提示词")
        if node.kind == "image_edit" and not references:
            raise WorkflowNodeExecutionError("INPUT_REQUIRED", "图片编辑节点至少需要一张参考图")
        config = node.config or {}
        urls = await self.image_provider.generate(
            model=str(config.get("model") or "qwen-image-3.0"),
            prompt=prompt,
            ratio=str(config.get("ratio") or "1:1"),
            count=max(1, min(6, int(config.get("count") or 1))),
            references=self._dedupe(references),
            negative_prompt=str(config.get("negativePrompt") or "") or None,
        )
        if not urls:
            raise WorkflowNodeExecutionError("PROVIDER_RESPONSE_INVALID", "图片模型没有返回可用结果")
        return {"image": [NodeArtifact("image", "image.asset", url, "reference_image") for url in urls]}

    async def _execute_video(self, node: WorkflowNode, incoming: dict[str, list[NodeArtifact]]) -> str:
        config = node.config or {}
        model = str(config.get("model") or self._default_video_model(node.kind))
        capability = video_capability(model)
        provider = self.video_providers.get(capability["provider"])
        if provider is None:
            raise WorkflowNodeExecutionError("PROVIDER_NOT_CONFIGURED", f"未配置{capability['provider']}视频服务")
        prompt = self._first_value(incoming.get("prompt")) or str(config.get("prompt") or "")
        request_values: dict[str, Any] = {
            "mode": node.kind if node.kind != "start_end_video" else "start_end_video",
            "prompt": prompt,
            "model": model,
            "ratio": str(config.get("ratio") or "16:9"),
            "duration": int(config.get("duration") or 5),
            "resolution": str(config.get("resolution") or "720P"),
            "prompt_extend": bool(config.get("promptExtend", True)),
            "watermark": bool(config.get("watermark", False)),
            "audio": config.get("audio"),
            "audio_url": self._first_value(incoming.get("audio")) or config.get("audioUrl"),
            "negative_prompt": config.get("negativePrompt"),
            "seed": config.get("seed"),
            "shot_type": config.get("shotType"),
        }
        if node.kind == "text_to_video":
            reference_inputs = incoming.get("references") or []
            request_values["mode"] = "reference_to_video" if reference_inputs else "text_to_video"
            if reference_inputs:
                request_values["references"] = self._reference_payloads(reference_inputs, config)
        elif node.kind == "image_to_video":
            request_values["mode"] = "image_to_video"
            request_values["first_frame_url"] = self._required_value(incoming.get("first_frame"), "首帧")
        elif node.kind == "start_end_video":
            request_values["mode"] = "start_end_video"
            request_values["first_frame_url"] = self._required_value(incoming.get("first_frame"), "首帧")
            request_values["last_frame_url"] = self._required_value(incoming.get("last_frame"), "尾帧")
        else:
            request_values["mode"] = "reference_to_video"
            references = incoming.get("references") or []
            if not references:
                raise WorkflowNodeExecutionError("INPUT_REQUIRED", "参考视频节点至少需要一个图片或视频参考")
            request_values["references"] = self._reference_payloads(references, config)
        request = VideoGenerationRequest.model_validate(request_values)
        submission = await provider.submit(request)
        snapshot: ProviderTaskSnapshot | None = None
        for attempt in range(self.max_provider_polls):
            snapshot = await provider.retrieve(submission.provider_task_id)
            if snapshot.status in TERMINAL_VIDEO_STATUSES:
                break
            await asyncio.sleep(self.poll_interval_seconds)
        if snapshot is None or snapshot.status is not VideoTaskStatus.SUCCEEDED or not snapshot.video_url:
            message = snapshot.error_message if snapshot else "视频模型轮询超时"
            raise WorkflowNodeExecutionError(snapshot.error_code if snapshot else "PROVIDER_TIMEOUT", message or "视频生成失败")
        return self._require_public_url(snapshot.video_url)

    @staticmethod
    def _default_video_model(kind: str) -> str:
        return {"text_to_video": "wan2.7-t2v", "image_to_video": "wan2.7-i2v", "start_end_video": "wan2.2-kf2v-flash", "reference_to_video": "wan2.7-r2v"}[kind]

    @staticmethod
    def _reference_payloads(references: list[NodeArtifact], config: dict[str, Any]) -> list[dict[str, str]]:
        return [
            {
                "assetId": f"workflow-{abs(hash(artifact.value))}",
                "mediaKind": artifact.media_kind or ("reference_image" if artifact.type == "image.asset" else "reference_video"),
                "purpose": str(config.get("referencePurpose") or "motion"),
                "url": VisualWorkflowExecutor._require_public_url(artifact.value),
            }
            for artifact in references
        ]

    @staticmethod
    def _incoming(edges: list[WorkflowEdge], outputs: dict[str, dict[str, list[NodeArtifact]]]) -> dict[str, list[NodeArtifact]]:
        incoming: dict[str, list[NodeArtifact]] = defaultdict(list)
        for edge in edges:
            incoming[edge.target_port_id].extend(outputs.get(edge.source_node_id, {}).get(edge.source_port_id, []))
        return dict(incoming)

    @staticmethod
    def _incoming_payload(edges: list[WorkflowEdge], outputs: dict[str, dict[str, list[NodeArtifact]]]) -> list[dict[str, Any]]:
        return [artifact.to_payload() for artifacts in VisualWorkflowExecutor._incoming(edges, outputs).values() for artifact in artifacts]

    @staticmethod
    def _passthrough(node: WorkflowNode, incoming: dict[str, list[NodeArtifact]]) -> dict[str, list[NodeArtifact]]:
        result: dict[str, list[NodeArtifact]] = {}
        for port, artifacts in incoming.items():
            output_port = "images" if node.kind == "gallery_output" and port == "images" else "videos" if node.kind == "gallery_output" and port == "videos" else port
            result[output_port] = [NodeArtifact(output_port, artifact.type, artifact.value, artifact.media_kind) for artifact in artifacts]
        return result

    @staticmethod
    def _values(artifacts: list[NodeArtifact] | None) -> list[str]:
        return [artifact.value for artifact in (artifacts or [])]

    @staticmethod
    def _all_values(incoming: dict[str, list[NodeArtifact]]) -> list[str]:
        return [artifact.value for artifacts in incoming.values() for artifact in artifacts]

    @staticmethod
    def _first_value(artifacts: list[NodeArtifact] | None) -> str | None:
        return artifacts[0].value if artifacts else None

    @staticmethod
    def _required_value(artifacts: list[NodeArtifact] | None, label: str) -> str:
        value = VisualWorkflowExecutor._first_value(artifacts)
        if not value:
            raise WorkflowNodeExecutionError("INPUT_REQUIRED", f"缺少{label}输入")
        return value

    @staticmethod
    def _dedupe(values: list[str]) -> list[str]:
        return list(dict.fromkeys(value for value in values if value))

    @staticmethod
    def _require_public_url(value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise WorkflowNodeExecutionError("ASSET_URL_INVALID", "媒体资产必须是公开 HTTP/HTTPS URL")
        hostname = (parsed.hostname or "").lower()
        if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith((".local", ".internal")):
            raise WorkflowNodeExecutionError("ASSET_URL_INVALID", "媒体资产不能指向本地地址")
        return value
