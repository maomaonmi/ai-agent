'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  sendChatMessage,
  sendDeepResearch,
  ChatMessage,
  WebDoc,
  ResearchProcessEvent,
  ResearchChunk,
  AgentTalkEvent,
  PlanProgressEvent,
  DiscussionLength,
  CapabilityMode,
  RuntimeSettings,
  SessionSummary,
  SessionSnapshot,
  listSessions,
  createSession,
  getSessionHistory,
  saveSessionSnapshot,
  deleteSession,
  clearSessions,
  ChatAttachment,
  getModelSettings,
  ModelSettings,
} from '../lib/api';
import { Image as ImageIcon, Link, Paperclip, X } from 'lucide-react';
import ResearchProgressPanel from './ResearchProgressPanel';
import MarkdownMessage from './MarkdownMessage';
import TaskExecutionPanel from './TaskExecutionPanel';
import ModeSelector, { ModeType } from './ModeSelector';
import AgentDrawer from './AgentDrawer';
import SessionSidebar from './SessionSidebar';
import RuntimeSettingsDrawer from './RuntimeSettingsDrawer';
import SettingsDialog from './SettingsDialog';
import ModelQuickSwitcher from './ModelQuickSwitcher';
import ChatNodeNavigator, { ChatNode } from './ChatNodeNavigator';
import CodeWorkspace from './CodeWorkspace';
import useCodeAutoRepair from '../hooks/useCodeAutoRepair';
import { SelectedElementContext } from '../lib/codeSandbox';
import { bundleVFS, VirtualFileSystem } from '../Code/vfsBundler';
import { isFullstackVFS, parseProjectCode, serializeProjectVFS } from '../Code/fullstackBundler';
import {
  createSnapshot,
  deepCopyVFS,
  isSameVFS,
  nextVersionNumber,
  VersionSnapshot,
} from '../Code/versionManager';

const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  responseLength: 'balanced',
  webSearch: 'auto',
  deepThinking: 'auto',
  discussionRounds: 2,
};

