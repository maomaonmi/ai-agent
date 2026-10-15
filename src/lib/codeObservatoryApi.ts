import { API_BASE_URL } from './api.ts';

export interface CodeObservatoryStatusAxes {
  execution: string;
  verification: string;
  observation: string;
}

export interface CodeControlTopologyState {
  state_id: string;
  terminal: boolean;
}

export interface CodeControlTopologyTransition {
  transition_id: string;
  from_state: string;
  event: string;
  to_state: string;
  guard_id?: string | null;
  action: string;
  owner: string;
  rule_id?: string | null;
}

export interface CodeControlTopologyDynamicRegion {
  region_id: 'agent_model_tool_routing' | 'runtime_recovery_selection';
  enumeration_status: 'dynamic' | 'registered_metadata_only';
}

export interface CodeControlTopologyRuntimeRoute {
  route_id: string;
  executor_id: string;
  lane_id: string;
  arbitration_order: number;
  side_effect_class: 'none' | 'idempotent' | 'compensatable' | 'non_idempotent';
}

export interface CodeControlTopology {
  schema_version: 'code-observatory/v1';
  topology_schema_version: 1;
  topology_version: string;
  rule_version: string | null;
  rule_version_status: 'not_recorded';
  reference_status: 'current_reference';
  states: CodeControlTopologyState[];
  transitions: CodeControlTopologyTransition[];
  dynamic_regions: CodeControlTopologyDynamicRegion[];
  runtime_routes: CodeControlTopologyRuntimeRoute[];
}

export interface CodeObservatorySourceRef {
  stream_key?: string | null;
  event_key?: string | null;
  source_event_id?: string | null;
  source_sequence?: number | null;
  stream_sequence?: number | null;
  transport_event_id?: string | null;
  transport_sequence?: number | null;
}

export interface CodeObservatoryNodeView {
  node_instance_id: string;
  node_definition_id?: string | null;
  aggregate_kind: 'run' | 'operation';
  aggregate_id: string;
  operation_id?: string | null;
  run_id: string;
  node_kind: string;
  source_refs: CodeObservatorySourceRef[];
  status: CodeObservatoryStatusAxes;
  versions: Record<string, unknown>;
  association_status: 'complete' | 'incomplete' | 'unknown';
}

export interface CodeObservatorySpanView {
  span_id: string;
  span_kind: 'model_turn' | 'tool_action' | 'verification';
  aggregate_kind: 'run' | 'operation';
  aggregate_id: string;
  operation_id?: string | null;
  run_id: string;
  attempt_ref?: string | null;
  turn_id?: string | null;
  action_id?: string | null;
  tool_name?: string | null;
  candidate_revision?: string | null;
  execution_generation?: number | null;
  parent_span_id?: string | null;
  source_refs: CodeObservatorySourceRef[];
  receipt_refs: CodeObservatorySourceRef[];
  start_ref?: CodeObservatorySourceRef | null;
  end_ref?: CodeObservatorySourceRef | null;
  started_at_ms?: number | null;
  ended_at_ms?: number | null;
  start_committed_at_ms?: number | null;
  end_committed_at_ms?: number | null;
  duration_ms?: number | null;
  lifecycle_status: 'open' | 'closed' | 'incomplete';
  execution_status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  verification_status: string;
  association_status: 'complete' | 'orphan' | 'incomplete' | 'ambiguous';
}

export interface CodeObservatoryDecisionCandidateSource {
  source_id: string;
  status: 'complete' | 'partial' | 'unavailable' | 'not_applicable';
  reason_codes: string[];
  candidate_action_ids: string[];
}

export interface CodeObservatoryDecisionAction {
  action_id: string;
  executor_id: string;
  lane_id: string;
  status: 'eligible' | 'inapplicable' | 'blocked' | 'undetermined' | 'already_attempted' | 'reconciliation_required';
  reason_codes: string[];
  based_on_revision?: string | null;
  current_revision?: string | null;
  operation_version?: number | null;
  related_attempt_id?: string | null;
  applicable_obligation_ids: string[];
}

