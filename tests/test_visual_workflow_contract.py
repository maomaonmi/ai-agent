from __future__ import annotations

import pytest

from visual_workflow_models import WorkflowDocument, WorkflowEdge, WorkflowNode
from visual_workflow_registry import get_node_definition, list_node_definitions
from visual_workflow_validator import validate_workflow


def node(node_id: str, kind: str, *, x: float = 0, y: float = 0) -> WorkflowNode:
    return WorkflowNode(id=node_id, kind=kind, definition_version=1, position={"x": x, "y": y}, config={})


def edge(edge_id: str, source: str, source_port: str, target: str, target_port: str) -> WorkflowEdge:
    return WorkflowEdge(
        id=edge_id,
        source_node_id=source,
        source_port_id=source_port,
        target_node_id=target,
        target_port_id=target_port,
    )


def test_registry_exposes_initial_multimodal_node_contracts():
    definitions = list_node_definitions()

    assert {definition.kind for definition in definitions} >= {
        "prompt_input", "image_input", "video_input", "image_generate", "reference_to_video", "preview_output",
    }
    assert get_node_definition("image_to_video").input_port("first_frame").data_type == "image.asset"
    assert get_node_definition("reference_to_video").input_port("references").cardinality == "many"


def test_document_accepts_camel_case_wire_fields_and_round_trips_them():
    document = WorkflowDocument.model_validate({
        "schemaVersion": 1,
        "workflowId": "wf-1",
        "revision": 3,
        "name": "人物转视频",
        "nodes": [{
            "id": "prompt-1",
            "kind": "prompt_input",
            "definitionVersion": 1,
            "position": {"x": 10, "y": 20},
            "config": {"text": "一只猫在雨中奔跑"},
        }],
        "edges": [],
        "viewport": {"x": 0, "y": 0, "zoom": 1},
    })

    assert document.workflow_id == "wf-1"
    assert document.model_dump(by_alias=True)["schemaVersion"] == 1
    assert document.nodes[0].definition_version == 1


def test_validator_allows_same_type_connection_but_rejects_mismatched_types():
    valid = WorkflowDocument(
        workflow_id="wf-1",
        name="valid",
        nodes=[node("prompt", "prompt_input"), node("generate", "image_generate")],
        edges=[edge("e-1", "prompt", "prompt", "generate", "prompt")],
    )
    invalid = valid.model_copy(update={
        "nodes": [node("image", "image_input"), node("generate", "image_generate")],
        "edges": [edge("e-1", "image", "image", "generate", "prompt")],
    })

    assert validate_workflow(valid) == []
    assert any(issue.code == "PORT_TYPE_MISMATCH" for issue in validate_workflow(invalid))


def test_validator_rejects_duplicate_edges_and_cycles():
    document = WorkflowDocument(
        workflow_id="wf-1",
        name="cyclic",
        nodes=[node("a", "prompt_input"), node("b", "prompt_template")],
        edges=[
            edge("e-1", "a", "prompt", "b", "prompt_in"),
            edge("e-1", "a", "prompt", "b", "prompt_in"),
            edge("e-2", "b", "prompt", "a", "prompt"),
        ],
    )

    issues = validate_workflow(document)

    assert any(issue.code == "DUPLICATE_EDGE_ID" for issue in issues)
    assert any(issue.code == "CYCLE_DETECTED" for issue in issues)


def test_required_inputs_are_checked_only_for_execution_validation():
    draft = WorkflowDocument(
        workflow_id="wf-1",
        name="draft",
        nodes=[node("generate", "image_generate")],
        edges=[],
    )

    assert validate_workflow(draft) == []
    assert any(issue.code == "REQUIRED_INPUT_MISSING" for issue in validate_workflow(draft, require_inputs=True))


def test_unknown_node_kind_is_structured_and_does_not_crash_validation():
    document = WorkflowDocument(
        workflow_id="wf-1",
        name="unknown",
        nodes=[node("mystery", "not_a_real_node")],  # type: ignore[arg-type]
        edges=[],
    )

    issues = validate_workflow(document)

    assert issues[0].code == "UNKNOWN_NODE_KIND"
