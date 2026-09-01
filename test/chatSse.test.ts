import assert from 'node:assert/strict';
import test from 'node:test';

import { sendChatMessage } from '../src/lib/api.ts';

test('SSE error events reach onError instead of being treated as status messages', async () => {
  const originalFetch = globalThis.fetch;
  const errors: string[] = [];
  const statuses: string[] = [];
  globalThis.fetch = (async () => new Response(
    'event: error\ndata: {"message":"MiniMax 套餐 Key 无效","code":"MINIMAX_401"}\n\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )) as typeof fetch;

  try {
    await sendChatMessage('生成歌词', 'deep', {
      onError: (event) => errors.push(event.message),
      onSystemStatus: (event) => statuses.push(event.message),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(errors, ['MiniMax 套餐 Key 无效']);
  assert.deepEqual(statuses, []);
});

test('reasoning and agent deltas are delivered before the final answer', async () => {
  const originalFetch = globalThis.fetch;
  const reasoning: string[] = [];
  const agent: string[] = [];
  const answers: string[] = [];
  globalThis.fetch = (async () => new Response(
    [
      'event: reasoning_delta\ndata: {"reasoning_delta":"先拆解"}\n\n',
      'event: agent_delta\ndata: {"stream_id":"expert-1","actor":"专家","kind":"token","delta":"实时输出"}\n\n',
      'event: done\ndata: {"answer":"完成","mode":"deep"}\n\n',
    ].join(''),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )) as typeof fetch;

  try {
    await sendChatMessage('测试', 'deep', {
      onReasoningDelta: (token) => reasoning.push(token),
      onAgentDelta: (event) => agent.push(event.delta),
      onDone: (event) => answers.push(event.answer),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(reasoning, ['先拆解']);
  assert.deepEqual(agent, ['实时输出']);
  assert.deepEqual(answers, ['完成']);
});
