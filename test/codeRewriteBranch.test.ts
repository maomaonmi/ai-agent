import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSnapshot,
  type VersionSnapshot,
} from '../src/Code/versionManager.ts';
import {
  ensureCodeBaseSnapshot,
  resolveCodeRewriteBase,
} from '../src/Code/codeRewriteBranch.ts';

function snapshot(version: number, vfs: Record<string, string>, summary: string): VersionSnapshot {
  return createSnapshot(version, summary, vfs);
}

test('each prompt can point at its exact pre-run code snapshot', () => {
  const initial = snapshot(1, { 'index.html': '<main>initial</main>' }, '初始生成：first');
  const candidate = snapshot(2, { 'index.html': '<main>candidate</main>' }, '需求 2：second');
  const messages = [
    { id: 'u1', role: 'user' as const, content: 'first', codeBaseVersionId: initial.versionId },
    { id: 'a1', role: 'assistant' as const, content: 'done' },
    { id: 'u2', role: 'user' as const, content: 'second', codeBaseVersionId: candidate.versionId },
  ];

  const resolved = resolveCodeRewriteBase({
    messages,
    targetMessageIndex: 2,
    snapshots: [initial, candidate],
  });

  assert.equal(resolved?.snapshot.versionId, candidate.versionId);
  assert.equal(resolved?.exact, true);
  assert.equal(resolved?.source, 'message');
});

test('baseline capture is idempotent when the current VFS already has a snapshot', () => {
  const existing = snapshot(3, { 'index.html': '<main>same</main>' }, 'candidate');
  const ensured = ensureCodeBaseSnapshot(
    [existing],
    { 'index.html': '<main>same</main>' },
    '需求基线',
  );

  assert.equal(ensured.versionId, existing.versionId);
  assert.equal(ensured.created, false);
  assert.equal(ensured.snapshots.length, 1);
});

test('legacy fallback is marked inexact instead of pretending to be an explicit base', () => {
  const initial = snapshot(1, { 'index.html': '<main>initial</main>' }, '初始生成：first');
  const messages = [
    { role: 'user' as const, content: 'first' },
    { role: 'assistant' as const, content: 'done' },
    { role: 'user' as const, content: 'second' },
  ];

  const resolved = resolveCodeRewriteBase({
    messages,
    targetMessageIndex: 2,
    snapshots: [initial],
  });

  assert.equal(resolved?.snapshot.versionId, initial.versionId);
  assert.equal(resolved?.exact, false);
  assert.equal(resolved?.source, 'legacy_prompt_order');
});
