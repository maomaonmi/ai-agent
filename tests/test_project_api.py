import tempfile
import unittest
from pathlib import Path

import main
from fastapi.testclient import TestClient

from project_store import ProjectStore
from session_memory import SessionStore


class ProjectApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        database = Path(self.temp_dir.name) / "projects-api.db"
        self.original_session_store = main.session_store
        self.original_project_store = main.project_store
        main.session_store = SessionStore(database)
        main.project_store = ProjectStore(database)
        self.client = TestClient(main.app)

    def tearDown(self):
        main.session_store = self.original_session_store
        main.project_store = self.original_project_store
        self.temp_dir.cleanup()

    def test_project_crud_and_conversation_assignment(self):
        project_response = self.client.post(
            "/api/projects",
            json={"name": "新能源汽车发布", "description": "发布项目"},
        )
        self.assertEqual(project_response.status_code, 201)
        project = project_response.json()
        self.assertEqual(project["name"], "新能源汽车发布")
        self.assertIn("createdAt", project)

        session = self.client.post(
            "/api/sessions",
            json={"mode": "standard", "title": "市场研究"},
        ).json()
        assigned = self.client.post(
            f"/api/projects/{project['id']}/conversations/{session['session_id']}"
        )
        self.assertEqual(assigned.status_code, 200)
        self.assertEqual(assigned.json()["projectId"], project["id"])

        listed = self.client.get("/api/projects").json()
        self.assertEqual(listed["count"], 1)
        self.assertEqual(listed["projects"][0]["conversationIds"], [session["session_id"]])

        removed = self.client.delete(
            f"/api/projects/{project['id']}/conversations/{session['session_id']}"
        )
        self.assertEqual(removed.status_code, 200)
        self.assertIsNone(removed.json()["projectId"])

    def test_unknown_project_returns_404(self):
        response = self.client.patch(
            "/api/projects/missing-project",
            json={"name": "不会成功"},
        )
        self.assertEqual(response.status_code, 404)

    def test_delete_project_keeps_assigned_session(self):
        project = self.client.post("/api/projects", json={"name": "临时项目"}).json()
        session = self.client.post("/api/sessions", json={"mode": "standard"}).json()
        self.client.post(
            f"/api/projects/{project['id']}/conversations/{session['session_id']}"
        )

        deleted = self.client.delete(f"/api/projects/{project['id']}")

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(
            self.client.get(f"/api/sessions/{session['session_id']}/history").status_code,
            200,
        )


if __name__ == "__main__":
    unittest.main()
