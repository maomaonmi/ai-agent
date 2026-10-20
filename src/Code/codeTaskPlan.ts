import type {
  CodeTaskPlanState,
  CodeTaskStatus,
  TaskItem,
  TaskListEvent,
  GoalObligationsEvent,
  TaskUpdateEvent,
  CodeTaskPlanSnapshot,
} from '../lib/api';

export type CodeTaskEvent = TaskListEvent | GoalObligationsEvent | TaskUpdateEvent;

function normalizeTask(task: TaskItem): TaskItem {
  return {
    ...task,
    id: task.id,
    task_key: task.task_key || `task-${task.id}`,
    title: task.title || task.task_key || `任务 ${task.id}`,
    target_files: Array.isArray(task.target_files) ? [...task.target_files] : [],
    description: task.description || task.title || '',
    status: task.status || 'pending',
  };
}

function countCompleted(tasks: TaskItem[]): number {
  return tasks.reduce((count, task) => count + (task.status === 'completed' ? 1 : 0), 0);
}

function countImplemented(tasks: TaskItem[]): number {
  return tasks.reduce((count, task) => count + (
    task.implementation_status === 'implemented'
    || task.status === 'implemented_unverified'
    || task.status === 'completed'
      ? 1
      : 0
  ), 0);
}

function eventKey(event: CodeTaskEvent): string {
  if (event.event_id) return event.event_id;
  return [
    event.type,
    event.run_id || 'unbound',
    event.plan_id || 'legacy',
    event.sequence ?? 'no-sequence',
    event.type === 'task_update' ? `${event.task_id}:${event.status}` : event.tasks.length,
  ].join(':');
}

function planStatusFromTasks(tasks: TaskItem[]): CodeTaskPlanState['status'] {
  if (tasks.length > 0 && tasks.every((task) => task.status === 'completed')) return 'completed';
  if (tasks.some((task) => task.status === 'failed' || task.status === 'needs_attention')) return 'needs_attention';
  if (tasks.length > 0 && tasks.every((task) => (
    task.implementation_status === 'implemented'
    || task.status === 'implemented_unverified'
    || task.status === 'completed'
  ))) return 'awaiting_verification';
  return 'running';
}

function planKindFrom(
  explicit: CodeTaskPlanState['planKind'] | undefined,
  projectionSource: CodeTaskPlanState['projectionSource'] | undefined,
  fallback?: CodeTaskPlanState['planKind'],
): CodeTaskPlanState['planKind'] {
  if (explicit) return explicit;
  if (projectionSource === 'goal_obligation_ledger') return 'acceptance';
  if (projectionSource === 'execution_plan') return 'execution';
  return fallback;
}

function planningModeFrom(
  explicit: CodeTaskPlanState['planningMode'] | undefined,
  tasks: TaskItem[],
  fallback?: CodeTaskPlanState['planningMode'],
): CodeTaskPlanState['planningMode'] {
  if (explicit === 'NONE' || explicit === 'COMPACT' || explicit === 'DETAILED') return explicit;
  if (fallback) return fallback;
  return tasks.length > 1 ? 'DETAILED' : tasks.length === 1 ? 'COMPACT' : 'NONE';
}

/** Replace the UI projection with the durable server ledger after verification. */
export function projectCodeTaskPlanSnapshot(
  snapshot: CodeTaskPlanSnapshot | null | undefined,
  previous: CodeTaskPlanState | null,
): CodeTaskPlanState | null {
  if (!snapshot || !Array.isArray(snapshot.tasks) || snapshot.tasks.length === 0) return previous;
  const tasks = snapshot.tasks.map(normalizeTask);
  const status = snapshot.status || planStatusFromTasks(tasks);
  const ledgerProjection = snapshot.projection_source === 'goal_obligation_ledger';
  const planKind = planKindFrom(snapshot.plan_kind, snapshot.projection_source, previous?.planKind);
  if (
    previous?.planId === snapshot.plan_id
    && previous.lastSequence === snapshot.sequence
    && previous.status === status
    && JSON.stringify(previous.tasks) === JSON.stringify(tasks)
  ) return previous;
  return {
    runId: snapshot.run_id || previous?.runId || 'unbound',
    planId: snapshot.plan_id || previous?.planId || `legacy:${snapshot.run_id || 'unbound'}`,
    planKind,
    planningMode: planningModeFrom(snapshot.planning_mode, tasks, previous?.planningMode),
    planPath: ledgerProjection ? '' : snapshot.plan_path || previous?.planPath || 'PLAN.md',
    todoPath: ledgerProjection ? '' : snapshot.todo_path || previous?.todoPath || 'todo.md',
    projectionSource: snapshot.projection_source || 'code_task_plan',
    goalId: snapshot.goal_id,
    goalSetRevision: snapshot.goal_set_revision,
    tasks,
    status,
    completedCount: countCompleted(tasks),
    implementedCount: countImplemented(tasks),
    totalCount: tasks.length,
    lastSequence: Math.max(0, snapshot.sequence || 0),
    seenEventIds: previous?.planId === snapshot.plan_id ? previous.seenEventIds ?? [] : [],
  };
}

