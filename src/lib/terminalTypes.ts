export type PropositionDecision = 'approve' | 'reject' | 'dismiss';

export interface TerminalProposition {
  id: string;
  run_id: string;
  workspace_id: string;
  command: string;
  reason: string;
  expected: string;
  status: 'pending' | 'needs_confirm' | 'approved' | 'rejected' | 'timeout' | 'blocked' | 'executed';
  status_message: string;
  created_at: number;
  timeout_seconds: number;
  remaining_seconds: number;
}

export interface TerminalSessionDescriptor {
  workspace_id: string;
  run_id: string;
  title: string;
  is_manual: boolean;
  exit_code: number | null;
}
