import assert from 'node:assert/strict';
import test from 'node:test';
import { createOmniTurnContext } from '../src/features/omni/turnContext.ts';

test('项目只自动注入摘要，具体作品必须进入显式 mentionedArtifacts', () => {
  const summary = { artifactId: 'artifact-1' as never, versionId: 'version-2' as never, kind: 'document' as const, title: '发布稿', summary: '摘要', projectId: 'project-foreign' as never };
  const context = createOmniTurnContext({
    preferredCapability: 'omni', runtimeSettings: { webSearch: 'on', deepThinking: 'on' }, attachments: [],
    artifactPanelState: { status: 'closed' }, mentionedArtifacts: [summary], projectSummary: '项目摘要', candidateArtifactSummaries: [summary],
  });
  assert.deepEqual(context.mentionedArtifacts, [{ artifactId: summary.artifactId, versionId: summary.versionId }]);
  assert.equal(context.projectSummary, '项目摘要');
  assert.equal(context.candidateArtifactSummaries?.[0].summary, '摘要');
  assert.equal('payload' in context.candidateArtifactSummaries![0], false);
});
