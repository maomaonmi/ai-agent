import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceSource = readFileSync(resolve(testDirectory, '../src/components/CodeWorkspace.tsx'), 'utf8');
const panelSource = readFileSync(resolve(testDirectory, '../src/components/CodeObservatoryPanel.tsx'), 'utf8');

test('mounts the observatory launcher in the Code workbench top toolbar', () => {
  const toolbarStart = workspaceSource.indexOf('const topbar = (');
  const toolbarEnd = workspaceSource.indexOf('\n  return (', toolbarStart);
  const launcher = workspaceSource.indexOf('<CodeObservatoryLauncher run={latestAgentRun} />');

  assert.ok(toolbarStart >= 0);
  assert.ok(toolbarEnd > toolbarStart);
  assert.ok(launcher > toolbarStart && launcher < toolbarEnd);
});

test('loads persisted events through replay and renders them in React Flow without event text', () => {
  assert.match(panelSource, /replayCodeEvents\(/);
  assert.match(panelSource, /<ReactFlow[\s\S]*?nodes=\{nodes\}[\s\S]*?edges=\{edges\}/);
  assert.doesNotMatch(panelSource, /event\.content|event\.metadata|event\.command/);
});