export interface CodeObservatoryDecisionView {
  decision_ref: string;
  owner: 'runtime' | 'control_plane' | 'verification_runtime' | 'unknown';
  source_ref: CodeObservatorySourceRef;
  source_role: string;
  rule_id?: string | null;
  outcome: string;
  reason_code?: string | null;
  based_on_operation_version?: number | null;
  versions: {
    candidate_revision?: string | null;
    verification_epoch?: number | null;
    operation_version?: number | null;
    rule_version?: string | null;
    policy_digest?: string | null;
  };
  evidence_refs: string[];
  selected_route?: string | null;
  allowed_actions: string[];
  authorization_refs: string[];
  scope?: string | null;
  from_state?: string | null;
  to_state?: string | null;
  executor_evaluation_status?: 'not_enumerated' | 'enumerated' | 'unavailable' | null;
  candidate_inventory_status?: 'not_enumerated' | 'complete' | 'partial' | 'unavailable' | null;
  expected_candidate_source_ids: string[];
  candidate_sources: CodeObservatoryDecisionCandidateSource[];
  candidate_actions: CodeObservatoryDecisionAction[];
  remaining_executor_ids: string[];
  remaining_agent_action_ids: string[];
  source_gaps: string[];
}

export interface CodeObservatoryEvidenceView {
  evidence_ref: string;
  evidence_kind: string;
  status: 'available' | 'missing' | 'stale' | 'retention_missing' | 'untrusted' | 'unavailable' | 'unknown' | 'reference_only';
  storage_kind: 'runtime_action_journal' | 'artifact_store' | 'memory_observation' | 'reference_only';
  source_ref?: CodeObservatorySourceRef | null;
  source_role: string;
  artifact_id?: string | null;
  artifact_version?: string | null;
  producer?: string | null;
  relative_path?: string | null;
  media_type?: 'text/plain' | 'application/json' | null;
  content_hash?: string | null;
  hash_scope?: string | null;
  catalog_digest?: string | null;
  obligation_refs: string[];
  preview_kind?: 'runtime_read_result' | 'patch_metadata' | null;
  preview_available: boolean;
  source_gaps: string[];
  versions: {
    candidate_revision?: string | null;
    verification_epoch?: number | null;
    operation_version?: number | null;
    rule_version?: string | null;
    policy_digest?: string | null;
  };
  recorded_at_ms?: number | null;
  retention_status: 'retained' | 'missing' | 'unknown' | 'not_applicable';
}

export interface CodeObservatoryEvidencePreview {
  schema_version: 'code-observatory/v1';
  run_id: string;
  evidence_ref: string;
  evidence_kind: string;
  status: 'available';
  storage_kind: string;
  media_type: 'text/plain';
  relative_path?: string | null;
  content: string;
  content_hash?: string | null;
  hash_scope?: string | null;
  artifact_version?: string | null;
  versions: Record<string, unknown>;
  truncated: boolean;
}

export type CodeObservatoryErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CURSOR_INVALID'
  | 'CURSOR_EXPIRED'
  | 'SOURCE_UNAVAILABLE'
  | 'PROJECTION_INCOMPLETE'
  | 'SCHEMA_UNSUPPORTED'
  | 'EVIDENCE_NOT_FOUND'
  | 'EVIDENCE_RETENTION_MISSING'
  | 'EVIDENCE_PREVIEW_UNAVAILABLE'
  | 'EVIDENCE_STALE'
  | 'REQUEST_FAILED';

export class CodeObservatoryApiError extends Error {
  readonly code: CodeObservatoryErrorCode;

  constructor(code: CodeObservatoryErrorCode) {
    super(code);
    this.code = code;
    this.name = 'CodeObservatoryApiError';
  }
}

