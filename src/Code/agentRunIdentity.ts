import type { CodeAgentTrace, RuntimeVerificationEvidence } from '../lib/api';

type RuntimeCandidate = NonNullable<CodeAgentTrace['runtimeVerification']>;
const MAX_BACKEND_RUN_ID_LENGTH = 64;

/**
 * A backend Agent run and the browser code run are different identities.
 * Runtime verification must only accept evidence for the browser revision
 * that rendered this candidate.
 */
export function isRuntimeCandidateForBrowserRun(
  candidate: RuntimeCandidate | undefined,
  browserRunId: string,
): boolean {
  return Boolean(candidate?.browserRunId && candidate.browserRunId === browserRunId);
}

/**
 * A failed browser verification starts a new backend candidate run. The old
 * candidate remains immutable and addressable by its original run id.
 */
export function createRuntimeRepairRunId(parentRunId: string, attempt: number): string {
  const normalizedParent = parentRunId.trim() || 'agent-run';
  const suffix = `-repair-${Math.max(1, Math.floor(attempt))}`;
  const parentLimit = Math.max(1, MAX_BACKEND_RUN_ID_LENGTH - suffix.length);
  return `${normalizedParent.slice(0, parentLimit)}${suffix}`;
}

/** Bind browser evidence to the backend run that will consume it. */
export function rebindRuntimeEvidenceToRun(
  evidence: RuntimeVerificationEvidence | undefined,
  runId: string,
): RuntimeVerificationEvidence | undefined {
  if (!evidence) return undefined;
  return { ...evidence, run_id: runId };
}
