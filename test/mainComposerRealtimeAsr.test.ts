import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/ChatInterface.tsx', import.meta.url), 'utf8');

test('main composer exposes realtime ASR without auto-submitting recognized text', () => {
  assert.match(source, /useRealtimeASR\(\{\s*baseText:\s*input,\s*onText:\s*handleInputChangeFromASR\s*\}\)/);
  assert.match(source, /aria-label=\{mainAsr\.isListening \? '停止语音识别' : '开始语音识别'\}/);
  assert.doesNotMatch(source, /onText:\s*handleSubmit/);
});
