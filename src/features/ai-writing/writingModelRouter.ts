import { CompiledWritingPrompt, WritingCapability } from './writingTypes';

export interface WritingModelDecision { mode: 'auto' | 'manual'; capability: WritingCapability; modelId?: string; available: boolean; label: string }

export function routeWritingModel(prompt: CompiledWritingPrompt, manualModelId?: string): WritingModelDecision {
  if (manualModelId) return { mode: 'manual', capability: prompt.routingHints.capability, modelId: manualModelId, available: true, label: manualModelId };
  return { mode: 'auto', capability: prompt.routingHints.capability, available: prompt.routingHints.capability !== 'deep-research', label: prompt.routingHints.capability === 'deep-research' ? '资料研究 · 即将支持' : '智能路由' };
}
