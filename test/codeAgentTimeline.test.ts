import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendTimelineEvent,
  completeTimelineEvent,
  filterHookTimelineEvents,
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
import {
  classifyCodeGenerationEvent,
  summarizeAgentLoopRound,
} from '../src/Code/agentEventRouting.ts';
import { applyCodeTaskEvent } from '../src/Code/codeTaskPlan.ts';

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

test('keeps the complete tool report metadata for the scrollable result viewer', () => {
  const fullReport = 'const value = 1;\n'.repeat(40);
  const events = appendTimelineEvent([], input({
    stage: 'status',
    content: '第 1 轮已调用 read_file：const value = 1;…',
    metadata: { tool_name: 'read_file', tool_report: fullReport },
  }));

  assert.equal(events[0]?.metadata?.tool_name, 'read_file');
  assert.equal(events[0]?.metadata?.tool_report, fullReport);
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

test('keeps Hook observations out of the AgentLoop timeline projection', () => {
  const events = [
    input({ eventId: 'main-status', stage: 'status', content: '开始执行' }),
    input({
      eventId: 'hook-started',
      actorId: 'system:run-1:hook:pii',
      actorKind: 'system',
      stage: 'validation',
      content: 'PII 脱敏 · running',
      metadata: { source: 'hook', hookId: 'pii' },
      sequence: 2,
    }),
    input({ eventId: 'main-output', stage: 'output', content: '完成写入', sequence: 3 }),
  ];

  assert.deepEqual(filterHookTimelineEvents(events).map((event) => event.content), [
    '开始执行',
    '完成写入',
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
    runtimeCheckCompleted: false,
    currentRunId: 'code-run-1',
    errorRunId: 'code-run-1',
  }), false);
  assert.equal(canStartRuntimeRepair({
    mainWorkCompleted: true,
    runtimeCheckCompleted: false,
    currentRunId: 'code-run-1',
    errorRunId: 'code-run-1',
  }), false);
  assert.equal(canStartRuntimeRepair({
    mainWorkCompleted: true,
    runtimeCheckCompleted: true,
    currentRunId: 'code-run-1',
    errorRunId: 'code-run-1',
  }), true);
});

test('routes AgentLoop round metrics away from the code-update path', () => {
  assert.equal(classifyCodeGenerationEvent({ type: 'agent_loop_round' }), 'agent_event');
  assert.equal(classifyCodeGenerationEvent({ type: 'code_update' }), 'code_update');
  assert.equal(classifyCodeGenerationEvent({ type: 'future_metadata_event' }), 'agent_event');
});

test('summarizes a round with no effective VFS change without requiring event.code', () => {
  assert.equal(summarizeAgentLoopRound({
    iteration: 1,
    tool_calls_count: 1,
    files_changed: [],
    state_hash_before: 'same',
    state_hash_after: 'same',
  }), 'AgentLoop 第 1 轮完成：工具调用 1 次，本轮没有有效文件变化。');
});

test('replays task events idempotently and keeps stable task identity', () => {
  const listed = applyCodeTaskEvent(null, {
    type: 'task_list',
    run_id: 'run-task-ui',
    plan_id: 'plan-1',
    plan_path: 'PLAN.md',
    todo_path: 'todo.md',
    event_id: 'task-list-1',
    sequence: 1,
    timestamp_ms: 100,
    completed_count: 0,
    total_count: 2,
    status: 'running',
    done: false,
    tasks: [
      { id: 1, task_key: 'task-1', title: '调整底部面板', target_files: ['src/Panel.tsx'], description: '浅色面板', status: 'pending' },
      { id: 2, task_key: 'task-2', title: '验证效果', target_files: ['src/Panel.tsx'], description: '运行检查', status: 'pending' },
    ],
  });
  const started = applyCodeTaskEvent(listed, {
    type: 'task_update',
    run_id: 'run-task-ui',
    plan_id: 'plan-1',
    task_id: 1,
    task_key: 'task-1',
    status: 'in_progress',
    plan_status: 'running',
    event_id: 'task-update-1',
    sequence: 2,
    timestamp_ms: 200,
    done: false,
  });
  const completed = applyCodeTaskEvent(started, {
    type: 'task_update',
    run_id: 'run-task-ui',
    plan_id: 'plan-1',
    task_id: 1,
    task_key: 'task-1',
    status: 'completed',
    plan_status: 'running',
    event_id: 'task-update-2',
    sequence: 3,
    timestamp_ms: 300,
    done: false,
  });
  const replayed = applyCodeTaskEvent(completed, {
    type: 'task_update',
    run_id: 'run-task-ui',
    plan_id: 'plan-1',
    task_id: 1,
    task_key: 'task-1',
    status: 'completed',
    event_id: 'task-update-2',
    sequence: 3,
    timestamp_ms: 300,
    done: false,
  });

  assert.equal(completed, replayed);
  assert.equal(completed.tasks[0]?.task_key, 'task-1');
  assert.equal(completed.tasks[0]?.status, 'completed');
  assert.equal(completed.completedCount, 1);
  assert.equal(completed.totalCount, 2);
  assert.equal(completed.planPath, 'PLAN.md');
  assert.equal(completed.todoPath, 'todo.md');
});
