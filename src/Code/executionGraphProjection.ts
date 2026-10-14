import type {
  CodeObservatoryDecisionView,
  CodeObservatoryEvidenceView,
  CodeObservatoryNodeView,
  CodeObservatoryOperationView,
  CodeObservatorySourceRef,
  CodeObservatorySpanView,
  CodeObservatoryWireEvent,
} from '../lib/codeObservatoryApi';

export type ExecutionGraphEdgeKind =
  | 'parent_call'
  | 'trigger'
  | 'retry_of'
  | 'resume_from'
  | 'recovery'
  | 'artifact_dependency'
  | 'decision_route';

export type ExecutionGraphNodeKind = 'instance' | 'span' | 'run' | 'attempt' | 'artifact' | 'decision' | 'group';

export interface ExecutionGraphNode {
  id: string;
  kind: ExecutionGraphNodeKind;
  groupKind?: Exclude<ExecutionGraphNodeKind, 'group'>;
  groupedNodeCount?: number;
  label: string;
  subtitle: string;
  identity: string;
  runId?: string;
  nodeInstanceId?: string;
  actionId?: string;
  spanKind?: CodeObservatorySpanView['span_kind'];
  lifecycleStatus?: CodeObservatorySpanView['lifecycle_status'];
  executionStatus?: string;
  verificationStatus?: string;
  associationStatus?: string;
  sourceRefs: CodeObservatorySourceRef[];
  versions?: Record<string, unknown>;
  startedAtMs?: number;
  position: { x: number; y: number };
}

export interface ExecutionGraphEdge extends Record<string, unknown> {
  id: string;
  kind: ExecutionGraphEdgeKind;
  source: string;
  target: string;
  label: string;
  relationshipCount?: number;
}

export interface ExecutionGraphCoverage {
  unresolvedCausationRefs: number;
  missingSpanParents: number;
  ambiguousSpanParents: number;
  unlinkedDecisionRoutes: number;
  unlinkedArtifacts: number;
  unlinkedRecoveryAttempts: number;
  omittedNodes: number;
  collapsedInternalEdges: number;
}

export interface ExecutionGraphProjection {
  nodes: ExecutionGraphNode[];
  edges: ExecutionGraphEdge[];
  coverage: ExecutionGraphCoverage;
  hasOperationRelations: boolean;
}

export interface ExecutionGraphInput {
  runId: string;
  nodes: CodeObservatoryNodeView[];
  spans: CodeObservatorySpanView[];
  events: CodeObservatoryWireEvent[];
  decisions: CodeObservatoryDecisionView[];
  evidence: CodeObservatoryEvidenceView[];
  operation?: CodeObservatoryOperationView | null;
  collapsedKinds?: ExecutionGraphNodeKind[];
}

const GRAPH_NODE_LIMIT = 600;

const SPAN_LABELS: Record<CodeObservatorySpanView['span_kind'], string> = {
  model_turn: '模型轮次',
  tool_action: '工具动作',
  verification: '验证执行',
};

const NODE_KIND_LABELS: Record<Exclude<ExecutionGraphNodeKind, 'group'>, string> = {
  instance: '节点实例',
  span: '执行跨度',
  run: 'Run 关联',
  attempt: '恢复尝试',
  artifact: '证据引用',
  decision: '决策记录',
};

const EDGE_LABELS: Record<ExecutionGraphEdgeKind, string> = {
  parent_call: '父调用',
  trigger: '触发',
  retry_of: '重试',
  resume_from: '恢复自',
  recovery: '接管恢复',
  artifact_dependency: '证据依赖',
  decision_route: '决策路由',
};

function sourceKey(ref: CodeObservatorySourceRef | null | undefined): string | null {
  if (!ref) return null;
  const identity = ref.event_key
    ?? ref.source_event_id
    ?? (ref.source_sequence !== null && ref.source_sequence !== undefined ? String(ref.source_sequence) : null)
    ?? (ref.stream_sequence !== null && ref.stream_sequence !== undefined ? String(ref.stream_sequence) : null)
    ?? ref.transport_event_id
    ?? (ref.transport_sequence !== null && ref.transport_sequence !== undefined ? String(ref.transport_sequence) : null);
  return identity === null ? null : JSON.stringify([ref.stream_key ?? null, identity]);
}

