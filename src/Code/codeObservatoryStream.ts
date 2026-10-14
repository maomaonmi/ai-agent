import {
  CodeObservatoryApiError,
  getCodeObservatoryEvents,
  openCodeObservatoryStream,
  type CodeObservatoryErrorCode,
  type CodeObservatoryEventPage,
  type CodeObservatoryWireEvent,
} from '../lib/codeObservatoryApi.ts';
import type {
  CodeObservatoryConnection,
  CodeObservatoryHeartbeat,
} from './codeObservatoryTypes';

const MAX_SSE_BUFFER_BYTES = 300_000;
const MAX_CATCHUP_PAGE_SIZE = 100;
const RETRY_BASE_MS = 400;
const RETRY_MAX_MS = 8_000;

const KNOWN_ERROR_CODES = new Set<CodeObservatoryErrorCode>([
  'NOT_FOUND',
  'FORBIDDEN',
  'CURSOR_INVALID',
  'CURSOR_EXPIRED',
  'SOURCE_UNAVAILABLE',
  'PROJECTION_INCOMPLETE',
  'SCHEMA_UNSUPPORTED',
  'REQUEST_FAILED',
]);

const RESYNC_CODES = new Set<CodeObservatoryErrorCode>([
  'CURSOR_INVALID',
  'CURSOR_EXPIRED',
  'PROJECTION_INCOMPLETE',
]);

const TERMINAL_CODES = new Set<CodeObservatoryErrorCode>([
  'FORBIDDEN',
  'NOT_FOUND',
  'SCHEMA_UNSUPPORTED',
]);

export interface CodeObservatoryStreamCallbacks {
  onConnection: (connection: Extract<CodeObservatoryConnection, 'connecting' | 'live' | 'reconnecting'>) => void;
  onGap: (targetOffset: number) => void;
  onCatchupPage: (page: CodeObservatoryEventPage, requestedAfterOffset: number) => void;
  onObservation: (event: CodeObservatoryWireEvent, cursor: string) => void;
  onHeartbeat: (heartbeat: CodeObservatoryHeartbeat) => void;
  onError: (code: CodeObservatoryErrorCode) => void;
  onResyncRequired?: (code: CodeObservatoryErrorCode) => void;
}

export interface CodeObservatoryStreamOptions {
  openStream?: typeof openCodeObservatoryStream;
  fetchPage?: typeof getCodeObservatoryEvents;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  retryBaseMs?: number;
  retryMaxMs?: number;
}

interface ParsedSseBlock {
  eventName: string;
  data: string;
  id: string;
  idDeclared: boolean;
}

