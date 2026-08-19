"""Server-authoritative registry of the first visual workflow node set."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from visual_workflow_models import PortSchema, PortDataType


@dataclass(frozen=True)
class NodeDefinition:
    kind: str
    version: int
    category: str
    inputs: tuple[PortSchema, ...]
    outputs: tuple[PortSchema, ...]
    config_schema: dict[str, Any]
    cache_policy: str
    executor_key: str

    def input_port(self, port_id: str) -> PortSchema:
        for port in self.inputs:
            if port.id == port_id:
                return port
        raise KeyError(port_id)

    def output_port(self, port_id: str) -> PortSchema:
        for port in self.outputs:
            if port.id == port_id:
                return port
        raise KeyError(port_id)


def _port(
    port_id: str,
    direction: str,
    data_type: PortDataType,
    *,
    required: bool = False,
    # Every port supports fan-in/fan-out. `required` only means that at least
    # one connection is needed for execution; it is not a single-edge limit.
    cardinality: str = "many",
    max_connections: int | None = None,
) -> PortSchema:
    return PortSchema(
        id=port_id,
        direction=direction,
        dataType=data_type,
        required=required,
        cardinality=cardinality,
        maxConnections=max_connections,
    )


def _definition(
    kind: str,
    category: str,
    inputs: tuple[PortSchema, ...] = (),
    outputs: tuple[PortSchema, ...] = (),
    *,
    cache_policy: str = "content",
    executor_key: str | None = None,
) -> NodeDefinition:
    return NodeDefinition(
        kind=kind,
        version=1,
        category=category,
        inputs=inputs,
        outputs=outputs,
        config_schema={"type": "object", "additionalProperties": True},
        cache_policy=cache_policy,
        executor_key=executor_key or kind,
    )


_NODE_DEFINITIONS: tuple[NodeDefinition, ...] = (
    _definition("prompt_input", "input", outputs=(_port("prompt", "output", "prompt.text"),), cache_policy="never"),
    _definition("image_input", "input", outputs=(_port("image", "output", "image.asset"),), cache_policy="never"),
    _definition("video_input", "input", outputs=(_port("video", "output", "video.asset"),), cache_policy="never"),
    _definition("audio_url_input", "input", outputs=(_port("audio", "output", "audio.url"),), cache_policy="never"),
    _definition(
        "vision_to_prompt", "transform",
        inputs=(_port("image", "input", "image.asset", required=True),),
        outputs=(_port("prompt", "output", "prompt.text"),),
        executor_key="vision_to_prompt",
    ),
    _definition(
        "prompt_template", "transform",
        inputs=(_port("prompt_in", "input", "prompt.text", cardinality="many"),),
        outputs=(_port("prompt", "output", "prompt.text"),),
        executor_key="prompt_template",
    ),
    _definition(
        "image_generate", "image",
        inputs=(
            _port("prompt", "input", "prompt.text", required=True),
            _port("reference_image", "input", "image.asset"),
            _port("references", "input", "image.asset", cardinality="many"),
        ),
        outputs=(_port("image", "output", "image.asset"),),
        executor_key="image_generate",
    ),
    _definition(
        "image_edit", "image",
        inputs=(
            _port("prompt", "input", "prompt.text", required=True),
            _port("reference_image", "input", "image.asset"),
            _port("references", "input", "image.asset", cardinality="many"),
        ),
        outputs=(_port("image", "output", "image.asset"),),
        executor_key="image_edit",
    ),
    _definition(
        "image_compare", "output",
        inputs=(_port("images", "input", "image.asset", cardinality="many"),),
        outputs=(_port("images", "output", "image.asset[]"),),
        cache_policy="never",
        executor_key="image_compare",
    ),
    _definition(
        "text_to_video", "video",
        inputs=(
            _port("prompt", "input", "prompt.text", required=True),
            _port("references", "input", "media.asset", cardinality="many"),
        ),
        outputs=(_port("video", "output", "video.asset"),),
        executor_key="text_to_video",
    ),
    _definition(
        "image_to_video", "video",
        inputs=(
            _port("prompt", "input", "prompt.text", required=True),
            _port("first_frame", "input", "image.asset", required=True),
            _port("audio", "input", "audio.url"),
        ),
        outputs=(_port("video", "output", "video.asset"),),
        executor_key="image_to_video",
    ),
    _definition(
        "start_end_video", "video",
        inputs=(
            _port("prompt", "input", "prompt.text", required=True),
            _port("first_frame", "input", "image.asset", required=True),
            _port("last_frame", "input", "image.asset", required=True),
        ),
        outputs=(_port("video", "output", "video.asset"),),
        executor_key="start_end_video",
    ),
    _definition(
        "reference_to_video", "video",
        inputs=(
            _port("prompt", "input", "prompt.text", required=True),
            _port("references", "input", "media.asset", required=True, cardinality="many"),
        ),
        outputs=(_port("video", "output", "video.asset"),),
        executor_key="reference_to_video",
    ),
    _definition(
        "preview_output", "output",
        inputs=(
            _port("image", "input", "image.asset"),
            _port("video", "input", "video.asset"),
        ),
        outputs=(),
        cache_policy="never",
        executor_key="preview_output",
    ),
    _definition(
        "gallery_output", "output",
        inputs=(
            _port("images", "input", "image.asset[]", cardinality="many"),
            _port("videos", "input", "video.asset[]", cardinality="many"),
        ),
        outputs=(),
        cache_policy="never",
        executor_key="gallery_output",
    ),
)

_BY_KIND = {definition.kind: definition for definition in _NODE_DEFINITIONS}


def list_node_definitions() -> tuple[NodeDefinition, ...]:
    return _NODE_DEFINITIONS


def get_node_definition(kind: str) -> NodeDefinition:
    try:
        return _BY_KIND[kind]
    except KeyError as exc:
        raise KeyError(f"unknown workflow node kind: {kind}") from exc
