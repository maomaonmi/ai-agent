import assert from 'node:assert/strict';
import test from 'node:test';

import { createPptArtifactInput, readPptArtifactPayload } from '../src/features/omni/pptArtifactAdapter.ts';

const presentation = {
  presentationId: 'ppt-1', title: 'Agent 产品发布', templateId: null, revision: 2,
  document: { schemaVersion: 1 as const, presentationId: 'ppt-1', revision: 2, title: 'Agent 产品发布', aspectRatio: '16:9' as const, canvas: { width: 1280, height: 720 }, theme: { name: 'default', colors: { background: '#FFFFFF' as const, surface: '#FFFFFF' as const, text: '#111111' as const, mutedText: '#666666' as const, accent1: '#0000FF' as const, accent2: '#00FFFF' as const }, fonts: { heading: 'Arial', body: 'Arial', mono: 'Consolas' } }, slides: [], metadata: { language: 'zh-CN', createdAt: '', updatedAt: '' } },
  createdAt: '', updatedAt: '',
};
const run = { runId: 'run-1', presentationId: 'ppt-1', status: 'COMPLETED' as const, phase: 'done', state: {}, createdAt: '', updatedAt: '' };

test('PPT 适配器保留 presentation、revision 和精确 run', () => {
  const mapped = createPptArtifactInput({ messageId: 'message-ppt-1', presentation, run });
  assert.equal(mapped.kind, 'presentation');
  assert.deepEqual(mapped.sourceRef, { type: 'presentation', presentationId: 'ppt-1', revision: 2, runId: 'run-1' });
  assert.equal(readPptArtifactPayload(mapped.payload)?.run.runId, 'run-1');
});
