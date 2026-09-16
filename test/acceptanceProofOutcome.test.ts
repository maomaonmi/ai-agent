import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canTriggerAcceptanceRepair,
  reduceAcceptanceProofOutcome,
} from '../src/Code/acceptanceProofOutcome.ts';

test('uncertain evidence wins over legacy failed fields', () => {
  const report = {
    passed: false,
    verification_status: 'failed',
    assertions: [{
      passed: false,
      actual: { evidence_status: 'inconclusive' },
    }],
  };

  assert.equal(reduceAcceptanceProofOutcome(report), 'inconclusive');
  assert.equal(canTriggerAcceptanceRepair(report), false);
});

test('unobservable evidence never dispatches code repair', () => {
  const report = {
    passed: false,
    assertions: [{
      passed: false,
      actual: { evidence_status: 'unobservable' },
    }],
    deterministic_findings: [{ kind: 'measurement_failed' }],
  };

  assert.equal(reduceAcceptanceProofOutcome(report), 'unverifiable');
  assert.equal(canTriggerAcceptanceRepair(report), false);
});

test('legacy observability finding kind also blocks repair', () => {
  const report = {
    passed: false,
    verification_status: 'failed',
    deterministic_findings: [{ kind: 'state_not_observable' }],
  };

  assert.equal(reduceAcceptanceProofOutcome(report), 'unverifiable');
  assert.equal(canTriggerAcceptanceRepair(report), false);
});

test('per-obligation inconclusive status outranks legacy failure', () => {
  const report = {
    status: 'failed',
    obligation_statuses: { goalA: 'inconclusive' },
  };

  assert.equal(reduceAcceptanceProofOutcome(report), 'inconclusive');
  assert.equal(canTriggerAcceptanceRepair(report), false);
});

test('waiting-for-test-generation status remains unavailable', () => {
  const report = {
    status: 'failed',
    findings: [{ kind: 'test_agent_measurement_failed' }],
    obligation_statuses: { goal: 'waiting_for_test_generation' },
  };

  assert.equal(reduceAcceptanceProofOutcome(report), 'unverifiable');
  assert.equal(canTriggerAcceptanceRepair(report), false);
});

test('a conclusive failed assertion remains repair-eligible at the UI gate', () => {
  const report = {
    passed: false,
    assertions: [{
      passed: false,
      actual: { before: 1, after: 1, evidence_status: 'failed' },
    }],
  };

  assert.equal(reduceAcceptanceProofOutcome(report), 'contradicted');
  assert.equal(canTriggerAcceptanceRepair(report), true);
});
