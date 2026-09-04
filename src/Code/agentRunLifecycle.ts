import type { CodeAgentRun } from '../lib/api';

export function resetAgentRuns(
  previous: CodeAgentRun[],
  options: { preserveHistory?: boolean } = {},
): CodeAgentRun[] {
  return options.preserveHistory ? previous : [];
}
