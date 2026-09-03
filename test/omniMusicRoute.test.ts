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
  assert.match(source, /reasoning_time:/);
  assert.match(source, /onAgentDelta/);
  assert.match(source, /openArtifactPanel\(response\.artifact, response\.version\)/);
  assert.match(source, /nextMessagesWithUser/);
  assert.match(source, /reasoningPacing\.reset\(\)/);
  assert.match(source, /const reasoningStartedAt = Date\.now\(\)/);
  assert.match(source, /reasoningPacing\.commit\(finalReasoning\)/);
  assert.match(source, /reasoning_time: reasoningTime/);
  assert.match(source, /Mount the assistant turn before the first token/);
});

test('music generation reuses the active music artifact and bypasses the chat thinking stream', () => {
  assert.match(source, /latestMusicArtifactRef/);
  assert.match(source, /const musicArtifactRef = artifactPanelState\.status !== 'closed'/);
  assert.match(source, /if \(activeMusic && musicArtifactRef\) \{/);
  assert.match(source, /generateSunoMusic\(/);
});

test('artifact messages can use the full conversation width for wide music cards', () => {
  assert.match(source, /hasArtifactLinks/);
  assert.match(source, /w-full max-w-full/);
});
