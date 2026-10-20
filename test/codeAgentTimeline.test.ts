import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendTimelineEvent,
  buildPairedActionStatus,
  completeTimelineEvent,
  filterDuplicateFinalSummaryEvents,
  filterHookTimelineEvents,
  describeActionIntentInChinese,
  describeTestAgentActionInChinese,
  resolveActionIntentNarration,
  shouldShowActorLabel,
  timelineStatusLabel,
  projectTimelineCompletionFeedback,
  type TimelineEventInput,
} from '../src/Code/agentTimeline.ts';
import { plannerBudgetPresentation } from '../src/Code/plannerBudgetPresentation.ts';
import {
  getAcceptanceEligibility,
  canStartRuntimeRepair,
  type AcceptanceEligibilityState,
} from '../src/Code/acceptancePolicy.ts';
import {
  bindRuntimeVerificationCandidate,
  getNewestAgentRun,
  isAgentRunExecutionActive,
  mapAgentRunsToPrompts,
  getAgentRunLineage,
  projectRuntimeSummaryStatus,
  resetAgentRuns,
  sortAgentRunsChronologically,
  settleAgentRunAsSuperseded,
} from '../src/Code/agentRunLifecycle.ts';
import {
  classifyCodeGenerationEvent,
  summarizeAgentLoopRound,
} from '../src/Code/agentEventRouting.ts';
import { applyCodeTaskEvent, projectCodeTaskPlanSnapshot } from '../src/Code/codeTaskPlan.ts';
import type { CodeAgentRun, CodeAgentTrace } from '../src/lib/api.ts';

test('keeps the completion feedback as the only copy of the terminal summary', () => {
  const finalSummary = '验收暂未运行；候选源码保持有效。Runtime 保留验收状态为 pending。';
  const action = input({ eventId: 'action-output', stage: 'output', content: '我先核对候选版本。' });
  const streamedFinal = input({ eventId: 'streamed-final', stage: 'output', content: '验收暂未运行；候选源码保持有效。' });
  const runtimeSummary = input({ eventId: 'runtime-summary', stage: 'summary', content: finalSummary });
  const distinctSummary = input({ eventId: 'distinct-summary', stage: 'summary', content: '另一阶段的进度说明。' });

  const visible = filterDuplicateFinalSummaryEvents(
    [action, streamedFinal, runtimeSummary, distinctSummary],
    finalSummary,
  );

  assert.deepEqual(visible.map((event) => event.eventId), ['action-output', 'distinct-summary']);
});

test('keeps streamed output when no completion summary is available', () => {
  const finalOutput = input({ eventId: 'streamed-final', stage: 'output', content: '最终说明。' });

  assert.deepEqual(filterDuplicateFinalSummaryEvents([finalOutput], ''), [finalOutput]);
});

test('describes provider-specific planner budget semantics without calling a shared cap an output cap', () => {
  assert.deepEqual(plannerBudgetPresentation('shared_completion'), {
    summary: '推理与回答共用总生成额度',
    completionLimitLabel: '总生成上限',
    completionUsageLabel: '总生成用量',
    reasoningBudgetLabel: '上游推理 token 用量',
  });
  assert.deepEqual(plannerBudgetPresentation('separate'), {
    summary: '推理预算与可见输出上限分别控制',
    completionLimitLabel: '可见输出 token 上限',
    completionUsageLabel: '可见输出 token 用量',
    reasoningBudgetLabel: '独立推理 token 上限',
  });
});

test('durable completion feedback survives replayed rejected validation calls', () => {
  const feedback = {summary: 'Implemented, proof pending', changes: [], candidate_revision: 'current', verification: {
    status: 'needs_attention', static_validation: 'passed', acceptance_validation: 'unverifiable',
  }};
  const run: CodeAgentRun = {
    id: 'run-1', request: 'verify', projectKind: 'fullstack', createdAt: '2026-10-15T00:00:00Z',
    trace: {steps: [], output: '', phase: 'done', isRunning: false, completionFeedback: feedback},
  };
  const denied = input({stage: 'status', status: 'failed', metadata: {
    phase: 'tool_result', tool_name: 'validate_project', runtimeStatus: 'failed',
  }});
  assert.equal(projectTimelineCompletionFeedback(run, [denied]), feedback);
});

