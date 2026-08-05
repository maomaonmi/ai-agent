'use client';

import dynamic from 'next/dynamic';
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
import { FileCode, Folder, Square, X } from 'lucide-react';

import {
  CodeGenerationStatus,
  injectErrorCatcher,
  isRuntimeErrorReport,
  isSandboxConsoleEntry,
  isSelectedElementContext,
  RepairLog,
  RuntimeErrorReport,
  SandboxConsoleEntry,
  SelectedElementContext,
} from '../lib/codeSandbox';
import { SANDBOX_SET_INSPECT_MODE } from '../Code/inspectorScript';
import { bundleVFS, splitHtmlToVFS, VirtualFileSystem } from '../Code/vfsBundler';
import { VersionSnapshot } from '../Code/versionManager';
import { VersionTimelineDrawer } from '../Code/VersionTimelineDrawer';
import {
  bundleFullstackVFS,
  FULLSTACK_DATABASE_UPDATED,
  isFullstackVFS,
  parseProjectCode,
  serializeProjectVFS,
} from '../Code/fullstackBundler';
import { FileTreeExplorer, buildTreeFromVFS, type FileTreeAction } from '../Code/FileTreeExplorer';
import MarkdownMessage from './MarkdownMessage';
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
  type ChatAttachment,
  type CodeAcceptanceReport,
  type CodeAgentRun,
  type TaskItem,
} from '../lib/api';
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
  // Why: 与 prompts 平行，回显每条用户提问附带的图片缩略图。
  promptAttachments?: ChatAttachment[][];
  input: string;
  modeControl: ReactNode;
  modelControl: ReactNode;
  selectedElement: SelectedElementContext | null;
  isLoading: boolean;
  isSessionReady: boolean;
  repairLogs: RepairLog[];
  runId: string;
  status: CodeGenerationStatus;
  snapshots: VersionSnapshot[];
  activeVersionId: string;
  projectKind: 'frontend' | 'fullstack';
  agentRuns: CodeAgentRun[];
  terminalWorkspaceId: string;
  trustedTerminalPrefixes: Record<string, string[]>;
  onAddTrustedTerminalPrefix: (runId: string, prefix: string) => void;
  onTerminalPropositionUpdate?: (prop: TerminalProposition | null) => void;
  // Why: Code 模式需要把附件状态提升到 ChatInterface，提交时传给后端视觉分析。
  attachments?: ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  // Why: 只有多模态模型才允许在前端粘贴/上传图片，避免把无效请求推给后端。
  isMultimodal?: boolean;
  onRuntimeError: (error: RuntimeErrorReport) => void;
  onStopAutoRepair: () => void;
  onCaptureSnapshot: (vfs: VirtualFileSystem, summary: string) => void;
  onRollbackVersion: (snapshot: VersionSnapshot) => void;
  onSaveManualVersion: (vfs: VirtualFileSystem, summary: string) => void;
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
  // Why: 全栈修改模式任务拆解——后端推送子任务列表，
  // 前端用浮层卡片展示进度（待办/进行中/完成/失败/跳过）。
  tasks?: TaskItem[];
}

const TASK_STATUS_ICON: Record<TaskItem['status'], string> = {
  pending: '\u23F3',
  in_progress: '\u21BB',
  completed: '\u2705',
  failed: '\u274C',
  skipped: '\u23ED\uFE0F',
};

const TASK_STATUS_COLOR: Record<TaskItem['status'], string> = {
  pending: 'text-slate-400',
  in_progress: 'text-blue-500',
  completed: 'text-green-600',
  failed: 'text-red-500',
  skipped: 'text-amber-500',
};

