import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendTimelineEvent,
  type TimelineEventInput,
} from '../src/Code/agentTimeline.ts';

function input(overrides: Partial<TimelineEventInput> = {}): TimelineEventInput {
  return {
    eventId: 'event-1',
    runId: 'run-1',
    actorId: 'main-1',
    actorKind: 'main',
    stage: 'thinking',
    content: '先检查页面结构',
    done: false,
    timestampMs: 100,
    sequence: 1,
    ...overrides,
  };
}

test('merges streamed deltas into one timeline item without losing metrics', () => {
  let events = appendTimelineEvent([], input({ mergeKey: 'main-1:iteration-1:thinking' }));
  events = appendTimelineEvent(events, input({
    eventId: 'event-2',
    content: '再读取相关文件',
    timestampMs: 200,
    sequence: 2,
    mergeKey: 'main-1:iteration-1:thinking',
    metrics: { charCount: 7, durationMs: 100 },
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0]?.content, '先检查页面结构再读取相关文件');
  assert.equal(events[0]?.metrics?.charCount, 7);
  assert.equal(events[0]?.sequence, 1);
  assert.equal(events[0]?.timestampMs, 200);
});

test('keeps main, test, and ops actors separate even when stages match', () => {
  let events = appendTimelineEvent([], input({ mergeKey: 'thinking' }));
  events = appendTimelineEvent(events, input({
    eventId: 'event-test',
    actorId: 'test-1',
    actorKind: 'test',
    content: '制定验收计划',
    sequence: 2,
    mergeKey: 'thinking',
  }));
  events = appendTimelineEvent(events, input({
    eventId: 'event-ops',
    actorId: 'ops-1',
    actorKind: 'ops',
    content: '诊断运行错误',
    sequence: 3,
    mergeKey: 'thinking',
  }));

  assert.deepEqual(events.map((event) => event.actorKind), ['main', 'test', 'ops']);
  assert.deepEqual(events.map((event) => event.content), ['先检查页面结构', '制定验收计划', '诊断运行错误']);
});

test('is idempotent when the same event is replayed after an SSE reconnect', () => {
  const first = appendTimelineEvent([], input({ eventId: 'replayed', sequence: 9 }));
  const replayed = appendTimelineEvent(first, input({
    eventId: 'replayed',
    content: '重复事件不应再次出现',
    sequence: 9,
  }));

  assert.equal(replayed.length, 1);
  assert.equal(replayed[0]?.content, '重复事件不应再次出现');
});
