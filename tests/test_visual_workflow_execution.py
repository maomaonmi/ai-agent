from __future__ import annotations

import pytest

from visual_workflow_execution import WorkflowCompileError, compile_workflow
from visual_workflow_models import Position, WorkflowDocument, WorkflowEdge, WorkflowNode


def node(node_id: str, kind: str = "prompt_input") -> WorkflowNode:
    return WorkflowNode(id=node_id, kind=kind, position=Position(x=0, y=0))


def edge(edge_id: str, source: str, source_port: str, target: str, target_port: str) -> WorkflowEdge:
    return WorkflowEdge(
        id=edge_id,
        sourceNodeId=source,
        sourcePortId=source_port,
        targetNodeId=target,
        targetPortId=target_port,
    )


def test_compile_returns_stable_parallel_batches_for_fan_out():
    document = WorkflowDocument(
        workflowId="wf",
        revision=3,
        name="fan-out",
        nodes=[node("prompt"), node("video-a", "text_to_video"), node("video-b", "text_to_video")],
        edges=[
            edge("e-a", "prompt", "prompt", "video-a", "prompt"),
            edge("e-b", "prompt", "prompt", "video-b", "prompt"),
        ],
    )

    plan = compile_workflow(document)

    assert plan.batches == (("prompt",), ("video-a", "video-b"))
    assert plan.predecessors["video-a"] == ("prompt",)
    assert plan.successors["prompt"] == ("video-a", "video-b")


def test_compile_requested_target_includes_only_its_ancestors():
    document = WorkflowDocument(
        workflowId="wf",
        revision=1,
        name="subgraph",
        nodes=[node("prompt"), node("video", "text_to_video"), node("preview", "preview_output"), node("unused")],
        edges=[
            edge("e-1", "prompt", "prompt", "video", "prompt"),
            edge("e-2", "video", "video", "preview", "video"),
        ],
    )

    plan = compile_workflow(document, requested_node_ids=["preview"])

    assert plan.node_ids == ("prompt", "video", "preview")
    assert plan.batches == (("prompt",), ("video",), ("preview",))


def test_compile_rejects_cycles_before_any_execution_plan_is_created():
    document = WorkflowDocument(
        workflowId="wf",
        revision=1,
        name="cycle",
        nodes=[node("a", "prompt_template"), node("b", "prompt_template")],
        edges=[
            edge("e-a", "a", "prompt", "b", "prompt_in"),
            edge("e-b", "b", "prompt", "a", "prompt_in"),
        ],
    )

    with pytest.raises(WorkflowCompileError) as caught:
        compile_workflow(document)

    assert any(issue.code == "CYCLE_DETECTED" for issue in caught.value.issues)
