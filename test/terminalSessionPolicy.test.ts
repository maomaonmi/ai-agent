import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterAgentTerminalRunIds,
  getAgentRunFamilyIds,
  getStaleAgentTerminalRunIds,
  getVisibleAgentTerminalRunId,
} from '../src/Code/terminalSessionPolicy.ts';

test('does not persist manual terminal ids as dismissed Agent runs', () => {
  assert.deepEqual(
    filterAgentTerminalRunIds(['manual-old', 'agent-1', 'manual-old', 'agent-1', 'agent-2']),
    ['agent-1', 'agent-2'],
  );
});

test('shows only the newest non-dismissed Agent run while preserving manual terminals', () => {
  const runs = [{ id: 'agent-1' }, { id: 'agent-2' }, { id: 'agent-3' }];

  assert.equal(getVisibleAgentTerminalRunId(runs, new Set()), 'agent-3');
  assert.equal(getVisibleAgentTerminalRunId(runs, new Set(['agent-3'])), 'agent-2');

  assert.deepEqual(
    getStaleAgentTerminalRunIds([
      { run_id: 'agent-1', is_manual: false },
      { run_id: 'agent-2', is_manual: false },
      { run_id: 'manual-1', is_manual: true },
    ], 'agent-2', new Set()),
    ['agent-1'],
  );

  assert.deepEqual(
    getAgentRunFamilyIds([
      { id: 'agent-1' },
      { id: 'agent-1-repair-1', parentRunId: 'agent-1' },
      { id: 'agent-2' },
    ], ['agent-1-repair-1']),
    ['agent-1-repair-1', 'agent-1'],
  );
});

test('keeps a clicked completed Agent terminal available while viewing another latest run', () => {
  assert.deepEqual(
    getStaleAgentTerminalRunIds([
      { run_id: 'agent-old', is_manual: false },
      { run_id: 'agent-latest', is_manual: false },
    ], 'agent-latest', new Set(), 'agent-old'),
    [],
  );
});
