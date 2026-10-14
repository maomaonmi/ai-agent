import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodeObservatoryApiError,
  getCodeObservatoryEvidencePreview,
  getCodeObservatoryEvents,
  getCodeObservatorySnapshot,
  openCodeObservatoryStream,
} from '../src/lib/codeObservatoryApi.ts';

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

test('evidence preview API is scoped to an encoded Run and evidence reference', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify({ content: 'plain text' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const preview = await getCodeObservatoryEvidencePreview('run/evidence', 'ev:read-1');
    assert.equal(preview.content, 'plain text');
    const url = new URL(requestedUrl);
    assert.equal(url.pathname, '/api/code/observatory/runs/run%2Fevidence/evidence/ev%3Aread-1');
    assert.equal(requestedInit?.cache, 'no-store');
    assert.equal(new Headers(requestedInit?.headers).get('accept'), 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream API resumes through the opaque query cursor with a read-only SSE request', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };

  try {
    const response = await openCodeObservatoryStream('run/observe', 'opaque cursor');
    const url = new URL(requestedUrl);
    assert.equal(response.status, 200);
    assert.equal(url.pathname, '/api/code/observatory/runs/run%2Fobserve/stream');
    assert.equal(url.searchParams.get('cursor'), 'opaque cursor');
    assert.equal(new Headers(requestedInit?.headers).get('accept'), 'text/event-stream');
    assert.equal(requestedInit?.cache, 'no-store');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stream API preserves the safe expired-cursor code from preflight responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    detail: { code: 'CURSOR_EXPIRED', private_path: 'must not be surfaced' },
  }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    await assert.rejects(
      openCodeObservatoryStream('run-observe', 'expired-cursor'),
      (error: unknown) => {
        assert.ok(error instanceof CodeObservatoryApiError);
        assert.equal(error.code, 'CURSOR_EXPIRED');
        assert.doesNotMatch(error.message, /private_path/);
        return true;
      },
    );
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

test('evidence preview API preserves retention status without exposing upstream details', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    detail: { code: 'EVIDENCE_RETENTION_MISSING', local_path: 'C:/private/file.py' },
  }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  });

  try {
    await assert.rejects(
      getCodeObservatoryEvidencePreview('run-observe', 'ev-gone'),
      (error: unknown) => {
        assert.ok(error instanceof CodeObservatoryApiError);
        assert.equal(error.code, 'EVIDENCE_RETENTION_MISSING');
        assert.doesNotMatch(error.message, /local_path/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
