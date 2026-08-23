import pytest

from artifact_store import ArtifactNotFoundError, ArtifactStore, ArtifactVersionNotFoundError
from project_store import ProjectStore
from session_memory import SessionStore


@pytest.fixture()
def stores(tmp_path):
    database = tmp_path / "artifacts.db"
    sessions = SessionStore(database)
    ProjectStore(database)
    artifacts = ArtifactStore(database)
    return sessions, artifacts


def test_create_artifact_version_and_message_link_atomically(stores):
    sessions, artifacts = stores
    session = sessions.create("standard", "海报创作")

    artifact, version, link = artifacts.create_with_version(
        conversation_id=session.session_id,
        message_id="message-1",
        kind="image",
        title="新春海报",
        summary="第一轮海报",
        source_ref={"type": "image_batch", "imageBatchId": "batch-1", "imageAssetIds": ["asset-1"]},
        relation="created",
    )

    assert artifact.current_version_id == version.id
    assert version.version_number == 1
    assert link.artifact_id == artifact.id
    assert link.version_id == version.id


def test_new_version_preserves_historical_message_link(stores):
    sessions, artifacts = stores
    session = sessions.create("standard")
    artifact, first_version, first_link = artifacts.create_with_version(
        conversation_id=session.session_id,
        message_id="message-1",
        kind="document",
        title="策划案",
        summary="初稿",
        source_ref={"type": "writing_document", "documentId": "doc-1", "revision": 1},
        payload={"format": "markdown", "content": "初稿正文"},
    )

    second_version, second_link = artifacts.add_version(
        artifact_id=artifact.id,
        conversation_id=session.session_id,
        message_id="message-2",
        summary="蓝色主题修订稿",
        source_ref={"type": "writing_document", "documentId": "doc-1", "revision": 2},
        payload={"format": "markdown", "content": "第二版正文"},
        relation="updated",
    )

    assert artifacts.get(artifact.id).current_version_id == second_version.id
    assert artifacts.get_message_links("message-1")[0].version_id == first_version.id
    assert artifacts.get_message_links("message-2")[0].version_id == second_link.version_id
    assert [item.version_number for item in artifacts.list_versions(artifact.id)] == [2, 1]
    assert second_version.parent_version_id == first_version.id
    assert first_link.version_id != second_link.version_id
    assert artifacts.get_version(first_version.id).payload["content"] == "初稿正文"
    assert artifacts.get_version(second_version.id).payload["content"] == "第二版正文"


def test_conversation_artifacts_are_deduplicated_when_referenced_by_multiple_messages(stores):
    sessions, artifacts = stores
    session = sessions.create("standard")
    artifact, version, _ = artifacts.create_with_version(
        conversation_id=session.session_id,
        message_id="message-1",
        kind="research_report",
        title="行业研究",
        summary="研究摘要",
        source_ref={"type": "research_report", "reportId": "report-1", "revision": 1},
    )
    artifacts.link_message(
        conversation_id=session.session_id,
        message_id="message-2",
        artifact_id=artifact.id,
        version_id=version.id,
        relation="referenced",
    )

    assert [item.id for item in artifacts.list_for_conversation(session.session_id)] == [artifact.id]
    assert [item.message_id for item in artifacts.list_links_for_conversation(session.session_id)] == ["message-1", "message-2"]


def test_cross_artifact_relation_keeps_source_version(stores):
    sessions, artifacts = stores
    session = sessions.create("standard")
    source, source_version, _ = artifacts.create_with_version(
        conversation_id=session.session_id,
        message_id="message-1",
        kind="image",
        title="首帧",
        summary="视频首帧",
        source_ref={"type": "image_batch", "imageBatchId": "batch-1", "imageAssetIds": ["asset-1"]},
    )
    target, target_version, _ = artifacts.create_with_version(
        conversation_id=session.session_id,
        message_id="message-2",
        kind="video",
        title="宣传视频",
        summary="由首帧生成",
        source_ref={"type": "video_task", "videoTaskId": "task-1"},
    )

    relation = artifacts.add_relation(
        source_artifact_id=source.id,
        source_version_id=source_version.id,
        target_artifact_id=target.id,
        target_version_id=target_version.id,
        relation="derived_from",
    )

    assert relation.source_version_id == source_version.id
    assert artifacts.list_relations(target.id)[0].id == relation.id


def test_linking_an_unknown_artifact_is_rejected(stores):
    sessions, artifacts = stores
    session = sessions.create("standard")

    with pytest.raises(ArtifactNotFoundError):
        artifacts.link_message(
            conversation_id=session.session_id,
            message_id="message-1",
            artifact_id="missing-artifact",
            version_id="missing-version",
            relation="referenced",
        )


def test_relation_rejects_a_version_owned_by_another_artifact(stores):
    sessions, artifacts = stores
    session = sessions.create("standard")
    source, _, _ = artifacts.create_with_version(
        conversation_id=session.session_id, message_id="message-1", kind="image",
        title="来源", summary="来源", source_ref={"type": "image_batch", "imageBatchId": "b1", "imageAssetIds": ["a1"]},
    )
    target, target_version, _ = artifacts.create_with_version(
        conversation_id=session.session_id, message_id="message-2", kind="video",
        title="目标", summary="目标", source_ref={"type": "video_task", "videoTaskId": "t1"},
    )

    with pytest.raises(ArtifactVersionNotFoundError):
        artifacts.add_relation(
            source_artifact_id=source.id,
            source_version_id=target_version.id,
            target_artifact_id=target.id,
            target_version_id=target_version.id,
            relation="derived_from",
        )
