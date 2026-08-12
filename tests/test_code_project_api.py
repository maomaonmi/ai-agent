import tempfile
import unittest
from pathlib import Path

import main
from fastapi.testclient import TestClient

from code_project_store import CodeProjectStore
from session_memory import SessionStore


class CodeProjectApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_session_store = main.session_store
        self.original_project_store = main.code_project_store
        db_path = Path(self.temp_dir.name) / "api.db"
        main.session_store = SessionStore(db_path)
        main.code_project_store = CodeProjectStore(db_path)
        self.client = TestClient(main.app)

    def tearDown(self):
        main.session_store = self.original_session_store
        main.code_project_store = self.original_project_store
        self.temp_dir.cleanup()

    def test_publish_list_detail_and_delete_contract(self):
        session = main.session_store.create("code")
        response = self.client.post("/api/code-projects", json={
            "source_session_id": session.session_id,
            "title": "3D 地球",
            "category": "education",
            "prompt": "生成一个 3D 地球",
            "cover_image": "covers/earth.png",
            "vfs": {"index.html": "<main>Earth</main>"},
            "project_kind": "frontend",
            "published_run_id": "run-1",
        })
        self.assertEqual(response.status_code, 201)
        project_id = response.json()["project_id"]

        listing = self.client.get("/api/code-projects?category=education")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()["count"], 1)
        self.assertNotIn("vfs", listing.json()["projects"][0])

        detail = self.client.get(f"/api/code-projects/{project_id}")
        self.assertEqual(detail.json()["vfs"], {"index.html": "<main>Earth</main>"})

        self.client.delete(f"/api/sessions/{session.session_id}")
        self.assertIsNone(self.client.get(f"/api/code-projects/{project_id}").json()["source_session_id"])

        deleted = self.client.delete(f"/api/code-projects/{project_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get("/api/code-projects").json()["count"], 0)


if __name__ == "__main__":
    unittest.main()

