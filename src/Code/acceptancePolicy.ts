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

interface AcceptanceEligibilityInput {
  runId: string;
  status: AcceptanceObservedStatus;
  /** Runtime already attempted acceptance and recorded an unavailable proof. */
  acceptanceUnavailable?: boolean;
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
