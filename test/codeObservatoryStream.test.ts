import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recoverCodeObservatoryGap,
  runCodeObservatoryStream,
} from '../src/Code/codeObservatoryStream.ts';
import {
  CodeObservatoryApiError,
  type CodeObservatoryEventPage,
  type CodeObservatoryWireEvent,
} from '../src/lib/codeObservatoryApi.ts';

const RUN_ID = 'run-stream-client';

function event(offset: number): CodeObservatoryWireEvent {
  return {
    schema_version: 'code-observatory/v1',
    projection_version: 1,
    aggregate_kind: 'run',
    aggregate_id: RUN_ID,
    run_id: RUN_ID,
    event_category: 'execution',
    event_type: 'future_event_kind',
    source_role: 'runtime_committed',
    observation_offset: offset,
    occurred_at_ms: 2_000 + offset,
    committed_at_ms: 2_000 + offset,
    observed_at_ms: 2_000 + offset,
    status: { execution: 'running', verification: 'unknown', observation: 'current' },
  };
}

function page(events: CodeObservatoryWireEvent[], cursor: string): CodeObservatoryEventPage {
  return {
    schema_version: 'code-observatory/v1',
    projection_version: 1,
    aggregate_kind: 'run',
    aggregate_id: RUN_ID,
    head_offset: events.at(-1)?.observation_offset ?? 0,
    retention_floor_offset: 0,
    events,
    source_watermarks: [],
    next_cursor: cursor,
    has_more: false,
  };
}

function responseWithChunks(text: string): Response {
  const encoded = new TextEncoder().encode(text);
  const splitAt = Math.max(1, encoded.length - 7);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoded.slice(0, splitAt));
      controller.enqueue(encoded.slice(splitAt));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

test('SSE client parses chunked observation and heartbeat frames with opaque ids', async () => {
  let resolveSecondOpen!: () => void;
  const secondOpened = new Promise<void>((resolve) => { resolveSecondOpen = resolve; });
  const requestedCursors: string[] = [];
  const receivedOffsets: number[] = [];
  const deliveredIds: string[] = [];
  const receivedHeartbeats: string[] = [];
  const controller = new AbortController();
  let calls = 0;

  const firstResponse = responseWithChunks([
    `id: cursor:2:0\nevent: observation\ndata: ${JSON.stringify(event(2))}\n\n`,
    `id: cursor:2:0\nevent: heartbeat\ndata: ${JSON.stringify({
      cursor: 'cursor:2:0',
      head_offset: 2,
      retention_floor_offset: 0,
      status: { execution: 'running', verification: 'unknown', observation: 'current' },
      source_watermarks: [],
    })}\n\n`,
    'id: future-cursor\nevent: future_transport\ndata: not-json\n\n',
  ].join(''));

  const running = runCodeObservatoryStream(
    RUN_ID,
    1,
    'cursor:1:0',
    1,
    {
      onConnection: () => undefined,
      onGap: () => undefined,
      onCatchupPage: () => undefined,
      onObservation: (received, cursor) => {
        receivedOffsets.push(received.observation_offset);
        deliveredIds.push(cursor);
      },
      onHeartbeat: (heartbeat) => receivedHeartbeats.push(heartbeat.cursor),
      onError: () => undefined,
    },
    controller.signal,
    {
      openStream: async (_runId, cursor) => {
        requestedCursors.push(cursor);
        calls += 1;
        if (calls === 1) return firstResponse;
        resolveSecondOpen();
        return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          headers: { 'content-type': 'text/event-stream' },
        });
      },
      wait: async () => undefined,
      retryBaseMs: 0,
      retryMaxMs: 0,
    },
  );

  await secondOpened;
  controller.abort();
  await running;

  assert.deepEqual(receivedOffsets, [2]);
  assert.deepEqual(deliveredIds, ['cursor:2:0']);
  assert.deepEqual(receivedHeartbeats, ['cursor:2:0']);
  assert.deepEqual(requestedCursors, ['cursor:1:0', 'cursor:2:0']);
});

