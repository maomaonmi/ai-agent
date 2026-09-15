'use client';

import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import {
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FileCode, Folder, Sparkles, Square, X } from 'lucide-react';

import {
  CodeGenerationStatus,
  injectErrorCatcher,
  isRuntimeErrorReport,
  isSandboxEvalResult,
  isSandboxConsoleEntry,
  isSelectedElementContext,
  RuntimeErrorReport,
  SandboxConsoleEntry,
  SelectedElementContext,
} from '../lib/codeSandbox';
import { SANDBOX_EVAL_COMMAND, SANDBOX_SET_INSPECT_MODE } from '../Code/inspectorScript';
import {
  getAcceptanceEligibility,
  type AcceptanceEligibilityState,
} from '../Code/acceptancePolicy';
import {
  getAgentRunLineage,
  isAgentRunExecutionActive,
  mapAgentRunsToPrompts,
} from '../Code/agentRunLifecycle';
import { bundleVFS, splitHtmlToVFS, VirtualFileSystem } from '../Code/vfsBundler';
import { VersionSnapshot } from '../Code/versionManager';
import { VersionTimelineDrawer } from '../Code/VersionTimelineDrawer';
import {
  bundleFullstackVFS,
  FULLSTACK_DATABASE_UPDATED,
  getProjectManifest,
  isFullstackVFS,
  isManifestProjectVFS,
  parseProjectCode,
  serializeProjectVFS,
} from '../Code/fullstackBundler';
import { FileTreeExplorer, buildTreeFromVFS, type FileTreeAction } from '../Code/FileTreeExplorer';
import CodeAgentTimeline from './CodeAgentTimeline';
import CodeFileMenu from './CodeFileMenu';
// Why: Phase3 记忆面板——Code 工作台左侧 aside 的「记忆」Tab 内容。
import MemoryPanel from './MemoryPanel';
// Why: xterm.js 在模块顶层引用 self（浏览器全局），SSR 阶段 Node 环境下没有 self → ReferenceError。
// 用 next/dynamic + ssr:false 把 IntegratedTerminal 完全限定在客户端水合后加载，从根本避免 SSR 导入。
const IntegratedTerminal = dynamic(
  () => import('./IntegratedTerminal').then((m) => m.default),
  { ssr: false, loading: () => null }
);
// 类型用 typeof import，避免值级联 import 触发 xterm 模块的副作用。
import type { TerminalProposition } from './IntegratedTerminal';
import {
  runCodeAcceptanceTest,
  postSandboxCommandResult,
  type ChatAttachment,
  type CodeAcceptanceReport,
  type AcceptanceProgressEvent,
  type CodeAgentRun,
  type CodeAgentTimelineEvent,
} from '../lib/api';
import MarkdownMessage from './MarkdownMessage';
import {
  detectLanguage,
  diffLines,
  highlightDiff,
  type DiffLine,
  type TokenKind,
} from '../lib/syntaxHighlight';

interface CodeWorkspaceProps {
  code: string;
  prompts: string[];
  topbarActions?: ReactNode;
  topbarTargetId?: string;
  // Why: 与 prompts 平行，回显每条用户提问附带的图片缩略图。
  promptAttachments?: ChatAttachment[][];
  input: string;
  modelControl: ReactNode;
  selectedElement: SelectedElementContext | null;
  isLoading: boolean;
  /** Blocks a new Code turn while browser verification or candidate commit is pending. */
  isWorkflowBusy?: boolean;
  isSessionReady: boolean;
  runId: string;
  status: CodeGenerationStatus;
  snapshots: VersionSnapshot[];
  activeVersionId: string;
  projectKind: 'frontend' | 'fullstack';
  agentRuns: CodeAgentRun[];
  terminalWorkspaceId: string;
  trustedTerminalPrefixes: Record<string, string[]>;
  onAddTrustedTerminalPrefix: (runId: string, prefix: string) => void;
  onOpenAgentTerminal?: (runId?: string) => void;
  onTerminalPropositionUpdate?: (prop: TerminalProposition | null) => void;
  // Why: Code 模式需要把附件状态提升到 ChatInterface，提交时传给后端视觉分析。
  attachments?: ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  // Why: 只有多模态模型才允许在前端粘贴/上传图片，避免把无效请求推给后端。
  isMultimodal?: boolean;
  // Console error/warn 是手动运行时修复的诊断证据，必须与当前 run 一起上送。
  onConsoleEntriesChange?: (entries: SandboxConsoleEntry[]) => void;
  onRuntimeError: (error: RuntimeErrorReport) => void;
  onAcceptanceFinished?: (result: {
    codeRunId: string;
    verificationRunId: string;
    passed: boolean;
    blocked: boolean;
    report: CodeAcceptanceReport;
    consoleEntries: SandboxConsoleEntry[];
  }) => boolean | void | Promise<boolean | void>;
  onStopAutoRepair: () => void;
  onCaptureSnapshot: (vfs: VirtualFileSystem, summary: string) => void;
  onPublishProject?: (vfs: VirtualFileSystem) => void;
  onRollbackVersion: (snapshot: VersionSnapshot) => void;
  onSaveManualVersion: (vfs: VirtualFileSystem, summary: string) => void;
  onSaveGoldenTrace?: (run: CodeAgentRun) => void;
  onProjectKindChange: (kind: 'frontend' | 'fullstack') => void;
  onElementSelected: (element: SelectedElementContext) => void;
  onInputChange: (value: string) => void;
  onClearSelectedElement: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  // Why: 需求面板问答式操作——重写把该条问题载回输入框(CTRL+Enter 发送并清空其后记录)；
  // 删除移除该条问答并在上层同步关闭对应终端会话。
  onRewritePrompt?: (promptIndex: number) => void;
  onDeletePrompt?: (promptIndex: number) => void;
  // Why: Day57 @file 剪枝——用户在 textarea 敲 @ 触发文件下拉,选中后转为 Badge。
  // 状态提升到 ChatInterface 以便在 submit 时一起传给后端剪枝。
  mentionedFiles?: string[];
  onMentionedFilesChange?: (files: string[]) => void;
  // Why: Day58 树状资源目录的手动编辑（新建/重命名/删除）会改本地VFS，
  // 变更后需要把新 VFS 序列化为字符串同步回上层 ChatInterface 的 generatedCode，
  // 以便下次提交时Agent能看到完整一致的VFS快照。
  onVfsChange?: (serializedCode: string) => void;
  /** Latest read-only answer projected from the persisted conversation timeline. */
  conversationAnswer?: {
    content: string;
    kind: 'conversation' | 'clarify' | 'routing_error';
    timeline?: CodeAgentTimelineEvent[];
    isRunning?: boolean;
  } | null;
  /** All persisted read-only answers, attached to the user prompt that caused them. */
  conversationAnswers?: Array<{
    promptIndex: number;
    content: string;
    kind: 'conversation' | 'clarify' | 'routing_error';
    timeline?: CodeAgentTimelineEvent[];
    isRunning?: boolean;
  }>;
}

type AcceptanceProjection = {
  state: 'idle' | 'running' | 'passed' | 'failed' | 'blocked';
  report: CodeAcceptanceReport | null;
  elapsedSeconds: number;
  progressMessage?: string;
  startSequence?: number;
};

const IDLE_ACCEPTANCE: AcceptanceProjection = {
  state: 'idle',
    report: null,
    elapsedSeconds: 0,
};

function getTimelineEvents(run: CodeAgentRun): CodeAgentTimelineEvent[] {
  if (run.trace.timeline?.length) return run.trace.timeline;
  const actorId = `main:${run.id}`;
  const createdAt = Date.parse(run.createdAt) || 0;
  let sequence = 0;
  const next = (
    stage: CodeAgentTimelineEvent['stage'],
    content: string,
    file?: CodeAgentTimelineEvent['file'],
  ): CodeAgentTimelineEvent => {
    sequence += 1;
    return {
      eventId: `legacy:${run.id}:${sequence}`,
      runId: run.id,
      actorId,
      actorKind: 'main',
      stage,
      content,
      done: true,
      timestampMs: createdAt + sequence,
      sequence,
      file,
      metadata: { source: 'legacy-trace' },
    };
  };
  const events = run.trace.steps.map((step) => next('status', step));
  if (run.trace.reasoning) events.push(next('thinking', run.trace.reasoning));
  if (run.trace.output) events.push(next('output', run.trace.output));
  if (run.trace.answer && !run.trace.summary) events.push(next('summary', run.trace.answer));
  if (run.trace.summary) events.push(next('summary', run.trace.summary));
  for (const change of run.trace.fileChanges ?? []) {
    events.push(next('file_change', `已生成文件变更：${change.path}`, { ...change, operation: 'modify' }));
  }
  return events;
}

const ACCEPTANCE_UI_TIMEOUT_MS = 50_000;

