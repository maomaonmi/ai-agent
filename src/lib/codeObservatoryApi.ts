import { API_BASE_URL } from './api.ts';

export interface CodeObservatoryStatusAxes {
  execution: string;
  verification: string;
  observation: string;
}

export interface CodeObservatorySourceRef {
  stream_key?: string | null;
  event_key?: string | null;
  source_event_id?: string | null;
  source_sequence?: number | null;
  stream_sequence?: number | null;
  transport_event_id?: string | null;
  transport_sequence?: number | null;
}

export interface CodeObservatorySpanView {
  span_id: string;
  span_kind: 'model_turn' | 'tool_action' | 'verification';
  aggregate_kind: 'run' | 'operation';
  aggregate_id: string;
  operation_id?: string | null;
  run_id: string;
  attempt_ref?: string | null;
  turn_id?: string | null;
  action_id?: string | null;
  tool_name?: string | null;
  candidate_revision?: string | null;
  execution_generation?: number | null;
  parent_span_id?: string | null;
  source_refs: CodeObservatorySourceRef[];
  receipt_refs: CodeObservatorySourceRef[];
  start_ref?: CodeObservatorySourceRef | null;
  end_ref?: CodeObservatorySourceRef | null;
  started_at_ms?: number | null;
  ended_at_ms?: number | null;
  start_committed_at_ms?: number | null;
  end_committed_at_ms?: number | null;
  duration_ms?: number | null;
  lifecycle_status: 'open' | 'closed' | 'incomplete';
  execution_status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  verification_status: string;
  association_status: 'complete' | 'orphan' | 'incomplete' | 'ambiguous';
}

export type CodeObservatoryErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CURSOR_INVALID'
  | 'CURSOR_EXPIRED'
  | 'SOURCE_UNAVAILABLE'
  | 'PROJECTION_INCOMPLETE'
  | 'SCHEMA_UNSUPPORTED'
  | 'REQUEST_FAILED';

export class CodeObservatoryApiError extends Error {
  readonly code: CodeObservatoryErrorCode;

  constructor(code: CodeObservatoryErrorCode) {
    super(code);
    this.code = code;
    this.name = 'CodeObservatoryApiError';
  }
}

export interface CodeObservatoryWireEvent {
  schema_version: 'code-observatory/v1';
  projection_version: number;
  aggregate_kind: 'run' | 'operation';
  aggregate_id: string;
  operation_id?: string | null;
  run_id?: string | null;
  event_category: string;
  event_type: string;
  source_role: string;
  observation_offset: number;
  occurred_at_ms?: number | null;
  committed_at_ms?: number | null;
  observed_at_ms: number;
  status: CodeObservatoryStatusAxes;
}

export interface CodeObservatorySourceWatermark {
  source_kind: string;
  stream_key: string;
  last_source_sequence?: number | null;
  last_stream_sequence?: number | null;
  last_source_event_id?: string | null;
  last_transport_sequence?: number | null;
  last_transport_event_id?: string | null;
  coverage_status: string;
}

export interface CodeObservatorySnapshot {
  schema_version: 'code-observatory/v1';
  projection_version: number;
  head_offset: number;
  retention_floor_offset: number;
  cursor: string;
  feed: {
    schema_version: 'code-observatory/v1';
    aggregate_kind: 'run';
    aggregate_id: string;
    status: CodeObservatoryStatusAxes;
    cursor: {
      aggregate_kind: 'run';
      aggregate_id: string;
      projection_version: number;
      observation_offset: number;
      retention_floor_offset: number;
    };
    events: CodeObservatoryWireEvent[];
    spans?: CodeObservatorySpanView[];
    source_watermarks: CodeObservatorySourceWatermark[];
    has_more: boolean;
  };
}

export interface CodeObservatoryEventPage {
  schema_version: 'code-observatory/v1';
  projection_version: number;
  aggregate_kind: 'run';
  aggregate_id: string;
  head_offset: number;
  retention_floor_offset: number;
  events: CodeObservatoryWireEvent[];
  source_watermarks: CodeObservatorySourceWatermark[];
  next_cursor: string;
  has_more: boolean;
}

async function throwCodeObservatoryApiError(response: Response): Promise<never> {
  let code: CodeObservatoryErrorCode = 'REQUEST_FAILED';
  try {
    const payload = await response.json() as { detail?: { code?: unknown } };
    const candidate = payload.detail?.code;
    if (typeof candidate === 'string' && [
      'NOT_FOUND',
      'FORBIDDEN',
      'CURSOR_INVALID',
      'CURSOR_EXPIRED',
      'SOURCE_UNAVAILABLE',
      'PROJECTION_INCOMPLETE',
      'SCHEMA_UNSUPPORTED',
    ].includes(candidate)) {
      code = candidate as CodeObservatoryErrorCode;
    }
  } catch {
    // Keep only a bounded error class; upstream bodies may contain unsafe details.
  }
  throw new CodeObservatoryApiError(code);
}

/** Read the persisted Run projection; this endpoint never starts or resumes work. */
export async function getCodeObservatorySnapshot(
  runId: string,
  signal?: AbortSignal,
): Promise<CodeObservatorySnapshot> {
  const response = await fetch(
    `${API_BASE_URL}/api/code/observatory/runs/${encodeURIComponent(runId)}/snapshot`,
    { headers: { Accept: 'application/json' }, cache: 'no-store', signal },
  );
  if (!response.ok) await throwCodeObservatoryApiError(response);
  return response.json() as Promise<CodeObservatorySnapshot>;
}

/** Read one bounded page from the same immutable observation-offset stream. */
export async function getCodeObservatoryEvents(
  runId: string,
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<CodeObservatoryEventPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
  if (options.cursor) query.set('cursor', options.cursor);
  const response = await fetch(
    `${API_BASE_URL}/api/code/observatory/runs/${encodeURIComponent(runId)}/events?${query.toString()}`,
    { headers: { Accept: 'application/json' }, cache: 'no-store', signal: options.signal },
  );
  if (!response.ok) await throwCodeObservatoryApiError(response);
  return response.json() as Promise<CodeObservatoryEventPage>;
}

/** Open the read-only SSE endpoint from an opaque committed observation cursor. */
export async function openCodeObservatoryStream(
  runId: string,
  cursor: string,
  signal?: AbortSignal,
): Promise<Response> {
  const query = new URLSearchParams({ cursor });
  const response = await fetch(
    `${API_BASE_URL}/api/code/observatory/runs/${encodeURIComponent(runId)}/stream?${query.toString()}`,
    {
      headers: { Accept: 'text/event-stream' },
      cache: 'no-store',
      signal,
    },
  );
  if (!response.ok) await throwCodeObservatoryApiError(response);
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new CodeObservatoryApiError('PROJECTION_INCOMPLETE');
  }
  return response;
}
