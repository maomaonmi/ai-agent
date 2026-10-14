import type {
  CodeObservatoryEventPage,
  CodeObservatorySnapshot,
  CodeObservatoryWireEvent,
} from '../lib/codeObservatoryApi';
import type {
  CodeObservatoryAction,
  CodeObservatoryHeartbeat,
  CodeObservatoryState,
} from './codeObservatoryTypes';

export const MAX_CODE_OBSERVATORY_EVENTS = 500;

export function createCodeObservatoryState(aggregateId: string): CodeObservatoryState {
  return {
    aggregateId,
    projectionVersion: null,
    observationOffset: 0,
    headOffset: 0,
    retentionFloorOffset: 0,
    cursor: null,
    events: [],
    status: null,
    sourceWatermarks: [],
    connection: 'idle',
    connectionError: null,
    gapTargetOffset: null,
  };
}

function isOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isStatusAxes(value: unknown): value is CodeObservatoryWireEvent['status'] {
  if (!value || typeof value !== 'object') return false;
  const status = value as Record<string, unknown>;
  return ['execution', 'verification', 'observation'].every(
    (key) => typeof status[key] === 'string',
  );
}

function isCursor(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

function validateEvent(
  event: CodeObservatoryWireEvent,
  state: CodeObservatoryState,
): 'SCHEMA_UNSUPPORTED' | 'CURSOR_INVALID' | null {
  const value = event as unknown as Record<string, unknown>;
  if (value.schema_version !== 'code-observatory/v1') return 'SCHEMA_UNSUPPORTED';
  if (
    value.aggregate_kind !== 'run'
    || value.aggregate_id !== state.aggregateId
    || (value.run_id !== undefined && value.run_id !== null && value.run_id !== state.aggregateId)
    || !isOffset(value.projection_version)
    || value.projection_version !== state.projectionVersion
    || !isOffset(value.observation_offset)
    || value.observation_offset < 1
    || typeof value.event_category !== 'string'
    || typeof value.event_type !== 'string'
    || typeof value.source_role !== 'string'
    || !isStatusAxes(value.status)
  ) return 'CURSOR_INVALID';
  return null;
}

function validateSnapshot(
  snapshot: CodeObservatorySnapshot,
  state: CodeObservatoryState,
): 'SCHEMA_UNSUPPORTED' | 'CURSOR_INVALID' | 'PROJECTION_INCOMPLETE' | null {
  const value = snapshot as unknown as Record<string, unknown>;
  if (value.schema_version !== 'code-observatory/v1') return 'SCHEMA_UNSUPPORTED';
  if (snapshot.projection_version !== 1 || snapshot.feed?.schema_version !== 'code-observatory/v1') {
    return 'SCHEMA_UNSUPPORTED';
  }
  if (
    snapshot.feed?.aggregate_kind !== 'run'
    || snapshot.feed?.aggregate_id !== state.aggregateId
    || snapshot.feed?.cursor?.aggregate_id !== state.aggregateId
    || snapshot.feed?.cursor?.aggregate_kind !== 'run'
  ) return 'CURSOR_INVALID';
  if (
    !isOffset(snapshot.head_offset)
    || !isOffset(snapshot.retention_floor_offset)
    || snapshot.retention_floor_offset > snapshot.head_offset
    || snapshot.feed.cursor.observation_offset !== snapshot.head_offset
    || snapshot.feed.cursor.projection_version !== snapshot.projection_version
    || snapshot.feed.cursor.retention_floor_offset !== snapshot.retention_floor_offset
    || !isCursor(snapshot.cursor)
    || !isStatusAxes(snapshot.feed.status)
    || !Array.isArray(snapshot.feed.events)
    || !Array.isArray(snapshot.feed.source_watermarks)
  ) return 'PROJECTION_INCOMPLETE';

  for (const event of snapshot.feed.events) {
    if (validateEvent(event, { ...state, projectionVersion: snapshot.projection_version })) {
      return event.schema_version === 'code-observatory/v1'
        ? 'PROJECTION_INCOMPLETE'
        : 'SCHEMA_UNSUPPORTED';
    }
    if (event.observation_offset > snapshot.head_offset) return 'PROJECTION_INCOMPLETE';
  }
  return null;
}

function fail(
  state: CodeObservatoryState,
  code: NonNullable<CodeObservatoryState['connectionError']>,
): CodeObservatoryState {
  return { ...state, connection: 'error', connectionError: code };
}

function uniqueSortedEvents(
  events: CodeObservatoryWireEvent[],
): CodeObservatoryWireEvent[] | null {
  const byOffset = new Map<number, CodeObservatoryWireEvent>();
  for (const event of events) {
    const previous = byOffset.get(event.observation_offset);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) return null;
    byOffset.set(event.observation_offset, event);
  }
  return [...byOffset.values()].sort((left, right) => left.observation_offset - right.observation_offset);
}

