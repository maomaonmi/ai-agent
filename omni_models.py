"""Strict API contracts for projects, artifacts, versions, and omni runs."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


class OmniContractModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=_to_camel,
        extra="forbid",
        populate_by_name=True,
        validate_assignment=True,
    )


Identifier = Annotated[
    str,
    Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$"),
]
ArtifactKind = Literal[
    "image",
    "video",
    "document",
    "thesis",
    "research_report",
    "presentation",
]
ArtifactStatus = Literal[
    "draft",
    "queued",
    "generating",
    "ready",
    "failed",
    "archived",
]
CapabilityMode = Literal["off", "auto", "on"]


class ProjectCreateRequest(OmniContractModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    description: Annotated[str, Field(max_length=2_000)] | None = None


class ProjectUpdateRequest(OmniContractModel):
    name: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    description: Annotated[str, Field(max_length=2_000)] | None = None
    is_archived: bool | None = None


class ProjectModel(OmniContractModel):
    id: Identifier
    name: Annotated[str, Field(min_length=1, max_length=80)]
    description: Annotated[str, Field(max_length=2_000)] | None = None
    summary: Annotated[str, Field(max_length=20_000)] | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None


class ArtifactModel(OmniContractModel):
    id: Identifier
    project_id: Identifier | None
    origin_conversation_id: Identifier
    kind: ArtifactKind
    title: Annotated[str, Field(min_length=1, max_length=200)]
    summary: Annotated[str, Field(max_length=20_000)]
    status: ArtifactStatus
    current_version_id: Identifier
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ImageBatchSourceRef(OmniContractModel):
    type: Literal["image_batch"]
    image_batch_id: Identifier
    image_asset_ids: Annotated[list[Identifier], Field(min_length=1, max_length=16)]


class VideoTaskSourceRef(OmniContractModel):
    type: Literal["video_task"]
    video_task_id: Identifier


class WritingDocumentSourceRef(OmniContractModel):
    type: Literal["writing_document"]
    document_id: Identifier
    revision: Annotated[int, Field(ge=1)]


class ResearchReportSourceRef(OmniContractModel):
    type: Literal["research_report"]
    report_id: Identifier
    revision: Annotated[int, Field(ge=1)]


class PresentationSourceRef(OmniContractModel):
    type: Literal["presentation"]
    presentation_id: Identifier
    revision: Annotated[int, Field(ge=1)]
    run_id: Identifier | None = None


ArtifactSourceRef = Annotated[
    Union[
        ImageBatchSourceRef,
        VideoTaskSourceRef,
        WritingDocumentSourceRef,
        ResearchReportSourceRef,
        PresentationSourceRef,
    ],
    Field(discriminator="type"),
]


class ArtifactVersionModel(OmniContractModel):
    id: Identifier
    artifact_id: Identifier
    version_number: Annotated[int, Field(ge=1)]
    parent_version_id: Identifier | None = None
    status: Literal["draft", "generating", "ready", "failed"]
    source_ref: ArtifactSourceRef
    summary: Annotated[str, Field(max_length=20_000)]
    created_by_message_id: Identifier | None = None
    created_at: datetime


class MessageArtifactLinkModel(OmniContractModel):
    id: Identifier
    conversation_id: Identifier
    message_id: Identifier
    artifact_id: Identifier
    version_id: Identifier
    relation: Literal["created", "updated", "referenced", "derived"]
    display_order: Annotated[int, Field(ge=0)]
    created_at: datetime


class ArtifactMention(OmniContractModel):
    artifact_id: Identifier
    version_id: Identifier | None = None


class ArtifactSummary(OmniContractModel):
    artifact_id: Identifier
    version_id: Identifier
    kind: ArtifactKind
    title: Annotated[str, Field(min_length=1, max_length=200)]
    summary: Annotated[str, Field(max_length=20_000)]
    project_id: Identifier | None


class RuntimeCapabilities(OmniContractModel):
    web_search: CapabilityMode
    deep_thinking: CapabilityMode


class OmniTurnContext(OmniContractModel):
    preferred_capability: ArtifactKind | Literal["auto"] = "auto"
    runtime_capabilities: RuntimeCapabilities
    active_artifact: ArtifactMention | None = None
    mentioned_artifacts: Annotated[list[ArtifactMention], Field(max_length=50)] = Field(default_factory=list)
    attachments: Annotated[list[dict[str, Any]], Field(max_length=20)] = Field(default_factory=list)
    project_summary: Annotated[str, Field(max_length=20_000)] | None = None
    candidate_artifact_summaries: Annotated[list[ArtifactSummary], Field(max_length=50)] = Field(default_factory=list)


class OmniEventBase(OmniContractModel):
    run_id: Identifier


class ArtifactCreatedEvent(OmniEventBase):
    type: Literal["artifact.created"]
    artifact: ArtifactModel
    version: ArtifactVersionModel


class ArtifactProgressEvent(OmniEventBase):
    type: Literal["artifact.progress"]
    artifact_id: Identifier
    version_id: Identifier
    progress: Annotated[float, Field(ge=0, le=1)]
    phase: Annotated[str, Field(min_length=1, max_length=200)]


class ArtifactReadyEvent(OmniEventBase):
    type: Literal["artifact.ready"]
    artifact_id: Identifier
    version_id: Identifier


class ApiErrorDetail(OmniContractModel):
    code: Annotated[str, Field(min_length=1, max_length=100)]
    message: Annotated[str, Field(min_length=1, max_length=2_000)]
    details: Any | None = None


class ArtifactFailedEvent(OmniEventBase):
    type: Literal["artifact.failed"]
    artifact_id: Identifier
    version_id: Identifier
    error: ApiErrorDetail


class MessageArtifactLinkedEvent(OmniEventBase):
    type: Literal["message.artifact_linked"]
    link: MessageArtifactLinkModel


OmniArtifactEvent = Annotated[
    Union[
        ArtifactCreatedEvent,
        ArtifactProgressEvent,
        ArtifactReadyEvent,
        ArtifactFailedEvent,
        MessageArtifactLinkedEvent,
    ],
    Field(discriminator="type"),
]
