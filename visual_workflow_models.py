"""Stable wire models for the visual workflow document and validation API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


PortDataType = Literal[
    "prompt.text",
    "image.asset",
    "video.asset",
    "audio.url",
    "image.asset[]",
    "video.asset[]",
]


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float
    y: float


class Viewport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float = 0
    y: float = 0
    zoom: float = Field(default=1, gt=0, le=4)


class PortSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    direction: Literal["input", "output"]
    data_type: PortDataType = Field(alias="dataType")
    required: bool = False
    cardinality: Literal["one", "many"] = "one"
    max_connections: int | None = Field(default=None, alias="maxConnections", ge=1, le=32)


class WorkflowNode(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str = Field(min_length=1, max_length=128)
    # Deliberately kept as str instead of a closed Literal: the server must be
    # able to return a structured UNKNOWN_NODE_KIND error for future clients.
    kind: str = Field(min_length=1, max_length=80)
    definition_version: int = Field(default=1, alias="definitionVersion", ge=1, le=100)
    position: Position
    label: str | None = Field(default=None, max_length=160)
    config: dict[str, Any] = Field(default_factory=dict)
    is_disabled: bool = Field(default=False, alias="isDisabled")


class WorkflowEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str = Field(min_length=1, max_length=128)
    source_node_id: str = Field(alias="sourceNodeId", min_length=1, max_length=128)
    source_port_id: str = Field(alias="sourcePortId", min_length=1, max_length=64)
    target_node_id: str = Field(alias="targetNodeId", min_length=1, max_length=128)
    target_port_id: str = Field(alias="targetPortId", min_length=1, max_length=64)


class WorkflowDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    schema_version: Literal[1] = Field(default=1, alias="schemaVersion")
    workflow_id: str = Field(default="", alias="workflowId", max_length=128)
    revision: int = Field(default=0, ge=0)
    name: str = Field(min_length=1, max_length=160)
    nodes: list[WorkflowNode] = Field(default_factory=list, max_length=200)
    edges: list[WorkflowEdge] = Field(default_factory=list, max_length=500)
    viewport: Viewport = Field(default_factory=Viewport)


class ValidationIssue(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    code: str
    message: str
    node_id: str | None = Field(default=None, alias="nodeId")
    port_id: str | None = Field(default=None, alias="portId")
    edge_id: str | None = Field(default=None, alias="edgeId")

