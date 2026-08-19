from __future__ import annotations

from visual_workflow_repository import VisualWorkflowRepository


def test_repository_persists_node_runs_and_replayable_events(tmp_path):
    repository = VisualWorkflowRepository(tmp_path / "workflow.sqlite3")
    workflow = repository.create_workflow("运行记录")
    run = repository.create_run(workflow["id"], revision=1, mode="execute", requested_node_ids=["prompt", "image"])

    created = repository.create_node_runs(run["id"], ["prompt", "image"])
    repository.update_node_run(
        run["id"],
        "prompt",
        status="SUCCEEDED",
        output_artifacts=[{"type": "prompt.text", "value": "雨夜"}],
    )
    sequence = repository.append_event(run["id"], "node_succeeded", node_id="prompt", payload={"progress": 40})

    assert [item["node_id"] for item in created] == ["prompt", "image"]
    assert repository.get_node_runs(workflow["id"], run["id"])[0]["status"] == "SUCCEEDED"
    assert repository.get_node_runs(workflow["id"], run["id"])[0]["output_artifacts"] == [{"type": "prompt.text", "value": "雨夜"}]
    assert repository.list_events(workflow["id"], run["id"])[0]["sequence"] == sequence

