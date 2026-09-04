import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendTimelineEvent,
  completeTimelineEvent,
  shouldShowActorLabel,
  type TimelineEventInput,
} from '../src/Code/agentTimeline.ts';
import {
  getAcceptanceEligibility,
  canStartRuntimeRepair,
  type AcceptanceEligibilityState,
} from '../src/Code/acceptancePolicy.ts';
import {
  resetAgentRuns,
} from '../src/Code/agentRunLifecycle.ts';

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

test('keeps separate AgentLoop thinking turns separate and closes only the completed turn', () => {
  let events = appendTimelineEvent([], input({
    eventId: 'turn-1-delta',
    content: '先读取入口文件',
    mergeKey: 'main-1:thinking:turn-1',
  }));
  events = completeTimelineEvent(events, {
    actorId: 'main-1',
    actorKind: 'main',
    stage: 'thinking',
    mergeKey: 'main-1:thinking:turn-1',
    timestampMs: 200,
    durationMs: 100,
  });
  events = appendTimelineEvent(events, input({
    eventId: 'turn-2-delta',
    content: '观察写入结果并继续修正',
    sequence: 3,
    mergeKey: 'main-1:thinking:turn-2',
  }));

  assert.equal(events.length, 2);
  assert.equal(events[0]?.done, true);
  assert.equal(events[0]?.metrics?.durationMs, 100);
  assert.equal(events[1]?.done, false);
  assert.deepEqual(events.map((event) => event.content), [
    '先读取入口文件',
    '观察写入结果并继续修正',
  ]);
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

test('shows an actor label only when the timeline switches lanes', () => {
  const events = [
    { actorKind: 'main' as const },
    { actorKind: 'main' as const },
    { actorKind: 'system' as const },
    { actorKind: 'system' as const },
    { actorKind: 'main' as const },
  ];

  assert.deepEqual(events.map((_, index) => shouldShowActorLabel(events, index)), [
    true,
    false,
    true,
    false,
    true,
  ]);
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

test('does not start acceptance for a restored completed run', () => {
  const state: AcceptanceEligibilityState = {
    candidateRunId: '',
    testedRunId: '',
  };

  const result = getAcceptanceEligibility(state, {
    runId: 'restored-code-run',
    status: 'done',
  });

  assert.equal(result.shouldStart, false);
  assert.equal(result.state.candidateRunId, '');
});

test('starts acceptance only after a live generation reaches done', () => {
  const initial: AcceptanceEligibilityState = {
    candidateRunId: '',
    testedRunId: '',
  };
  const running = getAcceptanceEligibility(initial, {
    runId: 'live-code-run',
    status: 'checking',
  });
  const completed = getAcceptanceEligibility(running.state, {
    runId: 'live-code-run',
    status: 'done',
  });

  assert.equal(running.shouldStart, false);
  assert.equal(completed.shouldStart, true);
  assert.equal(completed.state.candidateRunId, 'live-code-run');
});

test('preserves prior AgentLoop runs for a new request but clears them on explicit reset', () => {
  const previous = [{ id: 'agent-run-1' }] as never[];

  assert.strictEqual(resetAgentRuns(previous, { preserveHistory: true }), previous);
  assert.deepEqual(resetAgentRuns(previous), []);
});

test('does not let runtime errors start ops while the main Agent is still streaming', () => {
  assert.equal(canStartRuntimeRepair({
    mainWorkCompleted: false,
    currentRunId: 'code-run-1',
    errorRunId: 'code-run-1',
  }), false);
  assert.equal(canStartRuntimeRepair({
    mainWorkCompleted: true,
    currentRunId: 'code-run-1',
    errorRunId: 'code-run-1',
  }), true);
});
