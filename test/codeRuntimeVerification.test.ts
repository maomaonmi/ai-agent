import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeRepairRunId,
  isRuntimeCandidateForBrowserRun,
  rebindRuntimeEvidenceToRun,
} from '../src/Code/agentRunIdentity.ts';
import {
  projectRuntimeVerificationCandidate,
  runtimeVerificationCandidateFromSummary,
} from '../src/Code/agentRunLifecycle.ts';
import {
  getAcceptanceEligibility,
  findResidentAcceptanceResult,
  isAcceptanceGoalReady,
  isResidentAcceptanceTerminalRun,
} from '../src/Code/acceptancePolicy.ts';
import { isCodeWorkflowBusy } from '../src/Code/codeWorkflowState.ts';

test('runtime candidate verification matches the browser run identity', () => {
  assert.equal(
    isRuntimeCandidateForBrowserRun(
      {
        runId: 'agent-run-1',
        browserRunId: 'code-run-1',
        baseRevision: 'base-1',
        candidateRevision: 'candidate-1',
      },
      'code-run-1',
    ),
    true,
  );
});

test('failed browser verification starts the next repair with a fresh backend run identity', () => {
  const nextRunId = createRuntimeRepairRunId('agent-run-1', 2);
  assert.notEqual(nextRunId, 'agent-run-1');
  assert.match(nextRunId, /^agent-run-1-repair-2$/);

  const evidence = rebindRuntimeEvidenceToRun({
    status: 'runtime_verification_failed',
    run_id: 'agent-run-1',
    base_revision: 'base-1',
    candidate_revision: 'candidate-1',
    changed_files: ['frontend/app.js'],
    diff_summary: '+1/-1',
    new_errors: ['ReferenceError'],
    same_error_persisted: true,
    boot_completed: true,
    console_errors: ['ReferenceError'],
    diagnostic: '浏览器验证失败',
  }, nextRunId);

  assert.equal(evidence?.run_id, nextRunId);
  assert.equal(evidence?.candidate_revision, 'candidate-1');
});

test('runtime candidate verification does not compare agent and browser run IDs', () => {
  assert.equal(
    isRuntimeCandidateForBrowserRun(
      {
        runId: 'agent-run-1',
        browserRunId: 'code-run-1',
        baseRevision: 'base-1',
        candidateRevision: 'candidate-1',
      },
      'agent-run-1',
    ),
    false,
  );
});

test('a completed runtime summary is not treated as a pending runtime candidate', () => {
  assert.equal(
    runtimeVerificationCandidateFromSummary({
      status: 'completed',
      run_id: 'agent-run-1',
      base_revision: 'base-1',
      candidate_revision: 'candidate-1',
    }),
    undefined,
  );
});

test('only an awaiting runtime summary creates a pending runtime candidate', () => {
  assert.deepEqual(
    runtimeVerificationCandidateFromSummary({
      status: 'awaiting_runtime_verification',
      run_id: 'agent-run-1',
      base_revision: 'base-1',
      candidate_revision: 'candidate-1',
    }),
    {
      runId: 'agent-run-1',
      baseRevision: 'base-1',
      candidateRevision: 'candidate-1',
    },
  );
});

test('a completed summary clears any previous pending runtime candidate', () => {
  assert.equal(
    projectRuntimeVerificationCandidate(
      {
        runId: 'agent-run-old',
        browserRunId: 'code-run-old',
        baseRevision: 'base-old',
        candidateRevision: 'candidate-old',
      },
      {
        done: true,
        status: 'completed',
        run_id: 'agent-run-new',
        base_revision: 'base-new',
        candidate_revision: 'candidate-new',
      },
    ),
    undefined,
  );
});

test('Code workbench remains busy while a runtime candidate is actively awaiting verification', () => {
  assert.equal(isCodeWorkflowBusy({
    mode: 'code',
    isLoading: false,
    agentIsRunning: true,
    agentStatus: 'awaiting_runtime_verification',
    codeStatus: 'done',
  }), true);
});

test('stale awaiting verification status does not lock a completed Code workbench', () => {
  assert.equal(isCodeWorkflowBusy({
    mode: 'code',
    isLoading: false,
    agentIsRunning: false,
    agentStatus: 'awaiting_runtime_verification',
    codeStatus: 'done',
  }), false);
});

test('idle Code workbench accepts a new turn', () => {
  assert.equal(isCodeWorkflowBusy({
    mode: 'code',
    isLoading: false,
    agentIsRunning: false,
    agentStatus: 'completed',
    codeStatus: 'done',
  }), false);
});

test('browser acceptance waits for a bound Runtime goal instead of sending an empty goal', () => {
  assert.equal(isAcceptanceGoalReady(undefined), false);
  assert.equal(isAcceptanceGoalReady({ goal_type: 'unknown' }), false);
  assert.equal(isAcceptanceGoalReady({ goal_type: 'open_runtime_behavior' }), true);
  assert.equal(getAcceptanceEligibility(
    { candidateRunId: 'agent-run-1', testedRunId: '' },
    {
      runId: 'code-run-1',
      status: 'done',
      acceptanceGoalReady: false,
    },
  ).shouldStart, false);
});

test('resident TestAgent result for the same candidate prevents a duplicate browser request', () => {
  const result = findResidentAcceptanceResult([
    {
      eventId: 'test-result-1',
      metadata: {
        eventType: 'test_agent_result',
        candidate_revision: 'candidate-1',
        outcome: 'verified',
      },
    },
  ], 'candidate-1');

  assert.equal(result?.eventId, 'test-result-1');
  const eligibility = getAcceptanceEligibility(
    { candidateRunId: 'agent-run-1', testedRunId: '' },
    {
      runId: 'code-run-1',
      status: 'done',
      acceptanceGoalReady: true,
      acceptanceAlreadyRecorded: true,
    },
  );
  assert.equal(eligibility.shouldStart, false);
  assert.equal(eligibility.state.testedRunId, '');
});

test('browser acceptance waits for the durable AgentLoop TestAgent result', () => {
  assert.equal(getAcceptanceEligibility(
    { candidateRunId: 'agent-run-1', testedRunId: '' },
    {
      runId: 'code-run-1',
      status: 'done',
      acceptanceGoalReady: true,
      acceptancePending: true,
    },
  ).shouldStart, false);
  assert.equal(isResidentAcceptanceTerminalRun({
    status: 'awaiting_runtime_verification',
    isRunning: false,
  }), false);
  assert.equal(isResidentAcceptanceTerminalRun({
    status: 'completed',
    isRunning: false,
  }), true);
});

test('resident TestAgent result is ignored when it belongs to another candidate or is observation-only', () => {
  assert.equal(findResidentAcceptanceResult([
    {
      metadata: {
        eventType: 'test_agent_result',
        candidate_revision: 'candidate-old',
        outcome: 'verified',
      },
    },
    {
      metadata: {
        eventType: 'test_agent_result',
        candidate_revision: 'candidate-current',
        observation_only: true,
        outcome: 'verified',
      },
    },
  ], 'candidate-current'), undefined);
});