export interface CodeObservatoryWireEvent {
  schema_version: 'code-observatory/v1';
  projection_version: number;
  aggregate_kind: 'run' | 'operation';
  aggregate_id: string;
  operation_id?: string | null;
  run_id?: string | null;
  run_kind?: string | null;
  actor_kind?: string | null;
  task_id?: string | null;
  turn_id?: string | null;
  iteration?: number | null;
  phase?: string | null;
  boundary?: string | null;
  event_category: string;
  event_type: string;
  action_id?: string | null;
  tool_name?: string | null;
  verification_run_id?: string | null;
  node_definition_id?: string | null;
  node_instance_id?: string | null;
  source_ref?: CodeObservatorySourceRef | null;
  causation_refs?: CodeObservatorySourceRef[];
  decision_ref?: string | null;
  evidence_refs?: string[];
  source_role: string;
  observation_offset: number;
  occurred_at_ms?: number | null;
  committed_at_ms?: number | null;
  observed_at_ms: number;
  status: CodeObservatoryStatusAxes;
}

export interface CodeObservatorySourceWatermark {
  source_kind: string;
  stream_key: string;
  last_source_sequence?: number | null;
  last_stream_sequence?: number | null;
  last_source_event_id?: string | null;
  last_transport_sequence?: number | null;
  last_transport_event_id?: string | null;
  coverage_status: string;
}

export interface CodeObservatorySnapshot {
  schema_version: 'code-observatory/v1';
  projection_version: number;
  head_offset: number;
  retention_floor_offset: number;
  cursor: string;
  feed: {
    schema_version: 'code-observatory/v1';
    aggregate_kind: 'run';
    aggregate_id: string;
    status: CodeObservatoryStatusAxes;
    cursor: {
      aggregate_kind: 'run';
      aggregate_id: string;
      projection_version: number;
      observation_offset: number;
      retention_floor_offset: number;
    };
    events: CodeObservatoryWireEvent[];
    nodes?: CodeObservatoryNodeView[];
    decisions?: CodeObservatoryDecisionView[];
    evidence?: CodeObservatoryEvidenceView[];
    spans?: CodeObservatorySpanView[];
    source_watermarks: CodeObservatorySourceWatermark[];
    has_more: boolean;
  };
}

export interface CodeObservatoryReplaySnapshot {
  schema_version: 'code-observatory/v1';
  projection_version: number;
  replay_offset: number;
  replay_history_start_offset: number;
  head_offset: number;
  retention_floor_offset: number;
  cursor: string;
  feed: CodeObservatorySnapshot['feed'];
}

export interface CodeObservatoryOperationRun {
  run_id: string;
  roles: Array<'execution' | 'recovery' | 'verification' | 'action' | 'current' | 'resume'>;
  execution_generations: number[];
  association_status: 'explicit_event' | 'operation_projection' | 'current_pointer';
  source_refs: CodeObservatorySourceRef[];
}

export interface CodeObservatoryOperationRunLink {
  from_run_id: string;
  to_run_id: string;
  relation_kind: 'execution_claim' | 'execution_takeover' | 'resume' | 'verification' | 'repair_authorization';
  binding_status: 'explicit' | 'candidate_match' | 'candidate_mismatch' | 'verification_missing' | 'identity_mismatch';
  candidate_revision?: string | null;
  verification_epoch?: number | null;
  verification_epoch_status?: 'matched' | 'mismatched' | 'unknown' | null;
  source_kind: 'runtime_event' | 'operation_projection';
  source_refs: CodeObservatorySourceRef[];
}

export interface CodeObservatoryRecoveryAttempt {
  attempt_id: string;
  run_id: string;
  action_id: string;
  executor_id: string;
  lane_id: string;
  status: 'started' | 'completed' | 'failed' | 'unknown' | 'cancelled';
  attempt_number: number;
  started_at_ms: number;
  completed_at_ms?: number | null;
  candidate_revision?: string | null;
  based_on_operation_version?: number | null;
  side_effect_class: 'none' | 'idempotent' | 'compensatable' | 'non_idempotent';
  error_code?: string | null;
  required_authorization_ids: string[];
  source_refs: CodeObservatorySourceRef[];
}

