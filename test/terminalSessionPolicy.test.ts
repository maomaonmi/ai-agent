import test from 'node:test';
import assert from 'node:assert/strict';

import { getStaleAgentTerminalRunIds } from '../src/Code/terminalSessionPolicy.ts';

test('external execution sessions are not treated as stale agent PTYs', () => {
  assert.deepEqual(
    getStaleAgentTerminalRunIds(
      [
        { run_id: 'old-agent', is_manual: false },
        { run_id: 'verification-output', is_manual: false, is_external: true },
      ],
      'current-agent',
      new Set(),
    ),
    ['old-agent'],
  );
});