function dedupeRefs(refs: CodeObservatorySourceRef[]): CodeObservatorySourceRef[] {
  const unique = new Map<string, CodeObservatorySourceRef>();
  for (const ref of refs) {
    const key = sourceKey(ref);
    if (key && !unique.has(key)) unique.set(key, ref);
  }
  return [...unique.values()];
}

function addOwner(owners: Map<string, Set<string>>, ref: CodeObservatorySourceRef | null | undefined, nodeId: string): void {
  const key = sourceKey(ref);
  if (!key) return;
  const values = owners.get(key) ?? new Set<string>();
  values.add(nodeId);
  owners.set(key, values);
}

function oneOwner(owners: Map<string, Set<string>>, ref: CodeObservatorySourceRef | null | undefined): string | null {
  const key = sourceKey(ref);
  if (!key) return null;
  const values = owners.get(key);
  return values?.size === 1 ? [...values][0] : null;
}

function deterministicPositions(
  nodes: ExecutionGraphNode[],
  edges: ExecutionGraphEdge[],
): ExecutionGraphNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const structuralKinds = new Set<ExecutionGraphEdgeKind>([
    'parent_call', 'trigger', 'retry_of', 'resume_from', 'recovery', 'decision_route',
  ]);
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!structuralKinds.has(edge.kind) || !nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const compareNodes = (left: ExecutionGraphNode, right: ExecutionGraphNode) => {
    return (left.startedAtMs ?? Number.MAX_SAFE_INTEGER) - (right.startedAtMs ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id);
  };
  const compareIds = (leftId: string, rightId: string) => compareNodes(nodeById.get(leftId)!, nodeById.get(rightId)!);
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id).sort(compareIds);
  const layers = new Map(nodes.map((node) => [node.id, 0]));
  const visited = new Set<string>();
  while (ready.length > 0) {
    const current = ready.shift()!;
    visited.add(current);
    for (const target of (outgoing.get(current) ?? []).sort(compareIds)) {
      layers.set(target, Math.max(layers.get(target) ?? 0, (layers.get(current) ?? 0) + 1));
      const nextDegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextDegree);
      if (nextDegree === 0) {
        ready.push(target);
        ready.sort(compareIds);
      }
    }
  }

  const byLayer = new Map<number, ExecutionGraphNode[]>();
  for (const node of nodes) {
    const layer = visited.has(node.id) ? layers.get(node.id) ?? 0 : 0;
    const current = byLayer.get(layer) ?? [];
    current.push(node);
    byLayer.set(layer, current);
  }
  for (const layerNodes of byLayer.values()) layerNodes.sort(compareNodes);
  const rowById = new Map<string, number>();
  for (const layerNodes of byLayer.values()) layerNodes.forEach((node, row) => rowById.set(node.id, row));
  return nodes.map((node) => {
    const layer = visited.has(node.id) ? layers.get(node.id) ?? 0 : 0;
    return { ...node, position: { x: layer * 310, y: (rowById.get(node.id) ?? 0) * 162 } };
  });
}

