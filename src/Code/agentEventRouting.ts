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

export function summarizeAgentLoopRound(event: Pick<AgentLoopRoundEvent, 'iteration' | 'tool_calls_count' | 'files_changed' | 'state_hash_before' | 'state_hash_after'>): string {
  const iteration = Number.isFinite(event.iteration) ? event.iteration : '?';
  const toolCalls = Number.isFinite(event.tool_calls_count) ? event.tool_calls_count : 0;
  const filesChanged = Array.isArray(event.files_changed) ? event.files_changed : [];
  const progress = event.state_hash_before === event.state_hash_after
    ? '本轮没有有效文件变化'
    : `产生 ${filesChanged.length} 个文件变化`;
  return `AgentLoop 第 ${iteration} 轮完成：工具调用 ${toolCalls} 次，${progress}。`;
}