test('legacy static projection uses candidate-bound Runtime results, not tool failures', () => {
  const run = {trace: {status: 'needs_attention', fileChanges: [{path: 'index.html', additions: 1, deletions: 0}],
    runtimeVerification: {candidateRevision: 'current'}}} as CodeAgentRun;
  const passed = input({metadata: {phase: 'static_verify', runtimeStatus: 'passed', candidate_revision: 'current'}});
  const denied = input({eventId: 'denied', status: 'failed', metadata: {
    phase: 'tool_result', tool_name: 'validate_project', runtimeStatus: 'failed',
  }});
  assert.equal(projectTimelineCompletionFeedback(run, [passed, denied])?.verification.static_validation, 'passed');
  const stale = {...passed, metadata: {...passed.metadata, candidate_revision: 'old'}};
  assert.equal(projectTimelineCompletionFeedback(run, [stale, denied])?.verification.static_validation, 'unknown');
});

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

test('keeps the concise CodeAgent preflight as its own timeline stage', () => {
  const events = appendTimelineEvent([], input({
    eventId: 'preflight-1',
    stage: 'preflight',
    content: '先确认入口，再执行最小修改并验证。',
    done: true,
  }));

  assert.equal(events[0]?.stage, 'preflight');
  assert.equal(events[0]?.done, true);
  assert.equal(events[0]?.content.length, 17);
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

test('projects acceptance planner heartbeats into one replay-safe live timeline row', () => {
  const projectionKey = 'acceptance-planner:run-1:call-1';
  let events = appendTimelineEvent([], input({
    eventId: 'server-event-1',
    stage: 'verification',
    content: '已等待 1.0 秒；可见输出 0 字符。',
    sequence: 12,
    metadata: {
      timeline_projection_key: projectionKey,
      source_event_id: 'server-event-1',
      progress_sequence: 3,
    },
  }));
  events = appendTimelineEvent(events, input({
    eventId: 'server-event-2',
    stage: 'verification',
    content: '已等待 2.0 秒；可见输出 0 字符。',
    sequence: 13,
    metadata: {
      timeline_projection_key: projectionKey,
      source_event_id: 'server-event-2',
      progress_sequence: 4,
    },
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventId, 'server-event-1');
  assert.equal(events[0]?.sequence, 12);
  assert.equal(events[0]?.content, '已等待 2.0 秒；可见输出 0 字符。');
  assert.equal(events[0]?.metadata?.source_event_id, 'server-event-2');

  const staleReplay = appendTimelineEvent(events, input({
    eventId: 'server-event-3',
    stage: 'verification',
    content: '已等待 1.0 秒；可见输出 0 字符。',
    sequence: 14,
    metadata: {
      timeline_projection_key: projectionKey,
      source_event_id: 'server-event-1',
      progress_sequence: 3,
    },
  }));
  assert.equal(staleReplay.length, 1);
  assert.equal(staleReplay[0]?.content, '已等待 2.0 秒；可见输出 0 字符。');
});

test('accumulates public planner draft deltas once and stops the call clock on completion', () => {
  const projectionKey = 'acceptance-planner:run-1:call-2';
  let events = appendTimelineEvent([], input({
    eventId: 'planner-start',
    stage: 'verification',
    content: '开始规划',
    sequence: 20,
    status: 'model_request_started',
    metadata: {
      timeline_projection_key: projectionKey,
      progress_sequence: 1,
      planner_call_active: true,
      draft_preview_delta: '',
    },
  }));
  events = appendTimelineEvent(events, input({
    eventId: 'planner-delta-1',
    stage: 'verification',
    content: '生成中',
    sequence: 21,
    status: 'model_output_progress',
    metadata: {
      timeline_projection_key: projectionKey,
      progress_sequence: 2,
      planner_call_active: true,
      draft_preview_delta: '{"disabled":',
    },
  }));
  events = appendTimelineEvent(events, input({
    eventId: 'planner-delta-2',
    stage: 'verification',
    content: '生成中',
    sequence: 22,
    status: 'model_output_progress',
    metadata: {
      timeline_projection_key: projectionKey,
      progress_sequence: 3,
      planner_call_active: true,
      draft_preview_delta: 'true}',
    },
  }));
  const replayedDelta = appendTimelineEvent(events, input({
    eventId: 'planner-delta-2',
    stage: 'verification',
    content: '重复增量',
    sequence: 22,
    metadata: {
      timeline_projection_key: projectionKey,
      progress_sequence: 3,
      planner_call_active: true,
      draft_preview_delta: 'true}',
    },
  }));
  events = appendTimelineEvent(replayedDelta, input({
    eventId: 'planner-finished',
    stage: 'verification',
    content: '规划请求结束',
    sequence: 23,
    status: 'model_response_finished',
    metadata: {
      timeline_projection_key: projectionKey,
      progress_sequence: 4,
      planner_call_active: false,
    },
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0]?.metadata?.planner_draft_preview, '{"disabled":true}');
  assert.equal(events[0]?.metadata?.planner_call_active, false);
  assert.equal(events[0]?.status, 'model_response_finished');
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

test('does not start a duplicate browser acceptance after Runtime marks the candidate unverified', () => {
  const state: AcceptanceEligibilityState = {
    candidateRunId: 'live-code-run',
    testedRunId: '',
  };

  const result = getAcceptanceEligibility(state, {
    runId: 'live-code-run',
    status: 'done',
    acceptanceUnavailable: true,
  });

  assert.equal(result.shouldStart, false);
  assert.equal(result.state.testedRunId, '');
});

test('preserves the Runtime completed-unverified terminal status in the frontend projection', () => {
  assert.equal(
    projectRuntimeSummaryStatus({ status: 'completed_unverified', done: true }),
    'completed_unverified',
  );
  assert.equal(
    projectRuntimeSummaryStatus({ status: 'completed', done: true }),
    'completed',
  );
  assert.equal(
    projectRuntimeSummaryStatus({ status: 'completed_unverified', done: false }),
    'running',
  );
});

test('preserves prior AgentLoop runs for a new request but clears them on explicit reset', () => {
  const previous = [{ id: 'agent-run-1' }] as never[];

  assert.strictEqual(resetAgentRuns(previous, { preserveHistory: true }), previous);
  assert.deepEqual(resetAgentRuns(previous), []);
});

test('binds a prompt to its root run and keeps runtime-repair descendants in that lane', () => {
  const mainTrace: CodeAgentTrace = {
    steps: [],
    output: '',
    phase: 'completed',
    isRunning: false,
  };
  const mainRun: CodeAgentRun = {
    id: 'agent-run-1',
    request: '修复页面按钮',
    projectKind: 'frontend',
    createdAt: '2026-09-09T00:00:00.000Z',
    trace: mainTrace,
  };
  const repairRun: CodeAgentRun = {
    ...mainRun,
    id: 'agent-run-1-repair-1',
    parentRunId: 'agent-run-1',
    runKind: 'runtime_repair',
    trace: { ...mainTrace, phase: 'repairing', isRunning: true },
  };

  const mapped = mapAgentRunsToPrompts(
    [mainRun, repairRun],
    ['修复页面按钮'],
  );

  assert.equal(mapped[0]?.id, 'agent-run-1-repair-1');
  assert.equal(mapped[0]?.parentRunId, 'agent-run-1');
  assert.deepEqual(
    getAgentRunLineage(repairRun, [mainRun, repairRun]).map((run) => run.id),
    ['agent-run-1-repair-1', 'agent-run-1'],
  );
});

test('selects the newest run by its timestamp when persisted arrival order is stale', () => {
  const older: CodeAgentRun = {
    id: 'agent-run-older',
    request: '修复页面按钮',
    projectKind: 'frontend',
    createdAt: '2026-09-18T05:09:02.707Z',
    trace: { steps: [], output: '', phase: 'completed', isRunning: false },
  };
  const newer: CodeAgentRun = {
    id: 'agent-run-newer',
    request: '修复页面按钮',
    projectKind: 'frontend',
    createdAt: '2026-09-19T13:40:04.849Z',
    trace: { steps: [], output: '', phase: 'needs_attention', isRunning: false },
  };

  assert.deepEqual(
    sortAgentRunsChronologically([newer, older]).map((run) => run.id),
    ['agent-run-older', 'agent-run-newer'],
  );
  assert.equal(getNewestAgentRun([newer, older])?.id, 'agent-run-newer');
  assert.equal(mapAgentRunsToPrompts([newer, older], ['修复页面按钮'])[0]?.id, 'agent-run-newer');
});

test('keeps a resumed user turn as a separate run identity', () => {
  const previous: CodeAgentRun = {
    id: 'agent-run-old',
    request: '第一次需求',
    projectKind: 'fullstack',
    createdAt: '2026-09-09T00:00:00.000Z',
    trace: { steps: ['旧轮次'], output: '旧输出', phase: 'needs_attention', isRunning: false, resumeEligible: true },
  };
  const next: CodeAgentRun = {
    id: 'agent-run-new',
    resumedFromRunId: previous.id,
    request: '继续修复第二个问题',
    projectKind: 'fullstack',
    createdAt: '2026-09-09T00:01:00.000Z',
    trace: { steps: ['正在恢复上一次未完成的 Code AgentLoop。'], output: '', phase: 'resuming', isRunning: true },
  };
  assert.notEqual(next.id, previous.id);
  assert.equal(next.resumedFromRunId, previous.id);
  assert.deepEqual(next.trace.steps, ['正在恢复上一次未完成的 Code AgentLoop。']);
});

test('settling a superseded parent run removes the false executing state', () => {
  const run: CodeAgentRun = {
    id: 'agent-run-1',
    request: '修复页面按钮',
    projectKind: 'frontend',
    createdAt: '2026-09-09T00:00:00.000Z',
    trace: { steps: [], output: '', phase: 'awaiting_runtime_verification', isRunning: true, status: 'running' },
  };

  const settled = settleAgentRunAsSuperseded(run, 'agent-run-1-repair-1');

  assert.equal(settled.trace.isRunning, false);
  assert.equal(settled.trace.status, 'superseded');
  assert.equal(settled.supersededByRunId, 'agent-run-1-repair-1');
});

test('does not present a candidate waiting for browser verification as model execution', () => {
  assert.equal(isAgentRunExecutionActive({
    trace: { isRunning: true, status: 'awaiting_runtime_verification' },
  } as never), false);
  assert.equal(isAgentRunExecutionActive({
    trace: { isRunning: true, status: 'running' },
  } as never), true);
});

test('binds a runtime-fix summary to the ops AgentLoop child run', () => {
  const trace: CodeAgentTrace = {
    steps: [],
    output: '',
    phase: 'repairing',
    isRunning: true,
    status: 'running',
  };
  const bound = bindRuntimeVerificationCandidate(trace, {
    run_id: 'agent-run-1-repair-1',
    base_revision: 'base-1',
    candidate_revision: 'candidate-1',
    status: 'awaiting_runtime_verification',
    resume_eligible: false,
  });

  assert.deepEqual(bound.runtimeVerification, {
    runId: 'agent-run-1-repair-1',
    baseRevision: 'base-1',
    candidateRevision: 'candidate-1',
  });
  assert.equal(bound.status, 'awaiting_runtime_verification');
  assert.equal(bound.phase, 'awaiting_runtime_verification');
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
  const summary = summarizeAgentLoopRound({
    iteration: 1,
    tool_calls_count: 1,
    files_changed: [],
    state_hash_before: 'same',
    state_hash_after: 'same',
  });

  assert.match(summary, /执行链路第 1 轮/);
  assert.match(summary, /本轮没有有效文件变化/);
  assert.match(summary, /下一步：读取持久任务状态/);
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

test('keeps implemented work separate from verified task completion', () => {
  const plan = applyCodeTaskEvent(null, {
    type: 'task_list',
    run_id: 'run-task-semantics',
    plan_id: 'plan-semantics',
    event_id: 'task-list-semantics',
    sequence: 1,
    timestamp_ms: 100,
    status: 'awaiting_verification',
    completed_count: 0,
    implemented_count: 1,
    total_count: 1,
    done: true,
    tasks: [{
      id: 1,
      task_key: 'task-1',
      title: '实现状态转换',
      target_files: ['src/state.ts'],
      description: '写入状态转换',
      status: 'implemented_unverified',
      implementation_status: 'implemented',
      verification_status: 'pending',
    }],
  });

  assert.equal(plan.status, 'awaiting_verification');
  assert.equal(plan.completedCount, 0);
  assert.equal(plan.implementedCount, 1);
  assert.equal(plan.tasks[0]?.status, 'implemented_unverified');
});

test('projects only server-verified task snapshot state after browser acceptance', () => {
  const initial = applyCodeTaskEvent(null, {
    type: 'task_list',
    run_id: 'run-task-snapshot',
    plan_id: 'plan-task-snapshot',
    event_id: 'task-list-snapshot',
    sequence: 4,
    timestamp_ms: 400,
    status: 'awaiting_verification',
    completed_count: 0,
    implemented_count: 2,
    total_count: 2,
    done: true,
    tasks: [
      { id: 1, task_key: 'task-1', title: '目标行为', target_files: [], description: '', status: 'implemented_unverified', implementation_status: 'implemented', verification_status: 'pending' },
      { id: 2, task_key: 'task-2', title: '关联义务', target_files: [], description: '', status: 'implemented_unverified', implementation_status: 'implemented', verification_status: 'pending' },
    ],
  });

  const projected = projectCodeTaskPlanSnapshot({
    run_id: 'run-task-snapshot',
    plan_id: 'plan-task-snapshot',
    plan_path: 'PLAN.md',
    todo_path: 'todo.md',
    sequence: 5,
    status: 'awaiting_verification',
    tasks: [
      { id: 1, task_key: 'task-1', title: '目标行为', target_files: [], description: '', status: 'completed', implementation_status: 'implemented', verification_status: 'verified' },
      { id: 2, task_key: 'task-2', title: '关联义务', target_files: [], description: '', status: 'implemented_unverified', implementation_status: 'implemented', verification_status: 'pending' },
    ],
  }, initial);

  assert.equal(projected?.tasks[0]?.status, 'completed');
  assert.equal(projected?.tasks[1]?.status, 'implemented_unverified');
  assert.equal(projected?.completedCount, 1);
  assert.equal(projected?.status, 'awaiting_verification');
});

// ── PLAN-PD §3.6/§3.5 前端 contract（显示顺序 = 存储顺序 = sequence 顺序）──

test('orders out-of-order arrivals by the persisted sequence, keeping preflight first', () => {
  // preflight（seq 0，持久存储最小号）最后到达仍必须居首——不是"谁先到谁在前"。
  let events = appendTimelineEvent([], input({ eventId: 'e-tool', stage: 'tool_call', sequence: 2 }));
  events = appendTimelineEvent(events, input({ eventId: 'e-thinking', stage: 'thinking', sequence: 1 }));
  events = appendTimelineEvent(events, input({
    eventId: 'e-preflight',
    stage: 'preflight',
    sequence: 0,
  }));

  assert.deepEqual(events.map((event) => event.stage), ['preflight', 'thinking', 'tool_call']);
});

test('keeps replayed reconnect streams idempotent without breaking sequence order', () => {
  let events = appendTimelineEvent([], input({ eventId: 'e-1', sequence: 1 }));
  events = appendTimelineEvent(events, input({ eventId: 'e-2', sequence: 2 }));
  // 断线重放同一批事件：不重复、不乱序。
  events = appendTimelineEvent(events, input({ eventId: 'e-1', sequence: 1 }));
  events = appendTimelineEvent(events, input({ eventId: 'e-2', sequence: 2 }));

  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
});

test('pairs action intent with its result by action_id identity, not adjacency', () => {
  const intent = input({
    eventId: 'e-intent',
    stage: 'tool_call',
    sequence: 1,
    metadata: {
      event_semantics: 'action_intent',
      action_id: 'run-1:act:1',
    },
  });
  // 故意夹一个无 action_id 的其他事件，证明配对只认 ID。
  const noise = input({ eventId: 'e-noise', stage: 'thinking', sequence: 2, content: '中间思考' });
  const result = input({
    eventId: 'e-result',
    stage: 'status',
    sequence: 3,
    status: 'completed',
    done: true,
    metadata: {
      event_semantics: 'action_result',
      action_id: 'run-1:act:1',
    },
  });

  const paired = buildPairedActionStatus([intent, noise, result]);
  assert.deepEqual(paired.get('run-1:act:1'), { status: 'completed', done: true });
  // intent 自身不是 result，不进入索引；未配对 ID 查不到。
  assert.equal(paired.size, 1);
  assert.equal(paired.get('run-1:act:9'), undefined);
});

test('renders narration from runtime_facts authority with rationale as a quote line', () => {
  const narrated = resolveActionIntentNarration(input({
    eventId: 'e-intent-narrated',
    stage: 'tool_call',
    content: 'read_file → src/main.py',
    metadata: {
      event_semantics: 'action_intent',
      action_id: 'run-1:act:2',
      narration: {
        runtime_facts: 'read_file → src/main.py',
        model_rationale: '已完成并成功写入全部文件',
        rationale_state: 'pending',
        narration_source: 'model+runtime',
      },
    },
  }));

  assert.equal(narrated.runtimeFacts, 'read_file → src/main.py');
  // rationale 即使声称"已完成/成功"，也只是一条引用行文本；完成态语义只能来自
  // result 配对（rationale_state 恒 pending，UI 不据它渲染任何状态徽标）。
  assert.equal(narrated.modelRationale, '已完成并成功写入全部文件');
  assert.equal(narrated.rationaleState, 'pending');
  assert.equal(narrated.actionId, 'run-1:act:2');
});

test('presents project validation as a natural Chinese action without tool or call identifiers', () => {
  const sentence = describeActionIntentInChinese(input({
    eventId: 'e-intent-validate-project',
    stage: 'status',
    content: '调用外部工具 validate_project',
    metadata: {
      event_semantics: 'action_intent',
      action_id: '#call_00_ET_N1D06vpmtaRsbsVWXPhC7045',
      tool_name: 'validate_project',
      narration: { runtime_facts: 'validate_project', model_rationale: '' },
    },
  }));

  assert.equal(sentence, '我准备开始检查项目配置和文件结构。');
  assert.equal(sentence.includes('validate_project'), false);
  assert.equal(sentence.includes('call_00_'), false);
  assert.equal(sentence.includes('Agent'), false);
});

test('describes file actions in Chinese while keeping the actual project path', () => {
  const sentence = describeActionIntentInChinese(input({
    eventId: 'e-intent-read-file',
    stage: 'status',
    content: 'read_file → index.html',
    metadata: {
      event_semantics: 'action_intent',
      action_id: 'call_private_id',
      tool_name: 'read_file',
      target_paths: ['index.html'],
      narration: { runtime_facts: 'read_file → index.html', model_rationale: '' },
    },
  }));

  assert.equal(sentence, '我准备先读取 index.html，了解当前内容。');
  assert.equal(sentence.includes('read_file'), false);
  assert.equal(sentence.includes('call_private_id'), false);
});

test('uses model-authored action narration without requiring a fixed sentence prefix', () => {
  const narrated = input({
    eventId: 'e-intent-model-note',
    stage: 'status',
    content: '调用外部工具 validate_project',
    metadata: {
      event_semantics: 'action_intent',
      tool_name: 'validate_project',
      narration: {
        runtime_facts: 'validate_project',
        model_rationale: '接下来我会先检查入口文件和项目配置。',
      },
    },
  });
  assert.equal(describeActionIntentInChinese(narrated), '接下来我会先检查入口文件和项目配置。');

  const modelAuthoredFormatting = input({
    ...narrated,
    eventId: 'e-intent-model-formatting',
    metadata: {
      ...narrated.metadata,
      narration: {
        runtime_facts: 'validate_project',
        model_rationale: '我准备先看入口文件，\n再确认项目配置。',
      },
    },
  });
  assert.equal(describeActionIntentInChinese(modelAuthoredFormatting), '我准备先看入口文件，\n再确认项目配置。');
});

test('localizes timeline status codes instead of displaying provider enum strings', () => {
  assert.equal(timelineStatusLabel('thinking'), '正在思考');
  assert.equal(timelineStatusLabel('tool_calling'), '正在准备行动');
  assert.equal(timelineStatusLabel('completed'), '已完成');
  assert.equal(timelineStatusLabel('provider_waiting'), '');
});

test('summarizes tool progress in Chinese without exposing internal fact codes', () => {
  const summary = summarizeAgentLoopRound({
    iteration: 5,
    tool_calls_count: 1,
    files_changed: [],
    state_hash_before: 'before',
    state_hash_after: 'after',
    progress_score: 3,
    progress_facts: ['new_validation_result', 'test_state:validate_project=通过'],
    round_summary: '',
    next_action: '读取持久任务状态，继续推进最早的未完成目标',
    controller_phase: 'running',
  });

  assert.match(summary, /第 5 轮/);
  assert.match(summary, /获得新的验证结果/);
  assert.match(summary, /项目检查：通过/);
  assert.doesNotMatch(summary, /AgentLoop|new_validation_result|test_state|validate_project/);
});

test('falls back to the first content line when narration metadata is missing', () => {
  const legacy = resolveActionIntentNarration(input({
    eventId: 'e-intent-legacy',
    stage: 'tool_call',
    content: 'write_file → frontend/index.html\n第二行不是事实行',
    metadata: { event_semantics: 'action_intent' },
  }));

  assert.equal(legacy.runtimeFacts, 'write_file → frontend/index.html');
  assert.equal(legacy.modelRationale, '');
  assert.equal(legacy.rationaleState, '');
  assert.equal(legacy.actionId, '');
});

test('shows TestAgent tool identity and file target without repeating its streamed action note', () => {
  const event = input({
    eventId: 'test-agent-read-file',
    stage: 'tool_call',
    content: 'Runtime facts and the streamed rationale are separate.',
    metadata: {
      event_semantics: 'action_intent',
      test_agent_model_action: true,
      tool_name: 'read_file',
      target_paths: ['src/index.html'],
      narration: {
        runtime_facts: 'read_file → src/index.html',
        model_rationale: '我先核对候选页面。',
      },
    },
  });

  assert.equal(
    describeTestAgentActionInChinese(event),
    '我准备读取文件 src/index.html，核对当前候选的实际内容。',
  );
  assert.equal(describeActionIntentInChinese(event), '我先核对候选页面。');
});

test('treats an intent without a paired result as still pending, never completed', () => {
  const intent = input({
    eventId: 'e-intent-pending',
    stage: 'tool_call',
    sequence: 1,
    metadata: {
      event_semantics: 'action_intent',
      action_id: 'run-1:act:3',
      narration: { runtime_facts: 'write_file → src/a.py', rationale_state: 'pending' },
    },
  });
  const paired = buildPairedActionStatus([intent]);

  // result 尚未到达：配对缺失即"未完成"，任何分支都不得把它当成功。
  assert.equal(paired.get('run-1:act:3'), undefined);
  assert.equal(paired.get('run-1:act:3')?.done === true, false);
});
