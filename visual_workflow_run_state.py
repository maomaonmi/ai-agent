"""Explicit Run and NodeRun state transitions.

Keeping this table-driven makes persistence and future worker recovery share
one source of truth instead of allowing arbitrary status strings in SQLite.
"""

from __future__ import annotations

from enum import StrEnum


class RunStatus(StrEnum):
    PLANNED = "PLANNED"
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCEL_REQUESTED = "CANCEL_REQUESTED"
    CANCELLED = "CANCELLED"


class NodeRunStatus(StrEnum):
    PENDING = "PENDING"
    READY = "READY"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    CANCEL_REQUESTED = "CANCEL_REQUESTED"
    CANCELLED = "CANCELLED"


class InvalidStateTransition(ValueError):
    def __init__(self, entity: str, current: str, target: str):
        super().__init__(f"invalid {entity} transition: {current} -> {target}")
        self.entity = entity
        self.current = current
        self.target = target


_RUN_TRANSITIONS: dict[RunStatus, frozenset[RunStatus]] = {
    RunStatus.PLANNED: frozenset({RunStatus.QUEUED, RunStatus.CANCELLED}),
    RunStatus.QUEUED: frozenset({RunStatus.RUNNING, RunStatus.CANCEL_REQUESTED, RunStatus.CANCELLED}),
    RunStatus.RUNNING: frozenset({RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCEL_REQUESTED}),
    RunStatus.CANCEL_REQUESTED: frozenset({RunStatus.CANCELLED, RunStatus.FAILED}),
    RunStatus.SUCCEEDED: frozenset(),
    RunStatus.FAILED: frozenset(),
    RunStatus.CANCELLED: frozenset(),
}

_NODE_TRANSITIONS: dict[NodeRunStatus, frozenset[NodeRunStatus]] = {
    NodeRunStatus.PENDING: frozenset({NodeRunStatus.READY, NodeRunStatus.SKIPPED, NodeRunStatus.CANCELLED}),
    NodeRunStatus.READY: frozenset({NodeRunStatus.RUNNING, NodeRunStatus.SKIPPED, NodeRunStatus.CANCELLED}),
    NodeRunStatus.RUNNING: frozenset({NodeRunStatus.SUCCEEDED, NodeRunStatus.FAILED, NodeRunStatus.CANCEL_REQUESTED}),
    NodeRunStatus.CANCEL_REQUESTED: frozenset({NodeRunStatus.CANCELLED, NodeRunStatus.FAILED}),
    NodeRunStatus.SUCCEEDED: frozenset(),
    NodeRunStatus.FAILED: frozenset(),
    NodeRunStatus.SKIPPED: frozenset(),
    NodeRunStatus.CANCELLED: frozenset(),
}


def transition_run_status(current: RunStatus | str, target: RunStatus | str) -> RunStatus:
    current_status = RunStatus(current)
    target_status = RunStatus(target)
    if target_status not in _RUN_TRANSITIONS[current_status]:
        raise InvalidStateTransition("run", current_status.value, target_status.value)
    return target_status


def transition_node_status(current: NodeRunStatus | str, target: NodeRunStatus | str) -> NodeRunStatus:
    current_status = NodeRunStatus(current)
    target_status = NodeRunStatus(target)
    if target_status not in _NODE_TRANSITIONS[current_status]:
        raise InvalidStateTransition("node_run", current_status.value, target_status.value)
    return target_status
