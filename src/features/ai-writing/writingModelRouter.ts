import { CompiledWritingPrompt, WritingCapability } from './writingTypes';

export interface WritingModelDecision { mode: 'auto' | 'manual'; capability: WritingCapability; modelId?: string; available: boolean; label: string }

// Why: 写作链路后端已 provider 化（默认 qwen 零回归）；下拉选项在此集中维护，
// thesisApi 与 WritingWorkspace 共用，避免 provider 字符串散落多处。
export type ThesisProvider = 'qwen' | 'minimax';

export const THESIS_PROVIDER_OPTIONS: Array<{ id: ThesisProvider; label: string }> = [
  { id: 'qwen', label: '千问' },
  { id: 'minimax', label: 'MiniMax' },
];

export function routeWritingModel(prompt: CompiledWritingPrompt, manualModelId?: string): WritingModelDecision {
  if (manualModelId) return { mode: 'manual', capability: prompt.routingHints.capability, modelId: manualModelId, available: true, label: manualModelId };
  return { mode: 'auto', capability: prompt.routingHints.capability, available: prompt.routingHints.capability !== 'deep-research', label: prompt.routingHints.capability === 'deep-research' ? '资料研究 · 即将支持' : '智能路由' };
}