interface SseReadResult {
  cursor: string;
  observationOffset: number;
  errorCode: CodeObservatoryErrorCode | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasStatusAxes(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['execution', 'verification', 'observation'].every((key) => typeof value[key] === 'string');
}

function safeErrorCode(value: unknown): CodeObservatoryErrorCode {
  return typeof value === 'string' && KNOWN_ERROR_CODES.has(value as CodeObservatoryErrorCode)
    ? value as CodeObservatoryErrorCode
    : 'REQUEST_FAILED';
}

function parseBlock(block: string, currentId: string): ParsedSseBlock | null {
  let eventName = 'message';
  let id = currentId;
  let idDeclared = false;
  const dataLines: string[] = [];

  for (const line of block.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value || 'message';
    if (field === 'data') dataLines.push(value);
    if (field === 'id' && !value.includes('\u0000')) {
      id = value;
      idDeclared = true;
    }
  }

  if (dataLines.length === 0) return null;
  return { eventName, data: dataLines.join('\n'), id, idDeclared };
}

function parseJson(data: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(data);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

async function consumeSseResponse(
  response: Response,
  runId: string,
  projectionVersion: number,
  initialCursor: string,
  initialOffset: number,
  callbacks: CodeObservatoryStreamCallbacks,
  signal: AbortSignal,
  options: CodeObservatoryStreamOptions,
): Promise<SseReadResult> {
  if (!response.body) {
    return { cursor: initialCursor, observationOffset: initialOffset, errorCode: 'PROJECTION_INCOMPLETE' };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const cancelRead = () => { void reader.cancel().catch(() => undefined); };
  let buffer = '';
  let cursor = initialCursor;
  let observationOffset = initialOffset;
  let errorCode: CodeObservatoryErrorCode | null = null;

  const handleBlock = async (block: string): Promise<void> => {
    const parsed = parseBlock(block, cursor);
    if (!parsed) return;
    if (!['observation', 'heartbeat', 'error'].includes(parsed.eventName)) return;
    const payload = parseJson(parsed.data);
    if (!payload) {
      errorCode = 'PROJECTION_INCOMPLETE';
      return;
    }

    if (parsed.eventName === 'observation') {
      if (
        payload.schema_version !== 'code-observatory/v1'
        || payload.projection_version !== projectionVersion
      ) {
        errorCode = 'SCHEMA_UNSUPPORTED';
        return;
      }
      if (!parsed.idDeclared || !parsed.id || parsed.id.length > 512) {
        errorCode = 'CURSOR_INVALID';
        return;
      }
      if (
        payload.aggregate_kind !== 'run'
        || payload.aggregate_id !== runId
        || (payload.run_id !== undefined && payload.run_id !== null && payload.run_id !== runId)
        || !isOffset(payload.observation_offset)
        || payload.observation_offset < 1
        || !hasStatusAxes(payload.status)
      ) {
        errorCode = 'CURSOR_INVALID';
        return;
      }
      const eventOffset = payload.observation_offset;
      if (eventOffset <= observationOffset) return;
      if (eventOffset > observationOffset + 1) {
        callbacks.onGap(eventOffset);
        const recovered = await recoverCodeObservatoryGap({
          runId,
          projectionVersion,
          cursor,
          afterOffset: observationOffset,
          targetOffset: eventOffset,
          signal,
          fetchPage: options.fetchPage,
          onPage: callbacks.onCatchupPage,
        });
        cursor = recovered.cursor;
        observationOffset = recovered.observationOffset;
        if (signal.aborted || eventOffset <= observationOffset) return;
      }
      if (eventOffset !== observationOffset + 1) {
        errorCode = 'PROJECTION_INCOMPLETE';
        return;
      }
      callbacks.onObservation(payload as unknown as CodeObservatoryWireEvent, parsed.id);
      cursor = parsed.id;
      observationOffset = eventOffset;
      return;
    }

    if (parsed.eventName === 'heartbeat') {
      if (
        !parsed.idDeclared
        || typeof payload.cursor !== 'string'
        || payload.cursor !== parsed.id
        || parsed.id.length > 512
        || !isOffset(payload.head_offset)
        || !isOffset(payload.retention_floor_offset)
        || payload.retention_floor_offset > payload.head_offset
        || !hasStatusAxes(payload.status)
        || !Array.isArray(payload.source_watermarks)
      ) {
        errorCode = 'CURSOR_INVALID';
        return;
      }
      if (payload.retention_floor_offset > observationOffset) {
        errorCode = 'CURSOR_EXPIRED';
        return;
      }
      if (payload.head_offset > observationOffset) {
        callbacks.onGap(payload.head_offset);
        const recovered = await recoverCodeObservatoryGap({
          runId,
          projectionVersion,
          cursor,
          afterOffset: observationOffset,
          targetOffset: payload.head_offset,
          signal,
          fetchPage: options.fetchPage,
          onPage: callbacks.onCatchupPage,
        });
        cursor = recovered.cursor;
        observationOffset = recovered.observationOffset;
        if (signal.aborted) return;
      }
      if (payload.head_offset < observationOffset) return;
      if (payload.head_offset > observationOffset) {
        errorCode = 'PROJECTION_INCOMPLETE';
        return;
      }
      cursor = payload.cursor;
      callbacks.onHeartbeat(payload as unknown as CodeObservatoryHeartbeat);
      return;
    }

    if (parsed.eventName === 'error') {
      errorCode = safeErrorCode(payload.code);
      return;
    }
  };

  signal.addEventListener('abort', cancelRead, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });
      if (encoder.encode(buffer).byteLength > MAX_SSE_BUFFER_BYTES) {
        errorCode = 'PROJECTION_INCOMPLETE';
        return { cursor, observationOffset, errorCode };
      }

      let separator = /(?:\r\n|\r|\n){2}/.exec(buffer);
      while (separator) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        await handleBlock(block);
        if (errorCode) return { cursor, observationOffset, errorCode };
        separator = /(?:\r\n|\r|\n){2}/.exec(buffer);
      }

      if (done) return { cursor, observationOffset, errorCode };
    }
    return { cursor, observationOffset, errorCode };
  } catch (error) {
    if (signal.aborted) return { cursor, observationOffset, errorCode: null };
    return {
      cursor,
      observationOffset,
      errorCode: error instanceof CodeObservatoryApiError ? error.code : 'REQUEST_FAILED',
    };
  } finally {
    signal.removeEventListener('abort', cancelRead);
    if (signal.aborted || errorCode !== null) {
      try {
        await reader.cancel();
      } catch {
        // Fetch cancellation can close the reader before explicit cleanup.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // A cancelled network read may already have released its lock.
    }
  }
}

function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

function isResyncCode(code: CodeObservatoryErrorCode): boolean {
  return RESYNC_CODES.has(code);
}

