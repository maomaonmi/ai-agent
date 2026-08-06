import tempfile
import unittest
from pathlib import Path

from session_memory import SessionNotFoundError, SessionStore


class SessionStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = SessionStore(Path(self.temp_dir.name) / "sessions.db")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_create_and_list_sessions_are_isolated_by_mode(self):
        standard = self.store.create("standard")
        deep = self.store.create("deep", title="深度会话")

        sessions = self.store.list()

        self.assertEqual({item.session_id for item in sessions}, {
            standard.session_id,
            deep.session_id,
        })
        self.assertEqual(self.store.get(standard.session_id).mode, "standard")
        self.assertEqual(self.store.get(deep.session_id).mode, "deep")

    def test_snapshot_round_trip_preserves_rich_results(self):
        session = self.store.create("distributed_plan")
        snapshot = {
            "messages": [{"role": "user", "content": "规划任务"}],
            "agentTalks": [{"from_agent": "A", "content": "观点"}],
            "planProgress": {
                "phase": "completed",
                "tasks": [{"id": 1, "status": "completed", "result": "完成"}],
            },
        }

        self.store.save_snapshot(session.session_id, snapshot)
        restored = self.store.get_history(session.session_id)

        self.assertEqual(restored["session"]["mode"], "distributed_plan")
        self.assertEqual(restored["snapshot"], snapshot)

    def test_update_title_and_delete_cascades_snapshot(self):
        session = self.store.create("web")
        self.store.save_snapshot(session.session_id, {"messages": []})
        updated = self.store.update_title(session.session_id, "联网资料")
        self.assertEqual(updated.title, "联网资料")

        self.store.delete(session.session_id)

        with self.assertRaises(SessionNotFoundError):
            self.store.get_history(session.session_id)

    def test_clear_removes_all_sessions(self):
        self.store.create("standard")
        self.store.create("agent")

        deleted = self.store.clear()

        self.assertEqual(deleted, 2)
        self.assertEqual(self.store.list(), [])


if __name__ == "__main__":
    unittest.main()
