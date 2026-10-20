import type { CodeAgentRun, TokenUsage } from '../lib/api.ts';
import type { CodeObservatoryOperationRun } from '../lib/codeObservatoryApi.ts';

export type OperationUsageCoverage = 'complete' | 'partial' | 'unavailable';

export interface OperationUsageSummary {
  operationId: string;
  associatedRunCount: number;
  recordedRunCount: number;
  coverage: OperationUsageCoverage;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  providerCalls: number | null;
  models: string[];
}

type UsageMetric = 'prompt_tokens' | 'completion_tokens' | 'total_tokens'
  | 'cached_tokens' | 'reasoning_tokens' | 'calls';

function safeCount(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function modelMetric(usage: TokenUsage, metric: UsageMetric): number | null {
  const models = usage.models;
  if (!models || Object.keys(models).length === 0) return null;
  let total = 0;
  for (const model of Object.values(models)) {
    const value = safeCount(model?.[metric]);
    if (value === null) return null;
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function usageMetric(usage: TokenUsage, metric: UsageMetric): number | null {
  const direct = safeCount(usage[metric]);
  return direct ?? modelMetric(usage, metric);
}

function sumCompleteMetric(usages: TokenUsage[], metric: UsageMetric): number | null {
  if (usages.length === 0) return null;
  let total = 0;
  for (const usage of usages) {
    const value = usageMetric(usage, metric);
    if (value === null) return null;
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

/**
 * Read-only usage projection. Operation run identities come from the backend
 * Operation snapshot; telemetry comes from the matching CodeAgentRun trace
 * projection supplied by the caller. Missing run telemetry remains visible
 * as incomplete coverage. This function never writes or infers usage.
 */
export function projectOperationUsage(
  operationId: string,
  operationRuns: CodeObservatoryOperationRun[],
  agentRuns: CodeAgentRun[],
): OperationUsageSummary {
  const normalizedOperationId = operationId.trim();
  const runIds = [...new Set(operationRuns
    .map((run) => run.run_id.trim())
    .filter(Boolean))];
  const runIdSet = new Set(runIds);
  const tracesByRunId = new Map<string, CodeAgentRun>();
  for (const run of agentRuns) {
    const runId = run.id.trim();
    if (
      runId
      && runIdSet.has(runId)
      && run.trace.operationId === normalizedOperationId
    ) {
      tracesByRunId.set(runId, run);
    }
  }

  const usages: TokenUsage[] = [];
  const models = new Set<string>();
  for (const runId of runIds) {
    const usage = tracesByRunId.get(runId)?.trace.tokenUsage;
    if (!usage || safeCount(usage.total_tokens) === null) continue;
    usages.push(usage);
    if (typeof usage.model === 'string' && usage.model.trim()) {
      models.add(usage.model.trim());
    }
    for (const modelName of Object.keys(usage.models ?? {})) {
      if (modelName.trim()) models.add(modelName.trim());
    }
  }

  const recordedRunCount = usages.length;
  const coverage: OperationUsageCoverage = recordedRunCount === 0
    ? 'unavailable'
    : recordedRunCount === runIds.length
      ? 'complete'
      : 'partial';

  return {
    operationId: normalizedOperationId,
    associatedRunCount: runIds.length,
    recordedRunCount,
    coverage,
    promptTokens: sumCompleteMetric(usages, 'prompt_tokens'),
    completionTokens: sumCompleteMetric(usages, 'completion_tokens'),
    totalTokens: sumCompleteMetric(usages, 'total_tokens'),
    cachedTokens: sumCompleteMetric(usages, 'cached_tokens'),
    reasoningTokens: sumCompleteMetric(usages, 'reasoning_tokens'),
    providerCalls: sumCompleteMetric(usages, 'calls'),
    models: [...models].sort((left, right) => left.localeCompare(right)),
  };
}