export function projectExecutionGraph(input: ExecutionGraphInput): ExecutionGraphProjection {
  const nodeById = new Map<string, ExecutionGraphNode>();
  const sourceOwners = new Map<string, Set<string>>();
  const spanNodeIds = new Map<string, string>();
  const eventNodeIds = new Map<CodeObservatoryWireEvent, string>();
  const edges = new Map<string, ExecutionGraphEdge>();
  const coverage: ExecutionGraphCoverage = {
    unresolvedCausationRefs: 0,
    missingSpanParents: 0,
    ambiguousSpanParents: 0,
    unlinkedDecisionRoutes: 0,
    unlinkedArtifacts: 0,
    unlinkedRecoveryAttempts: 0,
    omittedNodes: 0,
    collapsedInternalEdges: 0,
  };

  const addNode = (node: ExecutionGraphNode) => {
    if (!nodeById.has(node.id)) nodeById.set(node.id, node);
    if (node.kind === 'instance' || node.kind === 'span') {
      for (const ref of node.sourceRefs) addOwner(sourceOwners, ref, node.id);
    }
  };
  const addEdge = (kind: ExecutionGraphEdgeKind, source: string | null | undefined, target: string | null | undefined) => {
    if (!source || !target || source === target || !nodeById.has(source) || !nodeById.has(target)) return false;
    const id = `${kind}:${source}:${target}`;
    if (!edges.has(id)) edges.set(id, { id, kind, source, target, label: EDGE_LABELS[kind] });
    return true;
  };

  const validNodes = input.nodes.filter((node) => node.run_id === input.runId);
  for (const node of validNodes) {
    const id = `node:${node.node_instance_id}`;
    addNode({
      id,
      kind: 'instance',
      label: node.node_definition_id ?? node.node_kind,
      subtitle: node.node_kind,
      identity: node.node_instance_id,
      runId: node.run_id,
      nodeInstanceId: node.node_instance_id,
      executionStatus: node.status.execution,
      verificationStatus: node.status.verification,
      associationStatus: node.association_status,
      sourceRefs: dedupeRefs(node.source_refs),
      versions: node.versions,
      position: { x: 0, y: 0 },
    });
  }

  const validEvents = [...input.events]
    .filter((event) => event.run_id === input.runId && event.aggregate_id === input.runId)
    .sort((left, right) => left.observation_offset - right.observation_offset);
  for (const event of validEvents) {
    if (!event.node_instance_id) continue;
    const id = `node:${event.node_instance_id}`;
    const existing = nodeById.get(id);
    if (existing) {
      existing.executionStatus = event.status.execution;
      existing.verificationStatus = event.status.verification;
      existing.actionId = event.action_id ?? existing.actionId;
      existing.startedAtMs = existing.startedAtMs ?? event.occurred_at_ms ?? event.committed_at_ms ?? event.observed_at_ms;
      existing.sourceRefs = dedupeRefs([...existing.sourceRefs, ...(event.source_ref ? [event.source_ref] : [])]);
      addOwner(sourceOwners, event.source_ref, id);
    } else {
      addNode({
        id,
        kind: 'instance',
        label: event.node_definition_id ?? event.event_type,
        subtitle: event.node_definition_id ? event.event_type : '运行节点实例',
        identity: event.node_instance_id,
        runId: input.runId,
        nodeInstanceId: event.node_instance_id,
        actionId: event.action_id ?? undefined,
        executionStatus: event.status.execution,
        verificationStatus: event.status.verification,
        associationStatus: 'unknown',
        sourceRefs: event.source_ref ? [event.source_ref] : [],
        startedAtMs: event.occurred_at_ms ?? event.committed_at_ms ?? event.observed_at_ms,
        position: { x: 0, y: 0 },
      });
    }
    eventNodeIds.set(event, id);
  }

  for (const span of input.spans.filter((candidate) => candidate.run_id === input.runId)) {
    const matchingNodeIds = new Set<string>();
    for (const ref of span.source_refs) {
      const key = sourceKey(ref);
      for (const id of (key ? sourceOwners.get(key) : undefined) ?? []) matchingNodeIds.add(id);
    }
    let graphNodeId: string;
    if (matchingNodeIds.size === 1) {
      graphNodeId = [...matchingNodeIds][0];
      const existing = nodeById.get(graphNodeId)!;
      existing.spanKind = span.span_kind;
      existing.lifecycleStatus = span.lifecycle_status;
      existing.startedAtMs = span.started_at_ms ?? existing.startedAtMs;
      existing.actionId = existing.actionId ?? span.action_id ?? undefined;
      existing.subtitle = span.tool_name
        ? `${SPAN_LABELS[span.span_kind]} · ${span.tool_name}`
        : SPAN_LABELS[span.span_kind];
      existing.executionStatus = span.execution_status === 'unknown'
        ? existing.executionStatus
        : span.execution_status;
      existing.verificationStatus = span.verification_status === 'unknown'
        ? existing.verificationStatus
        : span.verification_status;
      existing.associationStatus = span.association_status;
      existing.sourceRefs = dedupeRefs([...existing.sourceRefs, ...span.source_refs]);
      for (const ref of span.source_refs) addOwner(sourceOwners, ref, graphNodeId);
    } else {
      graphNodeId = `span:${span.span_id}`;
      addNode({
        id: graphNodeId,
        kind: 'span',
        label: SPAN_LABELS[span.span_kind],
        subtitle: span.tool_name ?? span.attempt_ref ?? span.lifecycle_status,
        identity: span.action_id ?? span.turn_id ?? span.attempt_ref ?? span.span_id,
        runId: span.run_id,
        actionId: span.action_id ?? undefined,
        spanKind: span.span_kind,
        lifecycleStatus: span.lifecycle_status,
        executionStatus: span.execution_status,
        verificationStatus: span.verification_status,
        associationStatus: span.association_status,
        sourceRefs: dedupeRefs(span.source_refs),
        startedAtMs: span.started_at_ms ?? undefined,
        versions: {
          candidate_revision: span.candidate_revision,
          execution_generation: span.execution_generation,
        },
        position: { x: 0, y: 0 },
      });
      if (matchingNodeIds.size > 1) coverage.ambiguousSpanParents += 1;
    }
    spanNodeIds.set(span.span_id, graphNodeId);
  }

  for (const span of input.spans.filter((candidate) => candidate.run_id === input.runId)) {
    if (!span.parent_span_id) continue;
    const source = spanNodeIds.get(span.parent_span_id);
    const target = spanNodeIds.get(span.span_id);
    if (!source || !target) {
      coverage.missingSpanParents += 1;
      continue;
    }
    addEdge(span.span_kind === 'tool_action' ? 'parent_call' : 'trigger', source, target);
  }

  for (const event of validEvents) {
    const target = eventNodeIds.get(event)
      ?? oneOwner(sourceOwners, event.source_ref)
      ?? null;
    if (!target) continue;
    for (const cause of event.causation_refs ?? []) {
      const parent = oneOwner(sourceOwners, cause);
      if (!parent) {
        coverage.unresolvedCausationRefs += 1;
        continue;
      }
      const childSpan = input.spans.find((span) => span.run_id === input.runId
        && span.source_refs.some((ref) => sourceKey(ref) === sourceKey(event.source_ref)));
      const kind: ExecutionGraphEdgeKind = childSpan?.span_kind === 'tool_action' ? 'parent_call' : 'trigger';
      addEdge(kind, parent, target);
    }
  }

  const actionNodes = [...nodeById.values()].filter((node) => node.actionId);
  for (const decision of input.decisions) {
    const decisionId = `decision:${decision.decision_ref}`;
    addNode({
      id: decisionId,
      kind: 'decision',
      label: '控制决策',
      subtitle: decision.outcome,
      identity: decision.decision_ref,
      runId: input.runId,
      executionStatus: decision.outcome,
      associationStatus: decision.source_role,
      sourceRefs: [decision.source_ref],
      versions: decision.versions,
      position: { x: 0, y: 0 },
    });
    if (!decision.selected_route) continue;
    const matchingCandidateActions = decision.candidate_actions
      .filter((candidate) => candidate.action_id === decision.selected_route
        || candidate.executor_id === decision.selected_route
        || candidate.lane_id === decision.selected_route)
      .map((candidate) => candidate.action_id);
    const candidateIds = new Set(matchingCandidateActions);
    const routeTargets = actionNodes.filter((node) => candidateIds.has(node.actionId ?? '')
      || node.actionId === decision.selected_route
      || node.nodeInstanceId === decision.selected_route);
    if (routeTargets.length === 1) addEdge('decision_route', decisionId, routeTargets[0].id);
    else coverage.unlinkedDecisionRoutes += 1;
  }

  const artifactsByRef = new Map<string, string>();
  const artifactProducerByRef = new Map<string, string>();
  const evidenceGroups = new Map<string, CodeObservatoryEvidenceView[]>();
  for (const fact of input.evidence) {
    const group = evidenceGroups.get(fact.evidence_ref) ?? [];
    group.push(fact);
    evidenceGroups.set(fact.evidence_ref, group);
  }
  for (const [evidenceRef, facts] of evidenceGroups) {
    if (facts.length !== 1) {
      coverage.unlinkedArtifacts += facts.length;
      continue;
    }
    const fact = facts[0];
    const artifactId = `artifact:${fact.evidence_ref}`;
    artifactsByRef.set(evidenceRef, artifactId);
    addNode({
      id: artifactId,
      kind: 'artifact',
      label: fact.evidence_kind,
      subtitle: `${fact.status} · ${fact.evidence_ref}`,
      identity: fact.evidence_ref,
      runId: input.runId,
      executionStatus: fact.status,
      associationStatus: fact.retention_status,
      sourceRefs: fact.source_ref ? [fact.source_ref] : [],
      versions: fact.versions,
      startedAtMs: fact.recorded_at_ms ?? undefined,
      position: { x: 0, y: 0 },
    });
    const producer = oneOwner(sourceOwners, fact.source_ref);
    if (!producer || !addEdge('artifact_dependency', producer, artifactId)) coverage.unlinkedArtifacts += 1;
    else artifactProducerByRef.set(fact.evidence_ref, producer);
  }
  for (const event of validEvents) {
    const consumer = eventNodeIds.get(event) ?? oneOwner(sourceOwners, event.source_ref);
    if (!consumer) continue;
    for (const evidenceRef of event.evidence_refs ?? []) {
      const artifactId = artifactsByRef.get(evidenceRef);
      if (artifactId && artifactProducerByRef.get(evidenceRef) !== consumer && !addEdge('artifact_dependency', artifactId, consumer)) {
        if (artifactId !== consumer) coverage.unlinkedArtifacts += 1;
      }
    }
  }

  const observedOperationIds = new Set([
    ...input.nodes.map((node) => node.operation_id),
    ...input.spans.map((span) => span.operation_id),
    ...input.events.map((event) => event.operation_id),
  ].filter((operationId): operationId is string => Boolean(operationId)));
  const operationMatchesRun = input.operation?.runs.some((run) => run.run_id === input.runId)
    && (observedOperationIds.size === 0
      || (observedOperationIds.size === 1 && observedOperationIds.has(input.operation?.operation_id ?? '')));
  const operation = operationMatchesRun
    ? input.operation
    : undefined;
  if (operation) {
    for (const run of operation.runs) {
      addNode({
        id: `run:${run.run_id}`,
        kind: 'run',
        label: run.run_id === input.runId ? '当前 Run' : '关联 Run',
        subtitle: run.roles.join(' · ') || run.association_status,
        identity: run.run_id,
        runId: run.run_id,
        executionStatus: run.association_status,
        associationStatus: run.association_status,
        sourceRefs: run.source_refs,
        versions: { execution_generations: run.execution_generations },
        position: { x: 0, y: 0 },
      });
    }
    const operationEdgeKinds: Record<string, ExecutionGraphEdgeKind | undefined> = {
      execution_takeover: 'recovery',
      resume: 'resume_from',
      verification: 'trigger',
    };
    for (const relation of operation.run_links) {
      const kind = operationEdgeKinds[relation.relation_kind];
      if (!kind) continue;
      if (!addEdge(kind, `run:${relation.from_run_id}`, `run:${relation.to_run_id}`)) {
        coverage.missingSpanParents += 1;
      }
    }
    const attemptsByAction = new Map<string, typeof operation.recovery_attempts>();
    for (const attempt of operation.recovery_attempts.filter((candidate) => candidate.run_id === input.runId)) {
      const id = `attempt:${attempt.attempt_id}`;
      addNode({
        id,
        kind: 'attempt',
        label: `恢复尝试 ${attempt.attempt_number}`,
        subtitle: `${attempt.status} · ${attempt.action_id}`,
        identity: attempt.attempt_id,
        runId: attempt.run_id,
        actionId: attempt.action_id,
        executionStatus: attempt.status,
        associationStatus: attempt.side_effect_class,
        sourceRefs: attempt.source_refs,
        startedAtMs: attempt.started_at_ms,
        position: { x: 0, y: 0 },
      });
      const groupKey = `${attempt.run_id}\u001f${attempt.action_id}`;
      const group = attemptsByAction.get(groupKey) ?? [];
      group.push(attempt);
      attemptsByAction.set(groupKey, group);
      const matchingAction = actionNodes.find((node) => node.runId === attempt.run_id && node.actionId === attempt.action_id);
      if (!matchingAction) coverage.unlinkedRecoveryAttempts += 1;
      else addEdge('recovery', id, matchingAction.id);
    }
    for (const attempts of attemptsByAction.values()) {
      const sorted = [...attempts].sort((left, right) => left.attempt_number - right.attempt_number || left.attempt_id.localeCompare(right.attempt_id));
      for (let index = 1; index < sorted.length; index += 1) {
        const prior = sorted[index - 1];
        const current = sorted[index];
        if (current.attempt_number === prior.attempt_number + 1) {
          addEdge('retry_of', `attempt:${prior.attempt_id}`, `attempt:${current.attempt_id}`);
        }
      }
    }
  }

  const allNodes = [...nodeById.values()];
  const collapsedKinds = new Set<Exclude<ExecutionGraphNodeKind, 'group'>>(
    (input.collapsedKinds ?? []).filter((kind): kind is Exclude<ExecutionGraphNodeKind, 'group'> => kind !== 'group'),
  );
  const collapsedNodeIds = new Map<string, string>();
  const groupById = new Map<string, ExecutionGraphNode>();
  const graphNodes: ExecutionGraphNode[] = [];
  for (const node of allNodes) {
    if (node.kind === 'group' || !collapsedKinds.has(node.kind)) {
      graphNodes.push(node);
      continue;
    }
    const groupId = `group:${node.kind}`;
    collapsedNodeIds.set(node.id, groupId);
    let group = groupById.get(groupId);
    if (!group) {
      group = {
        id: groupId,
        kind: 'group',
        groupKind: node.kind,
        groupedNodeCount: 0,
        label: '',
        subtitle: '',
        identity: groupId,
        sourceRefs: [],
        startedAtMs: node.startedAtMs,
        position: { x: 0, y: 0 },
      };
      groupById.set(groupId, group);
      graphNodes.push(group);
    }
    group.groupedNodeCount = (group.groupedNodeCount ?? 0) + 1;
    group.startedAtMs = Math.min(group.startedAtMs ?? Number.MAX_SAFE_INTEGER, node.startedAtMs ?? Number.MAX_SAFE_INTEGER);
    group.sourceRefs = dedupeRefs([...group.sourceRefs, ...node.sourceRefs]).slice(0, 64);
  }
  for (const group of graphNodes.filter((node) => node.kind === 'group')) {
    const originalKind = group.groupKind!;
    group.label = `${NODE_KIND_LABELS[originalKind]} · ${group.groupedNodeCount} 节点`;
    group.subtitle = '已折叠 · 切换分组可展开';
    if (group.startedAtMs === Number.MAX_SAFE_INTEGER) group.startedAtMs = undefined;
  }

  const groupedEdges = new Map<string, ExecutionGraphEdge>();
  for (const edge of edges.values()) {
    const source = collapsedNodeIds.get(edge.source) ?? edge.source;
    const target = collapsedNodeIds.get(edge.target) ?? edge.target;
    if (source === target) {
      if (collapsedNodeIds.has(edge.source) || collapsedNodeIds.has(edge.target)) {
        coverage.collapsedInternalEdges += edge.relationshipCount ?? 1;
      }
      continue;
    }
    const id = `${edge.kind}:${source}:${target}`;
    const existing = groupedEdges.get(id);
    if (existing) {
      existing.relationshipCount = (existing.relationshipCount ?? 1) + (edge.relationshipCount ?? 1);
      existing.label = `${EDGE_LABELS[edge.kind]} ×${existing.relationshipCount}`;
    } else {
      groupedEdges.set(id, { ...edge, id, source, target });
    }
  }

  const keep = new Set(graphNodes
    .slice()
    .sort((left, right) => (right.startedAtMs ?? -1) - (left.startedAtMs ?? -1) || left.id.localeCompare(right.id))
    .slice(0, GRAPH_NODE_LIMIT)
    .map((node) => node.id));
  coverage.omittedNodes = Math.max(0, graphNodes.length - keep.size);
  const visibleNodes = graphNodes.filter((node) => keep.has(node.id));
  const visibleEdges = [...groupedEdges.values()].filter((edge) => keep.has(edge.source) && keep.has(edge.target));
  return {
    nodes: deterministicPositions(visibleNodes, visibleEdges),
    edges: visibleEdges,
    coverage,
    hasOperationRelations: Boolean(operation),
  };
}
