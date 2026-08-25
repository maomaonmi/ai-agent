import assert from 'node:assert/strict';
import test from 'node:test';

import { createResearchArtifactInput, readResearchArtifactPayload } from '../src/features/omni/researchArtifactAdapter.ts';

test('研究适配器保存报告正文、查询和有界来源摘要', () => {
  const mapped = createResearchArtifactInput({
    messageId: 'message-research-1',
    query: '分析 Agent 市场',
    report: '# AI Agent 市场研究报告\n\n报告正文',
    sources: [{ id: 1, title: '来源', url: 'https://example.com', score: 0.9, text: 'x'.repeat(2000) }],
  });
  const payload = readResearchArtifactPayload(mapped.payload);
  assert.equal(mapped.kind, 'research_report');
  assert.equal(mapped.title, 'AI Agent 市场研究报告');
  assert.equal(payload?.query, '分析 Agent 市场');
  assert.equal(payload?.sources[0].text.length, 1200);
});
