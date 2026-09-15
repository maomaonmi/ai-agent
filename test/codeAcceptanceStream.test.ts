import assert from 'node:assert/strict';
import test from 'node:test';

import { runCodeAcceptanceTest } from '../src/lib/api.ts';

test('delivers browser-verifier progress before resolving the final report', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const encoder = new TextEncoder();
  const progress: string[] = [];
  let resolved = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { setTimeout, clearTimeout },
  });
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(
        'data: {"type":"acceptance_progress","event":"started","verification_run_id":"verify-1","sequence":1,"timestamp_ms":1,"message":"已启动"}\n\n',
      ));
      queueMicrotask(() => {
        controller.enqueue(encoder.encode(
          'data: {"type":"acceptance_progress","event":"running","verification_run_id":"verify-1","sequence":2,"timestamp_ms":2,"message":"正在交互","elapsed_seconds":1}\n\n',
        ));
        controller.enqueue(encoder.encode(
          'data: {"type":"acceptance_progress","event":"completed","verification_run_id":"verify-1","sequence":3,"timestamp_ms":3,"message":"完成","report":{"passed":true,"blocked":false,"verification_run_id":"verify-1"}}\n\n',
        ));
        controller.close();
      });
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

  try {
    const pending = runCodeAcceptanceTest({
      user_request: '验证页面',
      preview_html: '<main>ok</main>',
      console_entries: [],
      verification_run_id: 'verify-1',
    }, (event) => {
      if (event.event === 'started') assert.equal(resolved, false);
      progress.push(event.message);
    });
    const report = await pending.finally(() => { resolved = true; });
    assert.deepEqual(progress, ['已启动', '正在交互', '完成']);
    assert.equal(report.passed, true);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});