test('stream catches up before accepting a later offset or reconnect cursor', async () => {
  const controller = new AbortController();
  const gapTargets: number[] = [];
  const caughtPages: number[][] = [];
  const reconnectCursors: string[] = [];
  let secondOpenResolver!: () => void;
  const secondOpened = new Promise<void>((resolve) => { secondOpenResolver = resolve; });
  let openCount = 0;

  const running = runCodeObservatoryStream(
    RUN_ID,
    1,
    'cursor:1:0',
    1,
    {
      onConnection: () => undefined,
      onGap: (targetOffset) => gapTargets.push(targetOffset),
      onCatchupPage: (nextPage) => {
        caughtPages.push(nextPage.events.map((item) => item.observation_offset));
      },
      onObservation: () => assert.fail('the page already supplied the triggering offset'),
      onHeartbeat: () => undefined,
      onError: (code) => assert.fail(`unexpected stream error: ${code}`),
    },
    controller.signal,
    {
      openStream: async (_runId, cursor) => {
        openCount += 1;
        if (openCount === 1) {
          return responseWithChunks(
            `id: cursor:3:0\nevent: observation\ndata: ${JSON.stringify(event(3))}\n\n`,
          );
        }
        reconnectCursors.push(cursor);
        secondOpenResolver();
        return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          headers: { 'content-type': 'text/event-stream' },
        });
      },
      fetchPage: async () => page([event(2), event(3)], 'cursor:3:0'),
      wait: async () => undefined,
      retryBaseMs: 0,
      retryMaxMs: 0,
    },
  );

  await secondOpened;
  controller.abort();
  await running;

  assert.deepEqual(gapTargets, [3]);
  assert.deepEqual(caughtPages, [[2, 3]]);
  assert.deepEqual(reconnectCursors, ['cursor:3:0']);
});

test('gap recovery follows page cursors until it reaches the announced offset', async () => {
  const requested: Array<{ cursor?: string; limit?: number }> = [];
  const received: number[][] = [];
  const pages = [page([event(2), event(3)], 'cursor:3:0'), page([event(4), event(5)], 'cursor:5:0')];
  const controller = new AbortController();

  const result = await recoverCodeObservatoryGap({
    runId: RUN_ID,
    cursor: 'cursor:1:0',
    afterOffset: 1,
    targetOffset: 5,
    signal: controller.signal,
    fetchPage: async (_runId, options) => {
      requested.push({ cursor: options?.cursor, limit: options?.limit });
      const next = pages.shift();
      assert.ok(next);
      return next;
    },
    onPage: (nextPage) => received.push(nextPage.events.map((item) => item.observation_offset)),
  });

  assert.deepEqual(received, [[2, 3], [4, 5]]);
  assert.deepEqual(requested.map((item) => item.cursor), ['cursor:1:0', 'cursor:3:0']);
  assert.ok(requested.every((item) => item.limit === 100));
  assert.deepEqual(result, { cursor: 'cursor:5:0', observationOffset: 5 });
});

test('gap recovery rejects a page that cannot advance the cursor', async () => {
  const controller = new AbortController();
  await assert.rejects(
    recoverCodeObservatoryGap({
      runId: RUN_ID,
      cursor: 'cursor:1:0',
      afterOffset: 1,
      targetOffset: 2,
      signal: controller.signal,
      fetchPage: async () => page([], 'cursor:1:0'),
      onPage: () => assert.fail('a non-progressing page must not be applied'),
    }),
    /PROJECTION_INCOMPLETE/,
  );
});

test('expired reconnect cursor requests one snapshot resync instead of retrying it', async () => {
  const controller = new AbortController();
  const errors: string[] = [];
  const resyncs: string[] = [];
  let openCount = 0;

  await runCodeObservatoryStream(
    RUN_ID,
    1,
    'expired-cursor',
    1,
    {
      onConnection: () => undefined,
      onGap: () => undefined,
      onCatchupPage: () => undefined,
      onObservation: () => undefined,
      onHeartbeat: () => undefined,
      onError: (code) => errors.push(code),
      onResyncRequired: (code) => resyncs.push(code),
    },
    controller.signal,
    {
      openStream: async () => {
        openCount += 1;
        throw new CodeObservatoryApiError('CURSOR_EXPIRED');
      },
      wait: async () => undefined,
    },
  );

  assert.equal(openCount, 1);
  assert.deepEqual(errors, ['CURSOR_EXPIRED']);
  assert.deepEqual(resyncs, ['CURSOR_EXPIRED']);
});
