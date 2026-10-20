export type AcceptanceObservedStatus =
  | 'idle'
  | 'generating'
  | 'modifying'
  | 'checking'
  | 'repairing'
  | 'done'
  | 'error';

export interface AcceptanceEligibilityState {
  candidateRunId: string;
  testedRunId: string;
}

/**
 * A browser verifier may only receive a goal that was produced by the
 * current Runtime contract.  An empty/unknown goal is not a smoke-test
 * fallback: it is an unbound proof context and must stay out of the runner.
 */
export function isAcceptanceGoalReady(goal: {
  goal_type?: unknown;
  valid?: unknown;
} | null | undefined): boolean {
  if (!goal || goal.valid === false) return false;
  const goalType = String(goal.goal_type ?? '').trim().toLowerCase();
  return Boolean(goalType && goalType !== 'unknown');
}

interface AcceptanceEligibilityInput {
  runId: string;
  status: AcceptanceObservedStatus;
  /** Runtime already attempted acceptance and recorded an unavailable proof. */
  acceptanceUnavailable?: boolean;
  /** The current candidate still has to wait for its bound Runtime goal. */
  acceptanceGoalReady?: boolean;
  /** A durable AgentLoop is still producing its resident TestAgent result. */
  acceptancePending?: boolean;
  /** A resident TestAgent already committed a result for this exact candidate. */
  acceptanceAlreadyRecorded?: boolean;
}

/** Find a persisted TestAgent verdict for the exact candidate revision. */
export function findResidentAcceptanceResult<T extends {
  metadata?: Record<string, unknown>;
}>(
  timeline: readonly T[],
  candidateRevision: string,
): T | undefined {
  const revision = String(candidateRevision ?? '').trim();
  if (!revision) return undefined;
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const event = timeline[index];
    const metadata = event?.metadata;
    if (
      metadata?.eventType !== 'test_agent_result'
      || metadata.observation_only === true
    ) continue;
    const eventRevision = String(
      metadata.candidateRevision ?? metadata.candidate_revision ?? '',
    ).trim();
    if (eventRevision === revision) return event;
  }
  return undefined;
}

export function isResidentAcceptanceTerminalRun(run: {
  status?: unknown;
  isRunning?: unknown;
} | null | undefined): boolean {
  if (!run || run.isRunning === true) return false;
  return [
    'completed', 'completed_unverified', 'needs_attention', 'failed', 'superseded',
  ].includes(String(run.status ?? '').trim().toLowerCase());
}

export function canStartRuntimeRepair(input: {
  mainWorkCompleted: boolean;
  runtimeCheckCompleted: boolean;
  currentRunId: string;
  errorRunId: string;
}): boolean {
  return input.mainWorkCompleted
    && input.runtimeCheckCompleted
    && Boolean(input.currentRunId)
    && input.currentRunId === input.errorRunId;
}

export function getAcceptanceEligibility(
  current: AcceptanceEligibilityState,
  input: AcceptanceEligibilityInput,
): { state: AcceptanceEligibilityState; shouldStart: boolean } {
  const isLiveCodeRun = ['generating', 'modifying', 'checking', 'repairing'].includes(input.status);
  const candidateRunId = isLiveCodeRun && input.runId
    ? input.runId
    : current.candidateRunId;
  const shouldStart = input.status === 'done'
    && !input.acceptanceUnavailable
    && !input.acceptancePending
    && !input.acceptanceAlreadyRecorded
    && input.acceptanceGoalReady !== false
    && Boolean(input.runId)
    && candidateRunId === input.runId
    && current.testedRunId !== input.runId;

  return {
    shouldStart,
    state: {
      candidateRunId,
      testedRunId: shouldStart ? input.runId : current.testedRunId,
    },
  };
}
