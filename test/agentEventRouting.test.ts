import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeAgentLoopRound } from '../src/Code/agentEventRouting.ts';

test('round summary states changed files and the next action', () => {
  const text = summarizeAgentLoopRound({
    iteration: 3,
    tool_calls_count: 2,
    files_changed: ['frontend/app.js'],
    state_hash_before: 'before',
    state_hash_after: 'after',
    progress_score: 3,
    progress_facts: ['补全恢复状态'],
    round_summary: '本轮修改文件：frontend/app.js',
    next_action: '核对仍未闭合的目标；若有反证，回到诊断并据此修复',
    controller_phase: 'verify',
  });

  assert.match(text, /frontend\/app\.js/);
  assert.match(text, /补全恢复状态/);
  assert.match(text, /下一步：核对仍未闭合的目标/);
});