function readRuntimeDefaults(): RuntimeSettings {
  if (typeof window === 'undefined') return DEFAULT_RUNTIME_SETTINGS;
  try {
    const stored = JSON.parse(
      localStorage.getItem('runtimeSettingsDefaults') ?? '{}',
    ) as Partial<RuntimeSettings>;
    return { ...DEFAULT_RUNTIME_SETTINGS, ...stored };
  } catch {
    return DEFAULT_RUNTIME_SETTINGS;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RESEARCH_STAGES = {
  fanout: '裂变意图',
  fetch: '全网抓取',
  chunk: '细粒度切片',
  rerank: 'Reranker 精选',
  reason: 'R1 深度思考',
};

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ModeType>('standard');
  const [isLoading, setIsLoading] = useState(false);
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  const [reasoningSteps, setReasoningSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [webDocs, setWebDocs] = useState<WebDoc[]>([]);
  const [researchChunks, setResearchChunks] = useState<ResearchChunk[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarType, setSidebarType] = useState<'web' | 'research'>('web');
  const [researchProgress, setResearchProgress] = useState<ResearchProcessEvent | null>(null);
  // 多智能体协同树
  const [agentTalks, setAgentTalks] = useState<AgentTalkEvent[]>([]);
  const [agentStatus, setAgentStatus] = useState<string>('');
  const [planProgress, setPlanProgress] = useState<PlanProgressEvent | null>(null);
  const [discussionLength, setDiscussionLength] = useState<DiscussionLength>('balanced');
  const [discussionAgentIds, setDiscussionAgentIds] = useState<string[]>([]);
  const [discussionRounds, setDiscussionRounds] = useState(2);
  const [webSearch, setWebSearch] = useState<CapabilityMode>('auto');
  const [deepThinking, setDeepThinking] = useState<CapabilityMode>('auto');
  const [isRuntimeSettingsOpen, setIsRuntimeSettingsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Why: standard/deep 模式消息列表点击图片缩略图后放大预览。
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentType, setAttachmentType] = useState<ChatAttachment['type']>('image_url');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  // Why: Code 模式需要感知当前模型是否支持多模态，决定是否开放粘贴/上传图片入口。
  const [currentModelSettings, setCurrentModelSettings] = useState<ModelSettings | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedElementContext | null>(null);
  const [codeVersions, setCodeVersions] = useState<VersionSnapshot[]>([]);
  const [activeCodeVersionId, setActiveCodeVersionId] = useState('');
  const [codeProjectKind, setCodeProjectKind] = useState<'frontend' | 'fullstack'>('frontend');
  // Why: Day57 @file 剪枝——状态提升到此,提交时连同 instruction 一起传给 useCodeAutoRepair.modify。
  const [mentionedFiles, setMentionedFiles] = useState<string[]>([]);
  // Why: 重写消息——点"重写"把该条用户消息载回输入框，CTRL+Enter 发送；
  // 若编辑的是历史消息，提交时先截断其后的所有记录（ChatGPT 式编辑重发）。
  const [rewritingIndex, setRewritingIndex] = useState<number | null>(null);
  const titleRequestedRef = useRef<Set<string>>(new Set());
  const {
    code: generatedCode,
    status: codeStatus,
    runId: codeRunId,
    repairLogs,
    agentRuns,
    terminalWorkspaceId,
    trustedTerminalPrefixes,
    tasks: codeTasks,
    generate: generateCode,
    modify: modifyCode,
    reset: resetCode,
    restore: restoreCode,
    restoreAgentRuns,
    handleRuntimeError,
    stopAutoRepair,
    addTrustedTerminalPrefix,
  } = useCodeAutoRepair();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const addAttachmentUrl = () => {
    const url = attachmentUrl.trim();
    if (!url.startsWith('https://')) { setError('附件 URL 必须使用 HTTPS'); return; }
    // Why: Code 模式后端 analyze_screenshot_with_vision 只处理 image_url，强制按图片添加避免被后端拒绝。
    const effectiveType: ChatAttachment['type'] = mode === 'code' ? 'image_url' : attachmentType;
    if (attachments.length > 0 && attachments[0].type !== effectiveType) { setError('同一次请求不能混合图片、视频和文件'); return; }
    setAttachments((current) => [...current, { type: effectiveType, url, name: url.split('/').pop() || 'URL 附件' }]);
    setAttachmentUrl(''); setError(null);
  };

  const addLocalImage = (file?: File) => {
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) { setError('仅支持 JPG、PNG、WebP 或 GIF 图片'); return; }
    if (file.size > 8 * 1024 * 1024) { setError('图片不能超过 8MB'); return; }
    if (attachments.some((item) => item.type !== 'image_url')) { setError('同一次请求不能混合图片、视频和文件'); return; }
    const reader = new FileReader();
    reader.onload = () => setAttachments((current) => [...current, { type: 'image_url', url: String(reader.result), name: file.name }]);
    reader.onerror = () => setError('读取图片失败'); reader.readAsDataURL(file);
  };

  // Why: 把"是否显示附件上传区"抽成布尔变量，避免在 JSX 里直接写复合条件导致 TS 把 mode 过度收窄。
  // 此变量仅服务 standard/deep 模式；code 模式的附件 UI 通过 attachmentControl prop 注入到 CodeWorkspace。
  const showAttachmentRow = mode === 'standard' || mode === 'deep';

  useEffect(() => {
    setIsHistoryCollapsed(
      localStorage.getItem('historySidebarCollapsed') === 'true',
    );
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const settings = await getModelSettings();
        if (active) setCurrentModelSettings(settings);
      } catch {
        /* ignore: 后端暂时不可用时保持上次状态 */
      }
    };
    void refresh();
    window.addEventListener('model-settings-changed', refresh);
    return () => {
      active = false;
      window.removeEventListener('model-settings-changed', refresh);
    };
  }, []);

  const changeHistoryCollapsed = (collapsed: boolean) => {
    setIsHistoryCollapsed(collapsed);
    localStorage.setItem('historySidebarCollapsed', String(collapsed));
  };

  const buildSnapshot = (): SessionSnapshot => ({
    messages,
    reasoningSteps,
    webDocs,
    researchChunks,
    agentTalks,
    planProgress,
    discussionLength,
    discussionAgentIds,
    discussionRounds,
    webSearch,
    deepThinking,
    generatedCode,
    codeVersions,
    activeCodeVersionId,
    codeProjectKind,
    codeAgentRuns: agentRuns,
  });

  const resetConversation = () => {
    setMessages([]);
    setReasoningSteps([]);
    setWebDocs([]);
    setResearchChunks([]);
    setResearchProgress(null);
    setAgentTalks([]);
    setAgentStatus('');
    setPlanProgress(null);
    setSelectedElement(null);
    setCurrentNode(null);
    setShowSidebar(false);
    resetCode();
    setCodeVersions([]);
    setActiveCodeVersionId('');
    setCodeProjectKind('frontend');
    setError(null);
  };

  const applySnapshot = (snapshot: Partial<SessionSnapshot>) => {
    const defaults = readRuntimeDefaults();
    setMessages(snapshot.messages ?? []);
    setReasoningSteps(snapshot.reasoningSteps ?? []);
    setWebDocs(snapshot.webDocs ?? []);
    setResearchChunks(snapshot.researchChunks ?? []);
    setAgentTalks(snapshot.agentTalks ?? []);
    setPlanProgress(snapshot.planProgress ?? null);
    setDiscussionLength(
      snapshot.discussionLength ?? defaults.responseLength,
    );
    setDiscussionAgentIds(snapshot.discussionAgentIds ?? []);
    setDiscussionRounds(
      snapshot.discussionRounds ?? defaults.discussionRounds,
    );
    setWebSearch(snapshot.webSearch ?? defaults.webSearch);
    setDeepThinking(snapshot.deepThinking ?? defaults.deepThinking);
    restoreCode(snapshot.generatedCode ?? '');
    restoreAgentRuns(snapshot.codeAgentRuns ?? []);
    setCodeVersions((snapshot.codeVersions ?? []).map((version) => ({
      ...version,
      vfs: deepCopyVFS(version.vfs),
    })));
    setActiveCodeVersionId(snapshot.activeCodeVersionId ?? '');
    setCodeProjectKind(
      snapshot.codeProjectKind ?? (parseProjectCode(snapshot.generatedCode ?? '') ? 'fullstack' : 'frontend'),
    );
    setResearchProgress(null);
    setAgentStatus('');
    setCurrentNode(null);
    setShowSidebar(false);
    setError(null);
    setSelectedElement(null);
  };

  // Why: 作为 useEffect dep 注入到 CodeWorkspace（L462、L482）。未包 useCallback → 每轮
  //   render 新引用 → useEffect 每轮触发 → 内部 setState → 又 render → 无限循环。
  const captureCodeVersion = useCallback((vfs: VirtualFileSystem, summary: string) => {
    setCodeVersions((previousVersions) => {
      const existing = previousVersions.find((version) => isSameVFS(version.vfs, vfs));
      if (existing) {
        setActiveCodeVersionId(existing.versionId);
        return previousVersions;
      }
      const next = createSnapshot(nextVersionNumber(previousVersions), summary, vfs);
      setActiveCodeVersionId(next.versionId);
      return [...previousVersions, next];
    });
  }, []);

  const rollbackCodeVersion = useCallback((version: VersionSnapshot) => {
    const restoredVfs = deepCopyVFS(version.vfs);
    setActiveCodeVersionId(version.versionId);
    setSelectedElement(null);
    restoreCode(isFullstackVFS(restoredVfs)
      ? serializeProjectVFS(restoredVfs)
      : bundleVFS(restoredVfs, { injectInspector: false }));
  }, [restoreCode]);

  const saveManualCodeVersion = useCallback((vfs: VirtualFileSystem, summary: string) => {
    captureCodeVersion(vfs, summary);
    restoreCode(isFullstackVFS(vfs)
      ? serializeProjectVFS(vfs)
      : bundleVFS(vfs, { injectInspector: false }));
  }, [captureCodeVersion, restoreCode]);

  const openSession = async (session: SessionSummary) => {
    setIsSessionReady(false);
    try {
      const history = await getSessionHistory(session.session_id);
      setActiveSessionId(session.session_id);
      setMode(session.mode as ModeType);
      applySnapshot(history.snapshot);
      localStorage.setItem('activeSessionId', session.session_id);
      setIsHistoryOpen(false);
    } finally {
      setIsSessionReady(true);
    }
  };

  const startDraftSession = (sessionMode: ModeType = mode) => {
    resetConversation();
    const defaults = readRuntimeDefaults();
    setDiscussionLength(defaults.responseLength);
    setDiscussionRounds(defaults.discussionRounds);
    setWebSearch(defaults.webSearch);
    setDeepThinking(defaults.deepThinking);
    setDiscussionAgentIds([]);
    setMode(sessionMode);
    setActiveSessionId(null);
    localStorage.removeItem('activeSessionId');
    setIsHistoryOpen(false);
    setIsSessionReady(true);
  };

  const persistCurrentSession = async () => {
    if (!activeSessionId || !isSessionReady) return;
    const shouldGenerateTitle =
      messages.some((message) => message.role === 'user') &&
      !titleRequestedRef.current.has(activeSessionId);
    if (shouldGenerateTitle) titleRequestedRef.current.add(activeSessionId);
    const updated = await saveSessionSnapshot(
      activeSessionId,
      buildSnapshot(),
      shouldGenerateTitle,
    );
    setSessions((previous) => [
      updated,
      ...previous.filter((item) => item.session_id !== updated.session_id),
    ]);
  };

  useEffect(() => {
    let cancelled = false;
    void listSessions()
      .then(async (response) => {
        if (cancelled) return;
        setSessions(response.sessions);
        const rememberedId = localStorage.getItem('activeSessionId');
        const initial =
          response.sessions.find((item) => item.session_id === rememberedId) ??
          response.sessions[0];
        if (initial) {
          await openSession(initial);
        } else {
          startDraftSession('standard');
        }
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : '加载历史会话失败',
          );
          setIsSessionReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // Run only once to hydrate persisted server state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeSessionId || !isSessionReady) return;
    const timeout = window.setTimeout(() => {
      void persistCurrentSession().catch((requestError) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : '保存会话失败',
        );
      });
    }, 500);
    return () => window.clearTimeout(timeout);
    // Snapshot dependencies intentionally trigger debounced persistence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeSessionId,
    isSessionReady,
    messages,
    reasoningSteps,
    webDocs,
    researchChunks,
    agentTalks,
    planProgress,
    discussionLength,
    discussionAgentIds,
    discussionRounds,
    webSearch,
    deepThinking,
    generatedCode,
    codeVersions,
    activeCodeVersionId,
    codeProjectKind,
    agentRuns,
  ]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, reasoningSteps, researchProgress, agentTalks, planProgress]);

  // Why: runtimeSettings 被当作 prop / useEffect dep，如果每轮渲染都新建对象引用，
  //   子组件（CodeWorkspace / useCodeAutoRepair）的 useEffect 会每轮触发 → 内部 setState
  //   → 父组件 re-render → runtimeSettings 又变新引用 → 死循环（Maximum update depth exceeded）。
  const runtimeSettings: RuntimeSettings = useMemo(() => ({
    responseLength: discussionLength,
    webSearch,
    deepThinking,
    discussionRounds,
  }), [discussionLength, webSearch, deepThinking, discussionRounds]);

  // Why: 内联箭头函数作为 prop 传给 CodeWorkspace，每轮 render 新引用 → CodeWorkspace
  //   内部 useCallback/useMemo 把它们当 dep → 每轮失效 → 连环 setState → 无限循环。
  const handleTerminalPropositionUpdate = useCallback((prop: {
    run_id?: string; status: string; remaining_seconds?: number; command?: string; id?: string | number;
  } | null | undefined) => {
    if (!prop) return;
    if (prop.status !== 'pending' && prop.status !== 'needs_confirm') return;
    try {
      window.dispatchEvent(new CustomEvent('code-agent-run-append-step', {
        detail: {
          run_id: prop.run_id,
          step: `【终端命令审批】正在等待用户选择，剩余 ${prop.remaining_seconds}s：${prop.command}`,
          dedupe_key: `term-prop-${String(prop.id)}`,
        },
      }));
    } catch { /* noop */ }
  }, []);

  const handleClearSelectedElement = useCallback(() => setSelectedElement(null), []);

  const handleVfsChange = useCallback((serialized: string) => {
    // Why: 树状资源管理器的新建/重命名/删除操作，直接回填 generatedCode，
    //   使得 Agent 下次生成 diff 时基于最新 VFS 计算，不覆盖用户的手动改动。
    restoreCode(serialized);
  }, [restoreCode]);

  const updateRuntimeDefaults = (updates: Partial<RuntimeSettings>) => {
    const next = { ...readRuntimeDefaults(), ...updates };
    localStorage.setItem('runtimeSettingsDefaults', JSON.stringify(next));
  };

  const changeResponseLength = (value: DiscussionLength) => {
    setDiscussionLength(value);
    updateRuntimeDefaults({ responseLength: value });
  };

  const changeWebSearch = (value: CapabilityMode) => {
    setWebSearch(value);
    updateRuntimeDefaults({ webSearch: value });
  };

  const changeDeepThinking = (value: CapabilityMode) => {
    setDeepThinking(value);
    updateRuntimeDefaults({ deepThinking: value });
  };

  const changeDiscussionRounds = (value: number) => {
    setDiscussionRounds(value);
    updateRuntimeDefaults({ discussionRounds: value });
  };

  const resetRuntimeSettings = () => {
    setDiscussionLength(DEFAULT_RUNTIME_SETTINGS.responseLength);
    setWebSearch(DEFAULT_RUNTIME_SETTINGS.webSearch);
    setDeepThinking(DEFAULT_RUNTIME_SETTINGS.deepThinking);
    setDiscussionRounds(DEFAULT_RUNTIME_SETTINGS.discussionRounds);
    setDiscussionAgentIds([]);
    localStorage.setItem(
      'runtimeSettingsDefaults',
      JSON.stringify(DEFAULT_RUNTIME_SETTINGS),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !isSessionReady) return;

    const userMessage = input.trim();
    const requestAttachments = attachments;
    setIsLoading(true);
    setError(null);
    let requestSessionId = activeSessionId;

    if (!requestSessionId) {
      try {
        const session = await createSession(mode);
        requestSessionId = session.session_id;
        setActiveSessionId(session.session_id);
        localStorage.setItem('activeSessionId', session.session_id);
        setSessions((previous) => [
          session,
          ...previous.filter(
            (item) => item.session_id !== session.session_id,
          ),
        ]);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : '创建会话失败',
        );
        setIsLoading(false);
        return;
      }
    }

    setInput('');
    setAttachments([]);
    // Why: Day57 @file 提交后清空提及状态,与 input/attachments 同生命周期。
    setMentionedFiles([]);
    setCurrentNode(null);
    setReasoningSteps([]);
    setWebDocs([]);
    setResearchChunks([]);
    setShowSidebar(false);
    setSidebarType('web');
    setResearchProgress(null);
    setAgentTalks([]);
    setAgentStatus('');
    setPlanProgress(null);

    setMessages((prev) => {
      // Why: 重写历史消息时，先截断到 rewritingIndex（该条及其后的记录全部清除），
      // 再追加新的用户消息，实现 ChatGPT 式"编辑并重发"。
      const base = rewritingIndex != null ? prev.slice(0, rewritingIndex) : prev;
      return [...base, {
        role: 'user',
        content: userMessage,
        // Why: Code 模式历史消息回显图片缩略图；standard/deep 模式消息列表也支持展示附件。
        attachments: requestAttachments.length ? requestAttachments : undefined,
      }];
    });
    // 截断后重写索引失效，下一轮提交按普通发送处理
    setRewritingIndex(null);

    if (mode === 'code') {
      const isIncrementalChange = Boolean(generatedCode.trim());
      const targetElement = selectedElement;
      try {
        const didComplete = isIncrementalChange
          ? await modifyCode(userMessage, targetElement, requestAttachments, mentionedFiles)
          : await generateCode(userMessage, codeProjectKind, requestAttachments);
        if (didComplete) {
          setSelectedElement(null);
          setMessages((previous) => [
            ...previous,
            {
              role: 'assistant',
              content: isIncrementalChange
                ? '修改已应用，正在自动检测运行时错误。'
                : '网页代码已生成，正在自动检测运行时错误。',
            },
          ]);
        }
      } catch (requestError) {
        if (
          requestError instanceof DOMException &&
          requestError.name === 'AbortError'
        ) {
          return;
        }
        const message =
          requestError instanceof Error
            ? requestError.message
            : '网页代码生成失败。';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    } else if (mode === 'research') {
      // 深度调研模式
      try {
        await sendDeepResearch(userMessage, {
          onResearchProcess: (event) => {
            setResearchProgress(event);
          },
          onResearchDone: (event) => {
            setResearchProgress(null);
            setResearchChunks(event.top_chunks as ResearchChunk[]);
            setShowSidebar(true);
            setSidebarType('research');
            setMessages((prev) => [
              ...prev,
              {
                role: 'assistant',
                content: event.report ||
                  `✅ 深度调研完成！\n\n已从 ${event.total_pages} 个网页中抓取内容，切分为 ${event.total_chunks} 个切片，通过 BGE-Reranker 精选出 ${event.top_chunks.length} 条高相关性片段。\n\n正在生成深度研究报告...`,
              },
            ]);
          },
          onResearchReasonDone: (event) => {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                last.content = event.report;
                last.reasoning = event.reasoning;
                last.reasoning_time = event.reasoning_time;
              }
              return updated;
            });
          },
          onError: (event) => {
            setError(event.message);
          },
        }, requestSessionId, runtimeSettings);
      } catch (err) {
        setError(err instanceof Error ? err.message : '请求失败');
      } finally {
        setIsLoading(false);
      }
    } else if (mode === 'plan' || mode === 'distributed_plan') {
      try {
        await sendChatMessage(userMessage, mode, {
          onSystemStatus: (event) => {
            setAgentStatus(event.message);
          },
          onPlanProgress: (event) => {
            setPlanProgress(event);
            setAgentStatus('');
          },
          onDone: (event) => {
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: event.answer },
            ]);
            setAgentStatus('');
          },
          onError: (event) => {
            setError(event.message);
          },
        }, {
          sessionId: requestSessionId,
          runtimeSettings,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : '请求失败');
      } finally {
        setIsLoading(false);
      }
    } else if (mode === 'agent') {
      // 多智能体协同模式
      try {
        await sendChatMessage(userMessage, mode, {
          onSystemStatus: (event) => {
            setAgentStatus(event.message);
          },
          onAgentTalk: (event) => {
            setAgentTalks((prev) => [...prev, event]);
          },
          onAgentFinalAnswer: (event) => {
            setMessages((prev) => [...prev, { role: 'assistant', content: event.answer }]);
          },
          onDone: () => {
            setAgentStatus('');
          },
          onError: (event) => {
            setError(event.message);
          },
        }, {
          discussionLength,
          discussionAgentIds,
          discussionRounds,
          sessionId: requestSessionId,
          runtimeSettings,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : '请求失败');
      } finally {
        setIsLoading(false);
      }
    } else {
      // 普通对话模式（standard / deep / web）
      try {
        let streamedAnswer = '';
        let streamedReasoning = '';
        await sendChatMessage(userMessage, mode, {
          onNode: (event) => {
            if (event.status === 'completed') {
              setCurrentNode(event.node_name);
              setTimeout(() => setCurrentNode(null), 1000);
            }
          },
          onReasoning: (event) => {
            setReasoningSteps((prev) => [...prev, event.reasoning]);
          },
          onReasoningDelta: (token) => {
            streamedReasoning += token;
            setReasoningSteps([streamedReasoning]);
          },
          onToken: (token) => {
            streamedAnswer += token;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: streamedAnswer };
              else next.push({ role: 'assistant', content: streamedAnswer });
              return next;
            });
          },
          onWebDocs: (event) => {
            setWebDocs(event.docs);
            setShowSidebar(true);
          },
          onDone: (event) => {
            if (!streamedAnswer) setMessages((prev) => [...prev, { role: 'assistant', content: event.answer }]);
            if (event.web_docs && event.web_docs.length > 0) {
              setWebDocs(event.web_docs);
              setShowSidebar(true);
            }
          },
          onError: (event) => {
            setError(event.message);
          },
        }, {
          sessionId: requestSessionId,
          runtimeSettings,
          attachments: requestAttachments,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : '请求失败');
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleSelectSession = async (session: SessionSummary) => {
    if (session.session_id === activeSessionId || isLoading) return;
    try {
      await persistCurrentSession();
      await openSession(session);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '切换会话失败',
      );
    }
  };

  const handleCreateSession = async () => {
    if (isLoading) return;
    try {
      await persistCurrentSession();
      startDraftSession(mode);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '创建会话失败',
      );
    }
  };

  const handleModeChange = async (nextMode: ModeType) => {
    if (nextMode === mode || isLoading) return;
    if (nextMode === 'code') {
      setIsHistoryOpen(false);
      changeHistoryCollapsed(true);
    }
    try {
      await persistCurrentSession();
      const target = sessions.find((session) => session.mode === nextMode);
      if (target) {
        await openSession(target);
      } else {
        startDraftSession(nextMode);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '切换模式失败',
      );
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (isLoading) return;
    try {
      await deleteSession(sessionId);
      titleRequestedRef.current.delete(sessionId);
      const remaining = sessions.filter(
        (session) => session.session_id !== sessionId,
      );
      setSessions(remaining);
      if (sessionId === activeSessionId) {
        if (remaining[0]) {
          await openSession(remaining[0]);
        } else {
          startDraftSession(mode);
        }
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '删除会话失败',
      );
    }
  };

  const handleClearSessions = async () => {
    if (
      isLoading ||
      !window.confirm('确定清空全部历史会话吗？此操作无法撤销。')
    ) {
      return;
    }
    try {
      await clearSessions();
      titleRequestedRef.current.clear();
      setSessions([]);
      localStorage.removeItem('activeSessionId');
      startDraftSession(mode);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '清空历史失败',
      );
    }
  };

  const isPlanMode = mode === 'plan' || mode === 'distributed_plan';

  // 复制到剪贴板（历史消息的"复制"按钮）
  const copyText = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => { /* 剪贴板不可用时静默 */ });
  }, []);

  // 重写：把第 index 条用户消息载回输入框，CTRL+Enter 发送
  const handleRewriteMessage = useCallback((index: number) => {
    const msg = messages[index];
    if (!msg || msg.role !== 'user') return;
    setInput(msg.content);
    setRewritingIndex(index);
    inputRef.current?.focus();
  }, [messages]);

  // 删除单条消息；若删除的是正在重写的消息则清空重写态
  const handleDeleteMessage = useCallback((index: number) => {
    setRewritingIndex((prev) => (
      prev == null ? null : (prev === index ? null : (prev > index ? prev - 1 : prev))
    ));
    setMessages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // code 模式需求面板：promptIndex 对应第几个 user 消息
  const handleRewritePrompt = useCallback((promptIndex: number) => {
    const userIndices = messages
      .map((m, idx) => (m.role === 'user' ? idx : -1))
      .filter((idx) => idx >= 0);
    const target = userIndices[promptIndex];
    if (target == null) return;
    const msg = messages[target];
    if (!msg) return;
    setInput(msg.content);
    setRewritingIndex(target);
  }, [messages]);

  // code 模式需求面板：删除第 promptIndex 条问答（用户问题 + 紧邻的智能体回答）
  const handleDeletePrompt = useCallback((promptIndex: number) => {
    setMessages((prev) => {
      const userIndices = prev
        .map((m, idx) => (m.role === 'user' ? idx : -1))
        .filter((idx) => idx >= 0);
      const target = userIndices[promptIndex];
      if (target == null) return prev;
      const next = [...prev];
      next.splice(target, 1);
      if (next[target] && next[target].role === 'assistant') next.splice(target, 1);
      return next;
    });
  }, []);

  // 输入框 CTRL+Enter 发送（重写场景）
  const handleInputCtrlEnter = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (input.trim() && !isLoading && isSessionReady) {
        handleSubmit({ preventDefault: () => {} } as React.FormEvent);
      }
    }
  };

  const visibleMessages = mode === 'code'
    ? []
    : mode === 'agent' || isPlanMode
      ? messages.filter((message) => message.role === 'user')
      : messages;
  const agentFinalMessages = mode === 'agent'
    ? messages.filter((message) => message.role === 'assistant')
    : [];
  const planFinalMessages = isPlanMode
    ? messages.filter((message) => message.role === 'assistant')
    : [];
  const codePrompts = mode === 'code'
    ? messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content)
    : [];
  // Why: 与 codePrompts 平行，回显每条提问的图片附件。
  const codePromptAttachments = mode === 'code'
    ? messages
        .filter((message) => message.role === 'user')
        .map((message) => message.attachments ?? [])
    : [];
  const chatNodes = visibleMessages.reduce<ChatNode[]>((nodes, message, index) => {
    if (message.role === 'user') {
      nodes.push({
        id: `chat-message-${index}`,
        preview: message.content,
      });
    }
    return nodes;
  }, []);

  return (
    <div className={`bg-gradient-to-b from-slate-50 to-slate-100 ${
      mode === 'code' ? 'h-screen overflow-hidden' : 'min-h-screen'
    }`}>
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        isOpen={isHistoryOpen}
        isLoading={isLoading}
        desktopCollapsed={isHistoryCollapsed}
        onClose={() => setIsHistoryOpen(false)}
        onToggleDesktop={() => changeHistoryCollapsed(!isHistoryCollapsed)}
        onCreate={() => void handleCreateSession()}
        onSelect={(session) => void handleSelectSession(session)}
        onDelete={(sessionId) => void handleDeleteSession(sessionId)}
        onClear={() => void handleClearSessions()}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      <SettingsDialog open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <RuntimeSettingsDrawer
        isOpen={isRuntimeSettingsOpen}
        mode={mode}
        responseLength={discussionLength}
        webSearch={webSearch}
        deepThinking={deepThinking}
        discussionRounds={discussionRounds}
        selectedAgentIds={discussionAgentIds}
        onClose={() => setIsRuntimeSettingsOpen(false)}
        onResponseLengthChange={changeResponseLength}
        onWebSearchChange={changeWebSearch}
        onDeepThinkingChange={changeDeepThinking}
        onDiscussionRoundsChange={changeDiscussionRounds}
        onSelectedAgentIdsChange={setDiscussionAgentIds}
        onReset={resetRuntimeSettings}
      />
      <ChatNodeNavigator nodes={chatNodes} isSidebarOpen={showSidebar} />
      <div className={`${isHistoryCollapsed ? 'lg:pl-14' : 'lg:pl-72'} ${
        mode === 'code' ? 'h-screen overflow-hidden' : ''
      }`}>
        <div className={`mx-auto p-6 transition-all duration-300 ${
          mode === 'code'
            ? 'flex h-full max-w-none flex-col overflow-hidden pb-4 pt-0'
            : 'max-w-4xl pb-80 sm:pb-72'
        } ${showSidebar && mode !== 'code' ? 'mr-96' : ''}`}>
        {/* Header */}
        <header className={`sticky top-0 z-30 -mx-6 border-b border-slate-200/80 bg-slate-50/90 px-6 shadow-sm backdrop-blur-xl ${
          mode === 'code' ? 'mb-2 py-2' : 'mb-6 py-4'
        }`}>
          <button
            type="button"
            aria-label="打开历史会话"
            onClick={() => setIsHistoryOpen(true)}
            className="absolute left-0 top-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm lg:hidden"
          >
            ☰ 历史
          </button>
          {mode === 'code' ? (
            <div className="flex min-h-8 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-800">
                <span aria-hidden="true">⌨️</span>
                <span>Code 工作台</span>
                <span className="hidden truncate text-xs font-normal text-slate-500 sm:inline">
                  需求、预览与源码在同一工作区
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label="打开运行设置"
                  onClick={() => setIsRuntimeSettingsOpen(true)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  ⚙ <span className="hidden sm:inline">运行设置</span>
                </button>
                <AgentDrawer />
              </div>
            </div>
          ) : <>
          <div className="text-center">
            <h1 className="mb-1 text-xl font-bold text-gray-900 sm:text-3xl">
              全能型智能助手
            </h1>
            <p className="hidden text-sm text-gray-500 sm:block">
              标准对话 / 深度思考 / 联网搜索 / 深度调研
            </p>
          </div>
          <div className="mt-4 flex justify-center gap-2 lg:absolute lg:right-0 lg:top-0 lg:mt-0">
            <button
              type="button"
              onClick={() => setIsRuntimeSettingsOpen(true)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            >
              ⚙ 运行设置
            </button>
            <AgentDrawer />
          </div>
          </>}
        </header>

        {/* Node Status Bar (for non-research modes) */}
        {currentNode && mode !== 'research' && (
          <div className="bg-white/80 backdrop-blur rounded-lg p-3 mb-4 flex items-center justify-center gap-2 shadow-sm">
            <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
            <span className="text-blue-700 font-medium">{currentNode}</span>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-center">
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {/* Chat Messages */}
        <div className={`bg-white/60 backdrop-blur rounded-2xl shadow-sm ${
          mode === 'code' ? 'min-h-0 flex-1 overflow-hidden p-0' : 'mb-6 min-h-[450px] p-6'
        }`}>
          {mode === 'code' && (
            <CodeWorkspace
              code={generatedCode}
              prompts={codePrompts}
              promptAttachments={codePromptAttachments}
              input={input}
              modeControl={(
                <ModeSelector
                  value={mode}
                  disabled={isLoading || !isSessionReady}
                  menuPlacement="bottom"
                  allowedGroups={['code']}
                  onChange={(nextMode) => void handleModeChange(nextMode)}
                />
              )}
              modelControl={<ModelQuickSwitcher compact disabled={isLoading || !isSessionReady}/>}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              isMultimodal={Boolean(currentModelSettings?.multimodal)}
              selectedElement={selectedElement}
              isLoading={isLoading}
              isSessionReady={isSessionReady}
              repairLogs={repairLogs}
              runId={codeRunId}
              status={codeStatus}
              snapshots={codeVersions}
              activeVersionId={activeCodeVersionId}
              projectKind={codeProjectKind}
              agentRuns={agentRuns}
              terminalWorkspaceId={terminalWorkspaceId}
              trustedTerminalPrefixes={trustedTerminalPrefixes}
              onAddTrustedTerminalPrefix={addTrustedTerminalPrefix}
              onTerminalPropositionUpdate={handleTerminalPropositionUpdate}
              onRuntimeError={handleRuntimeError}
              onStopAutoRepair={stopAutoRepair}
              onCaptureSnapshot={captureCodeVersion}
              onRollbackVersion={rollbackCodeVersion}
              onSaveManualVersion={saveManualCodeVersion}
              onProjectKindChange={setCodeProjectKind}
              onElementSelected={setSelectedElement}
              onInputChange={setInput}
              onClearSelectedElement={handleClearSelectedElement}
              onSubmit={handleSubmit}
              mentionedFiles={mentionedFiles}
              onMentionedFilesChange={setMentionedFiles}
              onVfsChange={handleVfsChange}
              onRewritePrompt={handleRewritePrompt}
              onDeletePrompt={handleDeletePrompt}
              tasks={codeTasks}
            />
          )}

          {mode !== 'code' && messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center h-96 text-gray-400">
              <div className="text-6xl mb-4">🤖</div>
              <p className="text-lg">开始对话吧</p>
              <p className="text-sm mt-2">选择一个模式，然后输入你的问题</p>
            </div>
          )}

          <div className={mode === 'code' ? 'hidden' : 'space-y-4'}>
            {visibleMessages.map((msg, index) => (
              <div
                id={msg.role === 'user' ? `chat-message-${index}` : undefined}
                key={index}
                className={`scroll-mt-28 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[85%] rounded-2xl px-5 py-3 ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-gray-100 text-gray-900 rounded-bl-md'
                }`}>
                  {/* 附件图片缩略图 */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {msg.attachments.map((item, attachIndex) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={`${item.url.slice(0, 24)}-${attachIndex}`}
                          src={item.url}
                          alt={item.name || '附件图片'}
                          className="h-20 w-20 cursor-zoom-in rounded-lg border border-white/20 object-cover"
                          onClick={() => setLightboxUrl(item.url)}
                        />
                      ))}
                    </div>
                  )}
                  {/* 报告正文 */}
                  <MarkdownMessage content={msg.content} />

                  {/* 可折叠的 R1 深度思考过程（调研模式完成后显示在消息内） */}
                  {msg.reasoning && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-purple-600 hover:text-purple-800 flex items-center gap-1.5 py-1 select-none">
                        <span>🧠</span>
                        R1 深度思考
                        {msg.reasoning_time != null && (
                          <span className="text-purple-400 font-normal">· {msg.reasoning_time}s</span>
                        )}
                      </summary>
                      <div className="mt-2 p-3 bg-purple-50 border border-purple-100 rounded-lg text-xs text-purple-800 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                        {msg.reasoning}
                      </div>
                    </details>
                  )}

                  {/* 消息操作：复制 / 重写(仅用户) / 删除 */}
                  {(() => {
                    const realIndex = messages.indexOf(msg);
                    return (
                      <div className={`mt-2 flex items-center gap-1 ${
                        msg.role === 'user' ? 'text-blue-100' : 'text-slate-400'
                      }`}>
                        <button
                          type="button"
                          title="复制内容"
                          onClick={() => copyText(msg.content)}
                          className="rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-white/20"
                        >
                          ⧉ 复制
                        </button>
                        {msg.role === 'user' && (
                          <button
                            type="button"
                            title="重写（CTRL+Enter 发送，会清空其后记录）"
                            onClick={() => handleRewriteMessage(realIndex)}
                            className="rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-white/20"
                          >
                            ✎ 重写
                          </button>
                        )}
                        <button
                          type="button"
                          title="删除该消息"
                          onClick={() => handleDeleteMessage(realIndex)}
                          className="rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-rose-100"
                        >
                          🗑 删除
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))}

            {/* Research Progress inside chat area */}
            {mode === 'research' && researchProgress && (
              <div className="flex justify-start">
                <div className="max-w-[90%]">
                  <ResearchProgressPanel progress={researchProgress} />
                </div>
              </div>
            )}

            {/* 多智能体协同树 (Agent Mode) */}
            {mode === 'agent' && (agentStatus || agentTalks.length > 0) && (
              <div className="mt-4 space-y-2">
                {/* 系统状态栏 */}
                {agentStatus && (
                  <div className="flex items-center gap-2 text-sm text-indigo-600 bg-indigo-50 rounded-lg px-4 py-2">
                    <div className="h-2 w-2 bg-indigo-400 rounded-full animate-pulse" />
                    <span>{agentStatus}</span>
                  </div>
                )}

                {/* 协同轨迹卡片流 */}
                {agentTalks.map((talk, i) => (
                  <div key={i} className="flex items-start gap-3 bg-white border border-indigo-100 rounded-xl px-4 py-3 shadow-sm">
                    <div className="flex-shrink-0 w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-sm">
                      🤖
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1 flex-wrap">
                        <span className="font-semibold text-indigo-700">{talk.from_agent}</span>
                        <span>➔</span>
                        <span className="font-semibold text-indigo-700">{talk.to_agent}</span>
                      </div>
                      <p className="text-sm text-gray-700">{talk.action}</p>
                      {talk.content && (
                        <MarkdownMessage className="mt-2 rounded-lg bg-indigo-50 p-3 text-sm leading-relaxed text-gray-800" content={talk.content} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isPlanMode && (planProgress || agentStatus) && (
              <div className="mt-4">
                {planProgress ? (
                  <TaskExecutionPanel
                    progress={planProgress}
                    distributed={mode === 'distributed_plan'}
                  />
                ) : (
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-lg bg-cyan-50 px-4 py-3 text-sm text-cyan-700"
                  >
                    <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-500" />
                    {agentStatus}
                  </div>
                )}
              </div>
            )}

            {agentFinalMessages.map((msg, index) => (
              <div key={`agent-final-${index}`} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-gray-100 px-5 py-3 text-gray-900">
                  <p className="mb-2 text-xs font-semibold text-indigo-700">🎙️ 主持人 · 聊天小结</p>
                  <MarkdownMessage content={msg.content} />
                </div>
              </div>
            ))}

            {planFinalMessages.map((msg, index) => (
              <div key={`plan-final-${index}`} className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-gray-100 px-5 py-3 text-gray-900">
                  <p className="mb-2 text-xs font-semibold text-cyan-700">
                    {mode === 'distributed_plan' ? '🕸️' : '🧭'} Final Summarizer · 最终报告
                  </p>
                  <MarkdownMessage content={msg.content} />
                </div>
              </div>
            ))}
          </div>

          {/* Reasoning Display (Deep Mode) */}
          {reasoningSteps.length > 0 && (
            <div className="mt-6 border-t border-gray-200 pt-4">
              <h3 className="text-sm font-medium text-purple-600 mb-3 flex items-center gap-2">
                <span>🧠</span> 深度思考过程
              </h3>
              <div className="space-y-2">
                {reasoningSteps.map((reasoning, index) => (
                  <details key={index} className="bg-purple-50/50 rounded-lg">
                    <summary className="px-4 py-2 cursor-pointer font-medium text-purple-700 text-sm">
                      推理 #{index + 1}
                    </summary>
                    <div className="px-4 py-3 text-gray-700 whitespace-pre-wrap text-sm leading-relaxed">
                      {reasoning}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Fixed Input Area */}
        {mode !== 'code' && <div
          className={`fixed bottom-0 left-0 z-40 border-t border-slate-200/80 bg-slate-50/90 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-[left,right] duration-300 ${
            isHistoryCollapsed ? 'lg:left-14' : 'lg:left-72'
          } ${
            showSidebar ? 'right-0 lg:right-96' : 'right-0'
          }`}
        >
          <div className="mx-auto max-w-4xl p-3 sm:p-4">
            <div className="rounded-2xl bg-white p-4 shadow-lg">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <ModeSelector
              value={mode}
              disabled={isLoading || !isSessionReady}
              onChange={(nextMode) => void handleModeChange(nextMode)}
            />

            <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-500">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                {discussionLength === 'brief'
                  ? '精简'
                  : discussionLength === 'detailed'
                    ? '详细'
                    : '标准'}篇幅
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                🌐 联网：{webSearch === 'off' ? '关闭' : webSearch === 'on' ? '开启' : '自动'}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                🧠 深度：{deepThinking === 'off' ? '关闭' : deepThinking === 'on' ? '开启' : '自动'}
              </span>
              {mode === 'agent' && (
                <span className="rounded-full bg-slate-100 px-2.5 py-1">
                  {discussionRounds} 轮讨论
                </span>
              )}
            </div>

            <ModelQuickSwitcher disabled={isLoading || !isSessionReady}/>

            {showAttachmentRow && <div className="space-y-2">
              {attachments.length > 0 && <div className="flex flex-wrap gap-2">{attachments.map((item, index) => <span key={`${item.url.slice(0,30)}-${index}`} className="inline-flex max-w-48 items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-800"><Paperclip size={13}/><span className="truncate">{item.name || item.type}</span><button type="button" aria-label={`移除 ${item.name || '附件'}`} onClick={()=>setAttachments((current)=>current.filter((_,i)=>i!==index))}><X size={13}/></button></span>)}</div>}
              <div className="flex flex-wrap items-center gap-2">
                {currentModelSettings?.multimodal ? (
                  <button type="button" onClick={()=>imageInputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"><ImageIcon size={14}/>本地图片</button>
                ) : (
                  <span className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                    当前模型为纯文本，不支持上传图片
                  </span>
                )}
                <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e)=>{addLocalImage(e.target.files?.[0]); e.currentTarget.value='';}}/>
                <select aria-label="附件类型" value={attachmentType} onChange={(e)=>setAttachmentType(e.target.value as ChatAttachment['type'])} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-600"><option value="image_url">图片 URL</option><option value="video_url">视频 URL</option><option value="file_url">文件 URL</option></select>
                <div className="flex min-w-52 flex-1"><input aria-label="附件 HTTPS URL" value={attachmentUrl} onChange={(e)=>setAttachmentUrl(e.target.value)} placeholder="https://…" className="min-w-0 flex-1 rounded-l-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-sky-500"/><button type="button" disabled={!attachmentUrl.trim()} onClick={addAttachmentUrl} className="inline-flex items-center gap-1 rounded-r-lg bg-slate-800 px-3 text-xs text-white disabled:opacity-40"><Link size={13}/>添加</button></div>
                <span className="text-[11px] text-slate-400">图片、视频、文件不可混合</span>
              </div>
            </div>}

            {/* Input Row */}
            <div className="flex gap-3">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleInputCtrlEnter}
                placeholder={
                  mode === 'web' ? '联网搜索最新信息...' :
                  mode === 'research' ? '输入调研主题...' :
                  mode === 'distributed_plan' ? '输入需要多位专家协作完成的复杂目标...' :
                  mode === 'plan' ? '输入需要拆解和持续执行的复杂任务...' :
                  '输入你的问题...'
                }
                disabled={isLoading}
                className="flex-1 px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 text-gray-900 placeholder-gray-400 bg-gray-50"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className={`px-6 py-3 text-white rounded-xl font-medium transition-all disabled:bg-gray-300 disabled:cursor-not-allowed shadow-sm ${
                  mode === 'web' ? 'bg-green-600 hover:bg-green-700' :
                  mode === 'deep' ? 'bg-purple-600 hover:bg-purple-700' :
                  mode === 'research' ? 'bg-orange-600 hover:bg-orange-700' :
                  mode === 'agent' ? 'bg-indigo-600 hover:bg-indigo-700' :
                  mode === 'distributed_plan' ? 'bg-teal-600 hover:bg-teal-700' :
                  mode === 'plan' ? 'bg-cyan-600 hover:bg-cyan-700' :
                  'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                    <span>
                      {mode === 'research'
                        ? '调研中'
                        : isPlanMode
                          ? '执行中'
                          : '思考中'}
                    </span>
                  </div>
                ) : (
                  '发送'
                )}
              </button>
            </div>

            {/* Research Mode Tip */}
            {mode === 'research' && !isLoading && (
              <p className="text-xs text-gray-400 text-center">
                深度调研会进行多路搜索 → 海量抓取 → 细粒度切片 → Reranker 精选
              </p>
            )}
            {isPlanMode && !isLoading && (
              <p className="text-center text-xs text-gray-400">
                {mode === 'distributed_plan'
                  ? '项目经理拆解 → 专家动态执行 → Re-Planner 调整 → 跨智能体汇总'
                  : 'Planner 拆解任务 → Executor 逐项执行 → Re-Planner 动态调整 → 汇总报告'}
              </p>
            )}
          </form>
            </div>
          </div>
        </div>}
      </div>
      </div>

      {/* Sidebar for Web Search Results / Research Chunks */}
      <div
        className={`fixed right-0 top-0 h-full w-96 bg-white shadow-2xl transform transition-transform duration-300 z-50 overflow-y-auto ${
          showSidebar ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-center justify-between backdrop-blur">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            {sidebarType === 'research' ? (
              <>
                <span className="text-xl">🔬</span>
                调研精选片段 ({researchChunks.length})
              </>
            ) : (
              <>
                <span className="text-xl">🌐</span>
                搜索结果 ({webDocs.length})
              </>
            )}
          </h3>
          <button
            onClick={() => setShowSidebar(false)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* 调研精选片段渲染 */}
          {sidebarType === 'research' && researchChunks.map((chunk: ResearchChunk, index: number) => (
            <div key={index} className="bg-orange-50 rounded-xl p-4 hover:bg-orange-100 transition-colors">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-orange-500 text-white rounded-full flex items-center justify-center text-sm font-medium">
                  {chunk.id || index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-gray-900 mb-2 line-clamp-2">
                    {chunk.title || '无标题'}
                  </h4>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full font-medium">
                      得分: {chunk.score.toFixed(4)}
                    </span>
                    <a
                      href={chunk.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      来源页面
                    </a>
                  </div>
                  <p className="text-sm text-gray-700 line-clamp-5 whitespace-pre-wrap">
                    {chunk.text}
                  </p>
                </div>
              </div>
            </div>
          ))}

          {/* 联网搜索结果渲染 */}
          {sidebarType === 'web' && webDocs.map((doc, index) => (
            <div key={index} className="bg-gray-50 rounded-xl p-4 hover:bg-gray-100 transition-colors">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-sm font-medium">
                  {doc.id}
                </span>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-gray-900 mb-2 line-clamp-2">
                    {doc.title}
                  </h4>
                  <p className="text-sm text-gray-600 mb-3 line-clamp-3">
                    {doc.content}
                  </p>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    查看原文
                  </a>
                </div>
              </div>
            </div>
          ))}

          {((sidebarType === 'web' && webDocs.length === 0) || (sidebarType === 'research' && researchChunks.length === 0)) && !isLoading && (
            <div className="text-center text-gray-400 py-8">
              暂无内容
            </div>
          )}
        </div>
      </div>

      {/* Overlay */}
      {showSidebar && (
        <div
          className="fixed inset-0 bg-black/10 z-40 backdrop-blur-sm"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Toggle Sidebar Button (when closed) */}
      {((!showSidebar && webDocs.length > 0) || (!showSidebar && researchChunks.length > 0)) && (
        <button
          onClick={() => setShowSidebar(true)}
          className="fixed right-4 top-1/2 -translate-y-1/2 bg-white shadow-lg rounded-full p-3 hover:bg-gray-50 transition-colors z-30 border border-gray-200"
          title={sidebarType === 'research' ? '查看调研精选' : '查看搜索结果'}
        >
          <span className="text-xl">{sidebarType === 'research' ? '🔬' : '🌐'}</span>
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 text-white text-xs rounded-full flex items-center justify-center">
            {sidebarType === 'research' ? researchChunks.length : webDocs.length}
          </span>
        </button>
      )}
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
    </div>
  );
}
