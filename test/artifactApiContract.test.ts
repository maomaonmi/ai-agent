import assert from 'node:assert/strict';
import test from 'node:test';

import { getArtifactVersion, listConversationArtifacts, listMessageArtifactLinks } from '../src/features/omni/api.ts';

test('artifact client requests exact conversation, message, and historical version resources', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const payload = calls.length === 1
      ? { artifacts: [], count: 0 }
      : calls.length === 2
        ? { links: [], count: 0 }
        : { id: 'version-1', artifactId: 'artifact-1', versionNumber: 1 };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    await listConversationArtifacts('session-1');
    await listMessageArtifactLinks('message-1');
    const version = await getArtifactVersion('artifact-1', 'version-1');

    assert.match(calls[0], /\/api\/conversations\/session-1\/artifacts$/);
    assert.match(calls[1], /\/api\/messages\/message-1\/artifacts$/);
    assert.match(calls[2], /\/api\/artifacts\/artifact-1\/versions\/version-1$/);
    assert.equal(version.id, 'version-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
