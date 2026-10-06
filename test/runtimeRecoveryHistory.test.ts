import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendRecoveryHistoryPage,
  describeRemainingRoutes,
  recoveryStatusLabel,
} from '../src/Code/recoveryHistory.ts';

test('a complete inventory with no eligible route is explicit, while incomplete states remain unknown', () => {
  assert.equal(describeRemainingRoutes({
    status: 'complete',
    remaining_executor_ids: [],
    remaining_agent_action_ids: [],
  }), '完整盘点后没有符合条件的剩余路线');
  assert.equal(describeRemainingRoutes({
    status: 'partial',
    remaining_executor_ids: [],
    remaining_agent_action_ids: [],
  }), '盘点不完整，尚不能确认剩余路线');
  assert.equal(describeRemainingRoutes({
    status: 'unavailable',
    remaining_executor_ids: [],
    remaining_agent_action_ids: [],
  }), '候选来源不可用，是否有剩余路线未知');
});

test('remaining executor and agent actions are shown separately', () => {
  assert.equal(describeRemainingRoutes({
    status: 'partial',
    remaining_executor_ids: ['executor-1'],
    remaining_agent_action_ids: ['action-1'],
  }), '执行器 executor-1、Agent 动作 action-1');
});

test('history pages merge by durable sequence and discard replay duplicates', () => {
  const merged = appendRecoveryHistoryPage(
    [{ sequence: 2, value: 'old copy' }, { sequence: 4, value: 'four' }],
    [{ sequence: 2, value: 'replayed' }, { sequence: 3, value: 'three' }],
  );
  assert.deepEqual(merged, [
    { sequence: 2, value: 'replayed' },
    { sequence: 3, value: 'three' },
    { sequence: 4, value: 'four' },
  ]);
});

test('recovery status labels preserve unknown codes for diagnosis', () => {
  assert.equal(recoveryStatusLabel('partial'), '部分');
  assert.equal(recoveryStatusLabel('CUSTOM_STOP_REASON'), 'CUSTOM_STOP_REASON');
});
