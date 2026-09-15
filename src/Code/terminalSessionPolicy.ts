import type { CodeAgentRun } from '../lib/api';

export interface AgentTerminalSessionLike {
  run_id: string;
  is_manual: boolean;
}

/**
 * Persisted dismissal state belongs only to Agent terminals. Older builds
 * accidentally stored manual-* ids here, which made a reused manual session
 * disappear immediately after refresh.
 */
export function filterAgentTerminalRunIds(runIds: Iterable<string>): string[] {
  return Array.from(new Set(runIds)).filter(
    (runId) => Boolean(runId) && !runId.startsWith('manual-'),
  );
}

/**
 * The terminal is a live workspace surface, not a second history view.
 * Keep only the newest non-dismissed Agent run visible; the timeline already
 * owns the historical output for older runs.
 */
export function getVisibleAgentTerminalRunId(
  agentRuns: Array<Pick<CodeAgentRun, 'id'>>,
  closedRunIds: ReadonlySet<string>,
): string | null {
  for (let index = agentRuns.length - 1; index >= 0; index -= 1) {
    const runId = agentRuns[index]?.id;
    if (runId && !closedRunIds.has(runId)) return runId;
  }
  return null;
}

/**
 * Return backend Agent sessions that are no longer the one visible Agent
 * terminal. Manual terminals are intentionally excluded from cleanup.
 */
export function getStaleAgentTerminalRunIds(
  sessions: AgentTerminalSessionLike[],
  visibleRunId: string | null,
  closedRunIds: ReadonlySet<string>,
): string[] {
  return Array.from(new Set(
    sessions
      .filter((session) => !session.is_manual)
      .map((session) => session.run_id)
      .filter((runId) => Boolean(runId) && runId !== visibleRunId && !closedRunIds.has(runId)),
  ));
}

/** Include the root and every repair ancestor for runs being discarded. */
export function getAgentRunFamilyIds(
  agentRuns: Array<Pick<CodeAgentRun, 'id' | 'parentRunId'>>,
  selectedRunIds: Iterable<string>,
): string[] {
  const byId = new Map(agentRuns.map((run) => [run.id, run]));
  const familyIds = new Set<string>();
  for (const selectedRunId of selectedRunIds) {
    let currentId: string | undefined = selectedRunId;
    while (currentId && !familyIds.has(currentId)) {
      familyIds.add(currentId);
      currentId = byId.get(currentId)?.parentRunId;
    }
  }
  return [...familyIds];
}
