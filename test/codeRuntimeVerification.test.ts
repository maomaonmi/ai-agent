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
