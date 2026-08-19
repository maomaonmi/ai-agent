from __future__ import annotations

import pytest

from visual_workflow_run_state import (
    InvalidStateTransition,
    NodeRunStatus,
    RunStatus,
    transition_node_status,
    transition_run_status,
)


def test_run_state_machine_allows_forward_execution_and_cancel_paths():
    assert transition_run_status(RunStatus.PLANNED, RunStatus.QUEUED) is RunStatus.QUEUED
    assert transition_run_status(RunStatus.QUEUED, RunStatus.RUNNING) is RunStatus.RUNNING
    assert transition_run_status(RunStatus.RUNNING, RunStatus.SUCCEEDED) is RunStatus.SUCCEEDED
    assert transition_run_status(RunStatus.RUNNING, RunStatus.CANCEL_REQUESTED) is RunStatus.CANCEL_REQUESTED
    assert transition_run_status(RunStatus.CANCEL_REQUESTED, RunStatus.CANCELLED) is RunStatus.CANCELLED


def test_terminal_run_cannot_be_reopened():
    with pytest.raises(InvalidStateTransition):
        transition_run_status(RunStatus.SUCCEEDED, RunStatus.RUNNING)


def test_node_state_machine_supports_skip_without_running():
    assert transition_node_status(NodeRunStatus.PENDING, NodeRunStatus.READY) is NodeRunStatus.READY
    assert transition_node_status(NodeRunStatus.READY, NodeRunStatus.SKIPPED) is NodeRunStatus.SKIPPED
    with pytest.raises(InvalidStateTransition):
        transition_node_status(NodeRunStatus.SKIPPED, NodeRunStatus.RUNNING)
