import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceSource = readFileSync(resolve(testDirectory, '../src/components/CodeWorkspace.tsx'), 'utf8');
const panelSource = readFileSync(resolve(testDirectory, '../src/components/CodeObservatoryPanel.tsx'), 'utf8');
const decisionInspectorSource = readFileSync(resolve(testDirectory, '../src/components/DecisionInspector.tsx'), 'utf8');
const decisionViewSource = readFileSync(resolve(testDirectory, '../src/Code/decisionView.ts'), 'utf8');
const evidenceInspectorSource = readFileSync(resolve(testDirectory, '../src/components/EvidenceInspector.tsx'), 'utf8');
const evidenceViewSource = readFileSync(resolve(testDirectory, '../src/Code/evidenceView.ts'), 'utf8');
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

test('shows source-backed decisions and makes missing history explicit', () => {
  assert.match(panelSource, /aria-label="观测详情"/);
  assert.match(panelSource, /决策检查 · \{state\.decisions\.length\}/);
  assert.match(panelSource, /<DecisionInspector decisions=\{state\.decisions\} \/>/);
  assert.match(decisionInspectorSource, /decision\.source_gaps/);
  assert.match(decisionInspectorSource, /decision\.reason_code \?\? '未记录'/);
  assert.match(decisionViewSource, /decision\.versions\.candidate_revision \?\? '未记录'/);
  assert.match(decisionViewSource, /contradicted: '结论矛盾'/);
  assert.match(decisionViewSource, /inconclusive: '验证不确定'/);
  assert.match(decisionViewSource, /invalid_test: '测试无效'/);
  assert.match(decisionViewSource, /infra_failure: '基础设施失败'/);
});

test('shows evidence retention and candidate gaps with an escaped text-only preview', () => {
  assert.match(panelSource, /证据检查 · \{state\.evidence\.length\}/);
  assert.match(panelSource, /<EvidenceInspector key=\{run\.id\} runId=\{run\.id\} evidence=\{state\.evidence\} \/>/);
  assert.match(evidenceInspectorSource, /getCodeObservatoryEvidencePreview\(/);
  assert.match(evidenceInspectorSource, /<pre[\s\S]*?>\s*\{preview\.preview\.content\}\s*<\/pre>/);
  assert.doesNotMatch(evidenceInspectorSource, /dangerouslySetInnerHTML|window\.open|location\.href/);
  assert.match(evidenceInspectorSource, /evidencePreviewErrorLabel\(code\)/);
  assert.match(evidenceViewSource, /candidate_revision_mismatch: '证据绑定到了其他候选版本'/);
  assert.match(evidenceViewSource, /persistent_artifact_binding_not_recorded/);
});
