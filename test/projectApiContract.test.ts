import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignConversationToProject,
  createProject,
  listProjects,
  removeConversationFromProject,
  updateProject,
} from '../src/features/projects/api.ts';

type FetchCall = { url: string; init?: RequestInit };

function withFakeFetch(payloads: unknown[], run: (calls: FetchCall[]) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(payloads.shift()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return run(calls).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test('project client uses resource-oriented endpoints and payloads', async () => {
  await withFakeFetch([
    { projects: [], count: 0 },
    { id: 'project-1', name: '项目', projectId: null },
    { id: 'project-1', name: '新名称' },
  ], async (calls) => {
    await listProjects();
    await createProject({ name: '项目' });
    await updateProject('project-1', { name: '新名称' });

    assert.match(calls[0].url, /\/api\/projects$/);
    assert.equal(calls[1].init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { name: '项目' });
    assert.equal(calls[2].init?.method, 'PATCH');
  });
});

test('conversation assignment and removal preserve explicit project identity', async () => {
  await withFakeFetch([
    { status: 'success', sessionId: 'session-1', projectId: 'project-1' },
    { status: 'success', sessionId: 'session-1', projectId: null },
  ], async (calls) => {
    const assigned = await assignConversationToProject('project-1', 'session-1');
    const removed = await removeConversationFromProject('project-1', 'session-1');

    assert.equal(assigned.projectId, 'project-1');
    assert.equal(removed.projectId, null);
    assert.equal(calls[0].init?.method, 'POST');
    assert.equal(calls[1].init?.method, 'DELETE');
  });
});