function receiveSnapshot(
  state: CodeObservatoryState,
  snapshot: CodeObservatorySnapshot,
): CodeObservatoryState {
  const invalidCode = validateSnapshot(snapshot, state);
  if (invalidCode) return fail(state, invalidCode);

  const events = uniqueSortedEvents(snapshot.feed.events);
  if (!events) return fail(state, 'PROJECTION_INCOMPLETE');
  return {
    ...state,
    projectionVersion: snapshot.projection_version,
    observationOffset: snapshot.head_offset,
    headOffset: snapshot.head_offset,
    retentionFloorOffset: snapshot.retention_floor_offset,
    cursor: snapshot.cursor,
    events: events.slice(-MAX_CODE_OBSERVATORY_EVENTS),
    status: snapshot.feed.status,
    sourceWatermarks: snapshot.feed.source_watermarks,
    connection: 'connecting',
    connectionError: null,
    gapTargetOffset: null,
  };
}

function receiveObservation(
  state: CodeObservatoryState,
  event: CodeObservatoryWireEvent,
  cursor: string,
): CodeObservatoryState {
  if (state.projectionVersion === null || state.cursor === null) return state;
  if (!isCursor(cursor)) return fail(state, 'CURSOR_INVALID');
  const invalidCode = validateEvent(event, state);
  if (invalidCode) return fail(state, invalidCode);
  if (event.observation_offset <= state.observationOffset) return state;

  if (event.observation_offset > state.observationOffset + 1) {
    return {
      ...state,
      headOffset: Math.max(state.headOffset, event.observation_offset),
      connection: 'catching_up',
      gapTargetOffset: Math.max(state.gapTargetOffset ?? 0, event.observation_offset),
      connectionError: null,
    };
  }

  const nextOffset = event.observation_offset;
  const nextGapTarget = state.gapTargetOffset !== null && state.gapTargetOffset > nextOffset
    ? state.gapTargetOffset
    : null;
  return {
    ...state,
    observationOffset: nextOffset,
    headOffset: Math.max(state.headOffset, nextOffset),
    cursor,
    events: [...state.events, event].slice(-MAX_CODE_OBSERVATORY_EVENTS),
    status: event.status,
    connection: nextGapTarget === null ? 'live' : 'catching_up',
    connectionError: null,
    gapTargetOffset: nextGapTarget,
  };
}

function markGap(state: CodeObservatoryState, targetOffset: number): CodeObservatoryState {
  if (!isOffset(targetOffset) || targetOffset <= state.observationOffset) {
    return fail(state, 'PROJECTION_INCOMPLETE');
  }
  return {
    ...state,
    headOffset: Math.max(state.headOffset, targetOffset),
    connection: 'catching_up',
    connectionError: null,
    gapTargetOffset: Math.max(state.gapTargetOffset ?? 0, targetOffset),
  };
}

function validHeartbeat(
  heartbeat: CodeObservatoryHeartbeat,
  state: CodeObservatoryState,
): boolean {
  return isCursor(heartbeat.cursor)
    && isOffset(heartbeat.head_offset)
    && heartbeat.head_offset >= state.observationOffset
    && isOffset(heartbeat.retention_floor_offset)
    && heartbeat.retention_floor_offset <= heartbeat.head_offset
    && isStatusAxes(heartbeat.status)
    && Array.isArray(heartbeat.source_watermarks);
}

function receiveHeartbeat(
  state: CodeObservatoryState,
  heartbeat: CodeObservatoryHeartbeat,
): CodeObservatoryState {
  if (state.projectionVersion === null || state.cursor === null) return state;
  if (!validHeartbeat(heartbeat, state)) return fail(state, 'PROJECTION_INCOMPLETE');
  if (heartbeat.retention_floor_offset > state.observationOffset) return fail(state, 'CURSOR_EXPIRED');

  const knownGapTarget = state.gapTargetOffset ?? 0;
  const hasGap = heartbeat.head_offset > state.observationOffset
    || knownGapTarget > state.observationOffset;
  if (hasGap) {
    return markGap(state, Math.max(heartbeat.head_offset, knownGapTarget));
  }

  return {
    ...state,
    cursor: heartbeat.cursor,
    headOffset: Math.max(state.headOffset, heartbeat.head_offset),
    retentionFloorOffset: Math.max(state.retentionFloorOffset, heartbeat.retention_floor_offset),
    status: heartbeat.status,
    sourceWatermarks: heartbeat.source_watermarks,
    connection: 'live',
    connectionError: null,
    gapTargetOffset: null,
  };
}