function TaskProgressCard({ tasks }: { tasks: TaskItem[] }) {
  const [expanded, setExpanded] = useState(true);
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const inProgress = tasks.some((t) => t.status === 'in_progress');

  return (
    <div className="absolute right-3 top-3 z-30 w-80 max-w-[calc(100%-1.5rem)] rounded-lg border border-slate-200 bg-white/95 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {inProgress && (
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          )}
          任务进度 {completed}/{tasks.length}
          {failed > 0 && <span className="text-xs text-red-400">({failed} 失败)</span>}
        </span>
        <span className="text-xs text-slate-400">{expanded ? '\u25BC' : '\u25B2'}</span>
      </button>
      {expanded && (
        <ul className="max-h-60 overflow-y-auto px-3 pb-2">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-start gap-2 py-1.5 text-xs">
              <span className="mt-0.5 shrink-0">{TASK_STATUS_ICON[task.status]}</span>
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${TASK_STATUS_COLOR[task.status]}`}>{task.title}</p>
                {task.target_files.length > 0 && (
                  <p className="mt-0.5 truncate text-slate-400">{task.target_files.join(', ')}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatModelOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return '';
  // Case 1: Complete, valid JSON → pretty-print with standard 2-space indent
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    // fall through to incremental formatter below
  }
  // Case 2: Incomplete / still-streaming JSON (JSON.parse fails above).
  // Insert strategic newlines around structural tokens so the display isn't a single wall of text.
  // Why: models usually emit compact JSON (no whitespace) during json_object streaming mode;
  // without any line breaks, the <pre> shows one 2000-char line and the diff engine reports
  // "only 1 line changed" for every edit.  This heuristic is lossy but dramatically improves
  // readability during the streaming window before the final valid JSON arrives.
  let formatted = trimmed;
  // Add newlines AFTER these structural patterns (keep the token, append \n + optional indent)
  const openers = [
    { re: /\},/g, sub: '},\n' },
    { re: /\],/g, sub: '],\n' },
    { re: /\{"/g, sub: '{\n"' },
    { re: /\["/g, sub: '[\n"' },
    { re: /":\{/g, sub: '": {' },
    { re: /":\[/g, sub: '": [' },
    { re: /\}\}/g, sub: '}\n}' },  // not perfect but prevents deeply-nested run-on lines
    { re: /\}\]/g, sub: '}\n]' },
  ];
  for (const { re, sub } of openers) {
    formatted = formatted.replace(re, sub);
  }
  // Also break lines after ", at top-level key positions that didn't match above
  formatted = formatted.replace(/(\w)",(\s*)"/g, '$1",\n"');
  return formatted;
}

const ACCEPTANCE_UI_TIMEOUT_MS = 50_000;

export default function CodeWorkspace({
  code,
  prompts,
  promptAttachments = [],
  input,
  modeControl,
  modelControl,
  selectedElement,
  isLoading,
  isSessionReady,
  repairLogs,
  runId,
  status,
  snapshots,
  activeVersionId,
  projectKind,
  agentRuns,
  terminalWorkspaceId,
  trustedTerminalPrefixes,
  onAddTrustedTerminalPrefix,
  onTerminalPropositionUpdate,
  attachments = [],
  onAttachmentsChange,
  isMultimodal = false,
  onRuntimeError,
  onStopAutoRepair,
  onCaptureSnapshot,
  onRollbackVersion,
  onSaveManualVersion,
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
  tasks = [],
}: CodeWorkspaceProps) {
  const [activeView, setActiveView] = useState<'preview' | 'source'>('preview');
  const [vfs, setVfs] = useState<VirtualFileSystem>({});
  const [activeFile, setActiveFile] = useState('index.html');
  const [archiveState, setArchiveState] = useState<string | null>(null);
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);
  const [hasUnsavedManualEdit, setHasUnsavedManualEdit] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isInspectMode, setIsInspectMode] = useState(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState(true);
  const [consoleHeight, setConsoleHeight] = useState(144);
  const [consoleEntries, setConsoleEntries] = useState<SandboxConsoleEntry[]>([]);
  // Why: 终端 Tab 和沙盒 Console 用同一个可伸缩面板承载；默认首次进入时是 console，
  // 用户一旦点"终端"就切过去。提案横幅贴在 Tab 条正上方，也就是 console panel 的顶部
  // （现在把 IntegratedTerminal 放进 console panel 里跟 console 并排）。
  const [activeTerminalTab, setActiveTerminalTab] = useState<'console' | 'terminal'>('console');
  // 手动终端前缀（区分自动 agent 终端 run_id）
  const [activeTerminalRunId, setActiveTerminalRunId] = useState<string>('');
  // Why: Day58 方案一：Header Tab 切换——左侧 aside 内容在「需求面板」「资源管理器」间切换，表单常显底部
  type LeftPanelTab = 'prompts' | 'resources';
  const [leftPanelTab, setLeftPanelTab] = useState<LeftPanelTab>('prompts');
  // Why: Day58 拖拽目标高亮——从文件树拖拽到表单区域时显示绿色边框。
  const [isDragOver, setIsDragOver] = useState(false);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());
  const [expandedRepairAttempts, setExpandedRepairAttempts] = useState<Set<number>>(new Set());
  const [acceptanceState, setAcceptanceState] = useState<
    'idle' | 'running' | 'passed' | 'failed' | 'blocked'
  >('idle');
  const [acceptanceReport, setAcceptanceReport] = useState<CodeAcceptanceReport | null>(null);
  const [acceptanceElapsedSeconds, setAcceptanceElapsedSeconds] = useState(0);
  const [isAcceptanceExpanded, setIsAcceptanceExpanded] = useState(true);
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
  const workspaceRef = useRef<HTMLElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const acceptanceControllerRef = useRef<AbortController | null>(null);
  const testedRunIdRef = useRef('');
  const consoleEntriesRef = useRef<SandboxConsoleEntry[]>([]);
  const acceptancePreviewRef = useRef('');
  const promptsRef = useRef<string[]>([]);
  const onRuntimeErrorRef = useRef(onRuntimeError);
  const initialFileSetRef = useRef(false);
  consoleEntriesRef.current = consoleEntries;
  promptsRef.current = prompts;
  onRuntimeErrorRef.current = onRuntimeError;
  const hasCode = code.trim().length > 0;
  const hasProject = Object.keys(vfs).length > 0;

  // 终端面板辅助：创建手动终端 / 关闭会话 / 判断是否手动终端 / 选中的 run_id
  const createManualTerminal = useCallback(() => {
    const suffix = Date.now().toString(36).slice(-5);
    const runId = `manual-${suffix}`;
    console.log('[terminal][createManual] runId=%s workspaceId=%s', runId, terminalWorkspaceId);
    setActiveTerminalRunId(runId);
  }, [terminalWorkspaceId]);

  const closeTerminalSession = useCallback((runId: string) => {
    console.log('[terminal][close] runId=%s workspaceId=%s', runId, terminalWorkspaceId);
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
      if (input.trim() && !isLoading && isSessionReady) {
        onSubmit({ preventDefault: () => {} } as FormEvent<HTMLFormElement>);
      }
    }
  }, [fileDropdownIndex, filteredVfsPaths, selectMentionedFile, showFileDropdown, input, isLoading, isSessionReady, onSubmit]);

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
    const usedRunIds = new Set<string>();
    return prompts.map((prompt) => {
      const normalizedPrompt = prompt.trim();
      const run = agentRuns.find((candidate) =>
        !usedRunIds.has(candidate.id) && candidate.request.trim() === normalizedPrompt
      );
      if (run) usedRunIds.add(run.id);
      return run;
    });
  }, [agentRuns, prompts]);
  const instrumentedCode = useMemo(
    () => injectErrorCatcher(
      isFullstackVFS(vfs)
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
    const serialized = isFullstackVFS(nextVfs)
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
      setActiveFile('frontend/index.html');
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
      if (isRuntimeErrorReport(data) && data.runId === runId) {
        onRuntimeError(data);
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
        // Generated apps often catch functional failures and log them instead of
        // throwing. Treat errors and warnings as diagnostics so important
        // SecurityError/deprecation/contract warnings reach auto-repair too.
        if (data.level === 'error' || data.level === 'warn') {
      onRuntimeError({
            type: 'code-sandbox-runtime-error',
            runId,
            message: data.args.join(' ') || `Sandbox console ${data.level}`,
            source: `console.${data.level}`,
          });
        }
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
            setVfs((previous) => ({ ...previous, 'backend/database.json': serialized }));
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
    acceptanceControllerRef.current?.abort();
    acceptanceControllerRef.current = null;
    setAcceptanceState('idle');
    setAcceptanceReport(null);
    setIsAcceptanceExpanded(true);
  }, [runId]);

  // Why: 切到 Terminal Tab 时，如果还没有选中具体 terminal run_id，自动切到"最近的 agent run（
  // 正在 running 的优先）"；保证用户点 Tab 就立刻能看到终端输出而不是"暂无终端"。
  useEffect(() => {
    if (activeTerminalTab !== 'terminal') return;
    if (activeTerminalRunId) return;
    const running = agentRuns.find((r) => Boolean(r.trace?.isRunning));
    const fallback = agentRuns[agentRuns.length - 1];
    const target = running ?? fallback;
    if (target && target.id !== activeTerminalRunId) setActiveTerminalRunId(target.id);
  }, [activeTerminalTab, activeTerminalRunId, agentRuns]);

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
    if (
      status.state !== 'done' ||
      !runId ||
      !acceptancePreviewRef.current.trim() ||
      testedRunIdRef.current === runId
    ) return;

    testedRunIdRef.current = runId;
    const controller = new AbortController();
    acceptanceControllerRef.current = controller;
    setAcceptanceState('running');
    setAcceptanceElapsedSeconds(0);
    setAcceptanceReport(null);
    const previewHtml = acceptancePreviewRef.current;
    const expectation = promptsRef.current.at(-1)?.trim() || '验证页面主要交互可以正常工作';

    void runCodeAcceptanceTest({
      user_request: expectation,
      preview_html: previewHtml,
      console_entries: consoleEntriesRef.current.map((entry) => ({
        level: entry.level,
        text: entry.args.join(' '),
      })),
    }, controller.signal).then((report) => {
      if (controller.signal.aborted || testedRunIdRef.current !== runId) return;
      setAcceptanceReport(report);
      if (report.blocked) {
        setAcceptanceState('blocked');
        return;
      }
      if (report.passed) {
        setAcceptanceState('passed');
        return;
      }
      setAcceptanceState('failed');
      const failedAssertions = report.assertions
        ?.filter((item) => !item.passed)
        .map((item) => `${item.assertion.kind} ${item.assertion.selector}: ${item.actual}`)
        .join('\n');
      onRuntimeErrorRef.current({
        type: 'code-sandbox-runtime-error',
        runId,
        source: 'python-playwright-test-agent',
        message: [
          `用户验收未通过：${report.plan?.summary ?? expectation}`,
          failedAssertions,
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
          setAcceptanceState('blocked');
          setAcceptanceReport({
            passed: false,
            blocked: true,
            diagnostic: '测试请求被预览状态更新中断，已安全终止。',
          });
        }
        return;
      }
      setAcceptanceState('blocked');
      setAcceptanceReport({
        passed: false,
        blocked: true,
        diagnostic: error instanceof Error ? error.message : '测试 Agent 调用失败',
      });
    }).finally(() => {
      if (acceptanceControllerRef.current === controller) {
        acceptanceControllerRef.current = null;
      }
    });

    return () => controller.abort();
  }, [runId, status.state]);

  useEffect(() => {
    if (acceptanceState !== 'running') return;
    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      setAcceptanceElapsedSeconds(Math.min(
        Math.floor((Date.now() - startedAt) / 1000),
        ACCEPTANCE_UI_TIMEOUT_MS / 1_000,
      ));
    }, 1_000);
    const timeoutId = window.setTimeout(() => {
      const activeController = acceptanceControllerRef.current;
      if (!activeController) return;
      activeController.abort();
      acceptanceControllerRef.current = null;
      setAcceptanceElapsedSeconds(ACCEPTANCE_UI_TIMEOUT_MS / 1_000);
      setAcceptanceState('blocked');
      setAcceptanceReport({
        passed: false,
        blocked: true,
        diagnostic: '测试状态超过 50 秒，已由界面看门狗强制终止。',
      });
    }, ACCEPTANCE_UI_TIMEOUT_MS);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [acceptanceState]);

  useEffect(() => {
    const latest = agentRuns.at(-1);
    if (!latest?.trace.isRunning) return;
    setExpandedRunIds((previous) => {
      if (previous.has(latest.id)) return previous;
      return new Set(previous).add(latest.id);
    });
  }, [agentRuns]);

  useEffect(() => {
    const latest = repairLogs.at(-1);
    if (!latest || latest.status !== 'repairing') return;
    setExpandedRepairAttempts((previous) => {
      if (previous.has(latest.attempt)) return previous;
      return new Set(previous).add(latest.attempt);
    });
  }, [repairLogs]);

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
    setAcceptanceState('blocked');
    setAcceptanceReport({
      passed: false,
      blocked: true,
      diagnostic: '已由用户终止模型对话与自动测试修复循环。',
    });
    onStopAutoRepair();
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement === workspaceRef.current) {
      await document.exitFullscreen();
      return;
    }
    await workspaceRef.current?.requestFullscreen();
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftPanelWidth;
    const resize = (moveEvent: PointerEvent) => {
      setLeftPanelWidth(Math.min(560, Math.max(280, startWidth + moveEvent.clientX - startX)));
    };
    const finish = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish);
  };

  const beginConsoleResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsConsoleOpen(true);
    const startY = event.clientY;
    const startHeight = consoleHeight;
    const resize = (moveEvent: PointerEvent) => {
      const workspaceHeight = workspaceRef.current?.getBoundingClientRect().height ?? window.innerHeight;
      const maximumHeight = Math.max(144, workspaceHeight - 48);
      setConsoleHeight(Math.min(maximumHeight, Math.max(96, startHeight + startY - moveEvent.clientY)));
    };
    const finish = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finish);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish);
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

  return (
    <section
      ref={workspaceRef}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white fullscreen:h-screen fullscreen:rounded-none fullscreen:border-0"
    >
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-slate-800">
            网页沙盒 <span className="ml-1 font-normal text-slate-500">· iframe 隔离渲染</span>
          </h2>
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
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <div
            role="status"
            aria-live="polite"
            className="mr-1 text-xs text-slate-500"
          >
            {status.state === 'generating' &&
              `正在生成 · ${status.charCount.toLocaleString()} 字符`}
            {status.state === 'modifying' &&
              `正在增量修改 · ${status.charCount.toLocaleString()} 字符`}
            {status.state === 'checking' && '正在检测运行时错误...'}
            {status.state === 'repairing' &&
              `自动修复第 ${status.attempt} 次 · ${status.charCount.toLocaleString()} 字符`}
            {status.state === 'done' &&
              (status.repairCount > 0
                ? `运行正常 · 已自动修复 ${status.repairCount} 次`
                : `生成完成 · ${status.charCount.toLocaleString()} 字符`)}
            {status.state === 'error' && status.message}
            {status.state === 'idle' && '等待需求'}
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
          {acceptanceState === 'running' && (
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
        </div>
      </header>

      <div
        style={{ '--code-panel-width': `${leftPanelWidth}px` } as CSSProperties}
        className="flex min-h-0 flex-1 flex-col lg:flex-row"
      >
        <aside className="flex max-h-[45vh] w-full flex-col overflow-hidden border-b border-slate-200 bg-slate-50/70 lg:max-h-none lg:w-[var(--code-panel-width)] lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-200 p-3">
            <div className="relative z-20">{modeControl}</div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Day58: Tab 内容切换——需求面板 / 资源管理器 */}
          {leftPanelTab === 'prompts' ? (
            <>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">用户需求</h3>
            <span className="text-xs text-slate-400">{prompts.length} 条</span>
          </div>

          {prompts.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm leading-6 text-slate-500">
              发送网页需求后，会在这里保留本次会话的输入记录。
            </div>
          ) : (
            <ol className="space-y-3">
              {prompts.map((prompt, index) => {
                const run = runsForPrompts[index];
                const isExpanded = Boolean(run && expandedRunIds.has(run.id));
                return (
                  <li
                    key={`${index}-${prompt.slice(0, 24)}`}
                    className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
                  >
                    {/* 问题块（用户） */}
                    <div className="p-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-slate-400">
                            <span>你 · 需求 {index + 1}</span>
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
                                className="flex items-center gap-2 transition-colors hover:text-slate-600"
                              >
                                <span className={run.trace.isRunning ? 'text-emerald-600' : 'text-slate-400'}>
                                  {run.trace.isRunning ? '输出中' : '模型输出'}
                                </span>
                                <span aria-hidden="true">{isExpanded ? '⌃' : '⌄'}</span>
                              </button>
                            )}
                          </span>
                          <span className="block whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                            {prompt}
                          </span>
                          {promptAttachments[index] && promptAttachments[index].length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {promptAttachments[index]!.map((item, attachIndex) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={`${item.url.slice(0, 24)}-${attachIndex}`}
                                  src={item.url}
                                  alt={item.name || '附件图片'}
                                  className="h-12 w-12 cursor-zoom-in rounded border border-slate-200 object-cover"
                                  onClick={() => setLightboxUrl(item.url)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1 text-slate-400">
                          <button
                            type="button"
                            title="复制问题"
                            onClick={() => copyText(prompt)}
                            className="rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-slate-100 hover:text-slate-700"
                          >
                            ⧉ 复制
                          </button>
                          <button
                            type="button"
                            title="重写（CTRL+Enter 发送，会清空其后记录）"
                            onClick={() => onRewritePrompt?.(index)}
                            className="rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-slate-100 hover:text-slate-700"
                          >
                            ✎ 重写
                          </button>
                          <button
                            type="button"
                            title="删除该条问答并关闭对应终端"
                            onClick={() => handleDeletePromptItem(index, run?.id)}
                            className="rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-rose-100 hover:text-rose-600"
                          >
                            🗑 删除
                          </button>
                        </div>
                      </div>
                    </div>
                    {/* 答案块（智能体） */}
                    {run && run.trace.summary && (
                      <div className="border-t border-slate-100 bg-white px-3 py-2.5">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2">
                            <span className="text-[10px] font-medium text-slate-400">智能体</span>
                            <span className="inline-flex h-4 items-center rounded bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-700">
                              {run.trace.summaryIntent === 'answer'
                                ? '回答'
                                : run.trace.summaryIntent === 'ask_clarification'
                                  ? '澄清'
                                  : run.trace.summaryIntent === 'fullstack_bootstrap'
                                    ? '全栈初始化'
                                    : '变更总结'}
                            </span>
                          </span>
                          <span className="flex items-center gap-1 text-slate-400">
                            <button
                              type="button"
                              title="复制回答"
                              onClick={() => copyText(run.trace.summary ?? '')}
                              className="rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-slate-100 hover:text-slate-700"
                            >
                              ⧉ 复制
                            </button>
                            <button
                              type="button"
                              title="删除该条问答并关闭对应终端"
                              onClick={() => handleDeletePromptItem(index, run.id)}
                              className="rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-rose-100 hover:text-rose-600"
                            >
                              🗑 删除
                            </button>
                          </span>
                        </div>
                        <MarkdownMessage
                          className="text-[13px] leading-6 text-slate-700 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_code]:font-mono"
                          content={run.trace.summary}
                        />
                      </div>
                    )}
                    {run && isExpanded && (
                      <section aria-label={`需求 ${index + 1} 的模型输出`} className="border-t border-slate-700 bg-slate-900 p-3 text-slate-200">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <h4 className="text-xs font-semibold">主代码 Agent · 执行记录</h4>
                          <span className="text-[10px] text-slate-400">
                            {run.projectKind === 'fullstack' ? '全栈' : '前端'} · {run.trace.isRunning ? '运行中' : '已结束'}
                          </span>
                        </div>
                        <ol className="mb-3 space-y-1.5" aria-label="执行阶段">
                          {run.trace.steps.map((step, stepIndex) => (
                            <li key={`${stepIndex}-${step}`} className="flex items-start gap-2 text-[11px] leading-5 text-slate-300">
                              <span aria-hidden="true" className="mt-1 text-emerald-400">›</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                        {run.trace.fileChanges && run.trace.fileChanges.length > 0 && (
                          <div className="mb-3 border-t border-slate-700 pt-2">
                            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                              文件修改 · {run.trace.fileChanges.length} 个文件
                            </p>
                            <ul className="space-y-1 rounded bg-slate-950 p-2 font-mono text-[10px]">
                              {run.trace.fileChanges.map((change) => (
                                <li key={change.path} className="flex items-center justify-between gap-3">
                                  <span className="min-w-0 truncate text-slate-300" title={change.path}>{change.path}</span>
                                  <span className="shrink-0">
                                    <span className="text-emerald-400">+{change.additions}</span>
                                    <span className="ml-2 text-red-400">-{change.deletions}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="border-t border-slate-700 pt-2">
                          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">完整模型输出</p>
                          {/* Day59：回答/澄清类内容已经在折叠按钮下方的“正常文本气泡 summary”里渲染了，
                              禁止再缩进渲染到完整模型输出大黑框里。只有在没有 summaryIntent 且
                              trace.answer 存在的老版本数据里才继续显示缩进块。 */}
                          {run.trace.answer && (!run.trace.summaryIntent || !['answer', 'ask_clarification'].includes(run.trace.summaryIntent)) ? (
                            // Why: 问答分支返回 Markdown 文本，用 MarkdownMessage 渲染而非 <pre>。
                            <div className="max-h-96 overflow-auto rounded bg-slate-950 p-3 text-xs leading-relaxed text-slate-200">
                              <MarkdownMessage content={run.trace.answer} />
                            </div>
                          ) : run.trace.output ? (
                            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-2 font-mono text-[10px] leading-4 text-slate-300">
                              {formatModelOutput(run.trace.output)}
                            </pre>
                          ) : (
                            <p role="status" className="text-[11px] text-slate-500">
                              {run.trace.isRunning ? '等待模型返回可展示内容…' : '本次执行没有额外的模型文本输出。'}
                            </p>
                          )}
                        </div>
                      </section>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {acceptanceState !== 'idle' && (
            <section className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white" aria-live="polite">
              <button
                type="button"
                aria-expanded={isAcceptanceExpanded}
                onClick={() => setIsAcceptanceExpanded((value) => !value)}
                className="flex w-full items-center justify-between gap-2 p-3 text-left transition-colors hover:bg-slate-50"
              >
                <h3 className="text-sm font-semibold text-slate-800">Python 测试子 Agent</h3>
                <span className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${
                  acceptanceState === 'passed'
                    ? 'text-emerald-600'
                    : acceptanceState === 'running'
                      ? 'text-blue-600'
                      : acceptanceState === 'blocked'
                        ? 'text-amber-600'
                        : 'text-red-600'
                  }`}>
                  {acceptanceState === 'running' && `正在验证 · ${acceptanceElapsedSeconds}s / 50s`}
                  {acceptanceState === 'passed' && '验收通过'}
                  {acceptanceState === 'failed' && '验收失败，已交给运维 Agent'}
                  {acceptanceState === 'blocked' && '测试已阻塞或终止'}
                  </span>
                  <span aria-hidden="true" className="text-xs text-slate-400">{isAcceptanceExpanded ? '⌃' : '⌄'}</span>
                </span>
              </button>
              {isAcceptanceExpanded && (
              <div className="space-y-3 border-t border-slate-200 p-3">
              {acceptanceReport?.plan?.summary && (
                <p className="mb-2 text-xs leading-5 text-slate-600">
                  验收目标：{acceptanceReport.plan.summary}
                </p>
              )}
              {acceptanceReport?.diagnostic && (
                <p className="rounded-md bg-amber-50 p-2 text-xs leading-5 text-amber-800">
                  {acceptanceReport.diagnostic}
                </p>
              )}
              {acceptanceReport?.artifacts && acceptanceReport.artifacts.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">编写产物</p>
                  <ul className="space-y-1 rounded-md bg-slate-950 p-2 font-mono text-[10px]">
                    {acceptanceReport.artifacts.map((artifact) => (
                      <li key={artifact.path} className="flex items-center justify-between gap-3">
                        <span className="truncate text-slate-300" title={artifact.path}>{artifact.path}</span>
                        <span className="shrink-0">
                          <span className="text-emerald-400">+{artifact.additions}</span>
                          <span className="ml-2 text-red-400">-{artifact.deletions}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(acceptanceReport?.runner_stdout || acceptanceReport?.runner_stderr || acceptanceReport?.returncode != null) && (
                <div>
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    测试执行器日志
                    {acceptanceReport?.returncode != null && (
                      <span className={`ml-2 rounded px-1.5 py-0.5 font-mono ${acceptanceReport.returncode === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                        exit {acceptanceReport.returncode}
                      </span>
                    )}
                  </p>
                  <div className="space-y-2">
                    {acceptanceReport?.runner_stderr ? (
                      <details className="rounded-md border border-rose-200 bg-rose-50">
                        <summary className="cursor-pointer select-none px-2 py-1.5 text-[11px] font-medium text-rose-700">
                          stderr（运行器错误输出）
                        </summary>
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-rose-200 bg-slate-950 p-2 font-mono text-[10px] leading-4 text-red-200">
                          {acceptanceReport.runner_stderr}
                        </pre>
                      </details>
                    ) : null}
                    {acceptanceReport?.runner_stdout ? (
                      <details className="rounded-md border border-slate-200 bg-slate-50">
                        <summary className="cursor-pointer select-none px-2 py-1.5 text-[11px] font-medium text-slate-600">
                          stdout（浏览器测试输出）
                        </summary>
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-slate-200 bg-slate-950 p-2 font-mono text-[10px] leading-4 text-slate-200">
                          {acceptanceReport.runner_stdout}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                </div>
              )}
              {acceptanceReport?.network_failures && acceptanceReport.network_failures.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    沙盒网络失败 · {acceptanceReport.network_failures.length}
                  </p>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-2 font-mono text-[10px] leading-4 text-slate-300">
                    {acceptanceReport.network_failures
                      .map((item: { url?: string; error?: unknown }) =>
                        `${item.url ?? 'N/A'} · ${String(item.error ?? '')}`,
                      )
                      .join('\n')}
                  </pre>
                </div>
              )}
              {acceptanceReport?.model_output && (
                <div>
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">完整模型输出</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-2 font-mono text-[10px] leading-4 text-slate-300">
                    {formatModelOutput(acceptanceReport.model_output)}
                  </pre>
                </div>
              )}
              {acceptanceReport?.assertions && acceptanceReport.assertions.length > 0 && (
                <ol className="space-y-1.5">
                  {acceptanceReport.assertions.map((result, index) => (
                    <li key={`${result.assertion.kind}-${index}`} className="rounded-md border border-slate-200 bg-white p-2 text-xs">
                      <span className={result.passed ? 'text-emerald-600' : 'text-red-600'}>
                        {result.passed ? '通过' : '失败'}
                      </span>
                      <span className="ml-2 break-all text-slate-600">
                        {result.assertion.kind} {result.assertion.selector || result.assertion.expected}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {acceptanceState === 'running' && (
                <p role="status" className="text-xs text-slate-500">测试 Agent 正在生成验收计划并执行浏览器验证…</p>
              )}
              </div>
              )}
            </section>
          )}

          {repairLogs.length > 0 && (
            <div className="mt-5 border-t border-slate-200 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">
                自动修复记录
              </h3>
              <ol className="space-y-2">
                {repairLogs.map((log) => {
                  const isExpanded = expandedRepairAttempts.has(log.attempt);
                  return (
                  <li
                    key={log.attempt}
                    className="overflow-hidden rounded-lg border border-slate-200 bg-white text-xs"
                  >
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedRepairAttempts((previous) => {
                        const next = new Set(previous);
                        if (next.has(log.attempt)) next.delete(log.attempt);
                        else next.add(log.attempt);
                        return next;
                      })}
                      className="flex w-full items-center justify-between gap-2 p-3 text-left hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-700">运维 Agent · 第 {log.attempt} 次</span>
                      <span className="flex items-center gap-2">
                        <span className={
                        log.status === 'repairing'
                          ? 'text-amber-600'
                          : log.status === 'fixed'
                            ? 'text-emerald-600'
                            : 'text-red-600'
                      }>
                        {log.status === 'repairing'
                          ? '修复中'
                          : log.status === 'fixed'
                            ? '已修复'
                            : '失败'}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">{isExpanded ? '⌃' : '⌄'}</span>
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="space-y-3 border-t border-slate-200 p-3">
                        {log.fileChanges && log.fileChanges.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">文件修改 · {log.fileChanges.length} 个文件</p>
                            <ul className="space-y-1 rounded-md bg-slate-950 p-2 font-mono text-[10px]">
                              {log.fileChanges.map((change) => (
                                <li key={change.path} className="flex items-center justify-between gap-3">
                                  <span className="truncate text-slate-300" title={change.path}>{change.path}</span>
                                  <span className="shrink-0"><span className="text-emerald-400">+{change.additions}</span><span className="ml-2 text-red-400">-{change.deletions}</span></span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {log.modelOutput && (
                          <div>
                            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">完整模型输出</p>
                            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-2 font-mono text-[10px] leading-4 text-slate-300">{formatModelOutput(log.modelOutput)}</pre>
                          </div>
                        )}
                        {log.consoleEntries && log.consoleEntries.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">控制台与测试证据</p>
                            <div className="max-h-56 overflow-auto rounded-md bg-slate-950 p-2 font-mono text-[10px] leading-4">
                              {log.consoleEntries.map((entry, entryIndex) => (
                                <p key={`${entryIndex}-${entry.text.slice(0, 20)}`} className={entry.level === 'error' ? 'text-red-300' : entry.level === 'warn' ? 'text-amber-300' : 'text-slate-300'}>
                                  <span className="mr-2 text-slate-500">[{entry.level}]</span>{entry.text}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}
                        <details className="rounded-md bg-slate-50 p-2">
                          <summary className="cursor-pointer font-medium text-slate-600">诊断上下文</summary>
                          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-4 text-slate-500">{log.diagnostic || log.error}</pre>
                        </details>
                        {log.status === 'repairing' && !log.modelOutput && <p role="status" className="text-slate-500">运维 Agent 正在诊断并生成补丁…</p>}
                      </div>
                    )}
                  </li>
                  );
                })}
              </ol>
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
                <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
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
            <div className="mb-2 flex items-center justify-between gap-2">{modelControl}<span className="text-[11px] text-slate-400">Code 生成模型</span></div>
            {selectedElement && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-800">
                <span className="truncate">已选中：<code>{selectedElement.selector}</code></span>
                <button type="button" onClick={onClearSelectedElement} className="shrink-0 text-blue-700 hover:text-blue-950">取消</button>
              </div>
            )}
            <div className="mb-2 space-y-2">
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
              {isMultimodal ? (
                <div className="flex items-center gap-2">
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
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    + 图片
                  </button>
                  <span className="text-[11px] text-slate-400">支持粘贴、点击添加；多模态模型可用</span>
                </div>
              ) : (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
                  当前模型为纯文本模型，如需粘贴/上传图片，请切换到 <b>GLM-5V Turbo</b>。
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
                disabled={isLoading || !isSessionReady}
                placeholder={
                  hasCode
                    ? (hasProject ? '例如：把选中的按钮改成红色… (敲 @ 或从上方拖拽 可指定文件/文件夹)' : '例如：把选中的按钮改成红色，其他内容不变…')
                    : '描述你想创建的网页…'
                }
                rows={3}
                className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-100"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="submit"
                disabled={isLoading || !isSessionReady || !input.trim()}
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
          onPointerDown={beginResize}
          className="hidden w-1 shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-blue-400 lg:block"
        />

        <div className="relative min-h-[28rem] min-w-0 flex-1 bg-white lg:min-h-0 fullscreen:min-h-0">
          {/* Why: 全栈修改模式任务拆解浮层卡片——展示子任务进度，可折叠。 */}
          {tasks.length > 0 && (
            <TaskProgressCard tasks={tasks} />
          )}
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
                // Why: 终端活动时面板若沿用 144px 的 consoleHeight，减去 Tab 头与会话条后
                // 终端 host 会被 flex 压到 0 高，term.open() 拿不到非零尺寸而无限跳过。
                // 切换到 Terminal Tab 时给足 320px，保证终端有可用的渲染高度。
                style={{ height: isConsoleOpen ? (activeTerminalTab === 'terminal' ? 320 : consoleHeight) : 40 }}
                className="relative flex shrink-0 flex-col border-t border-slate-200 bg-slate-950 text-slate-200"
              >
                <div
                  role="separator"
                  aria-label="调整控制台高度"
                  aria-orientation="horizontal"
                  onPointerDown={beginConsoleResize}
                  className="absolute inset-x-0 top-0 z-10 h-1 cursor-row-resize bg-transparent transition-colors hover:bg-blue-400"
                />
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
                        onClick={() => setActiveTerminalTab('terminal')}
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
                  <div className={`${isConsoleOpen ? 'min-h-0 flex-1' : 'hidden'} overflow-y-auto px-3 py-2 font-mono text-xs leading-5`}>
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
                ) : (
                  <div className={`${isConsoleOpen ? 'relative flex-1 overflow-hidden' : 'hidden'}`}>
                    {activeTerminalRunId ? (
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
                        allowUserStdin={isManualTerminalRunId(activeTerminalRunId)}
                        onPropositionUpdate={(prop) => {
                          // Why: IntegratedTerminal 内的提案横幅紧贴终端顶部（用户要求"紧靠着终端上方"），
                          // 此处额外转发给上层以便通过 CustomEvent 同步把“正在等待用户选择”注入 agent trace steps。
                          onTerminalPropositionUpdate?.(prop);
                        }}
                        onTrustedPrefixAdd={(runIdValue, prefix) => onAddTrustedTerminalPrefix(runIdValue, prefix)}
                        trustedPrefixesByRun={trustedTerminalPrefixes}
                      />
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[180px] items-center justify-center text-xs text-slate-500">
                        <div className="text-center">
                          <p className="mb-2">暂无终端会话。</p>
                          <button
                            type="button"
                            onClick={createManualTerminal}
                            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 font-medium text-slate-200 hover:bg-slate-800"
                          >
                            + 新建手动终端
                          </button>
                        </div>
                      </div>
                    )}
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
