"""Pure DAG compilation primitives for visual workflow runs.

This module deliberately has no provider calls, storage side effects, or task
submission.  It turns one immutable workflow revision into a deterministic
execution plan that later runners can consume safely.
"""

from __future__ import annotations

from dataclasses import dataclass
from graphlib import CycleError, TopologicalSorter

from visual_workflow_models import ValidationIssue, WorkflowDocument
from visual_workflow_validator import validate_workflow


class WorkflowCompileError(ValueError):
    """Raised when a revision cannot be compiled into an executable DAG."""

    def __init__(self, issues: list[ValidationIssue]):
        self.issues = tuple(issues)
        super().__init__("workflow revision is not executable")


@dataclass(frozen=True)
class WorkflowCompilePlan:
    workflow_id: str
    revision: int
    node_ids: tuple[str, ...]
    requested_node_ids: tuple[str, ...] | None
    predecessors: dict[str, tuple[str, ...]]
    successors: dict[str, tuple[str, ...]]
    batches: tuple[tuple[str, ...], ...]

    def to_payload(self) -> dict[str, object]:
        return {
            "workflowId": self.workflow_id,
            "revision": self.revision,
            "nodeIds": list(self.node_ids),
            "requestedNodeIds": list(self.requested_node_ids) if self.requested_node_ids is not None else None,
            "predecessors": {node_id: list(values) for node_id, values in self.predecessors.items()},
            "successors": {node_id: list(values) for node_id, values in self.successors.items()},
            "batches": [list(batch) for batch in self.batches],
        }


def _target_closure(
    requested_node_ids: list[str],
    predecessor_map: dict[str, set[str]],
    node_order: dict[str, int],
) -> tuple[set[str], list[ValidationIssue]]:
    issues: list[ValidationIssue] = []
    selected = set(requested_node_ids)
    for node_id in requested_node_ids:
        if node_id not in predecessor_map:
            issues.append(ValidationIssue(code="REQUESTED_NODE_NOT_FOUND", message="运行目标节点不存在", nodeId=node_id))
    if issues:
        return set(), issues
    pending = list(selected)
    while pending:
        node_id = pending.pop()
        for predecessor in predecessor_map[node_id]:
            if predecessor not in selected:
                selected.add(predecessor)
                pending.append(predecessor)
    return selected, issues


def compile_workflow(
    document: WorkflowDocument,
    *,
    requested_node_ids: list[str] | None = None,
    require_inputs: bool = False,
) -> WorkflowCompilePlan:
    """Compile a validated revision into deterministic topological batches.

    When ``requested_node_ids`` is supplied, only those nodes and their
    ancestors are included. This is the foundation for incremental execution:
    an unrelated branch is not scheduled just because it lives in the same
    workflow revision.
    """

    issues = validate_workflow(document, require_inputs=require_inputs)
    node_order = {node.id: index for index, node in enumerate(document.nodes)}
    full_predecessors: dict[str, set[str]] = {node.id: set() for node in document.nodes}
    for edge in document.edges:
        if edge.target_node_id in full_predecessors and edge.source_node_id in node_order:
            full_predecessors[edge.target_node_id].add(edge.source_node_id)

    selected = set(node_order)
    normalized_requested: tuple[str, ...] | None = None
    if requested_node_ids is not None:
        normalized_requested = tuple(dict.fromkeys(requested_node_ids))
        selected, target_issues = _target_closure(list(normalized_requested), full_predecessors, node_order)
        issues.extend(target_issues)

    if issues:
        raise WorkflowCompileError(issues)

    restricted_predecessors: dict[str, set[str]] = {
        node_id: {predecessor for predecessor in full_predecessors[node_id] if predecessor in selected}
        for node_id in selected
    }
    try:
        sorter = TopologicalSorter(restricted_predecessors)
        sorter.prepare()
        batches: list[tuple[str, ...]] = []
        while sorter.is_active():
            ready = tuple(sorted(sorter.get_ready(), key=node_order.__getitem__))
            if not ready:
                # Defensive guard: prepare() should already have raised for a
                # cycle, but never spin a worker on a malformed graph.
                raise CycleError("workflow contains a cycle")
            batches.append(ready)
            sorter.done(*ready)
    except CycleError:
        raise WorkflowCompileError([
            ValidationIssue(code="CYCLE_DETECTED", message="工作流存在环路，无法生成执行计划")
        ]) from None

    ordered_node_ids = tuple(sorted(selected, key=node_order.__getitem__))
    successors: dict[str, tuple[str, ...]] = {
        node_id: tuple(sorted(
            (successor for successor, predecessors in restricted_predecessors.items() if node_id in predecessors),
            key=node_order.__getitem__,
        ))
        for node_id in ordered_node_ids
    }
    predecessors = {
        node_id: tuple(sorted(restricted_predecessors[node_id], key=node_order.__getitem__))
        for node_id in ordered_node_ids
    }
    return WorkflowCompilePlan(
        workflow_id=document.workflow_id,
        revision=document.revision,
        node_ids=ordered_node_ids,
        requested_node_ids=normalized_requested,
        predecessors=predecessors,
        successors=successors,
        batches=tuple(batches),
    )
