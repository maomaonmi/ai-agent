import sqlite3

import pytest

from project_store import ProjectNotFoundError, ProjectStore
from session_memory import SessionStore


@pytest.fixture()
def stores(tmp_path):
    database = tmp_path / "projects.db"
    sessions = SessionStore(database)
    projects = ProjectStore(database)
    return sessions, projects, database


def test_create_and_list_projects_newest_first(stores):
    _, projects, _ = stores
    first = projects.create("项目 A")
    second = projects.create("项目 B", "第二个项目")

    listed = projects.list()

    assert {item.id for item in listed} == {first.id, second.id}
    assert listed[0].updated_at >= listed[1].updated_at
    assert second.description == "第二个项目"


def test_a_session_can_move_between_projects_without_copying_its_snapshot(stores):
    sessions, projects, _ = stores
    session = sessions.create("standard", "市场研究")
    sessions.save_snapshot(session.session_id, {"messages": [{"role": "user", "content": "研究主题"}]})
    project_a = projects.create("项目 A")
    project_b = projects.create("项目 B")

    projects.assign_conversation(project_a.id, session.session_id)
    projects.assign_conversation(project_b.id, session.session_id)

    assert projects.get_conversation_project_id(session.session_id) == project_b.id
    assert sessions.get_history(session.session_id)["snapshot"]["messages"][0]["content"] == "研究主题"


def test_removing_a_session_from_a_project_keeps_the_session(stores):
    sessions, projects, _ = stores
    session = sessions.create("standard", "独立对话")
    project = projects.create("项目")
    projects.assign_conversation(project.id, session.session_id)

    projects.remove_conversation(session.session_id)

    assert projects.get_conversation_project_id(session.session_id) is None
    assert sessions.get(session.session_id).title == "独立对话"


def test_deleting_a_project_unassigns_sessions_instead_of_deleting_them(stores):
    sessions, projects, database = stores
    session = sessions.create("standard", "需要保留")
    project = projects.create("临时项目")
    projects.assign_conversation(project.id, session.session_id)

    projects.delete(project.id)

    assert projects.get_conversation_project_id(session.session_id) is None
    assert sessions.get(session.session_id).title == "需要保留"
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1


def test_assigning_to_an_unknown_project_is_rejected(stores):
    sessions, projects, _ = stores
    session = sessions.create("standard")

    with pytest.raises(ProjectNotFoundError):
        projects.assign_conversation("missing-project", session.session_id)
