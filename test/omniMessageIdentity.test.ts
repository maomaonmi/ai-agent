import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatMessage } from '../src/lib/api.ts';
import { ensureChatMessageIds } from '../src/features/omni/messageIdentity.ts';

test('legacy messages receive deterministic IDs when the same snapshot is restored twice', () => {
  const legacyMessages: ChatMessage[] = [
    { role: 'user', content: '生成一张海报' },
    { role: 'assistant', content: '正在生成' },
  ];

  const firstRestore = ensureChatMessageIds(legacyMessages, 'session-1');
  const secondRestore = ensureChatMessageIds(legacyMessages, 'session-1');

  assert.deepEqual(
    firstRestore.map((message) => message.id),
    secondRestore.map((message) => message.id),
  );
  assert.ok(firstRestore.every((message) => Boolean(message.id)));
});

test('existing IDs survive streaming content updates', () => {
  const initial = ensureChatMessageIds(
    [{ role: 'assistant', content: '' }],
    'session-1',
  );
  const updated = ensureChatMessageIds(
    [{ ...initial[0], content: '逐步出现的完整回答' }],
    'session-1',
  );

  assert.equal(updated[0].id, initial[0].id);
});

test('identical messages at different positions receive different IDs', () => {
  const normalized = ensureChatMessageIds(
    [
      { role: 'user', content: '继续' },
      { role: 'assistant', content: '好的' },
      { role: 'user', content: '继续' },
    ],
    'session-1',
  );

  assert.notEqual(normalized[0].id, normalized[2].id);
});

test('normalization preserves the original array when every message already has an ID', () => {
  const messages: ChatMessage[] = [
    { id: 'message-existing', role: 'user', content: '已有身份' },
  ];

  assert.equal(ensureChatMessageIds(messages, 'session-1'), messages);
});