function receiveCatchupPage(
  state: CodeObservatoryState,
  page: CodeObservatoryEventPage,
  requestedAfterOffset: number,
): CodeObservatoryState {
  if (state.projectionVersion === null || state.cursor === null) return state;
  if (
    page.schema_version !== 'code-observatory/v1'
    || page.projection_version !== state.projectionVersion
  ) return fail(state, 'SCHEMA_UNSUPPORTED');
  if (page.aggregate_kind !== 'run' || page.aggregate_id !== state.aggregateId) {
    return fail(state, 'CURSOR_INVALID');
  }
  if (
    !isOffset(requestedAfterOffset)
    || !isOffset(page.head_offset)
    || page.head_offset < requestedAfterOffset
    || !isOffset(page.retention_floor_offset)
    || page.retention_floor_offset > page.head_offset
    || !isCursor(page.next_cursor)
    || !Array.isArray(page.events)
    || !Array.isArray(page.source_watermarks)
  ) return fail(state, 'PROJECTION_INCOMPLETE');
  if (requestedAfterOffset < page.retention_floor_offset) return fail(state, 'CURSOR_EXPIRED');

  for (const event of page.events) {
    const invalidCode = validateEvent(event, state);
    if (invalidCode) return fail(state, invalidCode);
    if (event.observation_offset > page.head_offset) return fail(state, 'PROJECTION_INCOMPLETE');
  }
  const orderedEvents = uniqueSortedEvents(page.events);
  if (!orderedEvents) return fail(state, 'PROJECTION_INCOMPLETE');

  let observationOffset = state.observationOffset;
  const appended: CodeObservatoryWireEvent[] = [];
  let status = state.status;
  for (const event of orderedEvents) {
    if (event.observation_offset <= observationOffset) continue;
    if (event.observation_offset !== observationOffset + 1) {
      return fail(state, 'PROJECTION_INCOMPLETE');
    }
    observationOffset = event.observation_offset;
    status = event.status;
    appended.push(event);
  }

  const candidateCursorOffset = orderedEvents.at(-1)?.observation_offset ?? requestedAfterOffset;
  const mayAdvanceCursor = candidateCursorOffset === observationOffset
    && observationOffset >= state.observationOffset
    && page.retention_floor_offset >= state.retentionFloorOffset;
  const retentionFloorOffset = Math.max(state.retentionFloorOffset, page.retention_floor_offset);
  const gapTargetOffset = state.gapTargetOffset !== null && state.gapTargetOffset > observationOffset
    ? state.gapTargetOffset
    : null;
  const mayUpdateWatermarks = page.head_offset >= state.headOffset;

  return {
    ...state,
    observationOffset,
    headOffset: Math.max(state.headOffset, page.head_offset),
    retentionFloorOffset,
    cursor: mayAdvanceCursor ? page.next_cursor : state.cursor,
    events: [...state.events, ...appended].slice(-MAX_CODE_OBSERVATORY_EVENTS),
    status,
    sourceWatermarks: mayUpdateWatermarks ? page.source_watermarks : state.sourceWatermarks,
    connection: gapTargetOffset === null
      ? (state.connection === 'catching_up' ? 'live' : state.connection)
      : 'catching_up',
    connectionError: null,
    gapTargetOffset,
  };
}

export function reduceCodeObservatoryState(
  state: CodeObservatoryState,
  action: CodeObservatoryAction,
): CodeObservatoryState {
  switch (action.type) {
    case 'snapshot_loading':
      return { ...state, connection: 'loading', connectionError: null };
    case 'snapshot_received':
      return receiveSnapshot(state, action.snapshot);
    case 'connection_changed':
      return {
        ...state,
        connection: action.connection,
        connectionError: action.connection === 'live' ? null : state.connectionError,
      };
    case 'gap_detected':
      return markGap(state, action.targetOffset);
    case 'observation_received':
      return receiveObservation(state, action.event, action.cursor);
    case 'heartbeat_received':
      return receiveHeartbeat(state, action.heartbeat);
    case 'catchup_page_received':
      return receiveCatchupPage(state, action.page, action.requestedAfterOffset);
    case 'stream_error':
    case 'snapshot_error':
      return fail(state, action.code);
    default:
      return state;
  }
}
