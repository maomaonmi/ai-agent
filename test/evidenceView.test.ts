import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evidenceGapLabel,
  evidencePreviewErrorLabel,
  evidenceStatusLabel,
  evidenceStorageLabel,
} from '../src/Code/evidenceView.ts';

test('keeps stale, unavailable, and reference-only evidence distinct', () => {
  assert.equal(evidenceStatusLabel('stale'), '旧候选证据');
  assert.equal(evidenceStatusLabel('retention_missing'), '来源已清理');
  assert.equal(evidenceStatusLabel('untrusted'), '来源未通过校验');
  assert.equal(evidenceStatusLabel('reference_only'), '只有引用');
});

test('does not label in-memory evidence as a persisted Artifact', () => {
  assert.equal(evidenceStorageLabel('runtime_action_journal'), 'Runtime 持久回执');
  assert.equal(evidenceStorageLabel('memory_observation'), '运行内存观察');
  assert.equal(evidenceStorageLabel('reference_only'), '未绑定持久资产');
});

test('explains version and persistence gaps without claiming evidence content', () => {
  assert.equal(evidenceGapLabel('candidate_revision_mismatch'), '证据绑定到了其他候选版本');
  assert.equal(evidenceGapLabel('memory_body_not_persisted'), '正文只在运行内存中，未写入持久来源');
  assert.equal(evidenceGapLabel('persistent_artifact_binding_not_recorded'), '未记录持久 Artifact 绑定');
  assert.equal(evidenceGapLabel('source_not_runtime_committed'), '该引用来自未提交的报告或传输事件');
  assert.equal(evidenceGapLabel('future_gap'), '来源未记录此字段');
  assert.match(evidencePreviewErrorLabel('EVIDENCE_RETENTION_MISSING'), /来源已清理/);
  assert.match(evidencePreviewErrorLabel('EVIDENCE_PREVIEW_UNAVAILABLE'), /持久正文/);
});