export async function runCodeObservatoryStream(
  runId: string,
  projectionVersion: number,
  initialCursor: string,
  initialOffset: number,
  callbacks: CodeObservatoryStreamCallbacks,
  signal: AbortSignal,
  options: CodeObservatoryStreamOptions = {},
): Promise<void> {
  let cursor = initialCursor;
  let observationOffset = initialOffset;
  let attempts = 0;
  const openStream = options.openStream ?? openCodeObservatoryStream;
  const wait = options.wait ?? waitForRetry;
  const retryBaseMs = Math.max(0, options.retryBaseMs ?? RETRY_BASE_MS);
  const retryMaxMs = Math.max(retryBaseMs, options.retryMaxMs ?? RETRY_MAX_MS);

  while (!signal.aborted) {
    callbacks.onConnection(attempts === 0 ? 'connecting' : 'reconnecting');
    try {
      const response = await openStream(runId, cursor, signal);
      if (signal.aborted) return;
      callbacks.onConnection('live');
      const result = await consumeSseResponse(
        response,
        runId,
        projectionVersion,
        cursor,
        observationOffset,
        callbacks,
        signal,
        options,
      );
      cursor = result.cursor;
      observationOffset = result.observationOffset;
      if (signal.aborted) return;
      if (result.errorCode) {
        callbacks.onError(result.errorCode);
        if (isResyncCode(result.errorCode)) callbacks.onResyncRequired?.(result.errorCode);
        if (isResyncCode(result.errorCode) || TERMINAL_CODES.has(result.errorCode)) return;
      }
    } catch (error) {
      if (signal.aborted) return;
      const code = error instanceof CodeObservatoryApiError ? error.code : 'REQUEST_FAILED';
      callbacks.onError(code);
      if (isResyncCode(code)) callbacks.onResyncRequired?.(code);
      if (isResyncCode(code) || TERMINAL_CODES.has(code)) return;
    }

    callbacks.onConnection('reconnecting');
    const delay = Math.min(retryMaxMs, retryBaseMs * (2 ** Math.min(attempts, 8)));
    attempts += 1;
    await wait(delay, signal);
  }
}

export interface CodeObservatoryGapRecoveryOptions {
  runId: string;
  projectionVersion?: number;
  cursor: string;
  afterOffset: number;
  targetOffset: number;
  signal: AbortSignal;
  onPage: (page: CodeObservatoryEventPage, requestedAfterOffset: number) => void;
  fetchPage?: typeof getCodeObservatoryEvents;
}

/** Read contiguous, bounded pages until the stream's announced gap is filled. */
export async function recoverCodeObservatoryGap(
  options: CodeObservatoryGapRecoveryOptions,
): Promise<{ cursor: string; observationOffset: number }> {
  const projectionVersion = options.projectionVersion ?? 1;
  let cursor = options.cursor;
  let observationOffset = options.afterOffset;
  const fetchPage = options.fetchPage ?? getCodeObservatoryEvents;

  if (
    !cursor
    || cursor.length > 512
    || !isOffset(observationOffset)
    || !isOffset(options.targetOffset)
    || options.targetOffset <= observationOffset
  ) throw new CodeObservatoryApiError('CURSOR_INVALID');

  while (observationOffset < options.targetOffset && !options.signal.aborted) {
    const requestedAfterOffset = observationOffset;
    const page = await fetchPage(options.runId, {
      cursor,
      limit: MAX_CATCHUP_PAGE_SIZE,
      signal: options.signal,
    });
    if (options.signal.aborted) break;

    if (
      page.schema_version !== 'code-observatory/v1'
      || page.projection_version !== projectionVersion
    ) throw new CodeObservatoryApiError('SCHEMA_UNSUPPORTED');
    if (page.aggregate_kind !== 'run' || page.aggregate_id !== options.runId) {
      throw new CodeObservatoryApiError('CURSOR_INVALID');
    }
    if (
      !Array.isArray(page.events)
      || !Array.isArray(page.source_watermarks)
      || !isOffset(page.head_offset)
      || page.head_offset < requestedAfterOffset
      || !isOffset(page.retention_floor_offset)
      || page.retention_floor_offset > page.head_offset
      || typeof page.next_cursor !== 'string'
      || page.next_cursor.length === 0
      || page.next_cursor.length > 512
    ) throw new CodeObservatoryApiError('PROJECTION_INCOMPLETE');
    if (requestedAfterOffset < page.retention_floor_offset) {
      throw new CodeObservatoryApiError('CURSOR_EXPIRED');
    }

    let expectedOffset = requestedAfterOffset;
    for (const event of page.events) {
      if (event.schema_version !== 'code-observatory/v1' || event.projection_version !== projectionVersion) {
        throw new CodeObservatoryApiError('SCHEMA_UNSUPPORTED');
      }
      if (
        event.aggregate_kind !== 'run'
        || event.aggregate_id !== options.runId
        || (event.run_id !== undefined && event.run_id !== null && event.run_id !== options.runId)
        || !isOffset(event.observation_offset)
        || event.observation_offset < 1
        || !hasStatusAxes(event.status)
        || typeof event.event_category !== 'string'
        || typeof event.event_type !== 'string'
        || typeof event.source_role !== 'string'
      ) throw new CodeObservatoryApiError('CURSOR_INVALID');
      if (event.observation_offset > page.head_offset) {
        throw new CodeObservatoryApiError('PROJECTION_INCOMPLETE');
      }
      if (event.observation_offset <= expectedOffset) continue;
      if (event.observation_offset !== expectedOffset + 1) {
        throw new CodeObservatoryApiError('PROJECTION_INCOMPLETE');
      }
      expectedOffset = event.observation_offset;
    }
    if (expectedOffset <= requestedAfterOffset) {
      throw new CodeObservatoryApiError('PROJECTION_INCOMPLETE');
    }

    options.onPage(page, requestedAfterOffset);
    observationOffset = expectedOffset;
    cursor = page.next_cursor;
  }

  return { cursor, observationOffset };
}
