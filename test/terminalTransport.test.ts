import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendPendingTerminalInput,
  createTerminalSessionKey,
} from '../src/Code/terminalTransport.ts';

test('terminal session key ignores list ordering and duplicate descriptors', () => {
  assert.equal(
    createTerminalSessionKey(['manual-b', 'agent-a', 'manual-b']),
    createTerminalSessionKey(['agent-a', 'manual-b']),
  );
});

test('terminal input typed while connecting is buffered with a bounded tail', () => {
  assert.equal(appendPendingTerminalInput('ab', 'cd'), 'abcd');
  assert.equal(appendPendingTerminalInput('1234', '567', 5), '34567');
});
