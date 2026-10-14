import type {
  CodeObservatoryErrorCode,
  CodeObservatoryEventPage,
  CodeObservatorySnapshot,
  CodeObservatorySourceWatermark,
  CodeObservatoryStatusAxes,
  CodeObservatoryWireEvent,
} from '../lib/codeObservatoryApi';

export type CodeObservatoryConnection =
  | 'idle'
  | 'loading'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'catching_up'
  | 'closed'
  | 'error';

/** UI state is a bounded projection; connection health stays outside business axes. */
export interface CodeObservatoryState {
  aggregateId: string;
  projectionVersion: number | null;
  observationOffset: number;
  headOffset: number;
  retentionFloorOffset: number;
  cursor: string | null;
  events: CodeObservatoryWireEvent[];
  status: CodeObservatoryStatusAxes | null;
  sourceWatermarks: CodeObservatorySourceWatermark[];
  connection: CodeObservatoryConnection;
  connectionError: CodeObservatoryErrorCode | null;
  gapTargetOffset: number | null;
}

export interface CodeObservatoryHeartbeat {
  cursor: string;
  head_offset: number;
  retention_floor_offset: number;
  status: CodeObservatoryStatusAxes;
  source_watermarks: CodeObservatorySourceWatermark[];
}

export type CodeObservatoryAction =
  | { type: 'snapshot_loading' }
  | { type: 'snapshot_received'; snapshot: CodeObservatorySnapshot }
  | { type: 'connection_changed'; connection: CodeObservatoryConnection }
  | { type: 'gap_detected'; targetOffset: number }
  | { type: 'observation_received'; event: CodeObservatoryWireEvent; cursor: string }
  | { type: 'heartbeat_received'; heartbeat: CodeObservatoryHeartbeat }
  | {
      type: 'catchup_page_received';
      page: CodeObservatoryEventPage;
      requestedAfterOffset: number;
    }
  | { type: 'stream_error'; code: CodeObservatoryErrorCode }
  | { type: 'snapshot_error'; code: CodeObservatoryErrorCode };
