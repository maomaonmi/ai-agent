import assert from 'node:assert/strict';
import test from 'node:test';

import { generateWebCode, replayCodeEvents } from '../src/lib/api.ts';

function frame(sequence: number, overrides: Record<string, unknown> = {}): string {
  const event = {
    type: 'agent_activity',
    channel: 'status',
    phase: 'analyzing',
    content: `event-${sequence}`,
    done: false,
    run_id: 'run-replay',
    event_id: `run-replay:sse:${sequence}`,
    sequence,
    timestamp_ms: sequence,
    ...overrides,
  };
  return `id: ${event.event_id}\nevent: code_agent\ndata: ${JSON.stringify(event)}\n\n`;
}

test('replays every durable page from the requested run cursor without resubmitting work', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: URL; method: string | undefined }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, method: init?.method });
    const after = Number(url.searchParams.get('after'));
    const sequences = after === 5
      ? Array.from({ length: 1000 }, (_, index) => index + 6)
      : after === 1005 ? [1006] : [];
    return new Response(sequences.map((sequence) => frame(sequence)).join(''), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;

  try {
    const delivered: number[] = [];
    const count = await replayCodeEvents('run-replay', 5, (event) => {
      delivered.push(event.sequence ?? 0);
    });

    assert.equal(count, 1001);
    assert.equal(delivered[0], 6);
    assert.equal(delivered.at(-1), 1006);
    assert.deepEqual(calls.map((call) => call.url.searchParams.get('after')), ['5', '1005']);
    assert.ok(calls.every((call) => call.method === undefined || call.method === 'GET'));
    assert.ok(calls.every((call) => call.url.pathname === '/api/code/events/run-replay'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('recovers a terminal event after a cleanly closed but incomplete live stream', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string | undefined }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init?.method });
    return url.pathname.endsWith('/api/code/generate')
      ? new Response(frame(1), { status: 200, headers: { 'content-type': 'text/event-stream' } })
      : new Response(frame(2, {
        type: 'runtime_summary',
        content: 'completed',
        done: true,
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;

  try {
    const received: string[] = [];
    await generateWebCode('generic request', (event) => {
      received.push(event.type);
    }, undefined, [], { run_id: 'run-replay' });

    assert.deepEqual(received, ['agent_activity', 'runtime_summary']);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    assert.equal(calls.filter((call) => call.path.endsWith('/api/code/events/run-replay')).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not treat a partial replay as a completed code request', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; method: string | undefined }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init?.method });
    if (url.pathname.endsWith('/api/code/generate')) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame(1)));
          setTimeout(() => controller.error(new Error('socket reset')), 0);
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(frame(2), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;

  try {
    const received: number[] = [];
    await assert.rejects(
      generateWebCode('generic request', (event) => {
        received.push(event.sequence ?? 0);
      }, undefined, [], { run_id: 'run-replay' }),
      /socket reset/,
    );

    assert.deepEqual(received, [1, 2]);
    assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
    assert.equal(calls.filter((call) => call.path.endsWith('/api/code/events/run-replay')).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
