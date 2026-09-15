import type { CodeAgentRun, CodeAgentTrace, RuntimeSummaryEvent } from '../lib/api';

/** `isRunning` also gates new work while a candidate is being verified. */
export function isAgentRunExecutionActive(
  run: Pick<CodeAgentRun, 'trace'>,
): boolean {
  return Boolean(
    run.trace.isRunning
    && run.trace.status !== 'awaiting_runtime_verification',
  );
}

/**
 * Convert a runtime summary into a browser-commit candidate only when the
 * backend explicitly placed the run in the verification gate. Ordinary
 * completed summaries also carry revisions for display/audit purposes, but
 * they do not have a server-side RuntimeFixCandidate to commit.
 */
export function runtimeVerificationCandidateFromSummary(
  event: Pick<RuntimeSummaryEvent, 'run_id' | 'base_revision' | 'candidate_revision' | 'status'>,
): NonNullable<CodeAgentTrace['runtimeVerification']> | undefined {
  if (
    event.status !== 'awaiting_runtime_verification'
    || !event.run_id
    || !event.base_revision
    || !event.candidate_revision
  ) return undefined;
  return {
    runId: event.run_id,
    baseRevision: event.base_revision,
    candidateRevision: event.candidate_revision,
  };
}

/** Project one summary event onto the trace's pending-candidate state. */
export function projectRuntimeVerificationCandidate(
  previous: CodeAgentTrace['runtimeVerification'],
  event: Pick<RuntimeSummaryEvent, 'run_id' | 'base_revision' | 'candidate_revision' | 'status' | 'done'>,
): CodeAgentTrace['runtimeVerification'] {
  const candidate = runtimeVerificationCandidateFromSummary(event);
  return event.done ? candidate : candidate ?? previous;
}

/** Bind a full-stack runtime-fix candidate to the AgentLoop child run. */
export function bindRuntimeVerificationCandidate(
  trace: CodeAgentTrace,
  event: Pick<RuntimeSummaryEvent, 'run_id' | 'base_revision' | 'candidate_revision' | 'status' | 'resume_eligible' | 'active_scope' | 'scope_version' | 'scope_source' | 'allowed_next_action' | 'runtime_evidence'>,
): CodeAgentTrace {
  const candidate = runtimeVerificationCandidateFromSummary(event);
  if (!candidate) return trace;
  return {
    ...trace,
    phase: event.status === 'awaiting_runtime_verification'
      ? 'awaiting_runtime_verification'
      : trace.phase,
    status: event.status === 'awaiting_runtime_verification'
      ? 'awaiting_runtime_verification'
      : trace.status,
    isRunning: event.status === 'awaiting_runtime_verification' || trace.isRunning,
    resumeEligible: event.resume_eligible ?? trace.resumeEligible,
    runtimeVerification: {
      ...candidate,
      ...(trace.runtimeVerification?.browserRunId
        ? { browserRunId: trace.runtimeVerification.browserRunId }
        : {}),
    },
    activeScope: event.active_scope ?? trace.activeScope,
    scopeVersion: event.scope_version ?? trace.scopeVersion,
    scopeSource: event.scope_source ?? trace.scopeSource,
    allowedNextAction: event.allowed_next_action ?? trace.allowedNextAction,
    runtimeEvidence: event.runtime_evidence ?? trace.runtimeEvidence,
  };
}

/**
 * Return the run that should represent one user prompt in the conversation.
 * Runtime repair runs are descendants of that prompt, not additional prompts.
 */
export function mapAgentRunsToPrompts(
  agentRuns: CodeAgentRun[],
  prompts: string[],
): Array<CodeAgentRun | undefined> {
  const rootsByText = new Map<string, CodeAgentRun[]>();
  for (const run of agentRuns) {
    if (run.parentRunId || run.runKind === 'runtime_repair') continue;
    const key = run.request.trim();
    const list = rootsByText.get(key) ?? [];
    list.push(run);
    rootsByText.set(key, list);
  }

  const promptCountByText = new Map<string, number>();
  for (const prompt of prompts) {
    const key = prompt.trim();
    promptCountByText.set(key, (promptCountByText.get(key) ?? 0) + 1);
  }

  const usedByText = new Map<string, number>();
  return prompts.map((prompt) => {
    const key = prompt.trim();
    const candidates = rootsByText.get(key);
    if (!candidates?.length) return undefined;
    const used = usedByText.get(key) ?? 0;
    usedByText.set(key, used + 1);
    const startIndex = Math.max(candidates.length - (promptCountByText.get(key) ?? 0), 0);
    const root = candidates[startIndex + used];
    if (!root) return undefined;

    // A repair chain is linear for one prompt. Select its newest descendant
    // so the rendered lane contains the latest ops/test state while retaining
    // the root identity for prompt matching.
    let current = root;
    while (true) {
      const descendant = agentRuns.findLast((run) => run.parentRunId === current.id);
      if (!descendant) return current;
      current = descendant;
    }
  });
}

/** Newest run first, followed by every parent that owns its prior evidence. */
export function getAgentRunLineage(
  run: CodeAgentRun,
  agentRuns: CodeAgentRun[],
): CodeAgentRun[] {
  const byId = new Map(agentRuns.map((item) => [item.id, item]));
  const lineage: CodeAgentRun[] = [];
  const visited = new Set<string>();
  let current: CodeAgentRun | undefined = run;
  while (current && !visited.has(current.id)) {
    lineage.push(current);
    visited.add(current.id);
    current = current.parentRunId ? byId.get(current.parentRunId) : undefined;
  }
  return lineage;
}

/** Mark a run superseded by a child repair without leaving a false spinner. */
export function settleAgentRunAsSuperseded(
  run: CodeAgentRun,
  supersededByRunId: string,
): CodeAgentRun {
  return {
    ...run,
    supersededByRunId,
    trace: {
      ...run.trace,
      phase: 'superseded',
      isRunning: false,
      status: 'superseded',
      resumeEligible: false,
    },
  };
}

export function resetAgentRuns(
  previous: CodeAgentRun[],
  options: { preserveHistory?: boolean } = {},
): CodeAgentRun[] {
  return options.preserveHistory ? previous : [];
}
