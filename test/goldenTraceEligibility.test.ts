import assert from 'node:assert/strict';
import test from 'node:test';

import { getGoldenTraceEligibility } from '../src/Code/goldenTraceEligibility.ts';
import type { CodeAgentRun } from '../src/lib/api.ts';

function makeRun(overrides: Partial<CodeAgentRun['trace']> = {}): CodeAgentRun {
  return {
    id: 'run-1',
    request: '修复交互页面',
    projectKind: 'frontend',
    createdAt: new Date(0).toISOString(),
    trace: {
      steps: [],
      output: '',
      phase: 'completed',
      isRunning: false,
      status: 'completed',
      runtimeVerification: {
        runId: 'run-1',
        browserRunId: 'browser-1',
        baseRevision: 'base-1',
        candidateRevision: 'candidate-1',
      },
      runtimeEvidence: {
        status: 'verified',
        run_id: 'run-1',
        base_revision: 'base-1',
        candidate_revision: 'candidate-1',
        changed_files: ['frontend/js/ui.js'],
        diff_summary: '+11/-0',
        new_errors: [],
        same_error_persisted: false,
        boot_completed: true,
        deterministic_verifier_passed: true,
        goal_verified: true,
        console_errors: [],
        diagnostic: '通过',
      },
      ...overrides,
    },
  };
}

test('only a completed browser-verified run is eligible', () => {
  assert.deepEqual(getGoldenTraceEligibility(makeRun()), { eligible: true });
  assert.equal(getGoldenTraceEligibility(makeRun({ status: 'awaiting_runtime_verification' })).eligible, false);
  assert.equal(getGoldenTraceEligibility(makeRun({ runtimeVerification: undefined })).eligible, false);
  assert.equal(getGoldenTraceEligibility(makeRun({ runtimeEvidence: undefined })).eligible, false);
});

test('runtime errors and incomplete boot make a source trace ineligible', () => {
  assert.equal(getGoldenTraceEligibility(makeRun({
    runtimeEvidence: {
      ...makeRun().trace.runtimeEvidence!,
      console_errors: ['TypeError'],
    },
  })).eligible, false);
  assert.equal(getGoldenTraceEligibility(makeRun({
    runtimeEvidence: {
      ...makeRun().trace.runtimeEvidence!,
      boot_completed: false,
    },
  })).eligible, false);
  assert.equal(getGoldenTraceEligibility(makeRun({
    runtimeEvidence: {
      ...makeRun().trace.runtimeEvidence!,
      deterministic_verifier_passed: false,
    },
  })).eligible, false);
});
