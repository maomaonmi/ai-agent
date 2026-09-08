import type {
  CodeTaskPlanState,
  CodeTaskStatus,
  TaskItem,
  TaskListEvent,
  TaskUpdateEvent,
} from '../lib/api';

export type CodeTaskEvent = TaskListEvent | TaskUpdateEvent;

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
  return 'running';
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

  if (event.type === 'task_list') {
    const tasks = event.tasks.map(normalizeTask);
    const status = event.status || (event.done ? planStatusFromTasks(tasks) : 'running');
    return {
      runId,
      planId,
      planPath: event.plan_path || previous?.planPath || 'PLAN.md',
      todoPath: event.todo_path || previous?.todoPath || 'todo.md',
      tasks,
      status,
      completedCount: countCompleted(tasks),
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
    planPath: event.plan_path || previous?.planPath || 'PLAN.md',
    todoPath: event.todo_path || previous?.todoPath || 'todo.md',
    tasks,
    status: inferredStatus,
    completedCount: countCompleted(tasks),
    totalCount: tasks.length,
    lastSequence: event.sequence ?? previous?.lastSequence ?? 0,
    seenEventIds: seen.slice(-128),
  };
}

export function codeTaskStatusLabel(status: CodeTaskStatus): string {
  return {
    pending: '待处理',
    in_progress: '进行中',
    completed: '已完成',
    failed: '失败',
    skipped: '已跳过',
    needs_attention: '需人工处理',
  }[status];
}