export interface CodeObservatoryRepairAuthorization {
  authorization_id: string;
  dispatch_run_id: string;
  verification_run_id: string;
  candidate_revision: string;
  verification_epoch: number;
  binding_status: 'candidate_match' | 'candidate_mismatch' | 'verification_missing' | 'identity_mismatch';
  verification_epoch_status: 'matched' | 'mismatched' | 'unknown';
  source_ref: CodeObservatorySourceRef;
}

export interface CodeObservatoryUnknownAction {
  action_id: string;
  tool_name: string;
  run_id?: string | null;
  execution_generation?: number | null;
  status: 'unknown';
  source_ref?: CodeObservatorySourceRef | null;
}

export interface CodeObservatoryReconciliation {
  action_id: string;
  tool_name: string;
  execution_generation: number;
  outcome: 'confirmed_applied' | 'confirmed_not_applied';
  binding_status: 'explicit' | 'identity_mismatch';
  source_ref: CodeObservatorySourceRef;
}

export interface CodeObservatoryVerification {
  source_run_id?: string | null;
  verification_run_id: string;
  candidate_revision: string;
  verification_epoch?: number | null;
  status: string;
  verified?: boolean | null;
  source_ref: CodeObservatorySourceRef;
}

export interface CodeObservatoryOperationView {
  operation_id: string;
  lifecycle?: string | null;
  version?: number | null;
  execution_generation?: number | null;
  current_run_id?: string | null;
  recovery_budget: {
    takeovers_used?: number | null;
    takeovers_limit?: number | null;
    status: 'available' | 'exhausted' | 'unknown';
  };
  runs: CodeObservatoryOperationRun[];
  run_links: CodeObservatoryOperationRunLink[];
  recovery_attempts: CodeObservatoryRecoveryAttempt[];
  repair_authorizations: CodeObservatoryRepairAuthorization[];
  verifications: CodeObservatoryVerification[];
  unknown_actions: CodeObservatoryUnknownAction[];
  reconciliations: CodeObservatoryReconciliation[];
  source_gaps: string[];
}

export interface CodeObservatoryOperationSnapshot {
  schema_version: 'code-observatory/v1';
  projection_version: number;
  operation_id: string;
  operation: CodeObservatoryOperationView;
  feed: {
    schema_version: 'code-observatory/v1';
    aggregate_kind: 'operation';
    aggregate_id: string;
    status: CodeObservatoryStatusAxes;
    cursor: {
      aggregate_kind: 'operation';
      aggregate_id: string;
      projection_version: number;
      observation_offset: number;
      retention_floor_offset: number;
    };
    events: CodeObservatoryWireEvent[];
    source_watermarks: CodeObservatorySourceWatermark[];
    has_more: boolean;
  };
}

export interface CodeRequirementGraphNode {
  node_id: string;
  kind: 'obligation' | 'clause' | 'proof_requirement' | 'check' | 'evidence' | 'verdict' | 'delivery';
  entity_id: string;
  status?: string | null;
  current?: boolean | null;
  evidence_status?: CodeObservatoryEvidenceView['status'] | null;
  artifact_version?: string | null;
  reason_code?: string | null;
  source_ref?: CodeObservatorySourceRef | null;
}

export interface CodeRequirementGraphEdge {
  edge_id: string;
  from_node: string;
  to_node: string;
  kind:
    | 'obligation_clause'
    | 'clause_proof_requirement'
    | 'proof_requirement_check'
    | 'clause_evidence'
    | 'check_evidence'
    | 'clause_verdict'
    | 'obligation_delivery';
  source_kind: 'goal_event' | 'acceptance_projection' | 'runtime_plan' | 'clause_result' | 'observation_feed';
  current?: boolean | null;
  source_ref?: CodeObservatorySourceRef | null;
}

