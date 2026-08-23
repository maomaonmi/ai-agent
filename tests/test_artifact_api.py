import tempfile
import unittest
from pathlib import Path

import main
from fastapi.testclient import TestClient

from artifact_store import ArtifactStore
from project_store import ProjectStore
from session_memory import SessionStore


class ArtifactApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        database = Path(self.temp_dir.name) / "artifact-api.db"
        self.original_session_store = main.session_store
        self.original_project_store = main.project_store
        self.original_artifact_store = main.artifact_store
        main.session_store = SessionStore(database)
        main.project_store = ProjectStore(database)
        main.artifact_store = ArtifactStore(database)
        self.client = TestClient(main.app)

    def tearDown(self):
        main.session_store = self.original_session_store
        main.project_store = self.original_project_store
        main.artifact_store = self.original_artifact_store
        self.temp_dir.cleanup()

    def test_reads_conversation_artifacts_and_exact_historical_version(self):
        session = main.session_store.create("standard")
        artifact, first, _ = main.artifact_store.create_with_version(
            conversation_id=session.session_id,
            message_id="message-1",
            kind="image",
            title="新春海报",
            summary="第一版",
            source_ref={"type": "image_batch", "imageBatchId": "batch-1", "imageAssetIds": ["asset-1"]},
        )
        second, _ = main.artifact_store.add_version(
            artifact_id=artifact.id,
            conversation_id=session.session_id,
            message_id="message-2",
            summary="第二版",
            source_ref={"type": "image_batch", "imageBatchId": "batch-2", "imageAssetIds": ["asset-2"]},
        )

        listed = self.client.get(f"/api/conversations/{session.session_id}/artifacts")
        historical = self.client.get(f"/api/artifacts/{artifact.id}/versions/{first.id}")
        versions = self.client.get(f"/api/artifacts/{artifact.id}/versions")

        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["artifacts"][0]["currentVersionId"], second.id)
        self.assertEqual(historical.json()["id"], first.id)
        self.assertEqual([item["id"] for item in versions.json()["versions"]], [second.id, first.id])

    def test_reads_message_links_with_exact_version_ids(self):
        session = main.session_store.create("standard")
        artifact, version, _ = main.artifact_store.create_with_version(
            conversation_id=session.session_id,
            message_id="message-1",
            kind="document",
            title="策划案",
            summary="初稿",
            source_ref={"type": "writing_document", "documentId": "doc-1", "revision": 1},
        )

        response = self.client.get("/api/messages/message-1/artifacts")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["links"][0]["artifactId"], artifact.id)
        self.assertEqual(response.json()["links"][0]["versionId"], version.id)

    def test_unknown_artifact_returns_404(self):
        self.assertEqual(self.client.get("/api/artifacts/missing").status_code, 404)

    def test_project_context_is_summary_only_and_cross_project_reference_keeps_owner(self):
        source_session = main.session_store.create("standard")
        target_session = main.session_store.create("standard")
        source_project = main.project_store.create("品牌发布", "准备新品发布")
        target_project = main.project_store.create("海外传播")
        main.project_store.assign_conversation(source_project.id, source_session.session_id)
        main.project_store.assign_conversation(target_project.id, target_session.session_id)
        artifact, version, _ = main.artifact_store.create_with_version(
            conversation_id=source_session.session_id, message_id="source-message", kind="document",
            title="发布文案", summary="面向年轻用户的发布文案",
            source_ref={"type": "writing_document", "documentId": "launch-doc", "revision": 1},
            payload={"content": "不应被摘要检索接口自动注入的完整正文"},
        )
        context = self.client.get(f"/api/conversations/{target_session.session_id}/omni-context?query=发布")
        self.assertEqual(context.status_code, 200)
        candidate = context.json()["candidateArtifactSummaries"][0]
        self.assertEqual(candidate["artifactId"], artifact.id)
        self.assertNotIn("payload", candidate)
        referenced = self.client.post(
            f"/api/conversations/{target_session.session_id}/artifact-references",
            json={"messageId": "target-message", "artifactId": artifact.id, "versionId": version.id},
        )
        self.assertEqual(referenced.status_code, 201)
        self.assertTrue(referenced.json()["fromOtherProject"])
        self.assertEqual(referenced.json()["artifact"]["projectId"], source_project.id)
        self.assertEqual(main.artifact_store.get(artifact.id).project_id, source_project.id)

    def test_creates_document_artifact_with_immutable_preview_payload(self):
        session = main.session_store.create("standard")
        response = self.client.post(
            f"/api/conversations/{session.session_id}/artifacts",
            json={
                "messageId": "message-writing-1",
                "kind": "document",
                "title": "产品发布稿",
                "summary": "一篇产品发布稿",
                "sourceRef": {"type": "writing_document", "documentId": "doc-writing-1", "revision": 1},
                "payload": {"format": "markdown", "content": "# 产品发布\n\n正文"},
                "metadata": {"adapter": "writing"},
            },
        )

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["version"]["payload"]["content"], "# 产品发布\n\n正文")
        self.assertEqual(body["link"]["messageId"], "message-writing-1")

        updated = self.client.post(
            f"/api/artifacts/{body['artifact']['id']}/versions",
            json={
                "conversationId": session.session_id,
                "messageId": "message-writing-2",
                "summary": "第二版",
                "sourceRef": {"type": "writing_document", "documentId": "doc-writing-1", "revision": 2},
                "payload": {"format": "markdown", "content": "# 产品发布\n\n第二版正文"},
            },
        )
        self.assertEqual(updated.status_code, 201)
        self.assertEqual(updated.json()["version"]["versionNumber"], 2)
        self.assertEqual(updated.json()["link"]["messageId"], "message-writing-2")


if __name__ == "__main__":
    unittest.main()
