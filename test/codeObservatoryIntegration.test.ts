import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceSource = readFileSync(resolve(testDirectory, '../src/components/CodeWorkspace.tsx'), 'utf8');
const panelSource = readFileSync(resolve(testDirectory, '../src/components/CodeObservatoryPanel.tsx'), 'utf8');
const apiSource = readFileSync(resolve(testDirectory, '../src/lib/codeObservatoryApi.ts'), 'utf8');
const reducerSource = readFileSync(resolve(testDirectory, '../src/Code/codeObservatoryReducer.ts'), 'utf8');
const streamSource = readFileSync(resolve(testDirectory, '../src/Code/codeObservatoryStream.ts'), 'utf8');

test('mounts the observatory launcher in the Code workbench top toolbar', () => {
  const toolbarStart = workspaceSource.indexOf('const topbar = (');
  const toolbarEnd = workspaceSource.indexOf('\n  return (', toolbarStart);
  const launcher = workspaceSource.indexOf('<CodeObservatoryLauncher run={latestAgentRun} />');

  assert.ok(toolbarStart >= 0);
  assert.ok(toolbarEnd > toolbarStart);
  assert.ok(launcher > toolbarStart && launcher < toolbarEnd);
});

test('loads the persisted observation snapshot and renders safe events in React Flow', () => {
  assert.match(panelSource, /getCodeObservatorySnapshot\(/);
  assert.match(panelSource, /projectCodeObservatoryFeedEvents\(/);
  assert.match(panelSource, /runCodeObservatoryStream\(/);
  assert.match(panelSource, /type: 'gap_detected'/);
  assert.match(panelSource, /onCatchupPage:/);
  assert.match(panelSource, /useReducer\(/);
  assert.match(apiSource, /\/api\/code\/observatory\/runs\/\$\{encodeURIComponent\(runId\)\}\/snapshot/);
  assert.match(apiSource, /\/api\/code\/observatory\/runs\/\$\{encodeURIComponent\(runId\)\}\/stream/);
  assert.match(panelSource, /<ReactFlow[\s\S]*?nodes=\{nodes\}[\s\S]*?edges=\{edges\}/);
  assert.doesNotMatch(panelSource, /window\.setInterval/);
  assert.doesNotMatch(panelSource, /event\.content|event\.metadata|event\.command/);
  assert.doesNotMatch(panelSource, /run\.trace\.status/);
  assert.match(panelSource, /state\.status\?\.execution/);
  assert.match(panelSource, /state\.connection/);
  assert.match(reducerSource, /MAX_CODE_OBSERVATORY_EVENTS/);
  assert.match(streamSource, /recoverCodeObservatoryGap/);
});

test('offers an accessible full-screen toggle that expands the panel to the viewport', () => {
  assert.match(panelSource, /aria-label=\{isFullscreen \? '退出链路面板全屏' : '全屏显示链路面板'\}/);
  assert.match(panelSource, /aria-pressed=\{isFullscreen\}/);
  assert.match(panelSource, /'fixed inset-0 z-\[100\] flex'/);
});
