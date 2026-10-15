import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceSource = readFileSync(resolve(testDirectory, '../src/components/CodeWorkspace.tsx'), 'utf8');
const panelSource = readFileSync(resolve(testDirectory, '../src/components/CodeObservatoryPanel.tsx'), 'utf8');
const executionGraphSource = readFileSync(resolve(testDirectory, '../src/components/ExecutionGraph.tsx'), 'utf8');
const executionProjectionSource = readFileSync(resolve(testDirectory, '../src/Code/executionGraphProjection.ts'), 'utf8');
const decisionInspectorSource = readFileSync(resolve(testDirectory, '../src/components/DecisionInspector.tsx'), 'utf8');
const decisionViewSource = readFileSync(resolve(testDirectory, '../src/Code/decisionView.ts'), 'utf8');
const evidenceInspectorSource = readFileSync(resolve(testDirectory, '../src/components/EvidenceInspector.tsx'), 'utf8');
const evidenceViewSource = readFileSync(resolve(testDirectory, '../src/Code/evidenceView.ts'), 'utf8');
const apiSource = readFileSync(resolve(testDirectory, '../src/lib/codeObservatoryApi.ts'), 'utf8');
const reducerSource = readFileSync(resolve(testDirectory, '../src/Code/codeObservatoryReducer.ts'), 'utf8');
const streamSource = readFileSync(resolve(testDirectory, '../src/Code/codeObservatoryStream.ts'), 'utf8');
const controlTopologySource = readFileSync(resolve(testDirectory, '../src/components/ControlTopology.tsx'), 'utf8');
const requirementGraphSource = readFileSync(resolve(testDirectory, '../src/components/RequirementEvidenceGraph.tsx'), 'utf8');
const controlProjectionSource = readFileSync(resolve(testDirectory, '../src/Code/controlTopologyProjection.ts'), 'utf8');
const globalStyles = readFileSync(resolve(testDirectory, '../src/app/globals.css'), 'utf8');

test('mounts the observatory launcher in the Code workbench top toolbar', () => {
  const toolbarStart = workspaceSource.indexOf('const topbar = (');
  const toolbarEnd = workspaceSource.indexOf('\n  return (', toolbarStart);
  const launcher = workspaceSource.indexOf(
    '<CodeObservatoryLauncher run={latestAgentRun} sidebarCollapsed={sidebarCollapsed} />',
  );

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
  assert.match(panelSource, /displayState\.status\?\.execution/);
  assert.match(panelSource, /state\.connection/);
  assert.match(reducerSource, /MAX_CODE_OBSERVATORY_EVENTS/);
  assert.match(streamSource, /recoverCodeObservatoryGap/);
});

test('offers an accessible full-screen toggle that expands the panel to the viewport', () => {
  assert.match(panelSource, /aria-label=\{isFullscreen \? '退出链路面板全屏' : '全屏显示链路面板'\}/);
  assert.match(panelSource, /aria-pressed=\{isFullscreen\}/);
  assert.match(panelSource, /fixed inset-y-0 right-0 left-0 z-\[100\] flex/);
  assert.match(panelSource, /lg:left-14/);
  assert.match(panelSource, /lg:left-72/);
});

