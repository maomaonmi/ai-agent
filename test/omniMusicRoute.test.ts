import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/components/ChatInterface.tsx', import.meta.url), 'utf8');

test('Omni music requests generate lyrics, persist a music artifact, and open the split panel', () => {
  assert.match(source, /preferredCapability === 'music'/);
  assert.match(source, /buildMusicAgentPrompt\(userMessage\)/);
  assert.match(source, /parseMusicDraft/);
  assert.match(source, /providerOverride:\s*activeProvider === 'custom' \? 'deepseek' : activeProvider/);
  assert.match(source, /onReasoningDelta/);
  assert.match(source, /onReasoning:/);
  assert.match(source, /onNode:\s*handleNodeEvent/);
  assert.match(source, /let streamError = ''/);
  assert.match(source, /if \(streamError\) throw new Error\(streamError\)/);
  assert.match(source, /createMusicArtifactInput/);
  assert.match(source, /openArtifactPanel\(created\.artifact, created\.version\)/);
  assert.match(source, /reasoning:\s*finalReasoning/);
});