export interface CodeRequirementGraphCoverage {
  metric:
    | 'implementation'
    | 'acceptance'
    | 'evidence_association'
    | 'materialized_evidence'
    | 'proof_check_binding'
    | 'delivery';
  numerator: number;
  denominator: number;
  status: 'available' | 'not_applicable' | 'incomplete';
}

export interface CodeRequirementEvidenceGraph {
  schema_version: 'code-observatory/v1';
  graph_version: 1;
  operation_id: string;
  operation_version: number;
  source_status: 'current' | 'incomplete' | 'unavailable';
  goal_id?: string | null;
  goal_set_revision?: number | null;
  ledger_revision?: number | null;
  verification_epoch?: number | null;
  candidate_revision?: string | null;
  goal_stream_sequence?: number | null;
  acceptance_projection_revision?: number | null;
  runtime_plan_status: 'current' | 'missing' | 'stale';
  source_gaps: string[];
  nodes: CodeRequirementGraphNode[];
  edges: CodeRequirementGraphEdge[];
  coverage: CodeRequirementGraphCoverage[];
}

export interface CodeObservatoryEventPage {
  schema_version: 'code-observatory/v1';
  projection_version: number;
  aggregate_kind: 'run';
  aggregate_id: string;
  head_offset: number;
  retention_floor_offset: number;
  events: CodeObservatoryWireEvent[];
  source_watermarks: CodeObservatorySourceWatermark[];
  next_cursor: string;
  has_more: boolean;
}

async function throwCodeObservatoryApiError(response: Response): Promise<never> {
  let code: CodeObservatoryErrorCode = 'REQUEST_FAILED';
  try {
    const payload = await response.json() as { detail?: { code?: unknown } };
    const candidate = payload.detail?.code;
    if (typeof candidate === 'string' && [
      'NOT_FOUND',
      'FORBIDDEN',
      'CURSOR_INVALID',
      'CURSOR_EXPIRED',
      'SOURCE_UNAVAILABLE',
      'PROJECTION_INCOMPLETE',
      'SCHEMA_UNSUPPORTED',
      'EVIDENCE_NOT_FOUND',
      'EVIDENCE_RETENTION_MISSING',
      'EVIDENCE_PREVIEW_UNAVAILABLE',
      'EVIDENCE_STALE',
    ].includes(candidate)) {
      code = candidate as CodeObservatoryErrorCode;
    }
  } catch {
    // Keep only a bounded error class; upstream bodies may contain unsafe details.
  }
  throw new CodeObservatoryApiError(code);
}

/** Read the current, immutable control-rule reference; it never starts a Run. */
export async function getCodeControlTopology(
  signal?: AbortSignal,
): Promise<CodeControlTopology> {
  const response = await fetch(
    `${API_BASE_URL}/api/code/observatory/topology`,
    { headers: { Accept: 'application/json' }, cache: 'no-store', signal },
  );
  if (!response.ok) await throwCodeObservatoryApiError(response);
  return response.json() as Promise<CodeControlTopology>;
}

/** Read the persisted Run projection; this endpoint never starts or resumes work. */
export async function getCodeObservatorySnapshot(
  runId: string,
  signal?: AbortSignal,
): Promise<CodeObservatorySnapshot> {
  const response = await fetch(
    `${API_BASE_URL}/api/code/observatory/runs/${encodeURIComponent(runId)}/snapshot`,
    { headers: { Accept: 'application/json' }, cache: 'no-store', signal },
  );
  if (!response.ok) await throwCodeObservatoryApiError(response);
  return response.json() as Promise<CodeObservatorySnapshot>;
}

