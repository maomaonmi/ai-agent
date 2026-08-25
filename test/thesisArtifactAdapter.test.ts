import assert from 'node:assert/strict';
import test from 'node:test';

import { createThesisArtifactInput, readThesisArtifactPayload } from '../src/features/omni/thesisArtifactAdapter.ts';

test('论文适配器保留结构化章节、大纲与参考资料', () => {
  const document = {
    documentId: 'doc-thesis-1', title: 'Agent 系统研究', scene: 'thesis' as const,
    outline: [], sections: [{ id: 'c1', outlineId: 'c1', title: '第一章', level: 1 as const, content: '论文正文', status: 'complete' as const }],
    references: [], citations: [], generatedLength: 4, versionId: 'v1', versions: [], researchStatus: 'done' as const,
    view: 'body' as const, updatedAt: 1,
  };
  const outline = { title: 'Agent 系统研究', prefaces: [], chapters: [], rawStream: '', targetWords: null, status: 'ready' as const, error: '', researchPhase: '' as const };
  const mapped = createThesisArtifactInput({ messageId: 'message-thesis-1', document, outline });
  const payload = readThesisArtifactPayload(mapped.payload);
  assert.equal(mapped.kind, 'thesis');
  assert.equal(payload?.document.sections[0].content, '论文正文');
  assert.equal(payload?.outline.title, 'Agent 系统研究');
});
