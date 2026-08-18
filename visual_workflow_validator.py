"""Authoritative graph and port validation for visual workflows."""

from __future__ import annotations

from graphlib import CycleError, TopologicalSorter

from visual_workflow_models import ValidationIssue, WorkflowDocument
from visual_workflow_registry import NodeDefinition, get_node_definition


def validate_workflow(document: WorkflowDocument, *, require_inputs: bool = False) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    nodes_by_id: dict[str, object] = {}
    definitions: dict[str, NodeDefinition] = {}

    for node in document.nodes:
        if node.id in nodes_by_id:
            issues.append(ValidationIssue(code="DUPLICATE_NODE_ID", message="节点 ID 必须唯一", nodeId=node.id))
        nodes_by_id[node.id] = node
        try:
            definition = get_node_definition(node.kind)
        except KeyError:
            issues.append(ValidationIssue(code="UNKNOWN_NODE_KIND", message=f"不支持的节点类型: {node.kind}", nodeId=node.id))
            continue
        definitions[node.id] = definition
        if node.definition_version != definition.version:
            issues.append(ValidationIssue(
                code="UNSUPPORTED_NODE_VERSION",
                message=f"节点版本 {node.definition_version} 不受支持，当前版本为 {definition.version}",
                nodeId=node.id,
            ))

    predecessor_map: dict[str, set[str]] = {node_id: set() for node_id in nodes_by_id}
    edge_ids: set[str] = set()
    edge_keys: set[tuple[str, str, str, str]] = set()
    incoming_counts: dict[tuple[str, str], int] = {}

    for edge in document.edges:
        if edge.id in edge_ids:
            issues.append(ValidationIssue(code="DUPLICATE_EDGE_ID", message="连线 ID 必须唯一", edgeId=edge.id))
        edge_ids.add(edge.id)
        edge_key = (edge.source_node_id, edge.source_port_id, edge.target_node_id, edge.target_port_id)
        if edge_key in edge_keys:
            issues.append(ValidationIssue(code="DUPLICATE_EDGE", message="不能重复连接相同端口", edgeId=edge.id))
        edge_keys.add(edge_key)

        source_definition = definitions.get(edge.source_node_id)
        target_definition = definitions.get(edge.target_node_id)
        if edge.source_node_id not in nodes_by_id or edge.target_node_id not in nodes_by_id:
            issues.append(ValidationIssue(code="EDGE_NODE_NOT_FOUND", message="连线引用了不存在的节点", edgeId=edge.id))
            continue
        if edge.source_node_id == edge.target_node_id:
            issues.append(ValidationIssue(code="SELF_CONNECTION", message="节点不能连接到自身", nodeId=edge.source_node_id, edgeId=edge.id))
        predecessor_map[edge.target_node_id].add(edge.source_node_id)
        if source_definition is None or target_definition is None:
            continue
        try:
            source_port = source_definition.output_port(edge.source_port_id)
        except KeyError:
            issues.append(ValidationIssue(code="SOURCE_PORT_NOT_FOUND", message="来源输出端口不存在", nodeId=edge.source_node_id, portId=edge.source_port_id, edgeId=edge.id))
            continue
        try:
            target_port = target_definition.input_port(edge.target_port_id)
        except KeyError:
            issues.append(ValidationIssue(code="TARGET_PORT_NOT_FOUND", message="目标输入端口不存在", nodeId=edge.target_node_id, portId=edge.target_port_id, edgeId=edge.id))
            continue
        if source_port.data_type != target_port.data_type:
            issues.append(ValidationIssue(
                code="PORT_TYPE_MISMATCH",
                message=f"{source_port.data_type} 不能连接到 {target_port.data_type}",
                nodeId=edge.target_node_id,
                portId=edge.target_port_id,
                edgeId=edge.id,
            ))
        incoming_key = (edge.target_node_id, edge.target_port_id)
        incoming_counts[incoming_key] = incoming_counts.get(incoming_key, 0) + 1
        maximum = target_port.max_connections or (1 if target_port.cardinality == "one" else 32)
        if incoming_counts[incoming_key] > maximum:
            issues.append(ValidationIssue(
                code="PORT_CARDINALITY_EXCEEDED",
                message=f"端口最多接受 {maximum} 条连线",
                nodeId=edge.target_node_id,
                portId=edge.target_port_id,
                edgeId=edge.id,
            ))

    try:
        sorter = TopologicalSorter(predecessor_map)
        sorter.prepare()
    except CycleError as exc:
        cycle = exc.args[1] if len(exc.args) > 1 else []
        issues.append(ValidationIssue(code="CYCLE_DETECTED", message=f"工作流存在环路: {' → '.join(map(str, cycle))}"))

    if require_inputs:
        for node_id, definition in definitions.items():
            if getattr(nodes_by_id[node_id], "is_disabled", False):
                continue
            for port in definition.inputs:
                if port.required and incoming_counts.get((node_id, port.id), 0) == 0:
                    issues.append(ValidationIssue(
                        code="REQUIRED_INPUT_MISSING",
                        message="缺少必需输入",
                        nodeId=node_id,
                        portId=port.id,
                    ))

    return issues

