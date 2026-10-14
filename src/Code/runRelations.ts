import type {
  CodeObservatoryOperationSnapshot,
  CodeObservatoryOperationView,
} from '../lib/codeObservatoryApi';

export interface CodeObservatoryRunRelations {
  operation: CodeObservatoryOperationView;
  focusedRunId: string;
  focusedRunFound: boolean;
}

/** Keep only server-bound identities; the client never invents Run links. */
export function projectCodeObservatoryRunRelations(
  snapshot: CodeObservatoryOperationSnapshot,
  operationId: string,
  focusedRunId: string,
): CodeObservatoryRunRelations | null {
  if (
    snapshot.operation_id !== operationId
    || snapshot.operation.operation_id !== operationId
    || snapshot.feed.aggregate_kind !== 'operation'
    || snapshot.feed.aggregate_id !== operationId
  ) return null;

  const knownRunIds = new Set(snapshot.operation.runs.map((run) => run.run_id));
  const links = snapshot.operation.run_links.filter((link) => (
    knownRunIds.has(link.from_run_id) && knownRunIds.has(link.to_run_id)
  ));

  return {
    operation: {
      ...snapshot.operation,
      run_links: links,
      runs: [...snapshot.operation.runs],
    },
    focusedRunId,
    focusedRunFound: knownRunIds.has(focusedRunId),
  };
}
