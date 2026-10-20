import type { AgentLoopRoundEvent } from '../lib/api';

export type CodeGenerationEventRoute = 'code_update' | 'error' | 'agent_event';

/**
 * SSE data is runtime input, so an unknown event must never fall through to
 * the code-update branch.  Only an explicit code_update may replace the VFS
 * projection.
 */
export function classifyCodeGenerationEvent(event: { type?: unknown }): CodeGenerationEventRoute {
  if (event.type === 'code_update') return 'code_update';
  if (event.type === 'error') return 'error';
  return 'agent_event';
}

function humanizeProgressFact(fact: string): string {
  const value = fact.trim();
  if (value === 'new_validation_result') return '获得新的验证结果';
  if (value.startsWith('new_error:')) return '发现新的执行错误';
  if (value.startsWith('effective_patch:')) {
    const action = value.slice('effective_patch:'.length).trim();
    if (action === 'write_file') return '完成文件写入';
    if (action === 'patch_file') return '完成文件修改';
    return '完成一项文件修改';
  }
  if (value.startsWith('test_state:')) {
    const [tool, result] = value.slice('test_state:'.length).split('=', 2);
    const toolLabel: Record<string, string> = {
      validate_project: '项目检查',
      read_file: '文件读取',
      write_file: '文件写入',
      patch_file: '文件修改',
      run_tests: '测试运行',
    };
    const resultLabel: Record<string, string> = {
      passed: '通过',
      通过: '通过',
      completed: '完成',
      完成: '完成',
      failed: '未通过',
      失败: '未通过',
      blocked: '受阻',
      skipped: '已跳过',
    };
    if (toolLabel[tool] && resultLabel[result]) {
      return `${toolLabel[tool]}：${resultLabel[result]}`;
    }
    return toolLabel[tool] ? `${toolLabel[tool]}已返回结果` : '';
  }
  if (/^[\u3400-\u9fff]/.test(value)) return value;
  return '';
}

export function summarizeAgentLoopRound(event: Pick<AgentLoopRoundEvent, 'iteration' | 'tool_calls_count' | 'files_changed' | 'state_hash_before' | 'state_hash_after' | 'progress_score' | 'progress_facts' | 'round_summary' | 'next_action' | 'controller_phase'>): string {
  const iteration = Number.isFinite(event.iteration) ? event.iteration : '?';
  const toolCalls = Number.isFinite(event.tool_calls_count) ? event.tool_calls_count : 0;
  const filesChanged = Array.isArray(event.files_changed) ? event.files_changed : [];
  const score = Number.isFinite(event.progress_score) ? Number(event.progress_score) : null;
  const facts = Array.isArray(event.progress_facts)
    ? event.progress_facts
      .filter((fact): fact is string => typeof fact === 'string')
      .map(humanizeProgressFact)
      .filter(Boolean)
      .slice(0, 3)
    : [];
  const progress = score !== null
    ? score > 0
      ? `有效进展 ${score} 分${facts.length ? `（${facts.join('、')}）` : ''}`
      : '有效进展 0 分，本轮没有新的证据或变更'
    : event.state_hash_before === event.state_hash_after
      ? '本轮没有有效文件变化'
      : `产生 ${filesChanged.length} 个文件变化`;
  const rawSummary = typeof event.round_summary === 'string' ? event.round_summary.trim() : '';
  const summary = rawSummary && /[\u3400-\u9fff]/.test(rawSummary)
    && !/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/i.test(rawSummary)
    ? rawSummary
    : filesChanged.length
      ? `本轮修改文件：${filesChanged.slice(0, 5).join('、')}`
      : progress;
  const factsSummary = facts.length && !summary.includes(facts[0])
    ? `；进展事实：${facts.join('；')}`
    : '';
  const nextAction = typeof event.next_action === 'string' && event.next_action.trim()
    && /[\u3400-\u9fff]/.test(event.next_action)
    ? event.next_action.trim()
    : '读取持久任务状态，继续推进最早的未完成目标';
  return `执行链路第 ${iteration} 轮：${summary}${factsSummary}。调用工具 ${toolCalls} 次。下一步：${nextAction}。`;
}
