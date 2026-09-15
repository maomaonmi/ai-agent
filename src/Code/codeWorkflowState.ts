const ACTIVE_CODE_STATUSES = new Set(['generating', 'modifying', 'checking', 'repairing']);

export function isCodeWorkflowBusy(input: {
  mode: string;
  isLoading: boolean;
  agentIsRunning: boolean;
  agentStatus?: string;
  codeStatus: string;
}): boolean {
  // `agentStatus` can survive a restored conversation or a verifier handoff
  // after the live run has already ended. The lifecycle flag is the source of
  // truth for a currently owned run; a stale status must not lock the editor.
  return input.mode === 'code' && (
    input.isLoading
    || input.agentIsRunning
    || ACTIVE_CODE_STATUSES.has(input.codeStatus)
  );
}
