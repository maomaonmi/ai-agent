import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeChatMessages,
  unwrapInternalUserPrompt,
  type ChatMessage,
} from '../src/lib/chatHistoryNormalization.ts';

const apiSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/lib/api.ts'),
  'utf8',
);

test('normal user content passes through byte-for-byte', () => {
  assert.equal(unwrapInternalUserPrompt('点开始后为什么立刻结束'), '点开始后为什么立刻结束');
  assert.equal(unwrapInternalUserPrompt(''), '');
  assert.equal(unwrapInternalUserPrompt(undefined), '');
});

test('internal read-only prompt envelopes are unwrapped to the real question', () => {
  const envelope = [
    '你是 Code 工作台的只读对话助手。',
    '用户问题：我蛇的蛇体没有随着时间变化',
    '',
    '项目类型：code',
  ].join('\n');
  assert.equal(unwrapInternalUserPrompt(envelope), '我蛇的蛇体没有随着时间变化');
});

test('envelopes missing the question marker are kept verbatim', () => {
  const partial = '你是 Code 工作台的只读对话助手。\n没有问题标记';
  assert.equal(unwrapInternalUserPrompt(partial), partial);
});

test('normalizeChatMessages unwraps only user turns and preserves metadata', () => {
  const messages = [
    { role: 'user', content: '你是 Code 工作台的只读对话助手。\n用户问题：修复按钮\n\n项目类型：code', id: 'm1' },
    { role: 'assistant', content: '你是 Code 工作台的只读对话助手。\n用户问题：不应被改写', id: 'm2' },
  ];
  const normalized = normalizeChatMessages<ChatMessage>(messages);
  assert.equal(normalized[0].content, '修复按钮');
  assert.equal(normalized[0].id, 'm1');
  assert.equal(normalized[1].content, '你是 Code 工作台的只读对话助手。\n用户问题：不应被改写');
  assert.equal(normalized.length, 2);
});

test('normalizeChatMessages drops non-object entries and non-list input', () => {
  assert.deepEqual(normalizeChatMessages(null), []);
  assert.deepEqual(normalizeChatMessages('nope'), []);
  assert.deepEqual(normalizeChatMessages([null, 3, { role: 'user', content: 'ok' }]), [
    { role: 'user', content: 'ok' },
  ]);
});

test('snapshot save and memory branch writes normalize messages at the boundary', () => {
  assert.match(apiSource, /normalizeChatMessages<ChatMessage>\(snapshot\.messages\)/);
  assert.match(apiSource, /messages: normalizeChatMessages\(messages\)/);
});
