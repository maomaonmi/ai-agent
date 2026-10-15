import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCodeObservatoryReplayState,
  createCodeObservatoryState,
  reduceCodeObservatoryState,
} from '../src/Code/codeObservatoryReducer.ts';
import type {
  CodeObservatoryReplaySnapshot,
  CodeObservatorySnapshot,
  CodeObservatoryWireEvent,
} from '../src/lib/codeObservatoryApi.ts';

const RUN_ID = 'run-replay-ui';

function event(offset: number): CodeObservatoryWireEvent {
  return {
    schema_version: 'code-observatory/v1',
    projection_version: 1,
    aggregate_kind: 'run',
    aggregate_id: RUN_ID,
    run_id: RUN_ID,
    event_category: 'execution',
    event_type: 'agent_activity',
    source_role: 'runtime_committed',
    observation_offset: offset,
    observed_at_ms: 1_000 + offset,
    status: { execution: 'running', verification: 'unknown', observation: 'incomplete' },
  };
}

function replaySnapshot(replayOffset: number, headOffset = 4): CodeObservatoryReplaySnapshot {
  const events = Array.from({ length: replayOffset }, (_, index) => event(index + 1));
  return {
    schema_version: 'code-observatory/v1',
    projection_version: 1,
    replay_offset: replayOffset,
    replay_history_start_offset: Math.max(0, replayOffset - 10_000),
    head_offset: headOffset,
    retention_floor_offset: 0,
    cursor: `replay:${replayOffset}`,
    feed: {
      schema_version: 'code-observatory/v1',
      aggregate_kind: 'run',
      aggregate_id: RUN_ID,
      status: { execution: 'running', verification: 'unknown', observation: 'incomplete' },
      cursor: {
        aggregate_kind: 'run',
        aggregate_id: RUN_ID,
        projection_version: 1,
        observation_offset: replayOffset,
        retention_floor_offset: 0,
      },
      events,
      nodes: [],
      decisions: [],
      evidence: [],
      spans: [],
      source_watermarks: [],
      has_more: false,
    },
  };
}

function liveState(headOffset: number) {
  const snapshot: CodeObservatorySnapshot = {
    ...replaySnapshot(headOffset, headOffset),
    head_offset: headOffset,
    feed: {
      ...replaySnapshot(headOffset, headOffset).feed,
      status: { execution: 'running', verification: 'unknown', observation: 'current' },
    },
  };
  return reduceCodeObservatoryState(
    createCodeObservatoryState(RUN_ID),
    { type: 'snapshot_received', snapshot },
  );
}

test('replay display uses one historical offset and leaves live state untouched', () => {
  const live = liveState(4);
  const replay = createCodeObservatoryReplayState(replaySnapshot(2), RUN_ID);

  assert.equal(replay?.observationOffset, 2);
  assert.equal(replay?.headOffset, 4);
  assert.deepEqual(replay?.events.map((item) => item.observation_offset), [1, 2]);
  assert.equal(replay?.connection, 'closed');
  assert.equal(live.observationOffset, 4);
  assert.deepEqual(live.events.map((item) => item.observation_offset), [1, 2, 3, 4]);
});

test('replay display rejects mismatched identities and events beyond its watermark', () => {
  const mismatched = replaySnapshot(2);
  mismatched.feed.aggregate_id = 'run-other';
  assert.equal(createCodeObservatoryReplayState(mismatched, RUN_ID), null);

  const futureEvent = replaySnapshot(2);
  futureEvent.feed.events.push(event(3));
  assert.equal(createCodeObservatoryReplayState(futureEvent, RUN_ID), null);
});
