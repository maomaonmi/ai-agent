import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceSource = readFileSync(
  resolve(testDirectory, '../src/components/CodeWorkspace.tsx'),
  'utf8',
);
const chatInterfaceSource = readFileSync(
  resolve(testDirectory, '../src/components/ChatInterface.tsx'),
  'utf8',
);
const timelineSource = readFileSync(
  resolve(testDirectory, '../src/components/CodeAgentTimeline.tsx'),
  'utf8',
);

const codeHeader = workspaceSource.match(
  /<div className="([^"]*h-\[60px\][^"]*border-b border-slate-200 bg-white[^"]*)">/,
)?.[1];

assert.ok(codeHeader, 'Code 工作台 header should be present');
assert.match(codeHeader, /\boverflow-visible\b/, 'Code 工作台 header should allow the File menu to escape its row');
assert.match(codeHeader, /\bpy-2\b/, 'Unified Code 工作台 header should use compact vertical spacing');
assert.match(codeHeader, /\bh-\[60px\]/, 'Unified Code 工作台 header should keep a single compact row');
assert.match(codeHeader, /\bmt-0\b/, 'Unified Code 工作台 header should start at the top of the Code page');
assert.match(codeHeader, /\bflex-nowrap\b/, 'Code 工作台 header should not grow by wrapping after fullscreen changes');
assert.doesNotMatch(codeHeader, /\bpy-5\b/, 'Code 工作台 header should not use symmetric py-5 padding');
assert.match(workspaceSource, /<CodeFileMenu/, 'Code 工作台 should expose the File menu in the top toolbar');
assert.match(workspaceSource, /onOpenWorkspace=\{openWorkspaceManifest\}/, 'File menu should open a workspace manifest through its own picker');
assert.match(workspaceSource, /onOpenFolder=\{openWorkspaceFolder\}/, 'File menu should use a directory picker for Open Folder');
assert.match(workspaceSource, /downloadWorkspace/, 'Save Workspace As should create a downloadable workspace file');
assert.match(workspaceSource, /navigator\.clipboard\.writeText/, 'Copy Workspace should write the serialized VFS to the clipboard');
assert.match(workspaceSource, /沙盒 Console 输入/, 'Sandbox Console should expose an editable command input');
assert.match(workspaceSource, /<textarea[\s\S]*rows=\{4\}/, 'Sandbox Console input should support multi-line pasted commands');
assert.match(workspaceSource, /resize-y/, 'Sandbox Console input should be vertically resizable');
assert.match(workspaceSource, /event\.shiftKey/, 'Sandbox Console should preserve Shift+Enter for line breaks');
assert.match(workspaceSource, /SANDBOX_EVAL_COMMAND/, 'Sandbox Console should send commands through the iframe message bridge');
assert.match(workspaceSource, /isSandboxEvalResult/, 'Sandbox Console should render returned command results');
assert.match(workspaceSource, /consoleCommandHistory/, 'Sandbox Console should retain command history for keyboard navigation');
assert.match(workspaceSource, /code-sandbox-agent-command/, 'CodeWorkspace should receive Agent-requested sandbox commands');
assert.match(workspaceSource, /postSandboxCommandResult/, 'CodeWorkspace should return iframe results to the AgentLoop');
assert.doesNotMatch(workspaceSource, /网页沙盒 <span[^>]*>· iframe 隔离渲染/, 'The iframe implementation detail should not be shown in the toolbar');
assert.doesNotMatch(workspaceSource, /\bmodeControl\b/, 'The redundant Code mode selector row should be removed from the workspace body');
assert.doesNotMatch(chatInterfaceSource, /modeControl=\{\(/, 'Code mode should not pass a second mode selector row into the workspace');
assert.match(workspaceSource, /topbarActions\?: ReactNode/, 'The Code workspace should accept the global header actions');
assert.match(workspaceSource, /<h1[^>]*>Code 工作台<\/h1>/, 'Code mode title should live in the same top row as the workspace toolbar');
assert.match(workspaceSource, /\{topbarActions\}/, 'Global header actions should render in the Code workspace top row');

assert.match(
  workspaceSource,
  /const getMaximumLeftPanelWidth = \(\) => \{[\s\S]*?Math\.floor\(workspaceWidth \/ 2\)/,
  'The vertical splitter should allow the left panel to reach half of the workspace width',
);
assert.match(
  workspaceSource,
  /setLeftPanelWidth\(Math\.min\(getMaximumLeftPanelWidth\(\), Math\.max\(280,/g,
  'Pointer resize should clamp against the dynamic half-width maximum',
);
assert.match(
  workspaceSource,
  /aria-valuemax=\{getMaximumLeftPanelWidth\(\)\}/,
  'The vertical splitter should expose its dynamic maximum to assistive technology',
);

assert.match(
  workspaceSource,
  /if \(!event\.isPrimary \|\| event\.button !== 0\) return false;/g,
  'Both resize handles should only start from the primary mouse button',
);
assert.match(
  workspaceSource,
  /moveEvent\.buttons !== 1/g,
  'Both resize handles should stop when the pointer is no longer pressed',
);
assert.match(
  workspaceSource,
  /window\.addEventListener\('pointercancel'/g,
  'Both resize handles should clean up cancelled pointer sessions',
);
assert.match(
  workspaceSource,
  /setPointerCapture\(pointerId\)/g,
  'Both resize handles should capture the active pointer while dragging',
);
assert.match(
  workspaceSource,
  /className="group relative z-20 hidden -mx-2 w-5 shrink-0 cursor-col-resize/g,
  'The vertical resize handle should expose a wider hit area without widening the layout gutter',
);
assert.match(
  workspaceSource,
  /className="group flex h-3 shrink-0 cursor-row-resize/g,
  'The console resize handle should have a dedicated, visible hit area',
);
assert.match(
  workspaceSource,
  /const getMinimumConsoleHeight = \(\) => activeTerminalTab === 'terminal' \? 320 : 96;/,
  'Terminal mode should keep a usable minimum height without fixing the panel height',
);
assert.match(
  workspaceSource,
  /const getConsoleHeight = \(\) => Math\.min\(\s*getMaximumConsoleHeight\(\),\s*Math\.max\(getMinimumConsoleHeight\(\), consoleHeight\),?\s*\);/,
  'The rendered console height should be clamped from the current resizable state',
);
assert.match(
  workspaceSource,
  /style=\{\{ height: isConsoleOpen \? getConsoleHeight\(\) : 40 \}\}/,
  'Terminal mode should render the live resized height instead of a fixed 320px value',
);
assert.match(
  workspaceSource,
  /setConsoleHeight\(Math\.min\(maximumHeight, Math\.max\(getMinimumConsoleHeight\(\),/,
  'Pointer resizing should respect the active tab minimum height',
);
assert.match(
  workspaceSource,
  /aria-valuemin=\{getMinimumConsoleHeight\(\)\}/,
  'The console splitter should expose the active tab minimum height',
);

assert.match(
  chatInterfaceSource,
  /mode === 'code' \? 'px-1' : 'p-6'/,
  'Code mode should use a narrow horizontal outer gap',
);
assert.match(
  chatInterfaceSource,
  /mode === 'code' \? \(/,
  'Code mode should reserve the page-level unified Code workspace top row',
);
assert.match(chatInterfaceSource, /id="code-workspace-topbar-slot"/, 'Code mode should expose a page-level toolbar mount point');
assert.match(chatInterfaceSource, /topbarActions=\{\(/, 'Code mode should pass the settings and agent actions into the unified top row');
assert.match(chatInterfaceSource, /topbarTargetId="code-workspace-topbar-slot"/, 'Code workspace should mount its toolbar into the page-level top row');
assert.match(chatInterfaceSource, /readCodeWorkbench/, 'Read-only Code conversations should use the observation-only AgentLoop');
assert.match(chatInterfaceSource, /codeReadOnlyTimeline/, 'Read-only answers should retain their Agent read timeline');
assert.match(workspaceSource, /answer\.timeline/, 'CodeWorkspace should render the read-only Agent timeline');
assert.match(workspaceSource, /只读 Agent · 读取过程/, 'Read-only timeline should identify the file-reading process');
assert.match(timelineSource, /px-4[^\n]*sm:px-6/, 'Agent timeline should have consistent horizontal inner padding');
assert.match(timelineSource, /StageIcon/, 'Agent timeline should show an icon for each stage');
assert.match(timelineSource, /bg-slate-200/, 'Agent timeline should use a shared neutral connector color');
assert.doesNotMatch(timelineSource, /timelineOffsetClass\(index\)/, '平级 Agent 事件不应按索引错位');
assert.match(timelineSource, /timelineDetailIndent/, 'Expandable event details should own the nested indentation');
assert.doesNotMatch(timelineSource, /w-28 shrink-0/, '平级标签不应通过固定列制造额外间距');
assert.match(timelineSource, /text-xs font-medium text-slate-500/, 'Timeline metadata should remain readable at the shared text size');
assert.match(timelineSource, /const timelinePanelSurface = 'bg-white'/, 'Timeline panels should use the shared white surface');
assert.doesNotMatch(timelineSource, /rounded-md border border-slate-200 bg-slate-50/, 'Timeline panels should not retain visible card borders');
assert.doesNotMatch(timelineSource, /rounded bg-amber-50/, 'Timeline detail panels should not retain tinted surfaces');
assert.match(timelineSource, /border-l border-slate-200/, 'Only expandable detail content should keep a hierarchy connector');
assert.match(timelineSource, /function TimelineActorControls\(/, 'Each Agent actor should have a collapsible peer control');
assert.match(timelineSource, /aria-expanded=\{!collapsedActorKinds\.has\(kind\)\}/, 'Agent controls should expose their expanded state');
assert.match(timelineSource, /const actorKinds = useMemo/, 'Timeline should discover actor lanes without regrouping their events');
assert.match(timelineSource, /const renderEvents = useMemo/, 'Timeline should preserve the original event order while collapsing an actor');
assert.doesNotMatch(timelineSource, /const timelineLanes = useMemo/, 'Timeline should not regroup interleaved events into separate lists');
assert.ok(
  timelineSource.indexOf('<CompletionFeedbackCard') > timelineSource.lastIndexOf('<TimelineEventList'),
  'Completion feedback should render after the interleaved event list',
);
assert.match(
  chatInterfaceSource,
  /mode === 'code'\n\s*\? 'flex h-full max-w-none flex-col overflow-hidden pb-1 pt-0'/,
  'Code mode should leave only a small bottom gap around the workspace frame',
);
