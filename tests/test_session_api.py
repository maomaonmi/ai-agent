import tempfile
import unittest
from pathlib import Path

import main
from fastapi.testclient import TestClient

from session_memory import SessionStore


class SessionApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_store = main.session_store
        main.session_store = SessionStore(Path(self.temp_dir.name) / "api.db")
        self.client = TestClient(main.app)

    def tearDown(self):
        main.session_store = self.original_store
        self.temp_dir.cleanup()

    def test_session_crud_and_history_contract(self):
        created_response = self.client.post(
            "/api/sessions", json={"mode": "agent"}
        )
        self.assertEqual(created_response.status_code, 201)
        created = created_response.json()

        snapshot = {
            "messages": [{"role": "user", "content": "讨论一下光速"}],
            "agentTalks": [{"from_agent": "物理学家", "content": "先看定义"}],
        }
        saved_response = self.client.put(
            f"/api/sessions/{created['session_id']}/history",
            json={"snapshot": snapshot, "generate_title": False},
        )
        self.assertEqual(saved_response.status_code, 200)

        history = self.client.get(
            f"/api/sessions/{created['session_id']}/history"
        ).json()
        self.assertEqual(history["session"]["mode"], "agent")
        self.assertEqual(history["snapshot"], snapshot)

        sessions = self.client.get("/api/sessions").json()
        self.assertEqual(sessions["count"], 1)
        self.assertEqual(sessions["sessions"][0]["session_id"], created["session_id"])

        deleted_response = self.client.delete(
            f"/api/sessions/{created['session_id']}"
        )
        self.assertEqual(deleted_response.status_code, 200)
        self.assertEqual(self.client.get("/api/sessions").json()["count"], 0)

    def test_history_for_unknown_session_returns_404(self):
        response = self.client.get(
            "/api/sessions/00000000-0000-0000-0000-000000000000/history"
        )
        self.assertEqual(response.status_code, 404)

    def test_code_mode_session_can_be_created_and_restored(self):
        created_response = self.client.post(
            "/api/sessions",
            json={"mode": "code"},
        )

        self.assertEqual(created_response.status_code, 201)
        created = created_response.json()
        self.assertEqual(created["mode"], "code")

        history_response = self.client.get(
            f"/api/sessions/{created['session_id']}/history"
        )
        self.assertEqual(history_response.status_code, 200)
        self.assertEqual(
            history_response.json()["session"]["mode"],
            "code",
        )

    def test_chat_request_accepts_optional_session_id(self):
        request = main.ChatRequest(
            message="hello",
            mode="standard",
            session_id="00000000-0000-0000-0000-000000000000",
        )
        self.assertEqual(
            request.session_id, "00000000-0000-0000-0000-000000000000"
        )


if __name__ == "__main__":
    unittest.main()
