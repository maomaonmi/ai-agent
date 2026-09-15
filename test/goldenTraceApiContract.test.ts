import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGoldenTrace,
  enqueueGoldenTraceEvaluation,
  getGoldenTrace,
  listGoldenTraces,
  setGoldenTraceStatus,
  updateGoldenTraceSemantic,
} from '../src/lib/api.ts';

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

test('Golden Trace client preserves paginated outcome contract fields', async () => {
  await withFakeFetch([
    { data: [{ case_id: 'case-1' }], pagination: { page: 2, page_size: 1, total: 2 } },
    { created: true, existing: false, reactivated: false, case: { case_id: 'case-1' } },
    { case: { case_id: 'case-1' }, recent_evaluations: [], evaluation_count: 0 },
  ], async (calls) => {
    const page = await listGoldenTraces({ page: 2, pageSize: 1, status: 'draft' });
    const created = await createGoldenTrace({
      sessionId: 'session-1',
      sourceRunId: 'run-1',
      title: '交互式前端运行时修复',
      contract: { required_scope: 'frontend_runtime' },
    });
    const detail = await getGoldenTrace('case-1');

    assert.equal(page.pagination.total, 2);
    assert.equal(created.case.case_id, 'case-1');
    assert.equal(created.reactivated, false);
    assert.equal(detail.case.case_id, 'case-1');
    assert.match(calls[0].url, /golden-traces\?page=2&page_size=1&status=draft$/);
    assert.equal(calls[1].init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
      session_id: 'session-1',
      source_run_id: 'run-1',
      title: '交互式前端运行时修复',
      contract: { required_scope: 'frontend_runtime' },
    });
  });
});

test('Golden Trace evaluation client uses an idempotent client request id', async () => {
  await withFakeFetch([
    { created: true, existing: false, evaluation: { evaluation_run_id: 'eval-1' } },
  ], async (calls) => {
    const result = await enqueueGoldenTraceEvaluation('case-1', {
      clientRequestId: 'request-1',
      mode: 'replay',
    });

    assert.equal(result.evaluation.evaluation_run_id, 'eval-1');
    assert.equal(calls[0].init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      client_request_id: 'request-1',
      mode: 'replay',
    });
  });
});

test('Golden Trace status client uses the explicit lifecycle endpoint', async () => {
  await withFakeFetch([
    { case: { case_id: 'case-1', status: 'golden' } },
  ], async (calls) => {
    const result = await setGoldenTraceStatus('case-1', 'golden');
    assert.equal(result.case.status, 'golden');
    assert.equal(calls[0].init?.method, 'POST');
    assert.match(calls[0].url, /golden-traces\/case-1\/status$/);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { status: 'golden' });
  });
});

test('Golden Trace client keeps semantic strategy separate from concrete execution', async () => {
  await withFakeFetch([
    { created: true, existing: false, reactivated: false, case: { case_id: 'case-1' } },
    { case: { case_id: 'case-1', semantic_trace: { task_scope: 'frontend_runtime' } } },
  ], async (calls) => {
    await createGoldenTrace({
      sessionId: 'session-1',
      sourceRunId: 'run-1',
      title: '布局修复',
      semanticTrace: {
        task_scope: 'frontend_runtime',
        root_cause_category: 'frontend_layout_geometry',
        allowed_tools: ['read_file', 'patch_file'],
        verification_strategy: ['browser_interaction'],
        success_criteria: ['button_visible'],
      },
    });
    const updated = await updateGoldenTraceSemantic('case-1', {
      task_scope: 'frontend_runtime',
      root_cause_category: 'frontend_layout_geometry',
      allowed_tools: ['read_file', 'patch_file'],
      verification_strategy: ['browser_interaction'],
      success_criteria: ['button_visible'],
    });

    assert.equal(updated.case.case_id, 'case-1');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)).semantic_trace, {
      task_scope: 'frontend_runtime',
      root_cause_category: 'frontend_layout_geometry',
      allowed_tools: ['read_file', 'patch_file'],
      verification_strategy: ['browser_interaction'],
      success_criteria: ['button_visible'],
    });
    assert.match(calls[1].url, /golden-traces\/case-1\/semantic-trace$/);
  });
});
