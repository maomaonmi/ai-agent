import assert from 'node:assert/strict';
import test from 'node:test';

import { CodeObservatoryApiError, getCodeObservatoryEvents, getCodeObservatorySnapshot } from '../src/lib/codeObservatoryApi.ts';

test('snapshot API is a cache-free GET scoped to the encoded Run identity', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify({ schema_version: 'code-observatory/v1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await getCodeObservatorySnapshot('run-observe');
    assert.equal(result.schema_version, 'code-observatory/v1');
    assert.match(requestedUrl, /\/api\/code\/observatory\/runs\/run-observe\/snapshot$/);
    assert.equal(requestedInit?.method, undefined);
    assert.equal(requestedInit?.cache, 'no-store');
    assert.equal(new Headers(requestedInit?.headers).get('accept'), 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('event page API carries the stable cursor and bounded page size', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ next_cursor: 'cursor-next' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const page = await getCodeObservatoryEvents('run-observe', {
      cursor: 'opaque cursor',
      limit: 24,
    });
    assert.equal(page.next_cursor, 'cursor-next');
    const url = new URL(requestedUrl);
    assert.equal(url.pathname, '/api/code/observatory/runs/run-observe/events');
    assert.equal(url.searchParams.get('cursor'), 'opaque cursor');
    assert.equal(url.searchParams.get('limit'), '24');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('observatory API errors preserve only the structured safe error code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    detail: { code: 'SOURCE_UNAVAILABLE', private_path: 'must not be surfaced' },
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    await assert.rejects(
      getCodeObservatorySnapshot('run-observe'),
      (error: unknown) => {
        assert.ok(error instanceof CodeObservatoryApiError);
        assert.equal(error.code, 'SOURCE_UNAVAILABLE');
        assert.doesNotMatch(error.message, /private_path/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
