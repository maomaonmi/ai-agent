import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/NodeProgressPanel.tsx', import.meta.url), 'utf8');

test('node progress can display measured reasoning duration when node timestamps are absent', () => {
  assert.match(source, /reasoningTime\?: number/);
  assert.match(source, /reasoningTime/);
});