export function applyCodeTaskEvent(
  previous: CodeTaskPlanState | null,
  event: CodeTaskEvent,
): CodeTaskPlanState {
  const runId = event.run_id || previous?.runId || 'unbound';
  const planId = event.plan_id || previous?.planId || `legacy:${runId}`;
  const isNewPlan = !previous || previous.planId !== planId;
  const seen = isNewPlan ? [] : [...(previous.seenEventIds || [])];
  const key = eventKey(event);
  if (seen.includes(key)) return previous as CodeTaskPlanState;
  if (!isNewPlan && event.sequence != null && event.sequence <= previous.lastSequence) {
    return previous;
  }
  seen.push(key);

  if (event.type === 'task_list' || event.type === 'goal_obligations') {
    const tasks = event.tasks.map(normalizeTask);
    const status = event.status || (event.done ? planStatusFromTasks(tasks) : 'running');
    const ledgerProjection = event.projection_source === 'goal_obligation_ledger';
    const planKind = planKindFrom(event.plan_kind, event.projection_source, previous?.planKind);
    return {
      runId,
      planId,
      planKind,
      planningMode: planningModeFrom(event.planning_mode, tasks, previous?.planningMode),
      planPath: ledgerProjection ? '' : event.plan_path || previous?.planPath || 'PLAN.md',
      todoPath: ledgerProjection ? '' : event.todo_path || previous?.todoPath || 'todo.md',
      projectionSource: event.projection_source || 'code_task_plan',
      goalId: event.goal_id,
      goalSetRevision: event.goal_set_revision,
      tasks,
      status,
      completedCount: countCompleted(tasks),
      implementedCount: countImplemented(tasks),
      totalCount: tasks.length,
      lastSequence: event.sequence ?? previous?.lastSequence ?? 0,
      seenEventIds: seen.slice(-128),
    };
  }

  const tasks = isNewPlan ? [] : previous.tasks.map(normalizeTask);
  const taskIndex = tasks.findIndex((task) => (
    (event.task_key && task.task_key === event.task_key)
    || String(task.id) === String(event.task_id)
  ));
  const nextTask: TaskItem = normalizeTask(event.task || {
    id: event.task_id,
    task_key: event.task_key,
    title: `任务 ${event.task_key || event.task_id}`,
    target_files: [],
    description: event.reason || '',
    status: event.status,
  });
  nextTask.status = event.status as CodeTaskStatus;
  if (event.reason) nextTask.reason = event.reason;
  if (taskIndex >= 0) tasks[taskIndex] = { ...tasks[taskIndex], ...nextTask };
  else tasks.push(nextTask);

  const inferredStatus = event.plan_status
    || (event.done ? planStatusFromTasks(tasks) : previous?.status)
    || planStatusFromTasks(tasks);
  return {
    runId,
    planId,
    planKind: planKindFrom(event.plan_kind, event.projection_source, previous?.planKind),
    planningMode: planningModeFrom(event.planning_mode, tasks, previous?.planningMode),
    planPath: event.plan_path || previous?.planPath || 'PLAN.md',
    todoPath: event.todo_path || previous?.todoPath || 'todo.md',
    projectionSource: previous?.projectionSource || 'code_task_plan',
    goalId: previous?.goalId,
    goalSetRevision: previous?.goalSetRevision,
    tasks,
    status: inferredStatus,
    completedCount: countCompleted(tasks),
    implementedCount: countImplemented(tasks),
    totalCount: tasks.length,
    lastSequence: event.sequence ?? previous?.lastSequence ?? 0,
    seenEventIds: seen.slice(-128),
  };
}

export function codeTaskStatusLabel(status: CodeTaskStatus): string {
  return {
    pending: '待处理',
    in_progress: '进行中',
    implemented_unverified: '已实现待验收',
    completed: '已完成',
    failed: '失败',
    skipped: '已跳过',
    needs_attention: '需人工处理',
  }[status];
}
