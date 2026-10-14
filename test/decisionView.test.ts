import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allowedRecoveryActionsLabel,
  decisionGapLabel,
  decisionOutcomeLabel,
  decisionRouteLabel,
  decisionVersionRows,
} from '../src/Code/decisionView.ts';
import type { CodeObservatoryDecisionView } from '../src/lib/codeObservatoryApi.ts';

function decision(overrides: Partial<CodeObservatoryDecisionView> = {}): CodeObservatoryDecisionView {
  return {
    decision_ref: 'decision-1',
    owner: 'verification_runtime',
    source_ref: { stream_key: 'code_operation_verification:op-1', event_key: 'verification-1' },
    source_role: 'runtime_committed',
    outcome: 'inconclusive',
    reason_code: null,
    versions: {},
    evidence_refs: [],
    allowed_actions: [],
    authorization_refs: [],
    expected_candidate_source_ids: [],
    candidate_sources: [],
    candidate_actions: [],
    remaining_executor_ids: [],
    remaining_agent_action_ids: [],
    source_gaps: [],
    ...overrides,
  };
}

test('keeps materially different verification outcomes visibly distinct', () => {
  assert.equal(decisionOutcomeLabel('contradicted'), '结论矛盾');
  assert.equal(decisionOutcomeLabel('inconclusive'), '验证不确定');
  assert.equal(decisionOutcomeLabel('invalid_test'), '测试无效');
  assert.equal(decisionOutcomeLabel('infra_failure'), '基础设施失败');
});

test('shows missing decision versions and rule details as not recorded', () => {
  assert.deepEqual(decisionVersionRows(decision()), [
    ['候选版本', '未记录'],
    ['验证 epoch', '未记录'],
    ['Operation 版本', '未记录'],
    ['规则编号', '未记录'],
    ['规则版本', '未记录'],
  ]);
  assert.equal(decisionGapLabel('rule_id_not_recorded'), '规则编号未记录');
  assert.equal(decisionGapLabel('based_on_operation_version_not_recorded'), '决策依据 Operation 版本未记录');
  assert.equal(
    decisionVersionRows(decision({ based_on_operation_version: 0 }))[2]?.[1],
    '0',
  );
});

test('distinguishes an empty enumerated recovery list from missing enumeration', () => {
  assert.equal(
    allowedRecoveryActionsLabel(decision({
      owner: 'runtime',
      executor_evaluation_status: 'enumerated',
    })),
    '已枚举，无剩余动作',
  );
  assert.equal(
    allowedRecoveryActionsLabel(decision({
      owner: 'runtime',
      executor_evaluation_status: 'not_enumerated',
    })),
    '未枚举',
  );
  assert.equal(
    allowedRecoveryActionsLabel(decision({
      owner: 'runtime',
      allowed_actions: ['executor.fix', 'agent.retry'],
    })),
    'executor.fix、agent.retry',
  );
});

test('marks verification results as not having an FSM route', () => {
  assert.equal(decisionRouteLabel(decision()), '不适用（验证结果）');
  assert.equal(decisionRouteLabel(decision({ owner: 'control_plane' })), '未记录');
  assert.equal(decisionRouteLabel(decision({ selected_route: 'SUBMIT_PATCH_COMPLETE' })), 'SUBMIT_PATCH_COMPLETE');
});
