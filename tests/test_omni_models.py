import pytest
from pydantic import ValidationError

from omni_models import (
    ArtifactCreatedEvent,
    ArtifactModel,
    ArtifactVersionModel,
    ImageBatchSourceRef,
    MessageArtifactLinkModel,
    OmniTurnContext,
    ProjectCreateRequest,
    RuntimeCapabilities,
)


def test_runtime_capabilities_allow_web_search_and_deep_thinking_together():
    context = OmniTurnContext.model_validate({
        "preferredCapability": "auto",
        "runtimeCapabilities": {
            "webSearch": "on",
            "deepThinking": "on",
        },
        "mentionedArtifacts": [],
        "attachments": [],
    })

    assert context.runtime_capabilities == RuntimeCapabilities(
        web_search="on",
        deep_thinking="on",
    )


def test_message_artifact_link_requires_an_exact_version():
    with pytest.raises(ValidationError):
        MessageArtifactLinkModel.model_validate({
            "id": "link-1",
            "conversationId": "session-1",
            "messageId": "message-1",
            "artifactId": "artifact-1",
            "relation": "created",
            "displayOrder": 0,
            "createdAt": "2026-08-23T00:00:00Z",
        })


def test_artifact_created_event_serializes_with_camel_case_contract():
    artifact = ArtifactModel.model_validate({
        "id": "artifact-1",
        "projectId": None,
        "originConversationId": "session-1",
        "kind": "image",
        "title": "新春海报",
        "summary": "一组新春主题海报",
        "status": "ready",
        "currentVersionId": "version-1",
        "metadata": {},
        "createdAt": "2026-08-23T00:00:00Z",
        "updatedAt": "2026-08-23T00:00:00Z",
    })
    version = ArtifactVersionModel(
        id="version-1",
        artifact_id="artifact-1",
        version_number=1,
        status="ready",
        source_ref=ImageBatchSourceRef(
            type="image_batch",
            image_batch_id="batch-1",
            image_asset_ids=["asset-1"],
        ),
        summary="第一轮生图",
        created_by_message_id="message-1",
        created_at="2026-08-23T00:00:00Z",
    )
    event = ArtifactCreatedEvent(
        type="artifact.created",
        run_id="run-1",
        artifact=artifact,
        version=version,
    )

    payload = event.model_dump(mode="json", by_alias=True)
    assert payload["artifact"]["currentVersionId"] == "version-1"
    assert payload["version"]["sourceRef"]["imageBatchId"] == "batch-1"


def test_contracts_reject_unknown_fields_at_the_api_boundary():
    with pytest.raises(ValidationError):
        ProjectCreateRequest.model_validate({
            "name": "项目 A",
            "unexpected": "must not leak into storage",
        })