test('treats the panel as a modal dialog with keyboard focus management', () => {
  assert.match(panelSource, /role="dialog"/);
  assert.match(panelSource, /aria-modal="true"/);
  assert.match(panelSource, /aria-labelledby="code-observatory-panel-title"/);
  assert.match(panelSource, /focusableElements/);
  assert.match(panelSource, /event\.shiftKey/);
  assert.match(panelSource, /requestAnimationFrame\(/);
  assert.match(panelSource, /flex-wrap items-center justify-between gap-x-4/);
  assert.match(globalStyles, /\.code-observatory-dialog :is\(button, \[tabindex\]\):focus-visible/);
});

test('routes keyboard graph selection into the same inspectors as pointer selection', () => {
  assert.match(executionGraphSource, /onSelectionChange=\{\(\{ nodes \}\)/);
  assert.match(executionGraphSource, /ariaLabel: `\$\{NODE_KIND_LABELS/);
  assert.match(requirementGraphSource, /onSelectionChange=\{\(\{ nodes \}\)/);
  assert.match(controlTopologySource, /edgesFocusable/);
  assert.match(controlTopologySource, /onSelectionChange=\{\(\{ nodes, edges \}\)/);
  assert.match(controlProjectionSource, /ariaLabel: `控制状态：/);
});

test('offers the versioned control-rule graph without replacing the event timeline', () => {
  assert.match(panelSource, /setGraphView\('control'\)/);
  assert.match(panelSource, /setGraphView\('timeline'\)/);
  assert.match(panelSource, /<ControlTopology reloadKey=\{refreshVersion\} \/>/);
  assert.match(panelSource, /当前静态规则参考 · 不代表 Run 实际执行路径/);
  assert.match(apiSource, /\/api\/code\/observatory\/topology/);
});

test('offers the actual execution graph from persisted nodes, spans, causation and operation relations', () => {
  assert.match(panelSource, /setGraphView\('execution'\)/);
  assert.match(panelSource, /<ExecutionGraph/);
  assert.match(panelSource, /nodes=\{displayState\.nodes\}/);
  assert.match(panelSource, /spans=\{displayState\.spans\}/);
  assert.match(panelSource, /events=\{displayState\.events\}/);
  assert.match(executionGraphSource, /getCodeObservatoryOperationSnapshot\(/);
  assert.match(executionProjectionSource, /causation_refs/);
  assert.match(executionProjectionSource, /artifact_dependency/);
  assert.match(executionProjectionSource, /decision_route/);
  assert.match(executionProjectionSource, /resume_from/);
  assert.match(executionProjectionSource, /retry_of/);
  assert.match(executionGraphSource, /aria-label="折叠执行图分组"/);
  assert.match(executionGraphSource, /点击分组可展开/);
  assert.match(panelSource, /不按时间顺序推断关系/);
});

test('shows source-backed decisions and makes missing history explicit', () => {
  assert.match(panelSource, /aria-label="观测详情"/);
  assert.match(panelSource, /决策检查 · \{displayState\.decisions\.length\}/);
  assert.match(panelSource, /<DecisionInspector decisions=\{displayState\.decisions\} \/>/);
  assert.match(decisionInspectorSource, /decision\.source_gaps/);
  assert.match(decisionInspectorSource, /decision\.reason_code \?\? '未记录'/);
  assert.match(decisionViewSource, /decision\.versions\.candidate_revision \?\? '未记录'/);
  assert.match(decisionViewSource, /contradicted: '结论矛盾'/);
  assert.match(decisionViewSource, /inconclusive: '验证不确定'/);
  assert.match(decisionViewSource, /invalid_test: '测试无效'/);
  assert.match(decisionViewSource, /infra_failure: '基础设施失败'/);
});

test('shows evidence retention and candidate gaps with an escaped text-only preview', () => {
  assert.match(panelSource, /证据检查 · \{displayState\.evidence\.length\}/);
  assert.match(panelSource, /<EvidenceInspector key=\{run\.id\} runId=\{run\.id\} evidence=\{displayState\.evidence\} \/>/);
  assert.match(evidenceInspectorSource, /getCodeObservatoryEvidencePreview\(/);
  assert.match(evidenceInspectorSource, /<pre[\s\S]*?>\s*\{preview\.preview\.content\}\s*<\/pre>/);
  assert.doesNotMatch(evidenceInspectorSource, /dangerouslySetInnerHTML|window\.open|location\.href/);
  assert.match(evidenceInspectorSource, /evidencePreviewErrorLabel\(code\)/);
  assert.match(evidenceViewSource, /candidate_revision_mismatch: '证据绑定到了其他候选版本'/);
  assert.match(evidenceViewSource, /persistent_artifact_binding_not_recorded/);
});

test('replays one fixed offset while live SSE continues and current-only panels stay hidden', () => {
  assert.match(panelSource, /getCodeObservatoryReplaySnapshot\(/);
  assert.match(panelSource, /const displayState = replayState \?\? state/);
  assert.match(panelSource, /createCodeObservatoryReplayState\(replaySnapshot, run\.id\)/);
  assert.match(panelSource, /上一个事件/);
  assert.match(panelSource, /下一个事件/);
  assert.match(panelSource, /退出回放/);
  assert.match(panelSource, /实时订阅/);
  assert.match(panelSource, /isReplaying \?/);
  assert.match(panelSource, /需求关系图依赖当前 Operation 计划/);
  assert.match(panelSource, /Operation 聚合视图读取当前恢复预算/);
  assert.match(reducerSource, /createCodeObservatoryReplayState/);
});