/** Rebuild one fixed historical Run snapshot from persisted events only. */
export async function getCodeObservatoryReplaySnapshot(
  runId: string,
  offset: number,
  projectionVersion = 1,
  signal?: AbortSignal,
): Promise<CodeObservatoryReplaySnapshot> {
  const query = new URLSearchParams({
    offset: String(offset),
    projection_version: String(projectionVersion),
  });
  const response = await fetch(
    `${API_BASE_URL}/api/code/observatory/runs/${encodeURIComponent(runId)}/replay?${query.toString()}`,
    { headers: { Accept: 'application/json' }, cache: 'no-store', signal },
  );
  if (!response.ok) await throwCodeObservatoryApiError(response);
  return response.json() as Promise<CodeObservatoryReplaySnapshot>;
}

/** Read the persisted Operation aggregate and its explicit Run/recovery links. */
export async function getCodeObservatoryOperationSnapshot(
  operationId: string,
  signal?: AbortSignal,
): Promise<CodeObservatoryOperationSnapshot> {
  const response = await fetch(
    `${API_BASE_URL}/api/code/observatory/operations/${encodeURIComponent(operationId)}/snapshot`,
    { headers: { Accept: 'application/json' }, cache: 'no-store', signal },
  );
  if (!response.ok) await throwCodeObservatoryApiError(response);
  return response.json() as Promise<CodeObservatoryOperationSnapshot>;
}

/** Read the revision-bound obligation-to-evidence graph for one Operation. */
export async function getCodeRequirementEvidenceGraph(
  operationId: string,
  signal?: AbortSignal,
): Promise<CodeRequirementEvidenceGraph> {
  const response = await fetch(
    `${API_BASE_URL}/api/code/observatory/operations/${encodeURIComponent(operationId)}/requirements`,
    { headers: { Accept: 'application/json' }, cache: 'no-store', signal },
  );
  if (!response.ok) await throwCodeObservatoryApiError(response);
  return response.json() as Promise<CodeRequirementEvidenceGraph>;
}

/** Read one bounded page from the same immutable observation-offset stream. */
export async function getCodeObservatoryEvents(
  runId: string,
  options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<CodeObservatoryEventPage> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
  if (options.cursor) query.set('cursor', options.cursor);
  const response = await fetch(
    `${API_BASE_URL}/api/code/observatory/runs/${encodeURIComponent(runId)}/events?${query.toString()}`,
    { headers: { Accept: 'application/json' }, cache: 'no-store', signal: options.signal },
  );
  if (!response.ok) await throwCodeObservatoryApiError(response);
  return response.json() as Promise<CodeObservatoryEventPage>;
}

/** Read a Run-scoped evidence preview from its exact persisted source receipt. */
export async function getCodeObservatoryEvidencePreview(
  runId: string,
  evidenceRef: string,
  signal?: AbortSignal,
): Promise<CodeObservatoryEvidencePreview> {
  const response = await fetch(
    `${API_BASE_URL}/api/code/observatory/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(evidenceRef)}`,
    { headers: { Accept: 'application/json' }, cache: 'no-store', signal },
  );
  if (!response.ok) await throwCodeObservatoryApiError(response);
  return response.json() as Promise<CodeObservatoryEvidencePreview>;
}

/** Open the read-only SSE endpoint from an opaque committed observation cursor. */
export async function openCodeObservatoryStream(
  runId: string,
  cursor: string,
  signal?: AbortSignal,
): Promise<Response> {
  const query = new URLSearchParams({ cursor });
  const response = await fetch(
    `${API_BASE_URL}/api/code/observatory/runs/${encodeURIComponent(runId)}/stream?${query.toString()}`,
    {
      headers: { Accept: 'text/event-stream' },
      cache: 'no-store',
      signal,
    },
  );
  if (!response.ok) await throwCodeObservatoryApiError(response);
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new CodeObservatoryApiError('PROJECTION_INCOMPLETE');
  }
  return response;
}