export default function CodeWorkspace({
  code,
  prompts,
  topbarActions,
  topbarTargetId,
  promptAttachments = [],
  input,
  modelControl,
  selectedElement,
  isLoading,
  isWorkflowBusy = isLoading,
  isSessionReady,
  runId,
  status,
  snapshots,
  activeVersionId,
  projectKind,
  agentRuns,
  terminalWorkspaceId,
  trustedTerminalPrefixes,
  onAddTrustedTerminalPrefix,
  onOpenAgentTerminal,
  onTerminalPropositionUpdate,
  attachments = [],
  onAttachmentsChange,
  isMultimodal = false,
  onConsoleEntriesChange,
  onRuntimeError,
  onAcceptanceFinished,
  onStopAutoRepair,
  onCaptureSnapshot,
  onPublishProject,
  onRollbackVersion,
  onSaveManualVersion,
  onSaveGoldenTrace,
  onProjectKindChange,
  onElementSelected,
  onInputChange,
  onClearSelectedElement,
  onSubmit,
  onRewritePrompt,
  onDeletePrompt,
  mentionedFiles = [],
  onMentionedFilesChange,
  onVfsChange,
  conversationAnswer = null,
  conversationAnswers = [],
}: CodeWorkspaceProps) {
  const [activeView, setActiveView] = useState<'preview' | 'source'>('preview');
  const [topbarTarget, setTopbarTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!topbarTargetId || typeof document === 'undefined') return;
    setTopbarTarget(document.getElementById(topbarTargetId));
    return () => setTopbarTarget(null);
  }, [topbarTargetId]);
  const [vfs, setVfs] = useState<VirtualFileSystem>({});
  const vfsRef = useRef<VirtualFileSystem>({});
  vfsRef.current = vfs;
  const [activeFile, setActiveFile] = useState('index.html');
  // Why: Agent Loop 刚写入的文件路径，用于文件树实时高亮。随 file_written 事件更新。
  const [writtenHighlight, setWrittenHighlight] = useState<string | null>(null);
  const [archiveState, setArchiveState] = useState<string | null>(null);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [hasUnsavedManualEdit, setHasUnsavedManualEdit] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isInspectMode, setIsInspectMode] = useState(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState(true);
  const [consoleHeight, setConsoleHeight] = useState(144);
  const [consoleEntries, setConsoleEntries] = useState<SandboxConsoleEntry[]>([]);
  const [consoleCommand, setConsoleCommand] = useState('');
  const [consoleCommandHistory, setConsoleCommandHistory] = useState<string[]>([]);
  const [, setConsoleHistoryIndex] = useState(-1);
  const consoleCommandInputRef = useRef<HTMLTextAreaElement>(null);
  // Why: 终端 Tab 和沙盒 Console 用同一个可伸缩面板承载；默认首次进入时是 console，
  // 用户一旦点"终端"就切过去。提案横幅贴在 Tab 条正上方，也就是 console panel 的顶部
  // （现在把 IntegratedTerminal 放进 console panel 里跟 console 并排）。
  const [activeTerminalTab, setActiveTerminalTab] = useState<'console' | 'terminal'>('console');
  // 手动终端前缀（区分自动 agent 终端 run_id）
  const [activeTerminalRunId, setActiveTerminalRunId] = useState<string>('');
  // Why: code 模式下 useCodeAutoRepair hook 已接收 skill_matched SSE 并 dispatch
  //   'skill-matched' CustomEvent，此处监听并展示"🧠 已加载技能：xxx"提示条，
  //   与聊天模式同源反馈。新一轮请求开始时清空。
  const [codeMatchedSkills, setCodeMatchedSkills] = useState<Array<{
    skill_name: string;
    standard_steps_count: number;
  }>>([]);
  // Why: Day58 方案一：Header Tab 切换——左侧 aside 内容在「需求面板」「资源管理器」间切换，表单常显底部
  // Why: Phase3 新增「记忆」Tab——展示当前会话的四层记忆（档案卡/摘要/VFS/Skill/事件）。
  type LeftPanelTab = 'prompts' | 'resources' | 'memory';
  const [leftPanelTab, setLeftPanelTab] = useState<LeftPanelTab>('prompts');
  // Why: Day58 拖拽目标高亮——从文件树拖拽到表单区域时显示绿色边框。
  const [isDragOver, setIsDragOver] = useState(false);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());
  // Acceptance belongs to the candidate run that produced it. Keeping one
  // global state here caused a late Test Agent result to render under the
  // next user request after a new run was appended.
  const [acceptanceByRun, setAcceptanceByRun] = useState<Record<string, AcceptanceProjection>>({});
  const acceptanceByRunRef = useRef<Record<string, AcceptanceProjection>>({});
  const agentRunsRef = useRef<CodeAgentRun[]>(agentRuns);
  const [leftPanelWidth, setLeftPanelWidth] = useState(360);
  // Why: 图片放大预览弹窗，点击缩略图后显示原图。
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // Why: Day57 @file 浮层状态——showDropdown 控制弹层显隐,filterText 是 @ 后的过滤词,
  // selectedIndex 是键盘上下键高亮索引,cursorPos 记录光标位置用于裁剪文本。
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [fileFilterText, setFileFilterText] = useState('');
  const [fileDropdownIndex, setFileDropdownIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const codeInputRef = useRef<HTMLTextAreaElement>(null);
  // Why: 源码视图提供“高亮/Diff 只读模式”和“原始文本编辑模式”两种体验，默认高亮模式，
  // 用户要手动改代码时再切回 textarea，兼顾可读性与可编辑性。
  const [sourceEditMode, setSourceEditMode] = useState<'highlight' | 'raw'>('highlight');
  // Why: 上一轮每个文件的内容快照，切换文件或状态进入 done 时更新，用于给新版本做增/删行 diff。
  const previousFileSnapshotsRef = useRef<Record<string, string>>({});
  // Why: 主题色变化（SettingsDialog 通过 documentElement classList 改 dark 类）要即时体现在代码面板上，
  // 所以把 dark/light 作为组件状态监听。
  const [isDarkTheme, setIsDarkTheme] = useState(() => {
    if (typeof document === 'undefined') return true;
    const saved = JSON.parse(localStorage.getItem('appearance-settings') || '{}');
    const theme: 'system' | 'light' | 'dark' | undefined = saved.theme;
    if (theme === 'light') return false;
    if (theme === 'dark') return true;
    return document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceFileInputRef = useRef<HTMLInputElement>(null);
  const workspaceFolderInputRef = useRef<HTMLInputElement>(null);
  const workspaceManifestInputRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
    const acceptanceControllerRef = useRef<AbortController | null>(null);
  const activeAcceptanceRunIdRef = useRef('');
  const testedRunIdRef = useRef('');
  const acceptanceEligibilityRef = useRef<AcceptanceEligibilityState>({
    candidateRunId: '',
    testedRunId: '',
  });
  const consoleEntriesRef = useRef<SandboxConsoleEntry[]>([]);
  const sandboxAgentRequestsRef = useRef<Map<string, string>>(new Map());
  const acceptancePreviewRef = useRef('');
  const promptsRef = useRef<string[]>([]);
  const onRuntimeErrorRef = useRef(onRuntimeError);
  const onAcceptanceFinishedRef = useRef(onAcceptanceFinished);
  const initialFileSetRef = useRef(false);
  consoleEntriesRef.current = consoleEntries;
  acceptanceByRunRef.current = acceptanceByRun;
  agentRunsRef.current = agentRuns;
  promptsRef.current = prompts;
  onRuntimeErrorRef.current = onRuntimeError;
  onAcceptanceFinishedRef.current = onAcceptanceFinished;

  useEffect(() => {
    onConsoleEntriesChange?.(consoleEntries);
  }, [consoleEntries, onConsoleEntriesChange]);

  const hasCode = code.trim().length > 0;
  const hasProject = Object.keys(vfs).length > 0;
  const activeAcceptanceState = activeAcceptanceRunIdRef.current
    ? acceptanceByRun[activeAcceptanceRunIdRef.current]?.state
    : undefined;
  const latestRunId = agentRuns.at(-1)?.id ?? '';
  // The header belongs to the current code candidate, not merely the last
  // durable timeline item. This prevents a late verifier result from a prior
  // request being shown while a new request is still running.
  const latestAcceptance = testedRunIdRef.current === runId && activeAcceptanceRunIdRef.current
    ? acceptanceByRun[activeAcceptanceRunIdRef.current] ?? IDLE_ACCEPTANCE
    : IDLE_ACCEPTANCE;

  // 终端面板辅助：创建手动终端 / 关闭会话 / 判断是否手动终端 / 选中的 run_id
  const createManualTerminal = useCallback((reuseStored = false) => {
    const storageKey = `active-manual-terminal:${terminalWorkspaceId}`;
    let runId = '';
    if (reuseStored) {
      try {
        runId = window.localStorage.getItem(storageKey) ?? '';
      } catch { /* noop */ }
    }
    if (!runId) {
      const suffix = Date.now().toString(36).slice(-5);
      runId = `manual-${suffix}`;
    }
    try {
      window.localStorage.setItem(storageKey, runId);
    } catch { /* noop */ }
    console.log('[terminal][createManual] runId=%s workspaceId=%s', runId, terminalWorkspaceId);
    setActiveTerminalRunId(runId);
  }, [terminalWorkspaceId]);

  const closeTerminalSession = useCallback((runId: string) => {
    console.log('[terminal][close] runId=%s workspaceId=%s', runId, terminalWorkspaceId);
    if (runId.startsWith('manual-')) {
      // Do not reuse a run id whose PTY is being closed. Reusing it races the
      // async close request and can attach the next terminal to a dying shell.
      const storageKey = `active-manual-terminal:${terminalWorkspaceId}`;
      try {
        if (window.localStorage.getItem(storageKey) === runId) {
          window.localStorage.removeItem(storageKey);
        }
      } catch { /* noop */ }
    }
    setActiveTerminalRunId((prev) => (prev === runId ? '' : prev));
    const wsp = terminalWorkspaceId;
    void (async () => {
      const url1 = `/api/terminal/close/${encodeURIComponent(wsp)}/${encodeURIComponent(runId)}`;
      console.log('[terminal][close] POST url=%s', url1);
      try {
        const r1 = await fetch(url1, { method: 'POST' });
        console.log('[terminal][close] r1 status=%s ok=%s', r1.status, r1.ok);
        if (r1.ok) return;
      } catch (e) { console.log('[terminal][close] r1 error:', e); }
      const url2 = `/api/terminal/close/${encodeURIComponent(runId)}`;
      console.log('[terminal][close] POST fallback url=%s', url2);
      try {
        const r2 = await fetch(url2, { method: 'POST' });
        console.log('[terminal][close] r2 status=%s ok=%s', r2.status, r2.ok);
        if (r2.ok) return;
      } catch (e) { console.log('[terminal][close] r2 error:', e); }
    })();
  }, [terminalWorkspaceId]);

  const isManualTerminalRunId = useCallback((runId: string) => runId.startsWith('manual-'), []);

  const focusAgentTerminal = useCallback((targetRunId?: string) => {
    setActiveTerminalTab('terminal');
    setIsConsoleOpen(true);
    if (targetRunId) setActiveTerminalRunId(targetRunId);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-code-agent-terminal-panel]')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  }, []);

  // 复制到剪贴板（需求面板问答的"复制"按钮）
  const copyText = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => { /* 剪贴板不可用时静默 */ });
  }, []);

  // 删除需求面板第 promptIndex 条问答：上层移除消息 + 同步关闭对应终端会话
  const handleDeletePromptItem = useCallback((promptIndex: number, runId?: string) => {
    onDeletePrompt?.(promptIndex);
    if (runId) {
      closeTerminalSession(runId);
      // Why: 智能体终端 Tab 由 agentRuns 派生，后端 close 后 Tab 不会自动消失，
      // 通过事件通知 IntegratedTerminal 把该 run_id 加入已关闭集合，同步移除 Tab。
      try {
        window.dispatchEvent(new CustomEvent('code-agent-terminal-close', { detail: { run_id: runId } }));
      } catch { /* noop */ }
    }
  }, [onDeletePrompt, closeTerminalSession]);


  // Why: Day58 @file/@folder 下拉——候选列表包含文件路径和推导出的中间目录路径。
  // 目录路径末尾统一带 '/'，便于后端 is_file_in_mentioned_paths 前缀匹配。
  const allVfsPaths = useMemo<string[]>(() => {
    const files = Object.keys(vfs);
    const folders = new Set<string>();
    files.forEach((f) => {
      const parts = f.split('/');
      for (let i = 1; i < parts.length; i++) {
        folders.add(`${parts.slice(0, i).join('/')}/`);
      }
    });
    return [...Array.from(folders).sort(), ...files.sort()];
  }, [vfs]);
  const filteredVfsPaths = useMemo(
    () => allVfsPaths.filter(
      (p) => p.toLowerCase().includes(fileFilterText.toLowerCase()) && !mentionedFiles.includes(p)
    ),
    [allVfsPaths, fileFilterText, mentionedFiles],
  );

  // Why: 检测 textarea 输入中的 @ 符号,若 @ 与光标间无空格/换行则触发文件下拉。
  const handleCodeInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart ?? val.length;
    onInputChange(val);
    setCursorPos(pos);

    const lastAtIdx = val.lastIndexOf('@', pos - 1);
    if (lastAtIdx !== -1) {
      const queryAfterAt = val.slice(lastAtIdx + 1, pos);
      // @ 与光标之间没有空格或换行才触发下拉,避免误识别普通文本中的 @。
      if (!/\s/.test(queryAfterAt)) {
        setFileFilterText(queryAfterAt);
        setShowFileDropdown(true);
        setFileDropdownIndex(0);
        return;
      }
    }
    setShowFileDropdown(false);
  }, [onInputChange]);

  // Why: 把 @xxx 文本片段移除并把选中的文件转为 Badge。text 来自 props,
  // 因此通过 onInputChange 回写裁剪后的字符串。
  const selectMentionedFile = useCallback((filePath: string) => {
    if (!onMentionedFilesChange) return;
    if (!mentionedFiles.includes(filePath)) {
      onMentionedFilesChange([...mentionedFiles, filePath]);
    }
    // 移除 textarea 中 @xxx 片段
    const lastAtIdx = input.lastIndexOf('@', cursorPos - 1);
    if (lastAtIdx !== -1) {
      const newText = input.slice(0, lastAtIdx) + input.slice(cursorPos);
      onInputChange(newText);
      setCursorPos(lastAtIdx);
    }
    setShowFileDropdown(false);
    codeInputRef.current?.focus();
  }, [cursorPos, input, mentionedFiles, onInputChange, onMentionedFilesChange]);

  const removeMentionedFile = useCallback((filePath: string) => {
    if (!onMentionedFilesChange) return;
    onMentionedFilesChange(mentionedFiles.filter((f) => f !== filePath));
  }, [mentionedFiles, onMentionedFilesChange]);

  // Why: textarea 键盘事件——当下拉显示且有候选项时,ArrowUp/Down/Enter/Tab/Escape
  // 走文件选择逻辑;否则 Enter(无 Shift)走表单提交。
  const handleCodeInputKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showFileDropdown && filteredVfsPaths.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFileDropdownIndex((prev) => (prev + 1) % filteredVfsPaths.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFileDropdownIndex((prev) => (prev - 1 + filteredVfsPaths.length) % filteredVfsPaths.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMentionedFile(filteredVfsPaths[fileDropdownIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowFileDropdown(false);
        return;
      }
    }
    // Why: 重写历史问题时支持 CTRL+Enter 直接发送（与标准对话输入框行为一致）
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (input.trim() && !isWorkflowBusy && isSessionReady) {
        onSubmit({ preventDefault: () => {} } as FormEvent<HTMLFormElement>);
      }
    }
  }, [fileDropdownIndex, filteredVfsPaths, selectMentionedFile, showFileDropdown, input, isWorkflowBusy, isSessionReady, onSubmit]);

  // Why: 把图片文件读成 Base64 data URL，与标准对话的 ChatAttachment 格式保持一致。
  const addImageFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 8 * 1024 * 1024) {
      window.alert('图片不能超过 8MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const newAttachment: ChatAttachment = { type: 'image_url', url, name: file.name };
      onAttachmentsChange?.([...attachments, newAttachment]);
    };
    reader.onerror = () => window.alert('读取图片失败');
    reader.readAsDataURL(file);
  }, [attachments, onAttachmentsChange]);

  // Why: 监听 textarea 粘贴事件，识别剪贴板中的图片并直接转成附件。
  // 只有多模态模型时才拦截图片粘贴，否则保持默认粘贴行为。
  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!isMultimodal) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) imageItems.push(item);
    }
    if (imageItems.length === 0) return;
    event.preventDefault();
    imageItems.forEach((item) => {
      const file = item.getAsFile();
      if (file) addImageFile(file);
    });
  }, [addImageFile, isMultimodal]);

  const removeAttachment = useCallback((index: number) => {
    onAttachmentsChange?.(attachments.filter((_, i) => i !== index));
  }, [attachments, onAttachmentsChange]);

  const runsForPrompts = useMemo(() => {
    return mapAgentRunsToPrompts(agentRuns, prompts);
  }, [agentRuns, prompts]);
  const instrumentedCode = useMemo(
    () => injectErrorCatcher(
      isFullstackVFS(vfs)
        ? bundleFullstackVFS(vfs, { runId })
        : isManifestProjectVFS(vfs)
          ? bundleFullstackVFS(vfs, { runId })
          : bundleVFS(vfs, { injectInspector: false }),
      runId,
    ),
    [vfs, runId],
  );
  acceptancePreviewRef.current = instrumentedCode;

  // Why: 把当前活动文件的旧版本（如果存在）与当前版本做 line-based diff，
  // 再按语言附加语法高亮，供源码视图渲染行号 + 新增绿/删除红 + 颜色区分。
  const activeFileLanguage = useMemo(() => detectLanguage(activeFile), [activeFile]);
  const activeFileDiffLines = useMemo<DiffLine[]>(() => {
    const current = vfs[activeFile] ?? '';
    const previous = previousFileSnapshotsRef.current[activeFile];
    // 初次生成（没有 previous，或 previous 就是完全相等）时不强行染色成全部新增，
    // 让“首次”只显示高亮行号，后续改动才显示 diff。
    if (previous === undefined || previous === current) {
      const lines = current.split(/\r?\n/);
      return lines.map((raw, idx): DiffLine => ({
        kind: 'equal',
        newLineNo: idx + 1,
        oldLineNo: idx + 1,
        tokens: [{ text: raw, kind: 'plain' }],
        raw,
      }));
    }
    return diffLines(previous, current);
  }, [activeFile, vfs]);
  const activeFileHighlighted = useMemo<DiffLine[]>(
    () => highlightDiff(activeFileDiffLines, activeFileLanguage),
    [activeFileDiffLines, activeFileLanguage],
  );

  useEffect(() => {
    if (status.state !== 'done' || !code.trim()) return;
    const latestPrompt = prompts.at(-1)?.trim() || '代码更新';
    const prefix = prompts.length <= 1 ? '初始生成' : `需求 ${prompts.length}`;
    const summary = status.repairCount > 0
      ? `自动修复：${latestPrompt}`
      : `${prefix}：${latestPrompt}`;
    onCaptureSnapshot(parseProjectCode(code) ?? splitHtmlToVFS(code), summary);
  }, [code, onCaptureSnapshot, prompts, status]);

  // === Day58: VFS 序列化同步——本地 setVfs 后回填 generatedCode ===
  // Why: 避免与 useEffect([code]) 双向触发导致的循环：用 ref 记录"本次 update 是手动编辑触发"，
  // code 变化时如果是自己提交的版本，不重新 parse 覆盖。
  const manualSerializationRef = useRef<string | null>(null);
  const serializeAndSyncVFS = useCallback((nextVfs: VirtualFileSystem) => {
    const serialized = isFullstackVFS(nextVfs) || isManifestProjectVFS(nextVfs)
      ? serializeProjectVFS(nextVfs)
      : bundleVFS(nextVfs, { injectInspector: false });
    manualSerializationRef.current = serialized;
    onVfsChange?.(serialized);
  }, [onVfsChange]);

  // 配合上方：当 code prop 变化时，如果值等于我们刚发出去的序列化版本，跳过 setVfs，
  // 避免 React 用相同值"再渲染一次"时把 VFS 又 parse 一遍（状态不变但有多余计算）。
  useEffect(() => {
    if (manualSerializationRef.current !== null && code === manualSerializationRef.current) {
      manualSerializationRef.current = null;
      return;
    }
    const projectVfs = parseProjectCode(code);
    const nextVfs = code.trim() ? (projectVfs ?? splitHtmlToVFS(code)) : {};
    setVfs(nextVfs);

    if (!code.trim()) {
      initialFileSetRef.current = false;
      // Why: reset 时清空 diff 历史快照，避免新对话的 diff 计算把旧会话的文件显示为"删除"。
      previousFileSnapshotsRef.current = {};
    } else if (projectVfs && Object.keys(projectVfs).length > 0 && !initialFileSetRef.current) {
      const manifest = getProjectManifest(projectVfs);
      const firstHtml = Object.keys(projectVfs).find((path) =>
        path.toLowerCase().endsWith('.html') || path.toLowerCase().endsWith('.htm')
      );
      setActiveFile(manifest?.frontend.entry ?? firstHtml ?? Object.keys(projectVfs)[0] ?? '');
      initialFileSetRef.current = true;
    }

    setArchiveState(null);
  }, [code]);

  const joinPath = (folder: string, name: string): string => {
    const normalized = folder.endsWith('/') ? folder : folder === '' ? '' : `${folder}/`;
    return `${normalized}${name}`;
  };

  // Why: 纯函数式地把 UI 动作（右键菜单4项）作用到 VFS 上，
  // 操作完成后序列化同步回上层 generatedCode。
  const handleTreeAction = useCallback((action: FileTreeAction) => {
    setVfs((previous) => {
      let next: Record<string, string> = { ...previous };
      let nextActive: string | null = null;

      switch (action.type) {
        case 'create-file': {
          const name = action.fileName.replace(/[\\:*?"<>|]/g, '_');
          const path = joinPath(action.atFolderPath, name);
          if (next[path] != null) return previous; // 重名不覆盖
          // Why: 给新文件附带一个最小可用模板，避免预览渲染时出现语法错误。
          const ext = name.split('.').pop()?.toLowerCase() ?? '';
          const defaultContent =
            ext === 'html' ? `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <title>${name}</title>\n</head>\n<body>\n  <h1>${name}</h1>\n</body>\n</html>\n`
              : ext === 'css' ? `/* ${name} */\n`
                : ext === 'json' ? `{}\n`
                  : ext === 'md' ? `# ${name}\n`
                    : (ext === 'js' || ext === 'ts' || ext === 'tsx' || ext === 'jsx')
                      ? `// ${name}\n`
                      : '';
          next[path] = defaultContent;
          nextActive = path;
          break;
        }
        case 'create-folder': {
          const folderName = action.folderName.replace(/[\\:*?"<>|]/g, '_');
          // 空目录没有显式 key（VFS 只存文件），但树是派生子结构；插入一个"占位文件"保持目录持久化
          const keepPath = joinPath(action.atFolderPath, `${folderName}/.gitkeep`);
          next[keepPath] = '';
          break;
        }
        case 'rename': {
          if (!action.oldPath || !action.newName.trim()) return previous;
          const newNameTrimmed = action.newName.replace(/[\\:*?"<>|]/g, '_');
          const isFolder = action.oldPath.endsWith('/') || !action.oldPath.split('/').pop()!.includes('.');
          const prefix = isFolder
            ? (action.oldPath.endsWith('/') ? action.oldPath : `${action.oldPath}/`)
            : null;

          if (isFolder && prefix != null) {
            const base = prefix.slice(0, -1).split('/').slice(0, -1).join('/');
            const normalizedBase = base ? `${base}/` : '';
            const newPrefix = `${normalizedBase}${newNameTrimmed}/`;
            const affected = Object.keys(next).filter((p) => p.startsWith(prefix));
            if (affected.length === 0) return previous;
            const migrated: Record<string, string> = {};
            for (const p of affected) {
              migrated[`${newPrefix}${p.slice(prefix.length)}`] = next[p]!;
              delete next[p];
            }
            next = { ...next, ...migrated };
            if (activeFile.startsWith(prefix)) {
              nextActive = `${newPrefix}${activeFile.slice(prefix.length)}`;
            }
          } else {
            const parts = action.oldPath.split('/');
            const fileName = parts.pop()!;
            // Why: 保留文件目录，但对文件名重命名；如果用户改了扩展名，允许修改
            const folderPrefix = parts.length > 0 ? `${parts.join('/')}/` : '';
            // 如果新文件名没有携带扩展名，尽量沿用旧扩展名保持类型一致
            const finalName = newNameTrimmed.includes('.') || !fileName.includes('.')
              ? newNameTrimmed
              : newNameTrimmed + fileName.slice(fileName.lastIndexOf('.'));
            const newPath = `${folderPrefix}${finalName}`;
            if (newPath === action.oldPath) return previous;
            if (next[newPath] != null) return previous; // 已存在同名
            next[newPath] = next[action.oldPath] ?? '';
            delete next[action.oldPath];
            if (activeFile === action.oldPath) nextActive = newPath;
          }
          break;
        }
        case 'delete': {
          if (!action.path) return previous;
          const isFolder = action.path.endsWith('/') || !action.path.split('/').pop()!.includes('.');
          if (isFolder) {
            const prefix = action.path.endsWith('/') ? action.path : `${action.path}/`;
            const keys = Object.keys(next);
            if (!keys.some((p) => p.startsWith(prefix))) return previous;
            for (const p of keys) {
              if (p.startsWith(prefix)) delete next[p];
            }
            if (activeFile.startsWith(prefix)) nextActive = 'index.html';
          } else {
            if (next[action.path] == null) return previous;
            delete next[action.path];
            if (activeFile === action.path) nextActive = 'index.html';
          }
          break;
        }
      }

      if (nextActive) setActiveFile(nextActive in next ? nextActive : Object.keys(next)[0] ?? '');
      // 下一帧再同步 generatedCode，避免 setVfs 与 onVfsChange 在同一个 tick 内互相触发
      queueMicrotask(() => serializeAndSyncVFS(next));
      return next;
    });
  }, [serializeAndSyncVFS, activeFile]);

  const createFileFromMenu = useCallback((defaultName = '未命名.js') => {
    const name = window.prompt('新建文件', defaultName)?.trim();
    if (!name) return;
    handleTreeAction({ type: 'create-file', atFolderPath: '', fileName: name });
    setLeftPanelTab('resources');
  }, [handleTreeAction]);

  const openWorkspaceFiles = useCallback(() => {
    workspaceFileInputRef.current?.click();
  }, []);

  const openWorkspaceFolder = useCallback(() => {
    workspaceFolderInputRef.current?.click();
  }, []);

  const openWorkspaceManifest = useCallback(() => {
    workspaceManifestInputRef.current?.click();
  }, []);

  const importWorkspaceFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const entries = await Promise.all(Array.from(files).map(async (file) => {
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      return [path, await file.text()] as const;
    }));
    const next = { ...vfsRef.current, ...Object.fromEntries(entries) };
    setVfs(next);
    setActiveFile(entries[0]?.[0] ?? activeFile);
    serializeAndSyncVFS(next);
    setLeftPanelTab('resources');
  }, [activeFile, serializeAndSyncVFS]);

  const importWorkspaceManifest = useCallback(async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const next = parseProjectCode(await file.text());
      if (!next) throw new Error('工作区文件必须是“文件路径 -> 文件内容”的 JSON 对象');
      setVfs(next);
      const firstFile = Object.keys(next)[0] ?? '';
      setActiveFile(firstFile);
      serializeAndSyncVFS(next);
      setLeftPanelTab('resources');
      setArchiveState(`已打开工作区：${file.name}`);
    } catch (error) {
      setArchiveState(error instanceof Error ? error.message : '工作区文件格式无效');
    }
  }, [serializeAndSyncVFS]);

  const downloadWorkspace = useCallback(() => {
    const blob = new Blob([serializeProjectVFS(vfsRef.current)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'workspace.code-workspace';
    anchor.click();
    URL.revokeObjectURL(url);
    setArchiveState('工作区已另存为 workspace.code-workspace');
  }, []);

  const copyWorkspace = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('当前环境不支持剪贴板');
      await navigator.clipboard.writeText(serializeProjectVFS(vfsRef.current));
      setArchiveState('工作区内容已复制');
    } catch (error) {
      setArchiveState(error instanceof Error ? `复制失败：${error.message}` : '复制工作区失败');
    }
  }, []);

  const executeSandboxCommand = useCallback(() => {
    const source = consoleCommand.trim().slice(0, 8_000);
    const target = iframeRef.current?.contentWindow;
    if (!source) return;
    const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-console`;
    setConsoleCommandHistory((previous) => [...previous.slice(-49), source]);
    setConsoleHistoryIndex(-1);
    setConsoleCommand('');
    setConsoleEntries((previous) => [
      ...previous.slice(-99),
      { level: 'info', args: [`> ${source}`], timestamp: Date.now() },
    ]);
    if (!target) {
      setConsoleEntries((previous) => [
        ...previous.slice(-99),
        { level: 'error', args: ['当前没有可执行的沙盒页面'], timestamp: Date.now() },
      ]);
      return;
    }
    target.postMessage({
      type: SANDBOX_EVAL_COMMAND,
      runId,
      requestId,
      source,
    }, '*');
  }, [consoleCommand, runId]);

  // The AgentLoop pauses on the backend until this browser-owned iframe
  // returns a result. Only the iframe result is forwarded; the model never
  // gets a path to the parent window or the local filesystem.
  useEffect(() => {
    const handleAgentSandboxCommand = (event: Event) => {
      const detail = (event as CustomEvent<{
        run_id?: string;
        request_id?: string;
        source?: string;
      }>).detail;
      const serverRunId = String(detail?.run_id || '').trim();
      const requestId = String(detail?.request_id || '').trim();
      const source = String(detail?.source || '').trim().slice(0, 8_000);
      if (!serverRunId || !requestId || !source) return;

      const bridgeRunId = runId;
      const target = iframeRef.current?.contentWindow;
      sandboxAgentRequestsRef.current.set(requestId, serverRunId);
      if (!target || !bridgeRunId) {
        sandboxAgentRequestsRef.current.delete(requestId);
        void postSandboxCommandResult({
          runId: serverRunId,
          requestId,
          ok: false,
          error: '当前没有可执行的 Code 预览页面。',
        }).catch(() => undefined);
        return;
      }
      target.postMessage({
        type: SANDBOX_EVAL_COMMAND,
        runId: bridgeRunId,
        requestId,
        source,
      }, '*');
    };
    window.addEventListener('code-sandbox-agent-command', handleAgentSandboxCommand);
    return () => window.removeEventListener('code-sandbox-agent-command', handleAgentSandboxCommand);
  }, [runId]);

  const handleConsoleCommandKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      executeSandboxCommand();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setConsoleHistoryIndex((previous) => {
        const next = Math.min(previous + 1, consoleCommandHistory.length - 1);
        setConsoleCommand(consoleCommandHistory[consoleCommandHistory.length - 1 - next] ?? '');
        return next;
      });
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setConsoleHistoryIndex((previous) => {
        const next = Math.max(previous - 1, -1);
        setConsoleCommand(next < 0 ? '' : consoleCommandHistory[consoleCommandHistory.length - 1 - next] ?? '');
        return next;
      });
    }
  }, [consoleCommandHistory, executeSandboxCommand]);

  useEffect(() => {
    workspaceFolderInputRef.current?.setAttribute('webkitdirectory', '');
    workspaceFolderInputRef.current?.setAttribute('directory', '');
  }, []);

  // Why: 监听 Agent Loop 的 file_written 事件，高亮文件树里刚写入的文件。
  useEffect(() => {
    const handleFileWritten = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      if (detail?.path) setWrittenHighlight(detail.path);
    };
    window.addEventListener('code-file-written', handleFileWritten);
    return () => window.removeEventListener('code-file-written', handleFileWritten);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === workspaceRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (isSandboxEvalResult(data) && data.runId === runId) {
        setConsoleEntries((previous) => [
          ...previous.slice(-99),
          {
            level: data.ok ? 'info' : 'error',
            args: [data.ok ? (data.value ?? 'undefined') : (data.error ?? '执行失败')],
            timestamp: Date.now(),
          },
        ]);
        const serverRunId = sandboxAgentRequestsRef.current.get(data.requestId);
        if (serverRunId) {
          sandboxAgentRequestsRef.current.delete(data.requestId);
          void postSandboxCommandResult({
            runId: serverRunId,
            requestId: data.requestId,
            ok: data.ok,
            value: data.value,
            error: data.error,
          }).catch((error: unknown) => {
            setConsoleEntries((previous) => [
              ...previous.slice(-99),
              {
                level: 'error',
                args: [`Agent 沙盒 Console 结果回传失败：${error instanceof Error ? error.message : '未知错误'}`],
                timestamp: Date.now(),
              },
            ]);
          });
        }
        return;
      }
      if (isRuntimeErrorReport(data) && data.runId === runId) {
        // Runtime exceptions are evidence for the pending verification run.
        // Do not start Ops directly from an iframe boot error; Test Agent must
        // observe the completed main run and decide whether it is actionable.
        setConsoleEntries((previous) => [
          ...previous.slice(-99),
          {
            level: 'error',
            args: [
              data.message,
              data.source ? `source=${data.source}` : '',
              data.line ? `line=${data.line}` : '',
              data.stack ? data.stack.slice(0, 2_000) : '',
            ].filter(Boolean),
            timestamp: Date.now(),
          },
        ]);
        return;
      }
      if (isSelectedElementContext(data) && data.runId === runId && isInspectMode) {
        onElementSelected(data);
        setIsInspectMode(false);
        return;
      }
      if (isSandboxConsoleEntry(data) && data.runId === runId) {
        setConsoleEntries((previous) => [
          ...previous.slice(-99),
          { level: data.level, args: data.args, timestamp: Date.now() },
        ]);
        // Console output is collected as evidence for the completed Test Agent
        // run. It must not independently start Ops while the test is pending.
        return;
      }
      if (
        data && typeof data === 'object' &&
        (data as { type?: unknown }).type === FULLSTACK_DATABASE_UPDATED &&
        (data as { runId?: unknown }).runId === runId
      ) {
        const database = (data as { database?: unknown }).database;
        if (database && typeof database === 'object' && !Array.isArray(database)) {
          const serialized = JSON.stringify(database, null, 2);
          if (serialized.length <= 200_000) {
            const currentVfs = vfsRef.current;
            const targetPath = getProjectManifest(currentVfs)?.data?.files?.[0]
              ?? (currentVfs['backend/database.json'] !== undefined ? 'backend/database.json' : null);
            if (targetPath) {
              setVfs((previous) => ({ ...previous, [targetPath]: serialized }));
            }
          }
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isInspectMode, onElementSelected, onRuntimeError, runId]);

  useEffect(() => {
    setConsoleEntries([]);
    setIsInspectMode(false);
    const previousAcceptanceRunId = activeAcceptanceRunIdRef.current;
    if (previousAcceptanceRunId && previousAcceptanceRunId !== runId) {
      acceptanceControllerRef.current?.abort();
      acceptanceControllerRef.current = null;
      setAcceptanceByRun((previous) => {
        const existing = previous[previousAcceptanceRunId];
        if (!existing || existing.state !== 'running') return previous;
        return {
          ...previous,
          [previousAcceptanceRunId]: {
            ...existing,
            state: 'blocked',
            report: {
              passed: false,
              blocked: true,
              diagnostic: '新需求已开始，上一轮测试已停止并保留在原任务下。',
            },
          },
        };
      });
      activeAcceptanceRunIdRef.current = '';
    }
  }, [runId]);

  // Why: 收到 terminal_proposal SSE 事件时自动切到终端 Tab 并选中对应 run_id，
  // 否则用户看不到审批横幅，proposition 会 90s 超时。
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { run_id?: string } | undefined;
      console.log('[terminal][proposal-arrived] run_id=%s', detail?.run_id);
      setActiveTerminalTab('terminal');
      if (detail?.run_id) setActiveTerminalRunId(detail.run_id);
    };
    window.addEventListener('terminal-proposal-arrived', handler);
    return () => window.removeEventListener('terminal-proposal-arrived', handler);
  }, []);

  // Why: 设置面板切换浅/深色主题时通过切换 documentElement 的 dark 类 +
  // 写入 localStorage；这里监听二者保证代码面板背景与高亮主题即时同步。
  useEffect(() => {
    const handler = () => {
      const saved = JSON.parse(localStorage.getItem('appearance-settings') || '{}');
      const theme: 'system' | 'light' | 'dark' | undefined = saved.theme;
      if (theme === 'light') { setIsDarkTheme(false); return; }
      if (theme === 'dark') { setIsDarkTheme(true); return; }
      setIsDarkTheme(document.documentElement.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches);
    };
    handler();
    const observer = new MutationObserver(handler);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    window.addEventListener('storage', handler);
    window.addEventListener('appearance-settings-changed' as unknown as keyof WindowEventMap, handler as EventListener);
    return () => {
      observer.disconnect();
      window.removeEventListener('storage', handler);
      window.removeEventListener('appearance-settings-changed' as unknown as keyof WindowEventMap, handler as EventListener);
    };
  }, []);

  // Why: 每轮模型运行结束（done 状态）时，把当前活动文件的内容记入“上一份快照”，
  // 下一次文件内容发生变化时就能画出增删行 diff。手动编辑回存时同样更新快照。
  useEffect(() => {
    if (status.state !== 'done') return;
    const next: Record<string, string> = { ...previousFileSnapshotsRef.current };
    for (const [key, value] of Object.entries(vfs)) next[key] = value;
    previousFileSnapshotsRef.current = next;
  }, [status.state, vfs]);

  useEffect(() => {
    const eligibility = getAcceptanceEligibility(
      acceptanceEligibilityRef.current,
      { runId, status: status.state },
    );
    acceptanceEligibilityRef.current = eligibility.state;
    const acceptanceTimelineRunId = latestRunId;
    if (
      testedRunIdRef.current === runId
      && acceptanceTimelineRunId
      && activeAcceptanceRunIdRef.current
      && activeAcceptanceRunIdRef.current !== acceptanceTimelineRunId
    ) {
      // A durable agent-run can arrive one render after the code candidate
      // reaches done. Move the existing projection to that lane without
      // starting a second browser request.
      const existingProjection = acceptanceByRunRef.current[activeAcceptanceRunIdRef.current];
      if (existingProjection) {
        activeAcceptanceRunIdRef.current = acceptanceTimelineRunId;
        setAcceptanceByRun((previous) => ({
          ...previous,
          [acceptanceTimelineRunId]: existingProjection,
        }));
      }
    }
    if (
      !eligibility.shouldStart ||
      !acceptancePreviewRef.current.trim() ||
      testedRunIdRef.current === runId
    ) return;

    const acceptanceCodeRunId = runId;
    // code-run-* is the browser candidate revision; agent-run-* is the
    // durable conversation/timeline lane. Keep both identities explicit so a
    // verifier result cannot disappear under a different request.
    const acceptanceLaneId = acceptanceTimelineRunId ?? acceptanceCodeRunId;
    const acceptanceStartSequence = Math.max(
      0,
      ...(agentRunsRef.current.find((run) => run.id === acceptanceLaneId)?.trace.timeline ?? [])
        .map((event) => event.sequence),
    ) + 0.5;
    testedRunIdRef.current = acceptanceCodeRunId;
    activeAcceptanceRunIdRef.current = acceptanceLaneId;
    const controller = new AbortController();
    acceptanceControllerRef.current = controller;
    setAcceptanceByRun((previous) => ({
      ...previous,
      [acceptanceLaneId]: {
        ...IDLE_ACCEPTANCE,
        state: 'running',
        startSequence: acceptanceStartSequence,
      },
    }));
    const previewHtml = acceptancePreviewRef.current;
    const expectation = promptsRef.current.at(-1)?.trim() || '验证页面主要交互可以正常工作';
    const acceptanceGoal = agentRunsRef.current.find((run) => run.id === acceptanceLaneId)?.trace.acceptanceGoal
      ?? agentRunsRef.current.find((run) => run.id === acceptanceCodeRunId)?.trace.acceptanceGoal;
    const verificationSessionId = agentRunsRef.current.find((run) => run.id === acceptanceLaneId)?.trace.verificationSessionId
      ?? agentRunsRef.current.find((run) => run.id === acceptanceCodeRunId)?.trace.verificationSessionId;

    void runCodeAcceptanceTest({
      user_request: expectation,
      preview_html: previewHtml,
      run_id: acceptanceLaneId,
      verification_run_id: acceptanceCodeRunId,
      verification_session_id: verificationSessionId,
      acceptance_goal: acceptanceGoal,
      // Let the backend classify the candidate conservatively. This is the
      // exact VFS snapshot rendered into the preview, not a user-text guess.
      changed_files: Object.keys(vfs),
      console_entries: consoleEntriesRef.current.map((entry) => ({
        level: entry.level,
        text: entry.args.join(' '),
      })),
    }, (event: AcceptanceProgressEvent) => {
      if (controller.signal.aborted || testedRunIdRef.current !== acceptanceCodeRunId) return;
      setAcceptanceByRun((previous) => ({
        ...previous,
        [acceptanceLaneId]: {
          ...(previous[acceptanceLaneId] ?? IDLE_ACCEPTANCE),
          state: 'running',
          elapsedSeconds: event.elapsed_seconds
            ?? previous[acceptanceLaneId]?.elapsedSeconds
            ?? 0,
          progressMessage: event.message,
        },
      }));
    }, controller.signal).then(async (report) => {
      if (controller.signal.aborted || testedRunIdRef.current !== acceptanceCodeRunId) return;
      setAcceptanceByRun((previous) => ({
        ...previous,
        [acceptanceLaneId]: {
          ...(previous[acceptanceLaneId] ?? IDLE_ACCEPTANCE),
          report,
          state: report.blocked ? 'blocked' : report.passed ? 'passed' : 'failed',
        },
      }));
      const observedEntries = consoleEntriesRef.current.slice(-100);
      const acceptanceHandled = await onAcceptanceFinishedRef.current?.({
        codeRunId: acceptanceCodeRunId,
        verificationRunId: report.verification_run_id ?? acceptanceCodeRunId,
        passed: report.passed,
        blocked: report.blocked,
        report,
        consoleEntries: observedEntries,
      });
      if (acceptanceHandled === true || report.blocked) {
        return;
      }
      if (report.passed) {
        return;
      }
      const failedAssertions = report.assertions
        ?.filter((item) => !item.passed)
        .map((item) => `${item.assertion.kind} ${item.assertion.selector}: ${item.actual}`)
        .join('\n');
      const deterministicFindings = report.deterministic_findings
        ?.map((item) => `${item.kind} ${item.selector}: ${item.actual}`)
        .join('\n');
      const pageErrors = report.page_errors
        ?.map((item) => `${item.type}: ${item.text}`)
        .join('\n');
      onRuntimeErrorRef.current({
        type: 'code-sandbox-runtime-error',
        runId: acceptanceCodeRunId,
        source: 'deterministic-browser-verifier',
        message: [
          `${report.deterministic ? '确定性浏览器验证未通过' : '用户验收未通过'}：${report.plan?.summary ?? expectation}`,
          failedAssertions,
          deterministicFindings,
          pageErrors,
          report.page_text ? `页面可见文本：${report.page_text}` : '',
          report.diagnostic,
          report.runner_stderr,
          report.network_failures?.length
            ? `网络失败：${JSON.stringify(report.network_failures)}`
            : '',
          report.console?.length
            ? `测试控制台：${JSON.stringify(report.console.slice(-20))}`
            : '',
        ].filter(Boolean).join('\n\n').slice(0, 4_000),
        consoleEntries: [
          ...consoleEntriesRef.current.map((entry) => ({
            level: entry.level,
            text: entry.args.join(' '),
          })),
          ...(report.console ?? []),
        ].slice(-100),
      });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) {
        if (acceptanceControllerRef.current === controller) {
          acceptanceControllerRef.current = null;
          setAcceptanceByRun((previous) => ({
            ...previous,
            [acceptanceLaneId]: {
              ...(previous[acceptanceLaneId] ?? IDLE_ACCEPTANCE),
              state: 'blocked',
              report: {
                passed: false,
                blocked: true,
                diagnostic: '测试请求被预览状态更新中断，已安全终止。',
              },
            },
          }));
        }
        return;
      }
      setAcceptanceByRun((previous) => ({
        ...previous,
        [acceptanceLaneId]: {
          ...(previous[acceptanceLaneId] ?? IDLE_ACCEPTANCE),
          state: 'blocked',
          report: {
            passed: false,
            blocked: true,
            diagnostic: error instanceof Error ? error.message : '浏览器验证器调用失败',
          },
        },
      }));
      if (testedRunIdRef.current !== acceptanceCodeRunId) return;
      // A transport/timeout failure is still a terminal verifier outcome.
      // Notify the owning Agent lane so a runtime-repair child cannot remain
      // `isRunning=true` forever simply because no report body was returned.
      const blockedReport: CodeAcceptanceReport = {
        passed: false,
        blocked: true,
        verification_run_id: acceptanceCodeRunId,
        run_id: acceptanceLaneId,
        diagnostic: error instanceof Error ? error.message : '浏览器验证器调用失败',
      };
      onAcceptanceFinishedRef.current?.({
        codeRunId: acceptanceCodeRunId,
        verificationRunId: acceptanceCodeRunId,
        passed: false,
        blocked: true,
        report: blockedReport,
        consoleEntries: consoleEntriesRef.current.slice(-100),
      });
    }).finally(() => {
      if (acceptanceControllerRef.current === controller) {
        acceptanceControllerRef.current = null;
      }
    });

    return () => controller.abort();
  }, [latestRunId, runId, status.state]);

  useEffect(() => {
    const acceptanceRunId = activeAcceptanceRunIdRef.current;
    if (!acceptanceRunId || acceptanceByRunRef.current[acceptanceRunId]?.state !== 'running') return;
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setAcceptanceByRun((previous) => ({
        ...previous,
        [acceptanceRunId]: {
          ...(previous[acceptanceRunId] ?? IDLE_ACCEPTANCE),
          elapsedSeconds: Math.min(
            Math.floor((Date.now() - startedAt) / 1000),
            ACCEPTANCE_UI_TIMEOUT_MS / 1_000,
          ),
        },
      }));
    }, 1_000);
    const timeoutId = window.setTimeout(() => {
      const activeController = acceptanceControllerRef.current;
      if (!activeController) return;
      const ownsCurrentVerification = testedRunIdRef.current === runId;
      activeController.abort();
      acceptanceControllerRef.current = null;
      setAcceptanceByRun((previous) => ({
        ...previous,
        [acceptanceRunId]: {
          ...(previous[acceptanceRunId] ?? IDLE_ACCEPTANCE),
          state: 'blocked',
          elapsedSeconds: ACCEPTANCE_UI_TIMEOUT_MS / 1_000,
          report: {
            passed: false,
            blocked: true,
            diagnostic: '测试状态超过 50 秒，已由界面看门狗强制终止。',
          },
        },
      }));
      if (ownsCurrentVerification) {
        const blockedReport: CodeAcceptanceReport = {
          passed: false,
          blocked: true,
          verification_run_id: runId,
          run_id: acceptanceRunId,
          diagnostic: '测试状态超过 50 秒，已由界面看门狗强制终止。',
        };
        onAcceptanceFinishedRef.current?.({
          codeRunId: runId,
          verificationRunId: runId,
          passed: false,
          blocked: true,
          report: blockedReport,
          consoleEntries: consoleEntriesRef.current.slice(-100),
        });
      }
    }, ACCEPTANCE_UI_TIMEOUT_MS);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [activeAcceptanceState, runId]);

  useEffect(() => {
    const latest = agentRuns.at(-1);
    if (!latest?.trace.isRunning) return;
    setExpandedRunIds((previous) => {
      if (previous.has(latest.id)) return previous;
      return new Set(previous).add(latest.id);
    });
  }, [agentRuns]);

  // Why: 新一轮 code 请求开始时清空上一轮的 Skill 命中提示。
  useEffect(() => {
    if (isLoading) setCodeMatchedSkills([]);
  }, [isLoading]);

  // Why: 监听 useCodeAutoRepair hook dispatch 的 'skill-matched' CustomEvent，
  //   将命中的 Skill 手册追加到提示条。事件 detail 形如 { skill_name: string }。
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ skill_name: string }>).detail;
      if (!detail?.skill_name) return;
      setCodeMatchedSkills((prev) => {
        if (prev.some((s) => s.skill_name === detail.skill_name)) return prev;
        return [...prev, { skill_name: detail.skill_name, standard_steps_count: 0 }];
      });
    };
    window.addEventListener('skill-matched', handler);
    return () => window.removeEventListener('skill-matched', handler);
  }, []);

  const postInspectMode = (enabled: boolean) => {
    iframeRef.current?.contentWindow?.postMessage({
      type: SANDBOX_SET_INSPECT_MODE,
      runId,
      enabled,
    }, '*');
  };

  const toggleInspectMode = () => {
    const nextValue = !isInspectMode;
    setIsInspectMode(nextValue);
    postInspectMode(nextValue);
  };

  const stopAgentLoop = () => {
    acceptanceControllerRef.current?.abort();
    acceptanceControllerRef.current = null;
    const acceptanceRunId = activeAcceptanceRunIdRef.current;
    if (acceptanceRunId) {
      setAcceptanceByRun((previous) => ({
        ...previous,
        [acceptanceRunId]: {
          ...(previous[acceptanceRunId] ?? IDLE_ACCEPTANCE),
          state: 'blocked',
          report: {
            passed: false,
            blocked: true,
            diagnostic: '已由用户终止模型对话与自动测试修复循环。',
          },
        },
      }));
      activeAcceptanceRunIdRef.current = '';
    }
    onStopAutoRepair();
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement === workspaceRef.current) {
      await document.exitFullscreen();
      return;
    }
    await workspaceRef.current?.requestFullscreen();
  };

  const getMaximumLeftPanelWidth = () => {
    const workspaceWidth = workspaceRef.current?.getBoundingClientRect().width;
    return workspaceWidth ? Math.max(280, Math.floor(workspaceWidth / 2)) : 560;
  };

  const getMinimumConsoleHeight = () => activeTerminalTab === 'terminal' ? 320 : 96;

  const getMaximumConsoleHeight = () => {
    const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
    const workspaceHeight = workspaceRef.current?.getBoundingClientRect().height ?? viewportHeight;
    return Math.max(getMinimumConsoleHeight(), workspaceHeight - 48);
  };

  const getConsoleHeight = () => Math.min(
    getMaximumConsoleHeight(),
    Math.max(getMinimumConsoleHeight(), consoleHeight),
  );

  // Keep both splitters on one pointer lifecycle. Checking buttons on every move
  // prevents a lost pointerup from turning ordinary mouse movement into a resize.
  const beginPointerResize = (
    event: React.PointerEvent<HTMLDivElement>,
    cursor: 'col-resize' | 'row-resize',
    onMove: (moveEvent: PointerEvent) => void,
  ) => {
    if (!event.isPrimary || event.button !== 0) return false;

    resizeCleanupRef.current?.();
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    const finish = (endEvent?: PointerEvent) => {
      if (endEvent && endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', finishFromBlur);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
      if (resizeCleanupRef.current === finish) resizeCleanupRef.current = null;
    };
    const finishFromBlur = () => finish();
    const resize = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || moveEvent.buttons !== 1) {
        finish(moveEvent);
        return;
      }
      onMove(moveEvent);
    };

    resizeCleanupRef.current = finish;
    handle.setPointerCapture(pointerId);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = cursor;
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', finishFromBlur);
    return true;
  };

  useEffect(() => () => {
    resizeCleanupRef.current?.();
  }, []);

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = leftPanelWidth;
    beginPointerResize(event, 'col-resize', (moveEvent) => {
      setLeftPanelWidth(Math.min(getMaximumLeftPanelWidth(), Math.max(280, startWidth + moveEvent.clientX - startX)));
    });
  };

  const beginConsoleResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const startY = event.clientY;
    const startHeight = getConsoleHeight();
    const started = beginPointerResize(event, 'row-resize', (moveEvent) => {
      const maximumHeight = getMaximumConsoleHeight();
      setConsoleHeight(Math.min(maximumHeight, Math.max(getMinimumConsoleHeight(), startHeight + startY - moveEvent.clientY)));
    });
    if (started) setIsConsoleOpen(true);
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const maximumWidth = getMaximumLeftPanelWidth();
    const nextWidth = event.key === 'ArrowLeft'
      ? leftPanelWidth - step
      : event.key === 'ArrowRight'
        ? leftPanelWidth + step
        : event.key === 'Home'
          ? 280
          : event.key === 'End'
            ? maximumWidth
            : null;
    if (nextWidth == null) return;
    event.preventDefault();
    setLeftPanelWidth(Math.min(maximumWidth, Math.max(280, nextWidth)));
  };

  const handleConsoleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const maximumHeight = getMaximumConsoleHeight();
    const minimumHeight = getMinimumConsoleHeight();
    const nextHeight = event.key === 'ArrowUp'
      ? consoleHeight + step
      : event.key === 'ArrowDown'
        ? consoleHeight - step
        : event.key === 'Home'
          ? minimumHeight
          : event.key === 'End'
            ? maximumHeight
            : null;
    if (nextHeight == null) return;
    event.preventDefault();
    setIsConsoleOpen(true);
    setConsoleHeight(Math.min(maximumHeight, Math.max(minimumHeight, nextHeight)));
  };

  const updateActiveFile = (content: string) => {
    setVfs((previous) => ({ ...previous, [activeFile]: content }));
    setHasUnsavedManualEdit(true);
  };

  const saveManualEdit = () => {
    if (!hasUnsavedManualEdit) return;
    onSaveManualVersion(vfs, `手动编辑：${activeFile}`);
    // Why: 手动编辑保存后也要把这份新内容作为“基线”，否则下次模型改动的 diff 会把用户刚手写的也当作插入。
    previousFileSnapshotsRef.current = { ...previousFileSnapshotsRef.current, [activeFile]: vfs[activeFile] ?? '' };
    setHasUnsavedManualEdit(false);
  };

  const exportZip = async () => {
    if (!hasProject) return;
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    Object.entries(vfs).forEach(([path, content]) => zip.file(path, content));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'my-project.zip';
    link.click();
    URL.revokeObjectURL(url);
  };

  const archiveProject = async () => {
    if (!hasProject) return;
    setArchiveState('正在归档到 workspace...');
    try {
      const response = await fetch('/api/code/vfs/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_name: 'my-app', files: vfs }),
      });
      const payload = await response.json() as { project_path?: string; detail?: string };
      if (!response.ok) throw new Error(payload.detail || '归档失败');
      setArchiveState(`已归档：${payload.project_path ?? 'workspace/my-app'}`);
    } catch (error) {
      setArchiveState(error instanceof Error ? error.message : '归档失败');
    }
  };

  const topbar = (
      <div className="mt-0 flex h-[60px] min-h-[60px] max-h-[60px] shrink-0 flex-nowrap items-center justify-between gap-3 overflow-visible border-b border-slate-200 bg-white px-3 py-2">
        <input
          ref={workspaceFileInputRef}
          type="file"
          multiple
          accept=".html,.htm,.css,.js,.jsx,.ts,.tsx,.json,.md,.txt,.py,.sql,.xml,.svg"
          className="hidden"
          onChange={(event) => {
            void importWorkspaceFiles(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={workspaceFolderInputRef}
          type="file"
          multiple
          accept=".html,.htm,.css,.js,.jsx,.ts,.tsx,.json,.md,.txt,.py,.sql,.xml,.svg"
          className="hidden"
          onChange={(event) => {
            void importWorkspaceFiles(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
        <input
          ref={workspaceManifestInputRef}
          type="file"
          accept=".json,.code-workspace,application/json"
          className="hidden"
          onChange={(event) => {
            void importWorkspaceManifest(event.currentTarget.files);
            event.currentTarget.value = '';
          }}
        />
        <div className="flex min-w-0 shrink items-center gap-3">
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <h1 className="whitespace-nowrap text-base font-semibold tracking-tight text-slate-900">Code 工作台</h1>
          </div>
          <CodeFileMenu
            onNewTextFile={() => createFileFromMenu('未命名.txt')}
            onNewFile={() => createFileFromMenu()}
            onNewWindow={() => window.open(window.location.href, '_blank', 'noopener,noreferrer')}
            onOpenFile={openWorkspaceFiles}
            onOpenFolder={openWorkspaceFolder}
            onOpenWorkspace={openWorkspaceManifest}
            onOpenRecent={() => setLeftPanelTab('resources')}
            onAddFolderToWorkspace={openWorkspaceFolder}
            onSaveWorkspaceAs={downloadWorkspace}
            onCopyWorkspace={copyWorkspace}
          />
          {/* Day58: 方案一 Tab 切换——在标题旁直接切换左侧 aside 内容 */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
            <button
              type="button"
              aria-pressed={leftPanelTab === 'prompts'}
              onClick={() => setLeftPanelTab('prompts')}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                leftPanelTab === 'prompts'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              📋 需求面板
            </button>
            <button
              type="button"
              aria-pressed={leftPanelTab === 'resources'}
              onClick={() => setLeftPanelTab('resources')}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                leftPanelTab === 'resources'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              🌳 资源管理器
            </button>
            <button
              type="button"
              aria-pressed={leftPanelTab === 'memory'}
              onClick={() => setLeftPanelTab('memory')}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                leftPanelTab === 'memory'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              🧠 记忆
            </button>
          </div>
        </div>

        <div className="flex min-w-0 shrink-0 flex-nowrap items-center justify-end gap-2">
          <div
            role="status"
            aria-live="polite"
            className="mr-1 text-xs text-slate-500"
          >
            {latestAcceptance.state === 'running' &&
              `浏览器验证中 · 已用 ${latestAcceptance.elapsedSeconds} 秒，完成后才会提交运行时补丁`}
            {latestAcceptance.state !== 'running' && status.state === 'generating' &&
              `正在生成 · ${status.charCount.toLocaleString()} 字符`}
            {latestAcceptance.state !== 'running' && status.state === 'modifying' &&
              `正在增量修改 · ${status.charCount.toLocaleString()} 字符`}
            {latestAcceptance.state !== 'running' && status.state === 'checking' && '正在检测运行时错误...'}
            {latestAcceptance.state !== 'running' && status.state === 'repairing' &&
              `自动修复第 ${status.attempt} 次 · ${status.charCount.toLocaleString()} 字符`}
            {latestAcceptance.state !== 'running' && status.state === 'done' &&
              (status.repairCount > 0
                ? `运行正常 · 已自动修复 ${status.repairCount} 次`
                : `生成完成 · ${status.charCount.toLocaleString()} 字符`)}
            {latestAcceptance.state !== 'running' && status.state === 'error' && status.message}
            {latestAcceptance.state !== 'running' && status.state === 'idle' && '等待需求'}
          </div>
          {status.state === 'repairing' && (
            <button
              type="button"
              onClick={stopAgentLoop}
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
            >
              终止自动修复
            </button>
          )}
          {latestAcceptance.state === 'running' && (
            <button
              type="button"
              onClick={stopAgentLoop}
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
            >
              终止模型对话
            </button>
          )}
          <button
            type="button"
            disabled={snapshots.length === 0}
            onClick={() => setIsTimelineOpen(true)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            📜 版本历史 {activeVersionId ? `(${activeVersionId})` : ''}
          </button>
          <div className="flex rounded-lg border border-slate-200 bg-white p-1" aria-label="代码项目类型">
            {(['frontend', 'fullstack'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={hasCode}
                aria-pressed={projectKind === kind}
                title={hasCode ? '新建 Code 会话后可切换项目类型' : undefined}
                onClick={() => onProjectKindChange(kind)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                  projectKind === kind
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 disabled:opacity-60'
                }`}
              >
                {kind === 'frontend' ? '前端' : '全栈 Mock API'}
              </button>
            ))}
          </div>

          <div className="flex rounded-lg border border-slate-200 bg-white p-1">
            {(['preview', 'source'] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={activeView === view}
                onClick={() => setActiveView(view)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeView === view
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {view === 'preview' ? '预览' : '源代码'}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!hasProject}
            onClick={() => void exportZip()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            📦 导出 ZIP
          </button>
          <button
            type="button"
            disabled={!hasProject}
            onClick={() => void archiveProject()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            保存到 workspace
          </button>
          {archiveState && (
            <span role="status" className="max-w-52 truncate text-[11px] text-slate-500" title={archiveState}>
              {archiveState}
            </span>
          )}
          <button
            type="button"
            disabled={!hasProject || isLoading}
            onClick={() => onPublishProject?.(vfs)}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            发布作品
          </button>

          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={isFullscreen ? '退出全屏预览' : '全屏预览网页'}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <span aria-hidden="true">{isFullscreen ? '↙' : '⛶'}</span>
            {isFullscreen ? '退出全屏' : '全屏'}
          </button>
          <button
            type="button"
            disabled={!hasCode || activeView !== 'preview'}
            aria-pressed={isInspectMode}
            onClick={toggleInspectMode}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${
              isInspectMode
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {isInspectMode ? '退出检查' : '检查元素'}
          </button>
          {topbarActions}
        </div>
      </div>
  );

  return (
    <section
      ref={workspaceRef}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white fullscreen:h-screen fullscreen:rounded-none fullscreen:border-0"
    >
      {topbarTarget ? createPortal(topbar, topbarTarget) : topbar}
      <div
        style={{ '--code-panel-width': `${leftPanelWidth}px` } as CSSProperties}
        className="flex min-h-0 flex-1 flex-col lg:flex-row"
      >
        <aside className="flex max-h-[45vh] w-full flex-col overflow-hidden border-b border-slate-200 bg-white lg:max-h-none lg:w-[var(--code-panel-width)] lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Day58: Tab 内容切换——需求面板 / 资源管理器 */}
          {/* Why: Phase3 新增「记忆」Tab——优先命中，展示四层记忆面板 */}
          {leftPanelTab === 'memory' ? (
            <MemoryPanel />
          ) : leftPanelTab === 'prompts' ? (
            <>
          {/* Skill 命中提示——本轮注入了哪些 Skill 手册 */}
          {codeMatchedSkills.length > 0 && (
            <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5 text-violet-700">
                <span className="text-sm">🧠</span>
                <span className="font-medium">
                  已加载 {codeMatchedSkills.length} 个技能手册
                </span>
              </div>
              <ul className="mt-1.5 space-y-0.5 pl-5 text-violet-600">
                {codeMatchedSkills.map((s, i) => (
                  <li key={`${s.skill_name}-${i}`} className="flex items-start gap-1">
                    <span>📖</span>
                    <span className="font-mono">{s.skill_name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">对话流</h3>
            <span className="text-xs text-slate-400">{prompts.length} 条消息</span>
          </div>

          {prompts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm leading-6 text-slate-500">
              发送网页需求后，会在这里保留本次会话的输入记录。
            </div>
          ) : (
            <ol className="space-y-3">
              {prompts.map((prompt, index) => {
                const run = runsForPrompts[index];
                const runAcceptance = run
                  ? getAgentRunLineage(run, agentRuns)
                    .map((item) => acceptanceByRun[item.id])
                    .find((item) => item && item.state !== 'idle') ?? IDLE_ACCEPTANCE
                  : IDLE_ACCEPTANCE;
                const isExpanded = Boolean(run && expandedRunIds.has(run.id));
                return (
                  <li key={`${index}-${prompt.slice(0, 24)}`} className="space-y-3">
                    {/* 用户消息：使用对话气泡，AgentLoop 记录紧随其后形成同一条时间线。 */}
                    <article className="ml-auto max-w-[94%] rounded-2xl rounded-tr-md border border-sky-100 bg-sky-50/80 px-3.5 py-3 shadow-sm">
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-medium text-slate-400">
                        <span>你 · 需求 {index + 1}</span>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {run && (
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              onClick={() => setExpandedRunIds((previous) => {
                                const next = new Set(previous);
                                if (next.has(run.id)) next.delete(run.id);
                                else next.add(run.id);
                                return next;
                              })}
                              className="rounded px-1.5 py-0.5 transition-colors hover:bg-white hover:text-slate-600"
                            >
                              <span className={isAgentRunExecutionActive(run) ? 'text-emerald-600' : 'text-slate-400'}>
                                {isAgentRunExecutionActive(run)
                                  ? '执行中'
                                  : run.trace.status === 'awaiting_runtime_verification'
                                    ? '等待验证'
                                    : 'AgentLoop'}
                              </span>
                              <span className="ml-1" aria-hidden="true">{isExpanded ? '⌃' : '⌄'}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            title="复制问题"
                            aria-label={`复制需求 ${index + 1}`}
                            onClick={() => copyText(prompt)}
                            className="rounded px-1.5 py-0.5 transition-colors hover:bg-white hover:text-slate-700"
                          >
                            ⧉ 复制
                          </button>
                          <button
                            type="button"
                            title="重写（CTRL+Enter 发送，会清空其后记录）"
                            aria-label={`重写需求 ${index + 1}`}
                            onClick={() => onRewritePrompt?.(index)}
                            className="rounded px-1.5 py-0.5 transition-colors hover:bg-white hover:text-slate-700"
                          >
                            ✎ 重写
                          </button>
                          <button
                            type="button"
                            title="删除该条问答并关闭对应终端"
                            aria-label={`删除需求 ${index + 1}`}
                            onClick={() => handleDeletePromptItem(index, run?.id)}
                            className="rounded px-1.5 py-0.5 transition-colors hover:bg-white hover:text-rose-600"
                          >
                            🗑 删除
                          </button>
                        </div>
                      </div>
                      <div className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                        {prompt}
                      </div>
                      {promptAttachments[index] && promptAttachments[index].length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {promptAttachments[index]!.map((item, attachIndex) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={`${item.url.slice(0, 24)}-${attachIndex}`}
                              src={item.url}
                              alt={item.name || '附件图片'}
                              className="h-12 w-12 cursor-zoom-in rounded border border-sky-100 object-cover"
                              onClick={() => setLightboxUrl(item.url)}
                            />
                          ))}
                        </div>
                      )}
                    </article>
                    {run && isExpanded && (
                      <div className="pl-1">
                          <CodeAgentTimeline
                            events={getTimelineEvents(run)}
                            runId={run.id}
                            isRunning={isAgentRunExecutionActive(run) || (
                            runAcceptance.state === 'running' ||
                            (run.trace.status !== 'awaiting_runtime_verification'
                              && run.id === latestRunId && (
                            status.state === 'generating' ||
                            status.state === 'modifying' ||
                            status.state === 'checking' ||
                            status.state === 'repairing'
                            ))
                          )}
                          acceptanceState={runAcceptance.state}
                          acceptanceReport={runAcceptance.report}
                          acceptanceElapsedSeconds={runAcceptance.elapsedSeconds}
                          acceptanceProgressMessage={runAcceptance.progressMessage}
                          acceptanceStartSequence={runAcceptance.startSequence}
                          taskPlan={run.trace.taskPlan}
                          sourceRun={run}
                          onSaveGoldenTrace={onSaveGoldenTrace}
                          onOpenTerminal={onOpenAgentTerminal ?? focusAgentTerminal}
                          onOpenDiff={(path) => {
                            setActiveFile(path);
                            setActiveView('source');
                          }}
                        />
                      </div>
                    )}
                    {conversationAnswers.filter((answer) => answer.promptIndex === index)
                      .map((answer, answerIndex) => (
                        <div key={`code-conversation-answer-${index}-${answerIndex}`}>
                          {answer.timeline && answer.timeline.length > 0 && (
                            <CodeAgentTimeline
                              title="只读 Agent · 读取过程"
                              events={answer.timeline}
                              runId={answer.timeline[0]?.runId ?? `read-only-${index}`}
                              isRunning={Boolean(answer.isRunning)}
                            />
                          )}
                          <article
                            className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-6 text-slate-700 shadow-sm"
                          >
                            <div className="mb-1.5 text-xs font-medium text-slate-400">
                              {answer.kind === 'clarify' ? '需要确认' : answer.kind === 'routing_error' ? '未执行' : '只读回答'}
                            </div>
                            {answer.content.trim() ? (
                              <MarkdownMessage content={answer.content} density="compact" />
                            ) : (
                              <span className="text-slate-400">正在整理回答…</span>
                            )}
                          </article>
                        </div>
                      ))}
                  </li>
                );
              })}
            </ol>
          )}

          {conversationAnswers.length === 0 && conversationAnswer && (
            <div className="mt-4">
              {conversationAnswer.timeline && conversationAnswer.timeline.length > 0 && (
                <CodeAgentTimeline
                  title="只读 Agent · 读取过程"
                  events={conversationAnswer.timeline}
                  runId={conversationAnswer.timeline[0]?.runId ?? 'read-only-latest'}
                  isRunning={Boolean(conversationAnswer.isRunning)}
                />
              )}
              <article
                className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-sm leading-6 text-slate-700 shadow-sm"
              >
                <div className="mb-1.5 text-xs font-medium text-slate-400">
                  {conversationAnswer.kind === 'clarify' ? '需要确认' : conversationAnswer.kind === 'routing_error' ? '未执行' : '只读回答'}
                </div>
                {conversationAnswer.content.trim() ? (
                  <MarkdownMessage content={conversationAnswer.content} density="compact" />
                ) : (
                  <span className="text-slate-400">正在整理回答…</span>
                )}
              </article>
            </div>
          )}

            </>
          ) : (
            /* Day58 方案一：资源管理器 Tab 内容——独立面板，不与需求面板混放 */
            <div className="flex h-full flex-col">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <Folder className="h-4 w-4 text-amber-500" /> 项目资源管理器
                </h3>
                {hasProject && (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                    {Object.keys(vfs).length} 文件
                  </span>
                )}
              </div>
              {!hasProject ? (
                <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white">
                    <Folder className="h-6 w-6 text-slate-400" />
                  </div>
                  <p className="text-sm font-medium text-slate-700">暂无可浏览文件</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    生成网页或全栈项目后，会在这里展示树状目录结构。
                  </p>
                </div>
              ) : (
                <FileTreeExplorer
                  treeData={buildTreeFromVFS(vfs)}
                  activeFile={activeFile}
                  highlightPath={writtenHighlight ?? undefined}
                  onSelectFile={(path) => {
                    setActiveFile(path);
                    setActiveView('source');
                  }}
                  onAction={handleTreeAction}
                />
              )}
              {hasProject && (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-700">
                  💡 从上方拖拽<span className="font-semibold">文件</span>或<span className="font-semibold">文件夹</span>到底部「修改指令」框，可精准指定修改范围。
                </div>
              )}
            </div>
          )}
          </div>
          {/* Day58: 拖拽目标容器——从文件树拖拽文件/文件夹到此处生成 Badge */}
          <div
            onDragOver={(e) => { e.preventDefault(); if (!isDragOver) setIsDragOver(true); }}
            onDragLeave={(e) => {
              const related = e.relatedTarget as Node | null;
              if (related && e.currentTarget.contains(related)) return;
              setIsDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              const path = e.dataTransfer.getData('text/plain');
              if (path && !mentionedFiles.includes(path) && onMentionedFilesChange) {
                onMentionedFilesChange([...mentionedFiles, path]);
              }
            }}
            className={`relative border-t border-slate-200 bg-white p-3 transition-all duration-150 ${
              isDragOver ? 'ring-2 ring-emerald-500 bg-emerald-50/60' : ''
            }`}
          >
          {isDragOver && (
            <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-emerald-500 bg-emerald-100/70 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                <span className="text-xl animate-bounce">📥</span>
                松开鼠标挂载到聚焦上下文
              </div>
            </div>
          )}
          <form onSubmit={onSubmit}>
            <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {modelControl}
                {isMultimodal && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      multiple
                      className="hidden"
                      onChange={(event) => {
                        Array.from(event.target.files || []).forEach(addImageFile);
                        event.currentTarget.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="添加图片"
                      title="支持粘贴、点击添加；多模态模型可用"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      + 图片
                    </button>
                  </>
                )}
              </div>
              <span className="shrink-0 text-[11px] text-slate-400">Code 生成模型</span>
            </div>
            {selectedElement && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-800">
                <span className="truncate">已选中：<code>{selectedElement.selector}</code></span>
                <button type="button" onClick={onClearSelectedElement} className="shrink-0 text-blue-700 hover:text-blue-950">取消</button>
              </div>
            )}
            <div className="mb-1 space-y-1">
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((item, index) => (
                    <div
                      key={`${item.url.slice(0, 30)}-${index}`}
                      className="group relative h-16 w-16 overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt={item.name || '附件图片'}
                        className="h-full w-full cursor-zoom-in object-cover"
                        onClick={() => setLightboxUrl(item.url)}
                      />
                      <button
                        type="button"
                        aria-label={`移除 ${item.name || '图片'}`}
                        onClick={() => removeAttachment(index)}
                        className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900/70 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <label className="mb-1.5 block text-xs font-medium text-slate-600" htmlFor="code-instruction">
              {hasCode ? '修改指令' : '网页需求'}
            </label>
            {/* Day58 @file/@folder Badge 显示区——支持文件和文件夹图标区分 */}
            {hasProject && mentionedFiles.length > 0 && (
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500 font-medium">修改范围:</span>
                {mentionedFiles.map((filePath) => {
                  const lastSeg = filePath.split('/').pop() ?? '';
                  const isFolder = filePath.endsWith('/') || !lastSeg.includes('.');
                  return (
                    <div
                      key={filePath}
                      className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-xs text-blue-700"
                    >
                      {isFolder
                        ? <Folder className="h-3 w-3 text-amber-500" aria-hidden />
                        : <FileCode className="h-3 w-3 text-blue-500" aria-hidden />}
                      <span>{filePath}</span>
                      <button
                        type="button"
                        onClick={() => removeMentionedFile(filePath)}
                        aria-label={`移除 ${filePath}`}
                        className="hover:text-blue-900"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="relative">
              {/* Day57 @file 浮层——只在 fullstack 项目(VFS 非空)且 textarea 触发 @ 时显示 */}
              {showFileDropdown && hasProject && filteredVfsPaths.length > 0 && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-2 py-1.5 text-[11px] font-semibold text-slate-500">
                    <span>选择聚焦路径 (↑↓ 选择,Enter/Tab 确认)</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">@file / @folder</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1">
                    {filteredVfsPaths.map((p, idx) => {
                      const lastSeg = p.split('/').pop() ?? '';
                      const isFolder = p.endsWith('/') || !lastSeg.includes('.');
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => selectMentionedFile(p)}
                          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition-colors ${
                            idx === fileDropdownIndex
                              ? 'bg-blue-100 font-semibold text-blue-800'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {isFolder
                            ? <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                            : <FileCode className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />}
                          <span className="truncate">{p}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <textarea
                id="code-instruction"
                ref={codeInputRef}
                value={input}
                onChange={handleCodeInputChange}
                onKeyDown={handleCodeInputKeyDown}
                onPaste={handlePaste}
                disabled={isWorkflowBusy || !isSessionReady}
                placeholder={
                  hasCode
                    ? (hasProject ? '例如：把选中的按钮改成红色… (敲 @ 或从上方拖拽 可指定文件/文件夹)' : '例如：把选中的按钮改成红色，其他内容不变…')
                    : '描述你想创建的网页…'
                }
                rows={3}
                className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="submit"
                disabled={isWorkflowBusy || !isSessionReady || !input.trim()}
                className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isLoading ? (hasCode ? '正在修改…' : '正在生成…') : (hasCode ? '应用修改' : '生成网页')}
              </button>
              {isLoading && (
                <button
                  type="button"
                  onClick={onStopAutoRepair}
                  aria-label="中止生成"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition-colors hover:bg-rose-100 hover:text-rose-700"
                  title="中止生成"
                >
                  <Square size={14} />
                </button>
              )}
            </div>
          </form>
          </div>
        </aside>

        <div
          role="separator"
          aria-label="调整需求栏宽度"
          aria-orientation="vertical"
          aria-valuemin={280}
          aria-valuemax={getMaximumLeftPanelWidth()}
          aria-valuenow={leftPanelWidth}
          tabIndex={0}
          onPointerDown={beginResize}
          onKeyDown={handleResizeKeyDown}
          className="group relative z-20 hidden -mx-2 w-5 shrink-0 cursor-col-resize lg:block"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-2 w-1 bg-slate-200 transition-colors group-hover:bg-blue-400 group-focus-visible:bg-blue-400"
          />
        </div>

        <div className="relative min-h-[28rem] min-w-0 flex-1 bg-white lg:min-h-0 fullscreen:min-h-0">
          {!hasCode && status.state !== 'generating' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white px-6 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-2xl">
                {'</>'}
              </div>
              <p className="font-medium text-slate-700">描述你想创建的网页</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                例如：创建一个深色风格的产品落地页，包含导航栏、功能卡片和价格区域。
              </p>
            </div>
          )}

          {status.state === 'generating' && !hasProject && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white px-6 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-2xl animate-pulse">
                {'</>'}
              </div>
              <p className="font-medium text-slate-700">正在生成文件…</p>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                全栈项目包含前端页面、样式、脚本、Mock API 与数据库，请稍候。
              </p>
            </div>
          )}

          {activeView === 'preview' ? (
            <div className="flex h-full min-h-[28rem] flex-col lg:min-h-0">
              <iframe
                ref={iframeRef}
                title="生成网页实时预览"
                srcDoc={instrumentedCode}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                onLoad={() => postInspectMode(isInspectMode)}
                className="min-h-0 flex-1 w-full border-0 bg-white"
              />
              <section
                data-code-agent-terminal-panel
                  // Why: 终端活动时面板若沿用 144px 的 consoleHeight，减去 Tab 头与会话条后
                  // 终端 host 会被 flex 压到 0 高，term.open() 拿不到非零尺寸而无限跳过。
                  // 切换到 Terminal Tab 时保证至少 320px，同时保留拖拽后的实际高度。
                  style={{ height: isConsoleOpen ? getConsoleHeight() : 40 }}
                className="relative flex shrink-0 flex-col border-t border-slate-200 bg-slate-950 text-slate-200"
              >
                <div
                  role="separator"
                  aria-label="调整控制台高度"
                  aria-orientation="horizontal"
                  aria-valuemin={getMinimumConsoleHeight()}
                  aria-valuemax={getMaximumConsoleHeight()}
                  aria-valuenow={consoleHeight}
                  tabIndex={0}
                  onPointerDown={beginConsoleResize}
                  onKeyDown={handleConsoleResizeKeyDown}
                  className="group flex h-3 shrink-0 cursor-row-resize items-center justify-center border-b border-slate-800 bg-slate-950/95 outline-none transition-colors hover:bg-slate-900 focus-visible:bg-slate-900"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none h-1 w-16 rounded-full bg-slate-700 transition-colors group-hover:bg-blue-400 group-focus-visible:bg-blue-400"
                  />
                </div>
                {/* 顶部 Tab 条：Console / Terminal 二选一，紧贴 banner 与终端，满足“紧靠着”需求 */}
                <header className="flex shrink-0 items-center justify-between border-b border-slate-800 px-3 py-2 gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex shrink-0 rounded-md border border-slate-700 bg-slate-900/70 p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setActiveTerminalTab('console')}
                        className={`rounded px-2.5 py-1 font-medium transition-colors ${
                          activeTerminalTab === 'console'
                            ? 'bg-slate-700 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        沙盒 Console
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTerminalTab('terminal');
                          const hasRunningAgent = agentRuns.some((run) => Boolean(run.trace?.isRunning));
                          if (!activeTerminalRunId || !isManualTerminalRunId(activeTerminalRunId)) {
                            if (!hasRunningAgent) createManualTerminal(true);
                          }
                        }}
                        className={`rounded px-2.5 py-1 font-medium transition-colors ${
                          activeTerminalTab === 'terminal'
                            ? 'bg-slate-700 text-white shadow-sm'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        终端 Terminal
                      </button>
                    </div>
                    <h3 className="text-xs font-semibold truncate">
                      {activeTerminalTab === 'console' ? '沙盒控制台 (页面运行日志)' : '本机终端 (Agent 命令需用户审批)'}
                    </h3>
                  </div>
                  <div className="flex items-center gap-3">
                    {activeTerminalTab === 'console' ? (
                      <button type="button" onClick={() => setConsoleEntries([])} className="text-xs text-slate-400 hover:text-white">清空</button>
                    ) : null}
                    <button type="button" aria-expanded={isConsoleOpen} onClick={() => setIsConsoleOpen((value) => !value)} className="text-xs text-slate-300 hover:text-white">
                      {isConsoleOpen ? '收起' : '展开'}
                    </button>
                  </div>
                </header>
                {activeTerminalTab === 'console' ? (
                  <div className={`${isConsoleOpen ? 'min-h-0 flex-1' : 'hidden'} flex flex-col`}>
                    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-5">
                      {consoleEntries.length === 0 ? (
                        <p className="text-slate-500">等待沙盒日志…</p>
                      ) : consoleEntries.map((entry, index) => (
                        <p key={`${entry.timestamp}-${index}`} className={
                          entry.level === 'error'
                            ? 'text-red-300'
                            : entry.level === 'warn'
                              ? 'text-amber-300'
                              : 'text-slate-300'
                        }>
                          <span className="mr-2 text-slate-500">[{entry.level}]</span>
                          {entry.args.join(' ')}
                        </p>
                      ))}
                    </div>
                    <form
                      className="flex shrink-0 items-center gap-2 border-t border-slate-800 bg-slate-950 px-3 py-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        executeSandboxCommand();
                      }}
                    >
                      <span className="select-none font-mono text-xs text-emerald-400" aria-hidden="true">›</span>
                      <textarea
                        ref={consoleCommandInputRef}
                        value={consoleCommand}
                        onChange={(event) => {
                          setConsoleCommand(event.target.value);
                          setConsoleHistoryIndex(-1);
                        }}
                        onKeyDown={handleConsoleCommandKeyDown}
                        aria-label="沙盒 Console 输入"
                        placeholder="输入 JavaScript，可粘贴多行；Enter 执行，Shift+Enter 换行"
                        rows={4}
                        spellCheck={false}
                        autoComplete="off"
                        className="min-h-24 min-w-0 flex-1 resize-y bg-transparent font-mono text-xs leading-5 text-slate-100 outline-none placeholder:text-slate-600"
                      />
                      <button
                        type="submit"
                        disabled={!consoleCommand.trim()}
                        className="shrink-0 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        执行
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className={`${isConsoleOpen ? 'relative flex-1 overflow-hidden' : 'hidden'}`}>
                    <div className="absolute inset-0">
                      <IntegratedTerminal
                        workspaceId={terminalWorkspaceId}
                        activeRunId={activeTerminalRunId}
                        onChangeActiveRunId={setActiveTerminalRunId}
                        agentRuns={agentRuns}
                        isManualTerminal={isManualTerminalRunId}
                        onCreateManual={createManualTerminal}
                        onCloseTerminal={closeTerminalSession}
                        dark={isDarkTheme}
                        allowUserStdin={Boolean(activeTerminalRunId && isManualTerminalRunId(activeTerminalRunId))}
                        onPropositionUpdate={(prop) => {
                          // Why: IntegratedTerminal 内的提案横幅紧贴终端顶部（用户要求"紧靠着终端上方"），
                          // 此处额外转发给上层以便通过 CustomEvent 同步把“正在等待用户选择”注入 agent trace steps。
                          onTerminalPropositionUpdate?.(prop);
                        }}
                        onTrustedPrefixAdd={(runIdValue, prefix) => onAddTrustedTerminalPrefix(runIdValue, prefix)}
                        trustedPrefixesByRun={trustedTerminalPrefixes}
                      />
                    </div>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <SourceCodeViewer
              activeFile={activeFile}
              activeFileHighlighted={activeFileHighlighted}
              dark={isDarkTheme}
              fileContent={vfs[activeFile] ?? ''}
              hasUnsavedManualEdit={hasUnsavedManualEdit}
              sourceEditMode={sourceEditMode}
              onSaveManualEdit={saveManualEdit}
              onSetSourceEditMode={setSourceEditMode}
              onUpdateActiveFile={updateActiveFile}
            />
          )}
        </div>
        <VersionTimelineDrawer
          isOpen={isTimelineOpen}
          onClose={() => setIsTimelineOpen(false)}
          snapshots={snapshots}
          activeVersionId={activeVersionId}
          onRollback={(snapshot) => {
            onRollbackVersion(snapshot);
            setHasUnsavedManualEdit(false);
          }}
        />
      </div>
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="放大预览"
            className="max-h-full max-w-full rounded-lg shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}

    </section>
  );
}

// ── Source code viewer: row line numbers + syntax highlight + insert/delete gutter ──

interface SourceCodeViewerProps {
  activeFile: string;
  activeFileHighlighted: DiffLine[];
  dark: boolean;
  fileContent: string;
  hasUnsavedManualEdit: boolean;
  sourceEditMode: 'highlight' | 'raw';
  onSaveManualEdit: () => void;
  onSetSourceEditMode: (mode: 'highlight' | 'raw') => void;
  onUpdateActiveFile: (content: string) => void;
}

function tokenClass(kind: TokenKind, dark: boolean): string {
  if (dark) {
    switch (kind) {
      case 'keyword': return 'text-fuchsia-300';
      case 'string': return 'text-emerald-300';
      case 'number': return 'text-amber-300';
      case 'comment': return 'text-slate-500 italic';
      case 'tag': return 'text-rose-300';
      case 'attr': return 'text-sky-300';
      case 'selector': return 'text-pink-300';
      case 'property': return 'text-cyan-300';
      case 'function': return 'text-yellow-200';
      case 'operator': return 'text-indigo-300';
      case 'punct': return 'text-slate-400';
      default: return 'text-slate-200';
    }
  }
  switch (kind) {
    case 'keyword': return 'text-fuchsia-700';
    case 'string': return 'text-emerald-700';
    case 'number': return 'text-amber-700';
    case 'comment': return 'text-slate-500 italic';
    case 'tag': return 'text-rose-600';
    case 'attr': return 'text-sky-700';
    case 'selector': return 'text-pink-700';
    case 'property': return 'text-cyan-700';
    case 'function': return 'text-yellow-700';
    case 'operator': return 'text-indigo-700';
    case 'punct': return 'text-slate-600';
    default: return 'text-slate-800';
  }
}

function SourceCodeViewer(props: SourceCodeViewerProps) {
  const {
    activeFile, activeFileHighlighted, dark, fileContent, hasUnsavedManualEdit,
    sourceEditMode, onSaveManualEdit, onSetSourceEditMode, onUpdateActiveFile,
  } = props;
  const maxLineNumber = activeFileHighlighted.reduce(
    (max, line) => Math.max(max, line.newLineNo ?? 0, line.oldLineNo ?? 0),
    0,
  );
  const lineNoWidth = Math.max(3, String(maxLineNumber).length);
  const insertions = activeFileHighlighted.filter((l) => l.kind === 'insert').length;
  const deletions = activeFileHighlighted.filter((l) => l.kind === 'delete').length;
  const showDiffBadge = insertions > 0 || deletions > 0;
  const frameClass = dark
    ? 'bg-slate-950 border-slate-800'
    : 'bg-slate-50 border-slate-200';
  const headerTextClass = dark ? 'text-slate-400' : 'text-slate-600';
  const headerBgClass = dark ? 'border-slate-800' : 'border-slate-200';

  return (
    <div className={`flex h-full min-h-[28rem] flex-col lg:min-h-0 fullscreen:min-h-0 ${frameClass}`}>
      <div className={`flex items-center justify-between gap-3 border-b ${headerBgClass} px-4 py-2`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={`truncate font-mono text-xs ${headerTextClass}`}>
            正在编辑：{activeFile}
          </span>
          {showDiffBadge && (
            <span className="inline-flex shrink-0 items-center gap-2 rounded-md border border-slate-600/30 bg-slate-800/30 px-2 py-0.5 font-mono text-[10px] text-slate-200 dark:bg-slate-800/30">
              <span className="text-emerald-400">+{insertions}</span>
              <span className="text-red-400">-{deletions}</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-700/40 bg-slate-900/60 p-0.5 dark:bg-slate-900/60">
          {(['highlight', 'raw'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={sourceEditMode === mode}
              onClick={() => {
                if (mode === 'highlight' && hasUnsavedManualEdit) onSaveManualEdit();
                onSetSourceEditMode(mode);
              }}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                sourceEditMode === mode
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'text-slate-300 hover:bg-slate-800/60 dark:hover:bg-slate-800/60'
              }`}
            >
              {mode === 'highlight' ? '高亮/Diff' : '编辑源码'}
            </button>
          ))}
        </div>
      </div>
      {sourceEditMode === 'highlight' ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <pre className="min-w-max font-mono text-[12px] leading-6 tabular-nums">
            <code>
              {activeFileHighlighted.map((line, idx) => {
                const rowBackground = line.kind === 'insert'
                  ? (dark ? 'bg-emerald-900/25 hover:bg-emerald-900/40' : 'bg-emerald-100/80 hover:bg-emerald-100')
                  : line.kind === 'delete'
                  ? (dark ? 'bg-red-900/30 hover:bg-red-900/50' : 'bg-red-100/80 hover:bg-red-100')
                  : (dark ? 'hover:bg-slate-900/60' : 'hover:bg-slate-100');
                const gutterMarker = line.kind === 'insert'
                  ? (dark ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-400' : 'border-emerald-500 bg-emerald-50 text-emerald-600')
                  : line.kind === 'delete'
                  ? (dark ? 'border-red-500/60 bg-red-500/10 text-red-400' : 'border-red-500 bg-red-50 text-red-600')
                  : (dark ? 'border-transparent text-slate-500' : 'border-transparent text-slate-400');
                const lineNoText = (line.newLineNo ?? line.oldLineNo ?? '').toString();
                const changeSymbol = line.kind === 'insert' ? '+' : line.kind === 'delete' ? '−' : ' ';
                return (
                  <div
                    key={`${line.newLineNo ?? 'd'}-${line.oldLineNo ?? 'd'}-${idx}`}
                    className={`flex w-full border-l-4 ${gutterMarker} ${rowBackground}`}
                  >
                    <div
                      aria-hidden
                      className={`sticky left-0 z-10 shrink-0 select-none border-r border-slate-800/60 px-2 py-0.5 text-right ${dark ? 'bg-slate-950/90 text-slate-500' : 'bg-slate-50/90'}`}
                      style={{ width: `${lineNoWidth + 4}ch`, minWidth: `${lineNoWidth + 4}ch` }}
                    >
                      <span className="inline-block w-[1.5ch] text-center">{changeSymbol}</span>
                      <span>{lineNoText.padStart(lineNoWidth, ' ')}</span>
                    </div>
                    <div className={`min-w-0 flex-1 px-3 py-0.5 ${dark ? 'text-slate-200' : 'text-slate-800'}`}>
                      {line.tokens.length === 0 ? (
                        <span>&nbsp;</span>
                      ) : (
                        line.tokens.map((token, tIdx) => (
                          <span key={tIdx} className={tokenClass(token.kind, dark)}>
                            {token.text}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </code>
          </pre>
        </div>
      ) : (
        <textarea
          aria-label={`编辑 ${activeFile}`}
          value={fileContent}
          onChange={(event) => onUpdateActiveFile(event.target.value)}
          onBlur={onSaveManualEdit}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              onSaveManualEdit();
            }
          }}
          spellCheck={false}
          className={
            dark
              ? 'min-h-0 flex-1 resize-none bg-slate-950 p-5 font-mono text-xs leading-6 text-slate-200 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500'
              : 'min-h-0 flex-1 resize-none bg-white p-5 font-mono text-xs leading-6 text-slate-800 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500'
          }
        />
      )}
    </div>
  );
}
