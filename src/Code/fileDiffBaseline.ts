export type FileDiffRunStatus =
  | 'idle'
  | 'done'
  | 'generating'
  | 'modifying'
  | 'checking'
  | 'repairing'
  | 'error';

export interface FileDiffBaselineTransition {
  baseline: Record<string, string>;
  captured: boolean;
}

const ACTIVE_STATUSES = new Set<FileDiffRunStatus>([
  'generating',
  'modifying',
  'checking',
  'repairing',
]);

/**
 * Keep a completed run's diff visible until the next run starts. Capturing at
 * `done` replaces the before-image with the candidate and erases the diff.
 */
export function transitionFileDiffBaseline(
  status: FileDiffRunStatus,
  previousStatus: FileDiffRunStatus,
  currentVfs: Record<string, string>,
  currentBaseline: Record<string, string>,
  initialized: boolean,
): FileDiffBaselineTransition {
  const shouldCapture = !initialized || (
    ACTIVE_STATUSES.has(status) && !ACTIVE_STATUSES.has(previousStatus)
  );
  return shouldCapture
    ? { baseline: { ...currentVfs }, captured: true }
    : { baseline: currentBaseline, captured: false };
}
