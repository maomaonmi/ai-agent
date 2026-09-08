export interface CodeReadOnlyRunContext {
  request: string;
  phase: string;
  summary?: string;
  taskPlan?: {
    completedCount: number;
    totalCount: number;
    status: string;
  };
}

export interface CodeReadOnlyContextInput {
  projectKind: 'frontend' | 'fullstack';
  files: string[];
  latestRun?: CodeReadOnlyRunContext;
}

interface CodeRunLike {
  trace: {
    isRunning: boolean;
    phase: string;
    resumeEligible?: boolean;
    taskPlan?: {
      completedCount: number;
      totalCount: number;
      status: string;
    };
  };
}

/**
 * A run is resumable only when the orchestrator explicitly leaves a checkpoint
 * or the durable task plan still has unfinished work. A stale summary alone is
 * not enough to start another write-capable request.
 */
export function isCodeAgentRunUnfinished(run: CodeRunLike | null | undefined): boolean {
  if (!run) return false;
  if (run.trace.resumeEligible === true) return true;
  if (run.trace.isRunning) return true;
  const plan = run.trace.taskPlan;
  return Boolean(plan && plan.status !== 'completed' && plan.completedCount < plan.totalCount);
}

function trimForPrompt(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 24))}…（上下文已截断）`;
}

/**
 * Build the bounded context for a Code workbench question. The ordinary chat
 * model receives project facts and task state, never the complete VFS, so a
 * question or summary cannot accidentally become a code-edit request.
 */
export function buildCodeReadOnlyPrompt(
  message: string,
  context: CodeReadOnlyContextInput,
): string {
  const files = [...new Set(context.files.map((file) => file.trim()).filter(Boolean))]
    .sort()
    .slice(0, 48);
  const latestRun = context.latestRun;
  const taskLine = latestRun?.taskPlan
    ? `任务计划：${latestRun.taskPlan.completedCount}/${latestRun.taskPlan.totalCount} 已完成，状态 ${latestRun.taskPlan.status}`
    : '任务计划：当前没有可展示的持久化任务计划';
  const runLine = latestRun
    ? [
        `最近 Agent run：${trimForPrompt(latestRun.request, 180)}`,
        `阶段：${trimForPrompt(latestRun.phase, 40)}`,
        latestRun.summary ? `最近状态：${trimForPrompt(latestRun.summary, 500)}` : '',
        taskLine,
      ].filter(Boolean).join('\n')
    : '最近 Agent run：当前没有记录';

  return [
    '你是 Code 工作台的只读对话助手。',
    '本轮只解释、总结或回答用户的问题，不启动代码生成、文件变更、终端命令或外部工具。',
    '如果用户表达了新的修改意图，应明确说明需要用户确认后再进入修改流程；不要把问题改写成执行任务。',
    '',
    `用户问题：${trimForPrompt(message, 1_200)}`,
    '',
    `项目类型：${context.projectKind === 'fullstack' ? '全栈 Mock API' : '前端'}`,
    `项目文件（仅目录摘要）：${files.length > 0 ? files.join('、') : '暂无已知文件'}`,
    runLine,
    '',
    '请基于以上事实给出简洁、可验证的中文回答；不要假设没有提供的文件内容或执行结果。',
  ].join('\n').slice(0, 6_000);
}
