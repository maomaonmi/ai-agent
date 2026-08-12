import tempfile
import unittest
from pathlib import Path

from code_project_store import CodeProjectStore
from session_memory import SessionStore


class CodeProjectStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "projects.db"
        self.sessions = SessionStore(self.db_path)
        self.projects = CodeProjectStore(self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_published_project_survives_source_session_deletion(self):
        session = self.sessions.create("code", title="3D 地球")
        created = self.projects.create(
            source_session_id=session.session_id,
            title="3D 地球",
            category="education",
            prompt="生成一个 3D 地球",
            cover_image="covers/earth.png",
            vfs={"index.html": "<main>Earth</main>"},
            project_kind="frontend",
            published_run_id="run-1",
        )

        self.sessions.delete(session.session_id)
        restored = self.projects.get(created.project_id)

        self.assertIsNone(restored.source_session_id)
        self.assertEqual(restored.vfs, {"index.html": "<main>Earth</main>"})
        self.assertEqual(restored.prompt, "生成一个 3D 地球")

    def test_deleting_project_does_not_delete_source_session(self):
        session = self.sessions.create("code")
        created = self.projects.create(
            source_session_id=session.session_id,
            title="计算器",
            category="utility",
            prompt="生成计算器",
            cover_image="covers/calculator.png",
            vfs={"index.html": "calculator"},
            project_kind="frontend",
            published_run_id="run-2",
        )

        self.projects.delete(created.project_id)

        self.assertEqual(self.sessions.get(session.session_id).mode, "code")
        self.assertEqual(self.projects.list(), [])

    def test_republishing_source_session_updates_existing_project(self):
        session = self.sessions.create("code")
        created = self.projects.create(
            source_session_id=session.session_id, title="初版", category="web",
            prompt="初版提示词", cover_image="covers/one.png",
            vfs={"index.html": "one"}, project_kind="frontend",
            published_run_id="run-1",
        )

        updated = self.projects.upsert_for_session(
            source_session_id=session.session_id, title="第二版", category="utility",
            prompt="新版提示词", cover_image="covers/two.png",
            vfs={"index.html": "two"}, project_kind="frontend",
            published_run_id="run-2",
        )

        self.assertEqual(updated.project_id, created.project_id)
        self.assertEqual(updated.vfs, {"index.html": "two"})
        self.assertEqual(len(self.projects.list()), 1)


if __name__ == "__main__":
    unittest.main()
