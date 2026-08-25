'use client';

import { useState, useRef, useEffect, useCallback, useMemo, useReducer, type CSSProperties } from 'react';
import {
  sendChatMessage,
  sendDeepResearch,
  ChatMessage,
  WebDoc,
  ResearchProcessEvent,
  ResearchChunk,
  ResearchFigure,
  PlanFigure,
  AgentTalkEvent,
  PlanProgressEvent,
  PlanRuntimeEvent,
  DiscussionLength,
  CapabilityMode,
  McpMode,
  McpEvent,
  McpTraceItem,
  SkillMatchedEvent,
  RuntimeSettings,
  SessionSummary,
  SessionSnapshot,
  listSessions,
  createSession,
  getSessionHistory,
  saveSessionSnapshot,
  deleteSession,
  renameSession,
  clearSessions,
  ChatAttachment,
  getModelSettings,
  ModelSettings,
  restoreMemoryVfs,
  getSkills,
  SkillCapsule,
  NodeEvent,
  WebSearchOptions,
  DEFAULT_WEB_SEARCH_OPTIONS,
  QwenNativeSearchOptions,
  DEFAULT_QWEN_NATIVE_SEARCH_OPTIONS,
  ResearchEngine,
  ResearchOptions,
  DEFAULT_RESEARCH_OPTIONS,
  TokenUsage,
  publishCodeProject,
  PublishedCodeProject,
  getCodeProject,
  createImageGeneration,
  type ImageBatch,
  createVideoTask,
  getVideoModels,
  getVideoTaskStatus,
  type VideoTask,
} from '../lib/api';
import { Image as ImageIcon, Paperclip, X, Bot, ArrowUp, Sparkles, SlidersHorizontal, Plus, FileText, Video, Menu, Code2, Languages, WandSparkles, Telescope, Presentation } from 'lucide-react';
import ResearchProgressPanel from './ResearchProgressPanel';
import MarkdownMessage from './MarkdownMessage';
import NodeProgressPanel from './NodeProgressPanel';
import ModeSelector, { ModeType } from './ModeSelector';
import AgentDrawer from './AgentDrawer';
import SessionSidebar from './SessionSidebar';
import RuntimeSettingsDrawer from './RuntimeSettingsDrawer';
import ResearchOptionsPopover from './ResearchOptionsPopover';
import DirectoryPage from './DirectoryPage';
import HookCenter from './HookCenter';
import HookMonitorPanel from './HookMonitorPanel';
import SettingsDialog from './SettingsDialog';
import ModelQuickSwitcher, { type VideoComposerParams } from './ModelQuickSwitcher';
import ChatNodeNavigator, { ChatNode } from './ChatNodeNavigator';
import CodeWorkspace from './CodeWorkspace';
import CodeShowcasePage from './code-showcase/CodeShowcasePage';
import WritingWorkspace from '../features/ai-writing/WritingWorkspace';
import ImagePlazaWorkspace from '../features/picture/ImagePlazaWorkspace';
import ImageStudioWorkspace from '../features/picture/ImageStudioWorkspace';
import VideoStudioWorkspace from '../features/video/VideoStudioWorkspace';
import VideoMarketWorkspace from '../features/video/VideoMarketWorkspace';
import ResearchWorkspace from '../features/deep-research/ResearchWorkspace';
import PlanWorkspace from '../features/autonomous-plan/PlanWorkspace';
import PlanChainTimeline from '../features/autonomous-plan/PlanChainTimeline';
import ResearchDocumentCard from '../features/deep-research/ResearchDocumentCard';
import { pptApi, type PptHistoryRun } from '../features/ppt/api';
import { deriveReportTitle } from '../features/deep-research/report/researchReportAdapter';
import { useTypewriterPacing } from '../lib/useTypewriterPacing';
import type { CompiledWritingPrompt } from '../features/ai-writing/writingTypes';
import type { WritingDraft } from '../features/ai-writing/writingTypes';
import type { WritingDocumentState } from '../features/ai-writing/writingDocumentTypes';
import type { ThesisOutlineState } from '../features/ai-writing/thesis/thesisTypes';
import { createDefaultWritingValues } from '../features/ai-writing/writingScenes';
import { createClientMessageId, ensureChatMessageIds } from '../features/omni/messageIdentity';
import { createArtifactVersion, createConversationArtifact, getArtifactVersion, getConversationOmniContext, listConversationArtifactLinks, referenceConversationArtifact } from '../features/omni/api';
import ArtifactMessageCards from '../features/omni/ArtifactMessageCards';
import ArtifactReferencePicker from '../features/omni/ArtifactReferencePicker';
import ArtifactPanel from '../features/omni/ArtifactPanel';
import { artifactPanelReducer } from '../features/omni/panelState';
import { ARTIFACT_PANEL_DEFAULT_WIDTH, clampArtifactPanelWidth } from '../features/omni/artifactResize';
import OmniComposerToolbar from '../features/omni/OmniComposerToolbar';
import OmniModeShowcase from '../features/omni/OmniModeShowcase';
import { capabilityUsesTaskRoute, nextCapabilityMode, selectPreferredCapability, type OmniComposerCapability } from '../features/omni/composerCapabilities';
import { createOmniTurnContext } from '../features/omni/turnContext';
import { createWritingArtifactInput, writingDocumentToMarkdown } from '../features/omni/writingArtifactAdapter';
import { createImageArtifactInput, readImageArtifactPayload } from '../features/omni/imageArtifactAdapter';
import { createResearchArtifactInput } from '../features/omni/researchArtifactAdapter';
import { createThesisArtifactInput, readThesisArtifactPayload } from '../features/omni/thesisArtifactAdapter';
import { createVideoArtifactInput, matchesVideoArtifactTask, readVideoArtifactPayload } from '../features/omni/videoArtifactAdapter';
import { createPptArtifactInput, readPptArtifactPayload } from '../features/omni/pptArtifactAdapter';
import type { Artifact, ArtifactSummary, ArtifactVersion, MessageArtifactLink } from '../features/omni/types';
import { documentFromV1Result } from '../features/ai-writing/writingDocumentTypes';
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
  mcpMode: 'auto',
  mcpServerIds: [],
  skillMode: 'auto',
  skillIds: [],
  webSearchOptions: DEFAULT_WEB_SEARCH_OPTIONS,
  qwenNativeSearchOptions: DEFAULT_QWEN_NATIVE_SEARCH_OPTIONS,
};

// Legacy telemetry used this identifier for memory-only turns. It is not a
// real conversation and must never own Omni artifacts or artifact links.
const LEGACY_GLOBAL_SESSION_ID = '__global__';
const ARTIFACT_PANEL_WIDTH_STORAGE_KEY = 'omni-artifact-panel-width';

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

function researchChunksFromWebDocs(docs: WebDoc[]): ResearchChunk[] {
  return docs.map((doc, index) => ({
    id: Number.isFinite(doc.id) ? doc.id : index + 1,
    title: doc.title || '未命名来源',
    url: doc.url || '',
    score: Number.isFinite(doc.score) ? doc.score : 0,
    text: doc.content || '',
  }));
}

function buildHistoricalResearchChain(sourceCount: number): NodeEvent[] {
  const now = Date.now();
  const fallback = { history_fallback: true };
  return [
    { id: 1001, node_name: 'research_plan', status: 'completed', message: '历史会话已完成研究规划', timestamp_ms: now - 3000, extras: fallback },
    { id: 1002, node_name: 'web_search', status: 'completed', message: `历史会话已完成深度搜索，归档 ${sourceCount} 条来源`, timestamp_ms: now - 2000, kept_count: sourceCount, extras: fallback },
    { id: 1003, node_name: 'analysis', status: 'completed', message: '历史会话已完成分析整合', timestamp_ms: now - 1000, extras: fallback },
    { id: 1004, node_name: 'final_answer', status: 'completed', message: '历史调研报告已生成', timestamp_ms: now, extras: fallback },
  ];
}

function isPendingResearchFigure(figure: ResearchFigure): boolean {
  return figure.job_id === 'pending' || figure.id.startsWith('placeholder-');
}

function containsOnlyPendingResearchFigures(messages: ChatMessage[]): boolean {
  const figures = messages.flatMap((message) => message.researchFigures ?? []);
  return figures.length > 0 && figures.every(isPendingResearchFigure);
}

function mergeResearchSources(current: ResearchChunk[], incoming: ResearchChunk[]): ResearchChunk[] {
  const merged = new Map<string, ResearchChunk>();
  [...current, ...incoming].forEach((source) => {
    const key = source.url.trim() || `${source.title}\n${source.text}`;
    if (key.trim()) merged.set(key, source);
  });
  return [...merged.values()].map((source, index) => ({ ...source, id: index + 1 }));
}

/** Merge provider search batches without letting placeholder cards hide later
 * results. Native GLM/Qwen/MiniMax search can emit several web_docs events;
 * each event is a batch, not a replacement snapshot. */
function mergeWebDocs(current: WebDoc[], incoming: WebDoc[]): WebDoc[] {
  const merged = new Map<string, WebDoc>();
  [...current, ...incoming].forEach((doc, index) => {
    const url = String(doc.url || '').trim();
    const title = String(doc.title || '').trim();
    const content = String(doc.content || '').trim();
    // Empty-url docs are progress placeholders. Keep one only while there are
    // no real sources yet; remove it as soon as a provider returns URLs.
    if (!url && !merged.size) {
      merged.set(`placeholder:${title || index}`, doc);
      return;
    }
    if (!url) return;
    merged.set(`url:${url}`, doc);
    void content;
  });
  const real = [...merged.values()].filter((doc) => String(doc.url || '').trim());
  return real.length > 0 ? real : [...merged.values()].slice(0, 1);
}

function shouldCreateWritingArtifact(
  capability: OmniComposerCapability,
  prompt: string,
  content: string,
): boolean {
  if (!content.trim()) return false;
  if (capability === 'writing') return true;
  // 全能模式保持自然聊天；只有明显的文档意图才落作品卡片，避免普通
  // 问答被误存成“文章”。
  if (capability !== 'omni') return false;
  return /(论文|文章|报告|文档|综述|研究报告|白皮书|方案|初稿|paper|essay|report|document)/i.test(prompt);
}

function researchSourcesFromMessage(message?: ChatMessage): ResearchChunk[] {
  if (!message) return [];
  return message.researchChunks?.length
    ? message.researchChunks
    : researchChunksFromWebDocs(message.webDocs ?? []);
}

function buildCodeProjectCover(vfs: VirtualFileSystem, title: string): string {
  const entry = Object.entries(vfs).find(([path]) => /index\.(html|tsx?|jsx?)$/i.test(path)) ?? Object.entries(vfs)[0];
  const snippet = (entry?.[1] ?? '<main>Code project</main>').replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char] ?? char)).slice(0, 220);
  const safeTitle = title.replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[char] ?? char)).slice(0, 48);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#0f172a"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect width="1280" height="720" rx="34" fill="url(#g)"/><rect x="60" y="58" width="1160" height="604" rx="24" fill="#f8fafc" opacity=".98"/><circle cx="94" cy="92" r="8" fill="#ef4444"/><circle cx="120" cy="92" r="8" fill="#f59e0b"/><circle cx="146" cy="92" r="8" fill="#22c55e"/><text x="72" y="180" font-family="Inter,Arial" font-size="38" font-weight="700" fill="#0f172a">${safeTitle}</text><text x="72" y="238" font-family="ui-monospace,monospace" font-size="19" fill="#475569">${snippet.replace(/\n/g, ' ').replace(/"/g, '&quot;')}</text><rect x="72" y="300" width="540" height="18" rx="9" fill="#dbeafe"/><rect x="72" y="338" width="820" height="18" rx="9" fill="#e2e8f0"/><rect x="72" y="376" width="680" height="18" rx="9" fill="#e2e8f0"/><text x="72" y="590" font-family="Inter,Arial" font-size="18" fill="#64748b">Code workspace · live preview</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RESEARCH_STAGES = {
  fanout: '裂变意图',
  fetch: '全网抓取',
  chunk: '细粒度切片',
  rerank: 'Reranker 精选',
  reason: 'R1 深度思考',
};

// Why（Agent Loop 重构）：原 dedupeNodeProgress / mergeNodeCompleted 已移除。
//   旧逻辑用于"合并同名 completed 节点"，源于后端 R1 完成时连发两条 DeepThinker completed
//   （research_reason_done + stage=reason done）导致界面渲染重复。
//   Agent Loop 模式下每轮 Think/Search/Observe/Final 都会重复发射同名节点，循环中重复是正常行为，
//   不应再合并；前端改为 append-only 累积，由 NodeProgressPanel 按 iteration 分组渲染。

export default function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const welcomeText = '你好，我是全能型智能助手';
  const [typedWelcome, setTypedWelcome] = useState('');
  // DEBUG: 暴露消息 nodeProgress 给 window，供 DevTools 验证（仅开发环境，上线前可删）
  if (typeof window !== 'undefined') {
    (window as unknown as { __debugMessages?: ChatMessage[] }).__debugMessages = messages;
  }
  const [input, setInput] = useState('');
  const [allSkills, setAllSkills] = useState<SkillCapsule[]>([]);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [skillPickerQuery, setSkillPickerQuery] = useState('');
  const [skillPickerSelectedIndex, setSkillPickerSelectedIndex] = useState(0);
  const [skillPickerHoveredIndex, setSkillPickerHoveredIndex] = useState<number | null>(null);
  const [matchedSkill, setMatchedSkill] = useState<SkillCapsule | null>(null);
  const [showMatchedSkillTooltip, setShowMatchedSkillTooltip] = useState(false);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ModeType>('omni');
  const [preferredCapability, setPreferredCapability] = useState<OmniComposerCapability>('omni');
  const [imageModel, setImageModel] = useState('');
  const [videoModel, setVideoModel] = useState('');
  const [videoParams, setVideoParams] = useState<VideoComposerParams>({ ratio: '16:9', duration: 6, resolution: '768P', audio: true });
  const [videoMode, setVideoMode] = useState<'text_to_video' | 'multi_image_to_video'>('multi_image_to_video');
  const [mentionedArtifactSummaries, setMentionedArtifactSummaries] = useState<ArtifactSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (messages.length > 0 || isLoading) return;
    setTypedWelcome('');
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTypedWelcome(welcomeText.slice(0, index));
      if (index >= welcomeText.length) window.clearInterval(timer);
    }, 72);
    return () => window.clearInterval(timer);
  }, [messages.length, isLoading]);
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  // Why: 节点进度事件累积栈——web_search / chat / web_analyst 等节点 SSE 一条不落追加，
  //   UI 渲染成实时时间线，用户能看到"[Node: WebSearch] 🌐 正在全网搜索..." 与终端一致。
  // Why 拆成「本轮临时状态 + 每条消息绑定字段」：
  //   - 流式回答过程中，onToken / onWebDocs / onNode / onResearchDone 等回调
  //     无法等到"最终消息落位"后再 setState，需要一个中间容器（per-round refs）
  //     快速累积本轮状态；
  //   - 回调结束（onDone/onResearchDone/finally）时，一次性把 refs 中累积的
  //     nodeProgress / webDocs / researchChunks 写到最后一条 assistant 消息的
  //     扩展字段；刷新后这些字段随 SessionSnapshot.messages 整体持久化恢复，
  //     历史多轮对话不再共享同一个全局抽屉。
  const nodeProgressCounter = useRef(0);
  const perRoundNodeEventsRef = useRef<NodeEvent[]>([]);
  const perRoundWebDocsRef = useRef<WebDoc[]>([]);
  const perRoundResearchChunksRef = useRef<ResearchChunk[]>([]);
  const perRoundPlanProgressRef = useRef<PlanProgressEvent | null>(null);
  const perRoundTokenUsageRef = useRef<TokenUsage | null>(null);
  const perRoundMcpTraceRef = useRef<McpTraceItem[]>([]);
  const perRoundCurrentNodeRef = useRef<string | null>(null);
  const perRoundPanelOpenRef = useRef<boolean>(true);
  // Invalidate late SSE frames when a new request or conversation becomes active.
  const activeRequestTokenRef = useRef(0);

  // 消息级的「是否展开过程面板」：用消息 content 哈希作 key，避免多轮复用同一 toggle。
  const [msgPanelOpenKeys, setMsgPanelOpenKeys] = useState<Record<string, boolean>>({});
  const isMsgPanelOpen = useCallback((_msg: ChatMessage, idx: number): boolean => {
    const key = `msg-${idx}`;
    return msgPanelOpenKeys[key] ?? perRoundPanelOpenRef.current ?? true;
  }, [msgPanelOpenKeys]);
  const toggleMsgPanel = useCallback((idx: number) => {
    setMsgPanelOpenKeys((prev) => {
      const key = `msg-${idx}`;
      return { ...prev, [key]: !(prev[key] ?? perRoundPanelOpenRef.current) };
    });
  }, []);

  // Why：将本轮累积的进度 / 搜索结果同步到「最后一条 assistant 消息」。
  //   - streaming 中每隔一段时间同步一次，保证中断/刷新也不丢最近状态；
  //   - 流结束时同步一次作为最终版本。
  const syncRoundStateToLastMessage = useCallback(() => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      let lastAi = -1;
      for (let i = updated.length - 1; i >= 0; i -= 1) {
        if (updated[i].role === 'assistant') { lastAi = i; break; }
      }
      if (lastAi === -1) return prev;
      const msg = { ...updated[lastAi] };
      // Why 非空才覆盖：空数组覆盖会把上一轮恢复的历史结果清空。
      if (perRoundNodeEventsRef.current.length > 0) msg.nodeProgress = perRoundNodeEventsRef.current;
      if (perRoundWebDocsRef.current.length > 0) msg.webDocs = perRoundWebDocsRef.current;
      if (perRoundResearchChunksRef.current.length > 0) msg.researchChunks = perRoundResearchChunksRef.current;
      if (perRoundTokenUsageRef.current) msg.tokenUsage = perRoundTokenUsageRef.current;
      if (perRoundMcpTraceRef.current.length > 0) msg.mcpTrace = perRoundMcpTraceRef.current;
      updated[lastAi] = msg;
      messagesRef.current = updated;
      return updated;
    });
  }, []);

  const handleResearchWebDocs = useCallback((event: { docs: WebDoc[] }) => {
    const docs = event.docs ?? [];
    if (!docs.length) return;
    // Why：research 模式 spread 追加；后端 web_docs 事件可能因模型多轮搜索重复到达，
    //   按 url 去重防 React key 冲突。
    const seen = new Set(perRoundWebDocsRef.current.map((d) => d.url).filter(Boolean));
    const fresh = docs.filter((d) => d.url && !seen.has(d.url));
    if (!fresh.length) return;
    perRoundWebDocsRef.current = [...perRoundWebDocsRef.current, ...fresh];
    perRoundResearchChunksRef.current = mergeResearchSources(
      perRoundResearchChunksRef.current,
      researchChunksFromWebDocs(fresh),
    );
    setWebDocs(perRoundWebDocsRef.current);
    setResearchChunks(perRoundResearchChunksRef.current);
  }, []);

  const handleNodeEvent = useCallback((event: NodeEvent) => {
    // Why（Agent Loop 重构）：原"同名节点 processing→completed 升级 + 同名 completed 合并"逻辑已移除。
    //   Agent Loop 每轮 Think/Search/Observe 都会重复发射同名 completed 节点，循环中重复是正常行为，
    //   不应再合并——前端改为 append-only 累积，由 NodeProgressPanel 按 iteration 分组渲染展示。
    //   旧链路（fanout/fetch/chunk/rerank/reason）走相同路径，无 iteration 字段时面板按"无迭代"分组渲染。
    const nextId = nodeProgressCounter.current + 1;
    nodeProgressCounter.current = nextId;
    perRoundNodeEventsRef.current = [...perRoundNodeEventsRef.current, { ...event, id: nextId }];
    if (event.status === 'completed') {
      perRoundCurrentNodeRef.current = event.node_name;
      setTimeout(() => {
        if (perRoundCurrentNodeRef.current === event.node_name) {
          perRoundCurrentNodeRef.current = null;
        }
      }, 1000);
    } else {
      perRoundCurrentNodeRef.current = event.node_name;
    }
    // 立即同步到最后一条 assistant 消息（已存在的话），保证流式中已有面板能看到
    syncRoundStateToLastMessage();
  }, [syncRoundStateToLastMessage]);

  // Why：流结束时兜底——后端某些路径可能漏发 completed 事件，
  //   导致前端面板中对应节点永久转圈。这里把所有仍在 processing 的节点
  //   强制标记为 completed，确保 UI 不会残留转圈状态。
  const sealOffProcessingNodes = useCallback(() => {
    let changed = false;
    perRoundNodeEventsRef.current = perRoundNodeEventsRef.current.map((e) => {
      if (e.status === 'processing') {
        changed = true;
        return { ...e, status: 'completed' as const };
      }
      return e;
    });
    if (changed) syncRoundStateToLastMessage();
  }, [syncRoundStateToLastMessage]);

  const [reasoningSteps, setReasoningSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Why 保留 setWebDocs / setResearchChunks 仅作旧链路兼容：
  //   真正的每轮状态来源已经切换到 perRoundXxxRef + ChatMessage.xxx 扩展字段，
  //   右抽屉也被移除（下面的 Sidebar + Overlay + Float Button 会删掉）。
  //   这里的 state 仅给 buildSnapshot/readSnapshot 的字段赋值留个"安全兜底"。
  const [webDocs, setWebDocs] = useState<WebDoc[]>([]);
  const [researchChunks, setResearchChunks] = useState<ResearchChunk[]>([]);
  const [researchPaneWidthPx, setResearchPaneWidthPx] = useState<number>();
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
  // Why: MCP 会话级注入三态（off/auto/custom）+ 自定义模式下的服务器多选，
  //   与 webSearch/deepThinking 走完全相同的持久化与 meta 透传链路。
  const [mcpMode, setMcpMode] = useState<McpMode>('auto');
  const [selectedMcpServerIds, setSelectedMcpServerIds] = useState<string[]>([]);
  // Why: Skill 会话级挂载三态（决策 2），与 mcpMode 同一持久化/透传链路；
  //   custom 模式下 selectedSkillIds 为已上架 Skill 的白名单 skill_id。
  const [skillMode, setSkillMode] = useState<McpMode>('auto');
  const [selectedSkillIds, setSelectedSkillIds] = useState<number[]>([]);
  // Why: 会话级 Firecrawl 搜索高级选项，仅 DeepSeek 走 web_search_node 时生效；
  //   持久化到 SessionSnapshot，刷新/重启后恢复。
  const [webSearchOptions, setWebSearchOptions] = useState<WebSearchOptions>(DEFAULT_WEB_SEARCH_OPTIONS);
  // 调研模式引擎切换：firecrawl（Deep Research API）/ self-built（自研 day32+day33）/ qwen（千问原生）
  const [researchEngine, setResearchEngine] = useState<ResearchEngine>('firecrawl');
  const [researchOptions, setResearchOptions] = useState<ResearchOptions>(DEFAULT_RESEARCH_OPTIONS);
  // Why: 千问深度调研的反问确认开关，仅 researchEngine='qwen' 时生效。
  //   默认关闭（enable_feedback=false），直接研究；开启后走两步式流程。
  const [enableFeedback, setEnableFeedback] = useState(false);
  // Why: 千问反问确认交互状态——模型提出澄清问题后暂停，等待用户回答
  const [qwenFeedbackPending, setQwenFeedbackPending] = useState(false);
  const [qwenFeedbackQuestion, setQwenFeedbackQuestion] = useState('');
  const [qwenFeedbackAnswer, setQwenFeedbackAnswer] = useState('');
  const [qwenOriginalQuery, setQwenOriginalQuery] = useState('');
  // Why: 会话级千问原生搜索参数，仅 Qwen 走原生联网时生效；
  //   持久化到 SessionSnapshot，刷新/重启后恢复。
  const [qwenNativeSearchOptions, setQwenNativeSearchOptions] = useState<QwenNativeSearchOptions>(DEFAULT_QWEN_NATIVE_SEARCH_OPTIONS);
  // Why: 本轮对话 MCP 工具调用轨迹，实时在 UI 显示"正在调用 / 调用结果"，
  //   回答完成后保留 5s 再清空，让用户确认"MCP 真的被调用了"。
  const [mcpTrace, setMcpTrace] = useState<McpTraceItem[]>([]);
  const [mcpActive, setMcpActive] = useState(false);
  // Why: 本轮 Skill 匹配命中的手册，回答开始前清空，收到 skill_matched SSE 追加，
  //   让用户在对话区顶部看到"🧠 已加载技能：xxx"，与 MCP trace 同源反馈。
  const [matchedSkills, setMatchedSkills] = useState<SkillMatchedEvent[]>([]);
  const [isRuntimeSettingsOpen, setIsRuntimeSettingsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Why: SPA 全屏视图切换（计划书 §1 D1）——'chat' 正常聊天 / 'marketplace' 市场全屏页。
  const [view, setView] = useState<'chat' | 'marketplace' | 'hooks' | 'code-showcase' | 'writing' | 'image-studio' | 'image-plaza' | 'video-market' | 'video-studio'>('chat');
  const [directoryTab, setDirectoryTab] = useState<'skills' | 'connectors' | 'plugins'>('connectors');
  // Why: SettingsDialog 深链——市场页齿轮点击后打开设置并定位到 directory section + 子页签。
  const [settingsInitialSection, setSettingsInitialSection] = useState<string | null>(null);
  const [settingsInitialSubTab, setSettingsInitialSubTab] = useState<string | null>(null);
  // Why: standard/deep 模式消息列表点击图片缩略图后放大预览。
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [publishVfs, setPublishVfs] = useState<VirtualFileSystem | null>(null);
  const [publishTitle, setPublishTitle] = useState('');
  const [publishCoverImage, setPublishCoverImage] = useState('/code-showcase/covers-contact-sheet.png');
  const [publishCategory, setPublishCategory] = useState<PublishedCodeProject['category']>('web');
  const [isPublishing, setIsPublishing] = useState(false);
  // Why: Code 模式需要感知当前模型是否支持多模态，决定是否开放粘贴/上传图片入口。
  const [currentModelSettings, setCurrentModelSettings] = useState<ModelSettings | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [pptHistory, setPptHistory] = useState<PptHistoryRun[]>([]);
  const [pptHistoryLoading, setPptHistoryLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [artifactPanelState, dispatchArtifactPanel] = useReducer(artifactPanelReducer, { status: 'closed' });
  const [artifactPanelWidth, setArtifactPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return ARTIFACT_PANEL_DEFAULT_WIDTH;
    try {
      const stored = window.localStorage.getItem(ARTIFACT_PANEL_WIDTH_STORAGE_KEY);
      return stored === null ? ARTIFACT_PANEL_DEFAULT_WIDTH : clampArtifactPanelWidth(Number(stored));
    } catch {
      return ARTIFACT_PANEL_DEFAULT_WIDTH;
    }
  });
  const [conversationArtifactLinks, setConversationArtifactLinks] = useState<MessageArtifactLink[]>([]);
  useEffect(() => {
    try {
      window.localStorage.setItem(ARTIFACT_PANEL_WIDTH_STORAGE_KEY, String(artifactPanelWidth));
    } catch {
      // Width persistence is best-effort (private browsing can reject storage).
    }
  }, [artifactPanelWidth]);
  useEffect(() => {
    const normalizedMessages = ensureChatMessageIds(messages, activeSessionId ?? 'draft-session');
    messagesRef.current = normalizedMessages;
    if (normalizedMessages !== messages) setMessages(normalizedMessages);
  }, [activeSessionId, messages]);
  useEffect(() => {
    let cancelled = false;
    // A task poll can outlive the conversation that started it. Clear the
    // per-session finalization guards before loading the next session so an
    // old task can never suppress (or complete) work in the new one.
    videoFinalizingTasksRef.current.clear();
    pptFinalizingRunsRef.current.clear();
    // Do not key this effect by the whole sessions array. Session snapshots are
    // refreshed while a response streams; closing the panel on every refresh
    // made the right-hand work preview visibly flash when a document was opened.
    if (!activeSessionId || activeSessionId === LEGACY_GLOBAL_SESSION_ID) {
      setConversationArtifactLinks([]);
      dispatchArtifactPanel({ type: 'close' });
      return () => { cancelled = true; };
    }
    void listConversationArtifactLinks(activeSessionId)
      .then((response) => { if (!cancelled) setConversationArtifactLinks(response.links); })
      .catch(() => { if (!cancelled) setConversationArtifactLinks([]); });
    return () => { cancelled = true; };
  }, [activeSessionId]);
  const artifactLinksByMessageId = useMemo(() => {
    const grouped = new Map<string, MessageArtifactLink[]>();
    for (const link of conversationArtifactLinks) grouped.set(link.messageId, [...(grouped.get(link.messageId) ?? []), link]);
    return grouped;
  }, [conversationArtifactLinks]);
  const openArtifactPanel = useCallback((artifact: Artifact, version: ArtifactVersion) => {
    dispatchArtifactPanel({ type: 'open', artifactId: artifact.id, versionId: version.id });
  }, []);
  const handleArtifactLoaded = useCallback(() => dispatchArtifactPanel({ type: 'loaded' }), []);
  const handleArtifactClose = useCallback(() => dispatchArtifactPanel({ type: 'close' }), []);
  const handleArtifactDisplayModeChange = useCallback((displayMode: 'split' | 'maximized') => {
    dispatchArtifactPanel({ type: 'setDisplayMode', displayMode });
  }, []);
  const handleArtifactOpenVersion = useCallback((artifact: Artifact, versionId: ArtifactVersion['id']) => {
    dispatchArtifactPanel({ type: 'open', artifactId: artifact.id, versionId });
  }, []);
  const handleArtifactPanelWidthChange = useCallback((width: number) => {
    setArtifactPanelWidth(clampArtifactPanelWidth(width));
  }, []);
  const [selectedResearchMessageIndex, setSelectedResearchMessageIndex] = useState<number | null>(null);
  const [writingSessionRestore, setWritingSessionRestore] = useState<{
    sessionId: string;
    revision: number;
    instruction: string;
    result: string;
    draft?: WritingDraft;
    document?: WritingDocumentState;
    thesisOutline?: ThesisOutlineState;
  } | null>(null);
  const [writingWorkspaceState, setWritingWorkspaceState] = useState<{
    draft: WritingDraft;
    document: WritingDocumentState;
    thesisOutline: ThesisOutlineState;
  } | null>(null);
  const [writingArtifactBridge, setWritingArtifactBridge] = useState<{
    artifact: Artifact;
    version: ArtifactVersion;
    originalContent: string;
  } | null>(null);
  const [imageArtifactBridge, setImageArtifactBridge] = useState<{
    artifact: Artifact;
    version: ArtifactVersion;
    prompt: string;
    referenceImage?: { url: string; name?: string };
  } | null>(null);
  const [videoArtifactBridge, setVideoArtifactBridge] = useState<{
    artifact: Artifact;
    version: ArtifactVersion;
    task: VideoTask;
  } | null>(null);
  const writingRestoreRevisionRef = useRef(0);
  const thesisArtifactMessageIdRef = useRef<string | null>(null);
  const videoFinalizingTasksRef = useRef(new Set<string>());
  const pptFinalizingRunsRef = useRef(new Set<string>());
  // A showcase card opens an unsaved Code workbench draft. It becomes a real
  // conversation only when the user submits the first requirement.
  const [codeWorkbenchDraft, setCodeWorkbenchDraft] = useState(false);
  const [isCodeWorkbenchTransitioning, setIsCodeWorkbenchTransitioning] = useState(false);
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
    agentTrace,
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const pendingAttachmentTypeRef = useRef<ChatAttachment['type']>('image_url');

  const openAttachmentPicker = (type: ChatAttachment['type']) => {
    pendingAttachmentTypeRef.current = type;
    setAttachmentMenuOpen(false);
    attachmentInputRef.current?.click();
  };

  const addLocalAttachment = (file?: File) => {
    if (!file) return;
    const type = pendingAttachmentTypeRef.current;
    const maxSize = type === 'image_url' ? 8 : 20;
    if (file.size > maxSize * 1024 * 1024) { setError(`附件不能超过 ${maxSize}MB`); return; }
    if (type === 'image_url' && !file.type.startsWith('image/')) { setError('请选择图片文件'); return; }
    if (type === 'video_url' && !file.type.startsWith('video/')) { setError('请选择视频文件'); return; }
    if (attachments.some((item) => item.type !== type)) { setError('同一次请求不能混合图片、视频和文件'); return; }
    const reader = new FileReader();
    reader.onload = () => setAttachments((current) => [...current, { type, url: String(reader.result), name: file.name }]);
    reader.onerror = () => setError('读取附件失败');
    reader.readAsDataURL(file);
  };

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

  useEffect(() => {
    const loadSkills = async () => {
      try {
        const res = await getSkills();
        setAllSkills(res.skills.filter(s => s.status === 'published'));
      } catch {
        /* ignore */
      }
    };
    loadSkills();
    const handler = () => loadSkills();
    window.addEventListener('skill-deleted', handler);
    return () => window.removeEventListener('skill-deleted', handler);
  }, []);

  const filteredSkills = useMemo(() => {
    if (!showSkillPicker) return [];
    const query = skillPickerQuery.toLowerCase();
    return allSkills.filter(s => 
      s.skill_name.toLowerCase().includes(query) || 
      (s.description && s.description.toLowerCase().includes(query))
    ).slice(0, 10);
  }, [allSkills, showSkillPicker, skillPickerQuery]);

  useEffect(() => {
    setSkillPickerSelectedIndex(0);
  }, [skillPickerQuery, showSkillPicker]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
  };

  // Why: 用 useEffect 监听 input 变化，统一处理 matchedSkill 检测和斜杠匹配，
  //   避免 insertSkill 直接 setInput 绕过匹配逻辑的问题。
  useEffect(() => {
    const fullMatch = input.match(/\/([a-zA-Z0-9_-]+)(?=\s|$)/g);
    if (fullMatch) {
      const lastMatch = fullMatch[fullMatch.length - 1].slice(1);
      const found = allSkills.find(s => s.skill_name === lastMatch);
      setMatchedSkill(found || null);
    } else {
      setMatchedSkill(null);
    }

    const slashMatch = input.match(/\/([^\s/]*)$/);
    if (slashMatch && !slashMatch[0].match(/\/([a-zA-Z0-9_-]+)\s$/)) {
      setShowSkillPicker(true);
      setSkillPickerQuery(slashMatch[1]);
    } else {
      setShowSkillPicker(false);
    }
  }, [input, allSkills]);

  const insertSkill = (skillName: string) => {
    const newValue = input.replace(/\/([^\s/]*)$/, `/${skillName} `);
    setInput(newValue);
    setShowSkillPicker(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSkillPicker && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSkillPickerSelectedIndex(i => Math.min(i + 1, filteredSkills.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSkillPickerSelectedIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        insertSkill(filteredSkills[skillPickerSelectedIndex].skill_name);
        return;
      }
      if (e.key === 'Escape') {
        setShowSkillPicker(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (input.trim() && !isLoading && isSessionReady) {
        handleSubmit({ preventDefault: () => {} } as React.FormEvent);
      }
    }
  };

  const changeHistoryCollapsed = (collapsed: boolean) => {
    setIsHistoryCollapsed(collapsed);
    localStorage.setItem('historySidebarCollapsed', String(collapsed));
  };

  const buildSnapshot = (snapshotMessages: ChatMessage[] = messages): SessionSnapshot => {
    // 为什么这里单独拼一次 global nodeProgress/webDocs/researchChunks：
    //   - SessionSnapshot 顶层字段是「老会话恢复兼容」所需（applySnapshot 里会把这些字段迁移到最后一条 assistant 消息）；
    //   - 真正的持久化主体是 messages[i].nodeProgress/webDocs/researchChunks（每轮绑定），这里顶层只同步「当前轮」的 refs 作兜底。
    let lastAiMsg: ChatMessage | undefined;
    for (let i = snapshotMessages.length - 1; i >= 0; i -= 1) {
      if (snapshotMessages[i].role === 'assistant') { lastAiMsg = snapshotMessages[i]; break; }
    }
    const globalNodeProgress: NodeEvent[] = perRoundNodeEventsRef.current.length > 0
      ? perRoundNodeEventsRef.current
      : (lastAiMsg?.nodeProgress ?? []);
    const globalWebDocs: WebDoc[] = perRoundWebDocsRef.current.length > 0
      ? perRoundWebDocsRef.current
      : (lastAiMsg?.webDocs ?? webDocs);
    const globalResearchChunks: ResearchChunk[] = perRoundResearchChunksRef.current.length > 0
      ? perRoundResearchChunksRef.current
      : (lastAiMsg?.researchChunks ?? researchChunks);
    return {
      messages: snapshotMessages,
      reasoningSteps,
      webDocs: globalWebDocs,
      researchChunks: globalResearchChunks,
      agentTalks,
      planProgress,
      nodeProgress: globalNodeProgress,
      currentNode,
      discussionLength,
      discussionAgentIds,
      discussionRounds,
      webSearch,
      deepThinking,
      mcpMode,
      mcpServerIds: selectedMcpServerIds,
      skillMode,
      skillIds: selectedSkillIds,
      webSearchOptions,
      researchEngine,
      researchOptions,
      qwenNativeSearchOptions,
      generatedCode,
      codeVersions,
      activeCodeVersionId,
      codeProjectKind,
      codeAgentRuns: agentRuns,
    };
  };

  const persistResearchMessages = (sessionId: string | null | undefined, nextMessages: ChatMessage[]) => {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    if (!sessionId || sessionId === LEGACY_GLOBAL_SESSION_ID) return;
    void saveSessionSnapshot(sessionId, buildSnapshot(nextMessages), false).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : '保存调研来源失败');
    });
  };

  const persistPlanMessages = (sessionId: string | null | undefined, nextMessages: ChatMessage[]) => {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    if (!sessionId || sessionId === LEGACY_GLOBAL_SESSION_ID) return;
    void saveSessionSnapshot(sessionId, buildSnapshot(nextMessages), false).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : '保存自主规划进度失败');
    });
  };

  useEffect(() => {
    if (!activeSessionId || activeSessionId === LEGACY_GLOBAL_SESSION_ID) return undefined;
    let cancelled = false;
    const sessionAtStart = activeSessionId;
    const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
    const poll = async () => {
      const pendingMessages = messagesRef.current.filter((message) => message.id && message.videoTask && !terminal.has(message.videoTask.status));
      for (const pendingMessage of pendingMessages) {
        if (cancelled) return;
        const pendingMessageId = pendingMessage.id;
        if (!pendingMessageId) continue;
        const marker = pendingMessage.videoTask!;
        if (videoFinalizingTasksRef.current.has(marker.taskId)) continue;
        try {
          const task = await getVideoTaskStatus(marker.taskId);
          if (cancelled || sessionAtStart !== activeSessionId) return;
          if (!terminal.has(task.status)) continue;
          const initialLink = conversationArtifactLinks.find((link) => link.messageId === pendingMessageId);
          if (!initialLink) continue;
          videoFinalizingTasksRef.current.add(marker.taskId);
          // The message/link may be stale after a conversation switch. Verify
          // that the artifact's original version belongs to this exact task
          // before appending a terminal version; otherwise an unrelated task
          // can be recorded as a new version of the current work.
          const initialVersion = await getArtifactVersion(initialLink.artifactId, initialLink.versionId);
          if (cancelled || sessionAtStart !== activeSessionId) return;
          if (!matchesVideoArtifactTask(initialVersion.payload, initialVersion.sourceRef, marker.taskId)) {
            continue;
          }
          const completionMessageId = createClientMessageId();
          const mapped = createVideoArtifactInput({ messageId: completionMessageId, task });
          const created = await createArtifactVersion(initialLink.artifactId, {
            conversationId: sessionAtStart,
            // Keep the terminal version on the original assistant message.
            // Otherwise the initial generating link and the terminal link are
            // rendered as two separate cards even though they are one task.
            messageId: pendingMessageId,
            summary: mapped.summary,
            sourceRef: mapped.sourceRef,
            payload: mapped.payload,
            status: mapped.status,
          });
          if (cancelled || sessionAtStart !== activeSessionId) return;
          const normalizedStatus: NonNullable<ChatMessage['videoTask']>['status'] = task.status === 'SUCCEEDED' ? 'SUCCEEDED' : task.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
          const updatedMessages: ChatMessage[] = messagesRef.current.map((message) => message.id === pendingMessage.id
            ? { ...message, content: normalizedStatus === 'SUCCEEDED' ? '视频生成完成。' : '视频生成未成功。', videoTask: { taskId: marker.taskId, status: normalizedStatus } }
            : message);
          updatedMessages.push({
            id: completionMessageId,
            role: 'assistant',
            content: normalizedStatus === 'SUCCEEDED' ? '视频已生成，点击作品卡片即可播放。' : '视频任务失败，可进入视频工作台调整参数后重试。',
          });
          messagesRef.current = updatedMessages;
          setMessages(updatedMessages);
          await saveSessionSnapshot(sessionAtStart, { ...buildSnapshot(), messages: updatedMessages }, false);
          if (cancelled || sessionAtStart !== activeSessionId) return;
          setConversationArtifactLinks((previous) => [...previous, created.link]);
        } catch (cause) {
          setError(cause instanceof Error ? `视频任务状态同步失败：${cause.message}` : '视频任务状态同步失败。');
        } finally {
          videoFinalizingTasksRef.current.delete(marker.taskId);
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // Polling reads the latest message ref and artifact links for refresh recovery.
  }, [activeSessionId, conversationArtifactLinks]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === LEGACY_GLOBAL_SESSION_ID) return undefined;
    const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
    const poll = async () => {
      const pendingMessages = messagesRef.current.filter((message) => message.id && message.pptRun && !terminal.has(message.pptRun.status));
      for (const pendingMessage of pendingMessages) {
        const marker = pendingMessage.pptRun!;
        if (pptFinalizingRunsRef.current.has(marker.runId)) continue;
        try {
          const run = await pptApi.getRun(marker.runId);
          if (!terminal.has(run.status)) continue;
          const initialLink = conversationArtifactLinks.find((link) => link.messageId === pendingMessage.id);
          if (!initialLink) continue;
          pptFinalizingRunsRef.current.add(marker.runId);
          const presentation = await pptApi.getPresentation(marker.presentationId);
          const completionMessageId = createClientMessageId();
          const mapped = createPptArtifactInput({ messageId: completionMessageId, presentation, run });
          const created = await createArtifactVersion(initialLink.artifactId, {
            conversationId: activeSessionId,
            messageId: completionMessageId,
            summary: mapped.summary,
            sourceRef: mapped.sourceRef,
            payload: mapped.payload,
            status: mapped.status,
          });
          const normalizedStatus: NonNullable<ChatMessage['pptRun']>['status'] = run.status === 'COMPLETED' ? 'COMPLETED' : run.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
          const updatedMessages: ChatMessage[] = messagesRef.current.map((message) => message.id === pendingMessage.id
            ? { ...message, content: normalizedStatus === 'COMPLETED' ? 'PPT 生成完成。' : 'PPT 生成未成功。', pptRun: { ...marker, status: normalizedStatus } }
            : message);
          updatedMessages.push({ id: completionMessageId, role: 'assistant', content: normalizedStatus === 'COMPLETED' ? `PPT 已生成，共 ${presentation.document.slides.length} 页。` : 'PPT 任务未完成，可进入 PPT 工作台继续处理。' });
          messagesRef.current = updatedMessages;
          setMessages(updatedMessages);
          await saveSessionSnapshot(activeSessionId, { ...buildSnapshot(), messages: updatedMessages }, false);
          setConversationArtifactLinks((previous) => [...previous, created.link]);
        } catch (cause) {
          setError(cause instanceof Error ? `PPT 运行状态同步失败：${cause.message}` : 'PPT 运行状态同步失败。');
        } finally {
          pptFinalizingRunsRef.current.delete(marker.runId);
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 4000);
    return () => window.clearInterval(timer);
  }, [activeSessionId, conversationArtifactLinks]);

  const resetConversation = () => {
    setMessages([]);
    messagesRef.current = [];
    setSelectedResearchMessageIndex(null);
    setReasoningSteps([]);
    setWebDocs([]);
    setResearchChunks([]);
    setResearchProgress(null);
    setAgentTalks([]);
    setAgentStatus('');
    setPlanProgress(null);
    setSelectedElement(null);
    setCurrentNode(null);
    perRoundNodeEventsRef.current = [];
    perRoundWebDocsRef.current = [];
    perRoundResearchChunksRef.current = [];
    perRoundPlanProgressRef.current = null;
    perRoundTokenUsageRef.current = null;
    perRoundMcpTraceRef.current = [];
    perRoundCurrentNodeRef.current = null;
    perRoundPanelOpenRef.current = true;
    nodeProgressCounter.current = 0;
    activeRequestTokenRef.current += 1;
    setMcpTrace([]);
    setMcpActive(false);
    setMsgPanelOpenKeys({});
    resetCode();
    setCodeVersions([]);
    setActiveCodeVersionId('');
    setCodeProjectKind('frontend');
    setError(null);
  };

  const applySnapshot = (snapshot: Partial<SessionSnapshot>) => {
    const defaults = readRuntimeDefaults();
    // 新格式优先 ChatMessage 扩展字段；老格式全局字段兜底挂到最后一条 assistant
    const rawMessages = snapshot.messages ?? [];
    let normalizedMessages: ChatMessage[] = rawMessages;
    // Why（Agent Loop 重构）：原 dedupeNodeProgress 调用已移除。
    //   Agent Loop 模式下同名节点重复是正常的迭代行为，不应在快照恢复阶段合并去重。
    //   旧快照里若存了 R1 完成时连发的两条 DeepThinker completed，面板会按时间序渲染两条，
    //   前端 NodeProgressPanel 已具备按 iteration 分组与 fallback 渲染能力，可正确显示。
    if (normalizedMessages.length > 0) {
      let lastAi = -1;
      for (let i = rawMessages.length - 1; i >= 0; i -= 1) {
        if (rawMessages[i].role === 'assistant') { lastAi = i; break; }
      }
      if (lastAi !== -1) {
        const last = rawMessages[lastAi];
        if (!last.nodeProgress && snapshot.nodeProgress && snapshot.nodeProgress.length > 0) {
          normalizedMessages = [...rawMessages];
          normalizedMessages[lastAi] = { ...last, nodeProgress: snapshot.nodeProgress };
        }
        const m1 = normalizedMessages[lastAi];
        if (!m1.webDocs && snapshot.webDocs && snapshot.webDocs.length > 0) {
          normalizedMessages = [...normalizedMessages];
          normalizedMessages[lastAi] = { ...m1, webDocs: snapshot.webDocs };
        }
        const m2 = normalizedMessages[lastAi];
        if (!m2.researchChunks && snapshot.researchChunks && snapshot.researchChunks.length > 0) {
          normalizedMessages = [...normalizedMessages];
          normalizedMessages[lastAi] = { ...m2, researchChunks: snapshot.researchChunks };
        }
        const m3 = normalizedMessages[lastAi];
        if (!m3.planProgress && snapshot.planProgress) {
          normalizedMessages = [...normalizedMessages];
          normalizedMessages[lastAi] = { ...m3, planProgress: snapshot.planProgress };
        }
      }
    }
    messagesRef.current = normalizedMessages;
    setMessages(normalizedMessages);
    setSelectedResearchMessageIndex(null);
    setReasoningSteps(snapshot.reasoningSteps ?? []);
    setWebDocs(snapshot.webDocs ?? []);
    setResearchChunks(snapshot.researchChunks ?? []);
    let finalLastAi = -1;
    for (let i = normalizedMessages.length - 1; i >= 0; i -= 1) {
      if (normalizedMessages[i].role === 'assistant') { finalLastAi = i; break; }
    }
    perRoundNodeEventsRef.current = finalLastAi >= 0 ? (normalizedMessages[finalLastAi].nodeProgress ?? []) : [];
    perRoundWebDocsRef.current = finalLastAi >= 0
      ? (normalizedMessages[finalLastAi].webDocs ?? [])
      : (snapshot.webDocs ?? []);
    perRoundResearchChunksRef.current = finalLastAi >= 0
      ? (normalizedMessages[finalLastAi].researchChunks ?? [])
      : (snapshot.researchChunks ?? []);
    perRoundMcpTraceRef.current = finalLastAi >= 0
      ? (normalizedMessages[finalLastAi].mcpTrace ?? [])
      : [];
    perRoundPlanProgressRef.current = finalLastAi >= 0
      ? (normalizedMessages[finalLastAi].planProgress ?? snapshot.planProgress ?? null)
      : (snapshot.planProgress ?? null);
    perRoundCurrentNodeRef.current = snapshot.currentNode ?? null;
    nodeProgressCounter.current = perRoundNodeEventsRef.current.length;
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
    setMcpMode(snapshot.mcpMode ?? defaults.mcpMode);
    setSelectedMcpServerIds(snapshot.mcpServerIds ?? defaults.mcpServerIds);
    setSkillMode(snapshot.skillMode ?? defaults.skillMode);
    setSelectedSkillIds(snapshot.skillIds ?? defaults.skillIds);
    setWebSearchOptions(snapshot.webSearchOptions ?? DEFAULT_WEB_SEARCH_OPTIONS);
    setResearchEngine(snapshot.researchEngine ?? 'firecrawl');
    setResearchOptions(snapshot.researchOptions ?? DEFAULT_RESEARCH_OPTIONS);
    setQwenNativeSearchOptions(snapshot.qwenNativeSearchOptions ?? DEFAULT_QWEN_NATIVE_SEARCH_OPTIONS);
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
    setCurrentNode(snapshot.currentNode ?? null);
    setMsgPanelOpenKeys({});
    setError(null);
    setSelectedElement(null);
    setMcpTrace(perRoundMcpTraceRef.current);
    setMcpActive(false);
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
    activeRequestTokenRef.current += 1;
    perRoundMcpTraceRef.current = [];
    setMcpTrace([]);
    setMcpActive(false);
    try {
      const history = await getSessionHistory(session.session_id);
      const historyMessages = history.snapshot.messages ?? [];
      if (session.mode === 'writing') {
        const lastUserMessage = historyMessages.filter((message) => message.role === 'user').at(-1)?.content ?? '';
        const lastAssistantMessage = historyMessages.filter((message) => message.role === 'assistant').at(-1)?.content ?? '';
        const legacyWritingContent = session.title.trim();
        // 正文生成指令是会话中的后续操作，不应覆盖创建论文时的原始研究主题。
        const legacyInstruction = history.snapshot.writingDraft?.instruction || lastUserMessage || legacyWritingContent.split(/\r?\n/)[0] || '历史 AI 写作';
        const legacyResult = lastAssistantMessage || legacyWritingContent;
        const migratedDraft: WritingDraft | undefined = history.snapshot.writingDraft ?? (
          history.snapshot.writingDocument ? undefined : {
            scene: 'thesis',
            instruction: legacyInstruction,
            valuesByScene: createDefaultWritingValues(),
          }
        );
        const migratedDocument = history.snapshot.writingDocument ?? (
          history.snapshot.writingDraft ? undefined : documentFromV1Result('thesis', legacyResult, legacyInstruction)
        );
        setWritingSessionRestore({
          sessionId: session.session_id,
          revision: writingRestoreRevisionRef.current += 1,
          // Early AI-writing sessions stored their generated content in the
          // session title before structured writing snapshots were introduced.
          instruction: legacyInstruction,
          result: legacyResult,
          draft: migratedDraft,
          document: migratedDocument,
          thesisOutline: history.snapshot.thesisOutline,
        });
        setWritingWorkspaceState(null);
      } else {
        setWritingSessionRestore(null);
      }
      setActiveSessionId(session.session_id);
      setMode(session.mode as ModeType);
      if (session.mode === 'omni') setPreferredCapability('omni');
      setView(session.mode === 'writing' ? 'writing' : 'chat');
      applySnapshot(history.snapshot);
      localStorage.setItem('activeSessionId', session.session_id);
      setIsHistoryOpen(false);
      // Why: UI 快照里的 generatedCode 可能滞后（仅在流结束后持久化）；VFS checkpoint
      //   在每次 patch 成功时写入，是更新的状态源。快照为空时用 checkpoint 冷启动恢复，
      //   否则以 checkpoint 为准覆盖，保证刷新后代码不丢（计划书 T4.1/T4.3）。
      try {
        const restored = await restoreMemoryVfs(session.session_id);
        if (restored.checkpoint_id !== null && Object.keys(restored.vfs).length > 0) {
          const restoredVfs = deepCopyVFS(restored.vfs);
          restoreCode(isFullstackVFS(restoredVfs)
            ? serializeProjectVFS(restoredVfs)
            : bundleVFS(restoredVfs, { injectInspector: false }));
        }
      } catch {
        // checkpoint 恢复失败不阻断会话打开，UI 快照已可用。
      }
    } finally {
      setIsSessionReady(true);
    }
  };

  const startDraftSession = (sessionMode: ModeType = mode) => {
    setView('chat');
    resetConversation();
    setInput('');
    setAttachments([]);
    const defaults = readRuntimeDefaults();
    setDiscussionLength(defaults.responseLength);
    setDiscussionRounds(defaults.discussionRounds);
    setWebSearch(defaults.webSearch);
    setDeepThinking(defaults.deepThinking);
    setMcpMode(defaults.mcpMode);
    setSelectedMcpServerIds(defaults.mcpServerIds);
    setSkillMode(defaults.skillMode);
    setSelectedSkillIds(defaults.skillIds);
    setDiscussionAgentIds([]);
    setMode(sessionMode);
    setCodeWorkbenchDraft(false);
    setActiveSessionId(null);
    setWritingSessionRestore(null);
    setWritingWorkspaceState(null);
    localStorage.removeItem('activeSessionId');
    setIsHistoryOpen(false);
    setIsSessionReady(true);
  };

  const openPublishedCodeProject = async (project?: PublishedCodeProject) => {
    startDraftSession('code');
    setCodeWorkbenchDraft(true);
    if (!project) return;
    try {
      const detail = project.vfs ? project : await getCodeProject(project.project_id);
      const restoredVfs = deepCopyVFS(detail.vfs ?? {});
      if (Object.keys(restoredVfs).length > 0) {
        restoreCode(isFullstackVFS(restoredVfs)
          ? serializeProjectVFS(restoredVfs)
          : bundleVFS(restoredVfs, { injectInspector: false }));
        setCodeProjectKind(detail.project_kind);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '无法打开已发布作品');
    }
  };

  const openWritingWorkspace = async () => {
    await persistCurrentSession();
    localStorage.removeItem('ai-writing-draft-v1');
    localStorage.removeItem('ai-writing-document-v2');
    localStorage.removeItem('ai-writing-submitted-instruction-v1');
    localStorage.removeItem('ai-writing-thesis-outline-v1');
    startDraftSession('writing');
    setView('writing');
  };

  const ensureWritingSession = async (instruction: string) => {
    let sessionId = activeSessionId;
    if (!sessionId || sessionId === LEGACY_GLOBAL_SESSION_ID || mode !== 'writing') {
      const session = await createSession('writing', instruction.slice(0, 36) || 'AI 写作');
      sessionId = session.session_id;
      setActiveSessionId(sessionId);
      setMode('writing');
      setSessions((previous) => [session, ...previous.filter((item) => item.session_id !== session.session_id)]);
      localStorage.setItem('activeSessionId', sessionId);
    }
    return sessionId;
  };

  const submitWritingDraft = async ({ instruction, compiledPrompt }: { instruction: string; compiledPrompt: CompiledWritingPrompt }, onStreamToken: (token: string) => void) => {
    const sessionId = await ensureWritingSession(instruction);
    const request = [compiledPrompt.systemPrompt, ...compiledPrompt.constraints, '', `用户要求：${compiledPrompt.userPrompt}`].join('\n');
    const isRevision = compiledPrompt.constraints.includes('仅返回修改后的正文');
    const writingRuntimeSettings = isRevision ? { ...runtimeSettings, responseLength: 'brief' as const, webSearch: 'off' as const, deepThinking: 'off' as const } : runtimeSettings;
    let answer = '';
    await sendChatMessage(request, 'standard', {
      onToken: (token) => { answer += token; onStreamToken(token); },
      onDone: (event) => { if (event.answer) answer = event.answer; },
      onError: (event) => { throw new Error(event.message); },
    }, { sessionId, runtimeSettings: writingRuntimeSettings });
    const writingMessages: ChatMessage[] = [{ role: 'user', content: instruction }, { role: 'assistant', content: answer }];
    setMessages(writingMessages);
    // Save the completed writing payload directly. The general debounced
    // autosave can otherwise race with navigation and persist stale messages.
    const updated = await saveSessionSnapshot(sessionId, {
      ...buildSnapshot(),
      messages: writingMessages,
    }, true);
    setSessions((previous) => [updated, ...previous.filter((item) => item.session_id !== updated.session_id)]);
    return answer || '写作任务已完成。';
  };

  const submitWritingArtifactRevision = async ({ compiledPrompt }: { instruction: string; compiledPrompt: CompiledWritingPrompt }, onStreamToken: (token: string) => void) => {
    if (!activeSessionId) throw new Error('原会话不存在，无法更新作品。');
    const request = [compiledPrompt.systemPrompt, ...compiledPrompt.constraints, '', `用户要求：${compiledPrompt.userPrompt}`].join('\n');
    let answer = '';
    await sendChatMessage(request, 'standard', {
      onToken: (token) => { answer += token; onStreamToken(token); },
      onDone: (event) => { if (event.answer) answer = event.answer; },
      onError: (event) => { throw new Error(event.message); },
    }, { sessionId: activeSessionId, runtimeSettings });
    return answer || '写作修改已完成。';
  };

  const openWritingArtifactWorkspace = useCallback((artifact: Artifact, version: ArtifactVersion) => {
    if (!activeSessionId) return;
    const payload = version.payload && typeof version.payload === 'object' ? version.payload as Record<string, unknown> : null;
    // Older writing artifacts were stored as `document` even when they came
    // from the thesis workspace. Detect the structured payload itself so the
    // full outline, chapters, references and citations are restored instead of
    // collapsing the work into a one-section markdown draft.
    const thesisPayload = readThesisArtifactPayload(version.payload);
    const content = thesisPayload?.markdown || (typeof payload?.content === 'string' ? payload.content : '');
    if (!content) {
      setError('这个文档版本没有可编辑的正文快照。');
      return;
    }
    const document = thesisPayload?.document ?? documentFromV1Result('general', content, artifact.title);
    if (version.sourceRef.type === 'writing_document') document.documentId = version.sourceRef.documentId;
    document.versionId = version.id;
    const draft: WritingDraft = {
      scene: thesisPayload ? 'thesis' : 'general',
      instruction: artifact.title,
      valuesByScene: createDefaultWritingValues(),
    };
    setWritingArtifactBridge({ artifact, version, originalContent: content });
    setWritingWorkspaceState(null);
    setWritingSessionRestore({
      sessionId: activeSessionId,
      revision: writingRestoreRevisionRef.current += 1,
      instruction: artifact.title,
      result: content,
      draft,
      document,
      thesisOutline: thesisPayload?.outline,
    });
    dispatchArtifactPanel({ type: 'close' });
    setView('writing');
  }, [activeSessionId]);

  const openPptArtifactWorkspace = useCallback((version: ArtifactVersion) => {
    const payload = readPptArtifactPayload(version.payload);
    if (!payload) {
      setError('这个 PPT 版本没有可恢复的演示文稿快照。');
      return;
    }
    const presentationId = encodeURIComponent(payload.presentation.presentationId);
    const runId = encodeURIComponent(payload.run.runId);
    window.location.assign(`/ppt/workspace/${presentationId}?source=artifact&runId=${runId}&resume=1`);
  }, []);

  const closeWritingArtifactWorkspace = async () => {
    const bridge = writingArtifactBridge;
    const workspace = writingWorkspaceState;
    setView('chat');
    setWritingArtifactBridge(null);
    setWritingSessionRestore(null);
    localStorage.removeItem('ai-writing-draft-v1');
    localStorage.removeItem('ai-writing-document-v2');
    localStorage.removeItem('ai-writing-submitted-instruction-v1');
    if (!bridge || !workspace || !activeSessionId || activeSessionId === LEGACY_GLOBAL_SESSION_ID) return;
    const content = writingDocumentToMarkdown(workspace.document);
    if (!content.trim() || content.trim() === bridge.originalContent.trim()) return;
    const messageId = createClientMessageId();
    try {
      const thesisMapped = (bridge.artifact.kind === 'thesis' || Boolean(readThesisArtifactPayload(bridge.version.payload)))
        ? createThesisArtifactInput({ messageId, document: workspace.document, outline: workspace.thesisOutline })
        : null;
      const created = await createArtifactVersion(bridge.artifact.id, {
        conversationId: activeSessionId,
        messageId,
        summary: thesisMapped?.summary ?? content.replace(/\s+/g, ' ').trim().slice(0, 240),
        sourceRef: {
          type: 'writing_document',
          documentId: bridge.version.sourceRef.type === 'writing_document'
            ? bridge.version.sourceRef.documentId
            : workspace.document.documentId,
          revision: bridge.version.versionNumber + 1,
        },
        payload: thesisMapped?.payload ?? { format: 'markdown', content },
      });
      const nextMessages: ChatMessage[] = [...messagesRef.current, {
        id: messageId,
        role: 'assistant',
        content: `已在写作工作台更新《${bridge.artifact.title}》，生成版本 ${created.version.versionNumber}。`,
      }];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      await saveSessionSnapshot(activeSessionId, { ...buildSnapshot(), messages: nextMessages }, false);
      setConversationArtifactLinks((previous) => [...previous, created.link]);
    } catch (cause) {
      setError(cause instanceof Error ? `文档修改未能保存为新版本：${cause.message}` : '文档修改未能保存为新版本。');
    }
  };

  const handleThesisBodyRequest = async ({ phase, title, document, outline }: { phase: 'start' | 'complete' | 'failed'; title: string; document: WritingDocumentState; outline: ThesisOutlineState }) => {
    const instruction = '我要基于大纲生成正文';
    const sessionId = await ensureWritingSession(instruction);
    const previous = messagesRef.current;
    if (phase === 'start') thesisArtifactMessageIdRef.current = createClientMessageId();
    const artifactMessageId = thesisArtifactMessageIdRef.current ?? createClientMessageId();
    const nextMessages: ChatMessage[] = phase === 'start'
      ? [
          ...previous,
          { id: createClientMessageId(), role: 'user' as const, content: instruction },
          { id: artifactMessageId, role: 'assistant' as const, content: '正文生成中，请稍候…', writingArtifact: { type: 'word' as const, title, status: 'generating' as const } },
        ]
      : previous.map((message, index, all) => index === all.map((item) => item.role).lastIndexOf('assistant')
        ? { ...message, content: phase === 'complete' ? '正文已生成，可在右侧文档工作台继续编辑。' : '正文生成失败，请稍后重试。', writingArtifact: { type: 'word' as const, title, status: phase } }
        : message);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    // Persist the conversation event immediately; the writing workspace's
    // structured snapshot is saved separately by its existing autosave.
    await saveSessionSnapshot(sessionId, { ...buildSnapshot(), messages: nextMessages }, false);
    if (phase === 'complete') {
      try {
        const created = await createConversationArtifact(
          sessionId,
          createThesisArtifactInput({ messageId: artifactMessageId, document, outline }),
        );
        setConversationArtifactLinks((current) => [...current, created.link]);
      } catch (cause) {
        setError(cause instanceof Error ? `论文已生成，但保存为作品失败：${cause.message}` : '论文已生成，但保存为作品失败。');
      } finally {
        thesisArtifactMessageIdRef.current = null;
      }
    } else if (phase === 'failed') {
      thesisArtifactMessageIdRef.current = null;
    }
  };

  const enterCodeWorkbench = async (project?: PublishedCodeProject) => {
    setIsCodeWorkbenchTransitioning(true);
    await new Promise((resolve) => window.setTimeout(resolve, 360));
    await openPublishedCodeProject(project);
    setIsCodeWorkbenchTransitioning(false);
  };

  const persistCurrentSession = async () => {
    if (!activeSessionId || activeSessionId === LEGACY_GLOBAL_SESSION_ID || !isSessionReady) return;
    // AI writing persists atomically when generation completes. Its workspace
    // owns richer local document state. Flush that structured state explicitly
    // before switching sessions; otherwise a pending 500ms autosave can leave
    // the latest chapter search status out of the server snapshot.
    if (mode === 'writing') {
      if (!writingWorkspaceState) return;
      const updated = await saveSessionSnapshot(activeSessionId, {
        ...buildSnapshot(),
        writingDraft: writingWorkspaceState.draft,
        writingDocument: writingWorkspaceState.document,
        thesisOutline: writingWorkspaceState.thesisOutline,
      }, false);
      setSessions((previous) => [
        updated,
        ...previous.filter((item) => item.session_id !== updated.session_id),
      ]);
      return;
    }
    const snapshotMessages = messages.length > 0 ? messages : messagesRef.current;
    // Never let a stale render overwrite a completed research session with an
    // empty message array while switching sessions or hydrating history.
    if (mode === 'research' && snapshotMessages.length === 0) return;
    // Client-side figure placeholders are not durable task state. Saving them
    // during hydration can race the real job response and overwrite succeeded
    // images with queued placeholders.
    if (mode === 'research' && containsOnlyPendingResearchFigures(snapshotMessages)) return;
    const shouldGenerateTitle =
      snapshotMessages.some((message) => message.role === 'user') &&
      !titleRequestedRef.current.has(activeSessionId);
    if (shouldGenerateTitle) titleRequestedRef.current.add(activeSessionId);
    const updated = await saveSessionSnapshot(
      activeSessionId,
      buildSnapshot(snapshotMessages),
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
        const availableSessions = response.sessions.filter((session) => session.session_id !== LEGACY_GLOBAL_SESSION_ID);
        setSessions(availableSessions);
        const sharedId = new URLSearchParams(window.location.search).get('session');
        const rememberedId = sharedId || localStorage.getItem('activeSessionId');
        const initial =
          availableSessions.find((item) => item.session_id === rememberedId) ??
          availableSessions[0];
        if (initial) {
          await openSession(initial);
        } else {
          startDraftSession('omni');
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
    if (!activeSessionId || activeSessionId === LEGACY_GLOBAL_SESSION_ID || !isSessionReady) return;
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
    currentNode,
    discussionLength,
    discussionAgentIds,
    discussionRounds,
    webSearch,
    deepThinking,
    mcpMode,
    selectedMcpServerIds,
    generatedCode,
    codeVersions,
    activeCodeVersionId,
    codeProjectKind,
    agentRuns,
  ]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === LEGACY_GLOBAL_SESSION_ID || mode !== 'writing' || !writingWorkspaceState) return;
    const timeout = window.setTimeout(() => {
      void saveSessionSnapshot(activeSessionId, {
        ...buildSnapshot(),
        writingDraft: writingWorkspaceState.draft,
        writingDocument: writingWorkspaceState.document,
        thesisOutline: writingWorkspaceState.thesisOutline,
      }, false);
    }, 500);
    return () => window.clearTimeout(timeout);
    // Structured writing state is the intentional persistence trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, mode, writingWorkspaceState]);

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
    mcpMode,
    mcpServerIds: selectedMcpServerIds,
    skillMode,
    skillIds: selectedSkillIds,
    webSearchOptions,
    qwenNativeSearchOptions,
  }), [discussionLength, webSearch, deepThinking, discussionRounds, mcpMode, selectedMcpServerIds, skillMode, selectedSkillIds, webSearchOptions, qwenNativeSearchOptions]);

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

  const changeMcpMode = (value: McpMode) => {
    setMcpMode(value);
    updateRuntimeDefaults({ mcpMode: value });
  };

  const changeSelectedMcpServerIds = (value: string[]) => {
    setSelectedMcpServerIds(value);
    updateRuntimeDefaults({ mcpServerIds: value });
  };

  const changeSkillMode = (value: McpMode) => {
    setSkillMode(value);
    updateRuntimeDefaults({ skillMode: value });
  };

  const changeSelectedSkillIds = (value: number[]) => {
    setSelectedSkillIds(value);
    updateRuntimeDefaults({ skillIds: value });
  };

  // Why: openDirectory 语义从"开弹窗"改为"切视图"（计划书 §1）。
  //   侧边栏入口、设置页 Browse 按钮、运行设置抽屉入口统一走它。
  const openDirectory = useCallback((tab?: 'skills' | 'connectors' | 'plugins') => {
    if (tab) setDirectoryTab(tab);
    setView('marketplace');
  }, []);
  const closeDirectory = useCallback(() => setView('chat'), []);
  const openHooks = useCallback(() => setView('hooks'), []);
  const closeHooks = useCallback(() => setView('chat'), []);
  const openImageWorkspace = useCallback((draftPrompt = '') => {
    setImageArtifactBridge(null);
    setInput(draftPrompt);
    setView('image-studio');
  }, []);

  const openImageArtifactWorkspace = useCallback((artifact: Artifact, version: ArtifactVersion) => {
    const payload = readImageArtifactPayload(version.payload);
    if (!payload) {
      setError('这个图片版本没有可继续编辑的批次数据。');
      return;
    }
    setImageArtifactBridge({
      artifact,
      version,
      prompt: payload.prompt,
      referenceImage: payload.images[0]
        ? { url: payload.images[0].url, name: `${artifact.title} · 版本 ${version.versionNumber}` }
        : undefined,
    });
    dispatchArtifactPanel({ type: 'close' });
    setView('image-studio');
  }, []);

  const handleImageArtifactBatch = async (batch: ImageBatch) => {
    if (!imageArtifactBridge || !activeSessionId || activeSessionId === LEGACY_GLOBAL_SESSION_ID) return;
    const messageId = createClientMessageId();
    try {
      const mapped = createImageArtifactInput({ messageId, batch });
      const created = await createArtifactVersion(imageArtifactBridge.artifact.id, {
        conversationId: activeSessionId,
        messageId,
        summary: mapped.summary,
        sourceRef: mapped.sourceRef,
        payload: mapped.payload,
      });
      const nextMessages: ChatMessage[] = [...messagesRef.current, {
        id: messageId,
        role: 'assistant',
        content: `已在生图工作台为《${imageArtifactBridge.artifact.title}》生成版本 ${created.version.versionNumber}，包含 ${batch.images.length} 张候选图片。`,
      }];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      await saveSessionSnapshot(activeSessionId, { ...buildSnapshot(), messages: nextMessages }, false);
      setConversationArtifactLinks((previous) => [...previous, created.link]);
      setImageArtifactBridge((current) => current ? { ...current, version: created.version, prompt: batch.raw_prompt } : current);
    } catch (cause) {
      setError(cause instanceof Error ? `图片批次未能保存为新版本：${cause.message}` : '图片批次未能保存为新版本。');
    }
  };

  useEffect(() => {
    let cancelled = false;
    setPptHistoryLoading(true);
    void pptApi.listHistoryRuns()
      .then((response) => {
        if (!cancelled) setPptHistory(response.runs);
      })
      .catch(() => {
        // The PPT history section remains usable when an older backend is
        // still running; it will populate after the process is upgraded.
        if (!cancelled) setPptHistory([]);
      })
      .finally(() => {
        if (!cancelled) setPptHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, []);
  const openImagePlaza = useCallback((draftPrompt = '') => {
    setInput(draftPrompt);
    setView('image-plaza');
  }, []);
  const openVideoWorkspace = useCallback((draftPrompt = '') => {
    setVideoArtifactBridge(null);
    setInput(draftPrompt);
    setView('video-studio');
  }, []);
  const openVideoArtifactWorkspace = useCallback((artifact: Artifact, version: ArtifactVersion) => {
    const payload = readVideoArtifactPayload(version.payload);
    if (!payload) {
      setError('这个视频版本没有可恢复的任务数据。');
      return;
    }
    setVideoArtifactBridge({ artifact, version, task: payload.task });
    dispatchArtifactPanel({ type: 'close' });
    setView('video-studio');
  }, []);

  const handleVideoArtifactTask = async (task: VideoTask) => {
    if (!videoArtifactBridge || !activeSessionId || activeSessionId === LEGACY_GLOBAL_SESSION_ID) return;
    const messageId = createClientMessageId();
    const mapped = createVideoArtifactInput({ messageId, task });
    try {
      const created = await createArtifactVersion(videoArtifactBridge.artifact.id, {
        conversationId: activeSessionId,
        messageId,
        summary: mapped.summary,
        sourceRef: mapped.sourceRef,
        payload: mapped.payload,
        status: mapped.status,
      });
      const nextMessages: ChatMessage[] = [...messagesRef.current, { id: messageId, role: 'assistant', content: `已在视频工作台生成版本 ${created.version.versionNumber}，点击作品卡片即可播放。` }];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      await saveSessionSnapshot(activeSessionId, { ...buildSnapshot(), messages: nextMessages }, false);
      setConversationArtifactLinks((previous) => [...previous, created.link]);
      setVideoArtifactBridge((current) => current ? { ...current, version: created.version, task } : current);
    } catch (cause) {
      setError(cause instanceof Error ? `视频结果未能保存为新版本：${cause.message}` : '视频结果未能保存为新版本。');
    }
  };
  const openVideoMarket = useCallback((draftPrompt = '') => {
    setInput(draftPrompt);
    setView('video-market');
  }, []);
  const openVisualWorkflow = useCallback(() => {
    window.location.assign('/visual-workflow');
  }, []);
  const openPptMarket = useCallback(() => {
    window.location.assign('/ppt');
  }, []);
  const openPptWorkspace = useCallback(() => {
    const sessionId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
    window.location.assign(`/ppt/workspace/new?source=sidebar&session=${sessionId}`);
  }, []);
  const openPptHistory = useCallback((run: PptHistoryRun) => {
    window.location.assign(`/ppt/workspace/${encodeURIComponent(run.presentationId)}?source=history&runId=${encodeURIComponent(run.runId)}&resume=1`);
  }, []);

  // Why: Create with agent（计划书 §3.1 D4）——关市场→新建会话→输入框预填随机提示词（不发送）。
  const handleCreateWithAgent = useCallback(async (prompt: string) => {
    setView('chat');
    if (isLoading) return;
    try {
      await persistCurrentSession();
      startDraftSession('omni');
    } catch {
      // 创建失败不阻塞预填
    }
    setInput(prompt);
    // 异步聚焦——等 setInput 渲染完后聚焦输入框
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [isLoading, mode]);

  // Why: 市场页齿轮 → 打开 SettingsDialog 并定位到 directory section + 子页签（计划书 §5 深链）。
  const handleOpenSettingsFromDirectory = useCallback(
    (section: 'directory', subTab?: 'skills' | 'connectors' | 'plugins') => {
      setSettingsInitialSection(section);
      if (subTab) setSettingsInitialSubTab(subTab);
      setIsSettingsOpen(true);
    },
    [],
  );

  const resetRuntimeSettings = () => {
    setDiscussionLength(DEFAULT_RUNTIME_SETTINGS.responseLength);
    setWebSearch(DEFAULT_RUNTIME_SETTINGS.webSearch);
    setDeepThinking(DEFAULT_RUNTIME_SETTINGS.deepThinking);
    setDiscussionRounds(DEFAULT_RUNTIME_SETTINGS.discussionRounds);
    setMcpMode(DEFAULT_RUNTIME_SETTINGS.mcpMode);
    setSelectedMcpServerIds(DEFAULT_RUNTIME_SETTINGS.mcpServerIds);
    setSkillMode(DEFAULT_RUNTIME_SETTINGS.skillMode);
    setSelectedSkillIds(DEFAULT_RUNTIME_SETTINGS.skillIds);
    setWebSearchOptions(DEFAULT_WEB_SEARCH_OPTIONS);
    setResearchEngine('firecrawl');
    setResearchOptions({ ...DEFAULT_RESEARCH_OPTIONS });
    setQwenNativeSearchOptions(DEFAULT_QWEN_NATIVE_SEARCH_OPTIONS);
    setDiscussionAgentIds([]);
    localStorage.setItem(
      'runtimeSettingsDefaults',
      JSON.stringify(DEFAULT_RUNTIME_SETTINGS),
    );
  };

  // Why: 千问深度调研 Step 2——用户回答反问后，携带 feedback_question + feedback_answer 发起新请求继续研究
  const submitQwenFeedback = useCallback(async (msgIndex: number, answer: string) => {
    if (!answer.trim() || isLoading) return;

    // 找到对应的 feedback 消息
    const feedbackMsg = messages[msgIndex];
    if (!feedbackMsg || feedbackMsg.type !== 'qwen_feedback') return;

    const question = feedbackMsg.feedbackQuestion ?? '';
    const originalQuery = messages[msgIndex - 1]?.content ?? '';  // 用户原始问题

    // 同一原子更新中标记反问已回答并追加用户回答，供随后流式回调可靠读取。
    // 通过统一持久化入口立即保存，避免刷新/切换会话时反问卡片消失。
    const currentMessages = messagesRef.current;
    const updated = [...currentMessages];
    updated[msgIndex] = { ...updated[msgIndex], feedbackAnswer: answer };
    const nextMessages = [...updated, { role: 'user' as const, content: answer }];
    persistResearchMessages(activeSessionId, nextMessages);

    setIsLoading(true);
    setError(null);
    perRoundNodeEventsRef.current = [];
    perRoundWebDocsRef.current = [];
    perRoundResearchChunksRef.current = [];
    perRoundTokenUsageRef.current = null;
    perRoundCurrentNodeRef.current = null;
    perRoundPanelOpenRef.current = true;
    nodeProgressCounter.current = 0;
    setMsgPanelOpenKeys({});
    setReasoningSteps([]);
    setWebDocs([]);
    setResearchChunks([]);
    setResearchProgress(null);
    setAgentTalks([]);
    setAgentStatus('');
    setPlanProgress(null);

    try {
      await sendDeepResearch(originalQuery, {
        onNode: handleNodeEvent,
        onUsage: (usage) => {
          perRoundTokenUsageRef.current = usage;
          syncRoundStateToLastMessage();
        },
        onResearchProcess: (event) => {
          setResearchProgress(event);
        },
        onWebDocs: handleResearchWebDocs,
        onResearchDone: (event) => {
          setResearchProgress(null);
          perRoundResearchChunksRef.current = mergeResearchSources(perRoundResearchChunksRef.current, (event.top_chunks as ResearchChunk[]) ?? []);
          setResearchChunks(perRoundResearchChunksRef.current);
          persistResearchMessages(activeSessionId, [
            ...messagesRef.current,
            {
              role: 'assistant',
              content: event.report || '✅ 深度调研完成！',
              nodeProgress: perRoundNodeEventsRef.current.length > 0 ? perRoundNodeEventsRef.current : undefined,
              webDocs: perRoundWebDocsRef.current.length > 0 ? perRoundWebDocsRef.current : undefined,
              researchChunks: perRoundResearchChunksRef.current.length > 0 ? perRoundResearchChunksRef.current : undefined,
            },
          ]);
        },
        onResearchReasonDone: (event) => {
            const updated = [...messagesRef.current];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = {
                ...last,
                content: event.report,
                reasoning: event.reasoning,
                reasoning_time: event.reasoning_time,
                nodeProgress: perRoundNodeEventsRef.current.length > 0 ? perRoundNodeEventsRef.current : last.nodeProgress,
                webDocs: perRoundWebDocsRef.current.length > 0 ? perRoundWebDocsRef.current : last.webDocs,
                researchChunks: perRoundResearchChunksRef.current.length > 0 ? perRoundResearchChunksRef.current : last.researchChunks,
              };
            }
            persistResearchMessages(activeSessionId, updated);
        },
        onError: (event) => {
          setError(event.message);
        },
      }, activeSessionId ?? undefined, runtimeSettings, researchEngine, {
        ...researchOptions,
        enable_feedback: true,
        feedback_question: question,
        feedback_answer: answer,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败');
    } finally {
      setIsLoading(false);
      sealOffProcessingNodes();
    }
  // The research persistence helper intentionally snapshots the latest render state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isLoading, handleNodeEvent, handleResearchWebDocs, sealOffProcessingNodes, activeSessionId, runtimeSettings, researchEngine, researchOptions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !isSessionReady) return;

    const userMessage = input.trim();
    const requestAttachments = attachments;
    const userMessageId = createClientMessageId();
    const assistantMessageId = createClientMessageId();
    // Freeze all per-turn intent before any awaited session creation or streaming work.
    // Toolbar changes made while this request runs therefore apply only to the next turn.
    let omniTurnContext = createOmniTurnContext({
      preferredCapability,
      runtimeSettings,
      attachments: requestAttachments,
      artifactPanelState,
      mentionedArtifacts: mentionedArtifactSummaries,
    });
    if (mode === 'research') setSelectedResearchMessageIndex(null);
    // Why: 新一轮发送前强制上屏上一轮 pacing 残留，避免旧答案继续展开干扰新轮。
    answerPacing.flush();
    reasoningPacing.flush();
    setIsLoading(true);
    setError(null);
    setMcpTrace([]);
    setMcpActive(false);
    perRoundMcpTraceRef.current = [];
    const requestToken = ++activeRequestTokenRef.current;
    // Why: 每轮发送前清空上一轮的 Skill 命中提示，避免与新一轮匹配结果混淆。
    setMatchedSkills([]);
    let requestSessionId = activeSessionId;

    if (!requestSessionId || requestSessionId === LEGACY_GLOBAL_SESSION_ID) {
      try {
        const session = await createSession(mode);
        requestSessionId = session.session_id;
        setCodeWorkbenchDraft(false);
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

    try {
      const context = await getConversationOmniContext(requestSessionId, userMessage);
      omniTurnContext = createOmniTurnContext({
        preferredCapability,
        runtimeSettings,
        attachments: requestAttachments,
        artifactPanelState,
        mentionedArtifacts: mentionedArtifactSummaries,
        projectSummary: context.projectSummary ?? undefined,
        candidateArtifactSummaries: context.candidateArtifactSummaries,
      });
    } catch {
      // Context retrieval is additive; chat remains available if the index is temporarily unavailable.
    }

    const references = [
      ...mentionedArtifactSummaries,
      ...(omniTurnContext.activeArtifact && !mentionedArtifactSummaries.some((item) => item.artifactId === omniTurnContext.activeArtifact?.artifactId)
        ? [{ artifactId: omniTurnContext.activeArtifact.artifactId, versionId: omniTurnContext.activeArtifact.versionId }]
        : []),
    ];
    if (references.length > 0) {
      const settled = await Promise.allSettled(references.map((item, index) => referenceConversationArtifact(requestSessionId!, {
        messageId: userMessageId,
        artifactId: item.artifactId,
        versionId: item.versionId,
        displayOrder: index,
      })));
      const links = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value.link] : []);
      if (links.length > 0) setConversationArtifactLinks((previous) => [...previous, ...links]);
    }

    setInput('');
    setAttachments([]);
    setMentionedArtifactSummaries([]);
    // Why: Day57 @file 提交后清空提及状态,与 input/attachments 同生命周期。
    setMentionedFiles([]);
    setCurrentNode(null);
    // 清空本轮累积 refs，保证多轮对话/重写消息时上一轮状态不泄漏
    perRoundNodeEventsRef.current = [];
    perRoundWebDocsRef.current = [];
    perRoundResearchChunksRef.current = [];
    perRoundTokenUsageRef.current = null;
    perRoundCurrentNodeRef.current = null;
    perRoundPanelOpenRef.current = true;
    nodeProgressCounter.current = 0;
    setMsgPanelOpenKeys({});
    setReasoningSteps([]);
    setWebDocs([]);
    setResearchChunks([]);
    setResearchProgress(null);
    setAgentTalks([]);
    setAgentStatus('');
    setPlanProgress(null);

    setMessages((prev) => {
      // Why: 重写历史消息时，先截断到 rewritingIndex（该条及其后的记录全部清除），
      // 再追加新的用户消息，实现 ChatGPT 式"编辑并重发"。
      const base = rewritingIndex != null ? prev.slice(0, rewritingIndex) : prev;
      const next = [...base, {
        id: userMessageId,
        role: 'user' as const,
        content: userMessage,
        // Why: Code 模式历史消息回显图片缩略图；standard/deep 模式消息列表也支持展示附件。
        attachments: requestAttachments.length ? requestAttachments : undefined,
      }];
      messagesRef.current = next;
      return next;
    });
    // 截断后重写索引失效，下一轮提交按普通发送处理
    setRewritingIndex(null);

    if (preferredCapability === 'ppt' && capabilityUsesTaskRoute(preferredCapability, mode)) {
      try {
        const presentation = await pptApi.createPresentation({ title: userMessage.slice(0, 80) || '未命名演示' });
        const run = await pptApi.createRun({
          presentationId: presentation.presentationId,
          prompt: userMessage,
          modelProvider: 'deepseek',
          searchProvider: 'auto',
          searchLimit: 20,
        });
        const mapped = createPptArtifactInput({ messageId: assistantMessageId, presentation, run });
        const created = await createConversationArtifact(requestSessionId, mapped);
        const runStatus: NonNullable<ChatMessage['pptRun']>['status'] = run.status;
        const assistantMessage: ChatMessage = {
          id: assistantMessageId,
          role: 'assistant',
          content: `PPT 任务已启动，当前阶段：${run.phase}。刷新页面后仍会继续同步。`,
          pptRun: { runId: run.runId, presentationId: presentation.presentationId, status: runStatus },
        };
        const nextMessages = [...messagesRef.current, assistantMessage];
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        const updated = await saveSessionSnapshot(requestSessionId, { ...buildSnapshot(), messages: nextMessages }, false);
        setSessions((previous) => [updated, ...previous.filter((item) => item.session_id !== updated.session_id)]);
        setConversationArtifactLinks((previous) => [...previous, created.link]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'PPT 任务提交失败。');
      } finally {
        setIsLoading(false);
      }
    } else if (preferredCapability === 'video' && capabilityUsesTaskRoute(preferredCapability, mode)) {
      try {
        const models = await getVideoModels();
        const selected = models.find((item) => item.id === videoModel && item.enabled && item.modes.includes(videoMode))
          ?? models.find((item) => item.enabled && item.modes.includes(videoMode));
        if (!selected) throw new Error('当前没有可用的文生视频模型。');
        const ratio = selected.ratios.includes(videoParams.ratio) ? videoParams.ratio : selected.ratios[0] ?? '16:9';
        const resolution = selected.resolutions.includes(videoParams.resolution) ? videoParams.resolution : selected.resolutions[0] ?? '720P';
        const duration = selected.durations.includes(videoParams.duration) ? videoParams.duration : selected.durations[0] ?? selected.duration_min;
        const referenceImages = attachments.filter((item) => item.type === 'image_url').map((item) => ({ url: item.url, mediaKind: 'reference_image' as const }));
        const taskMode = videoMode === 'multi_image_to_video' && referenceImages.length > 0 ? 'multi_image_to_video' : 'text_to_video';
        const task = await createVideoTask({
          mode: taskMode,
          prompt: userMessage,
          model: selected.id,
          ratio,
          duration,
          resolution,
          prompt_extend: true,
          audio: selected.supports_audio ? videoParams.audio : null,
          references: taskMode === 'multi_image_to_video' ? referenceImages : undefined,
        });
        const mapped = createVideoArtifactInput({ messageId: assistantMessageId, task });
        const created = await createConversationArtifact(requestSessionId, mapped);
        const pendingStatus = task.status === 'RUNNING' ? 'RUNNING' as const : 'PENDING' as const;
        const assistantMessage: ChatMessage = {
          id: assistantMessageId,
          role: 'assistant',
          content: `视频任务已提交，当前进度 ${task.progress}%。任务会在后台继续，刷新页面也不会丢失。`,
          videoTask: { taskId: task.id, status: pendingStatus },
        };
        const nextMessages = [...messagesRef.current, assistantMessage];
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        const updated = await saveSessionSnapshot(requestSessionId, { ...buildSnapshot(), messages: nextMessages }, false);
        setSessions((previous) => [updated, ...previous.filter((item) => item.session_id !== updated.session_id)]);
        setConversationArtifactLinks((previous) => [...previous, created.link]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '视频任务提交失败。');
      } finally {
        setIsLoading(false);
      }
    } else if (preferredCapability === 'image' && capabilityUsesTaskRoute(preferredCapability, mode)) {
      try {
        const batch = await createImageGeneration({
          raw_prompt: userMessage,
          count: 4,
          model_mode: imageModel ? 'manual' : 'auto',
          model: imageModel || null,
          enhance: true,
        });
        if (!batch.images.length) throw new Error('图片服务没有返回可用图片。');
        const created = await createConversationArtifact(
          requestSessionId,
          createImageArtifactInput({ messageId: assistantMessageId, batch }),
        );
        const assistantMessage: ChatMessage = {
          id: assistantMessageId,
          role: 'assistant',
          content: `已生成 ${batch.images.length} 张候选图片。点击作品卡片可查看本次完整批次。`,
        };
        const nextMessages = [...messagesRef.current, assistantMessage];
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        const updated = await saveSessionSnapshot(requestSessionId, { ...buildSnapshot(), messages: nextMessages }, false);
        setSessions((previous) => [updated, ...previous.filter((item) => item.session_id !== updated.session_id)]);
        setConversationArtifactLinks((previous) => [...previous, created.link]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '图片生成失败。');
      } finally {
        setIsLoading(false);
      }
    } else if (mode === 'code') {
      const isIncrementalChange = Boolean(generatedCode.trim());
      const targetElement = selectedElement;
      // Why: MCP 会话级注入——与 webSearch/deepThinking 同链路，随 code 请求 meta 透传后端。
      const mcpContext = { mode: mcpMode, serverIds: selectedMcpServerIds };
      try {
        const didComplete = isIncrementalChange
          ? await modifyCode(userMessage, targetElement, requestAttachments, mentionedFiles, requestSessionId, mcpContext)
          : await generateCode(userMessage, codeProjectKind, requestAttachments, requestSessionId, mcpContext);
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
        sealOffProcessingNodes();
      }
    } else if (mode === 'research' || preferredCapability === 'research') {
      // 深度调研模式
      try {
        await sendDeepResearch(userMessage, {
          onNode: handleNodeEvent,
          onUsage: (usage) => {
            perRoundTokenUsageRef.current = usage;
            syncRoundStateToLastMessage();
          },
          onResearchProcess: (event) => {
            setResearchProgress(event);
          },
          // Why: 千问原生调研后端已逐 chunk 推 token（answer 阶段），此前前端丢弃；
          //   现接入 pacing 实现报告真流式打字机。
          onToken: (token) => {
            answerPacing.push(token);
          },
          onWebDocs: handleResearchWebDocs,
          onResearchDone: (event) => {
            setResearchProgress(null);
            // Why: 仅整块引擎（firecrawl/agent-loop/self-built）的 done 携带 report，走 commit 伪打字机；
            //   千问引擎 done 无 report（占位文案），总量已由 onToken push 累积，不能 commit 回卷。
            if (event.report) answerPacing.commit(event.report);
            // 1. 写入本轮 per-round ref（会被随后的 syncRoundStateToLastMessage 覆写到消息）
            perRoundResearchChunksRef.current = mergeResearchSources(perRoundResearchChunksRef.current, (event.top_chunks as ResearchChunk[]) ?? []);
            setResearchChunks(perRoundResearchChunksRef.current);
            // 2. 先追加消息占位（此时 nodeProgress / webDocs 可能已经在回调里累积到了 ref）
            persistResearchMessages(requestSessionId, [
              ...messagesRef.current,
              {
                id: assistantMessageId,
                role: 'assistant',
                content: event.report ||
                  `✅ 深度调研完成！\n\n已从 ${event.total_pages} 个网页中抓取内容，切分为 ${event.total_chunks} 个切片，通过 BGE-Reranker 精选出 ${event.top_chunks.length} 条高相关性片段。\n\n正在生成深度研究报告...`,
                nodeProgress: perRoundNodeEventsRef.current.length > 0 ? perRoundNodeEventsRef.current : undefined,
                webDocs: perRoundWebDocsRef.current.length > 0 ? perRoundWebDocsRef.current : undefined,
                researchChunks: perRoundResearchChunksRef.current.length > 0 ? perRoundResearchChunksRef.current : undefined,
              },
            ]);
          },
          onResearchReasonDone: (event) => {
              answerPacing.commit(event.report);
              const updated = [...messagesRef.current];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                updated[updated.length - 1] = {
                  ...last,
                  content: event.report,
                  reasoning: event.reasoning,
                  reasoning_time: event.reasoning_time,
                  // 写最终态：把 ref 中累积的所有阶段状态再挂到扩展字段
                  nodeProgress: perRoundNodeEventsRef.current.length > 0 ? perRoundNodeEventsRef.current : last.nodeProgress,
                  webDocs: perRoundWebDocsRef.current.length > 0 ? perRoundWebDocsRef.current : last.webDocs,
                  researchChunks: perRoundResearchChunksRef.current.length > 0 ? perRoundResearchChunksRef.current : last.researchChunks,
                };
              }
              persistResearchMessages(requestSessionId, updated);
          },
          onError: (event) => {
            setError(event.message);
          },
          // Why: 千问深度调研 Step 1 反问确认——后端推送 qwen_feedback 事件后连接关闭，
          //   前端在对话流中插入内嵌卡片，用户回答后发起 Step 2 请求继续研究。
          onQwenFeedback: (event) => {
            const currentMessages = messagesRef.current;
            const alreadyShown = currentMessages.some(
              (message) => message.type === 'qwen_feedback'
                && message.feedbackQuestion === event.question
                && !message.feedbackAnswer,
            );
            const nextMessages = alreadyShown
              ? currentMessages
              : [
                  ...currentMessages,
                  {
                    role: 'assistant' as const,
                    content: '',
                    type: 'qwen_feedback' as const,
                    feedbackQuestion: event.question,
                  },
                ];
            // Persist the feedback card and all node/source refs accumulated
            // before the stream paused. Previously this existed only in React
            // state, so reopening the session silently dropped the chain.
            persistResearchMessages(requestSessionId, nextMessages);
            setIsLoading(false);
            sealOffProcessingNodes();
          },
        }, requestSessionId, runtimeSettings, researchEngine, {
          ...researchOptions,
          enable_feedback: researchEngine === 'qwen' ? enableFeedback : undefined,
        });
        const reportMessage = [...messagesRef.current].reverse().find((message) => message.id === assistantMessageId && message.role === 'assistant');
        const report = reportMessage?.content?.trim() ?? '';
        const lastResearchMessage = messagesRef.current[messagesRef.current.length - 1];
        const isPendingFeedback = lastResearchMessage?.type === 'qwen_feedback' && !lastResearchMessage.feedbackAnswer;
        const isPlaceholder = !report || report.includes('正在生成深度研究报告');
        if (!isPendingFeedback && !isPlaceholder) {
          try {
            const created = await createConversationArtifact(
              requestSessionId,
              createResearchArtifactInput({
                messageId: assistantMessageId,
                report,
                query: userMessage,
                sources: perRoundResearchChunksRef.current,
              }),
            );
            setConversationArtifactLinks((previous) => [...previous, created.link]);
          } catch (artifactError) {
            setError(artifactError instanceof Error
              ? `研究报告已生成，但保存为作品失败：${artifactError.message}`
              : '研究报告已生成，但保存为作品失败。');
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '请求失败');
      } finally {
        setIsLoading(false);
        sealOffProcessingNodes();
      }
    } else if (mode === 'plan' || mode === 'distributed_plan') {
      try {
        await sendChatMessage(userMessage, mode, {
          onNode: handleNodeEvent,
          onSystemStatus: (event) => {
            setAgentStatus(event.message);
            // Mount the independent workspace as soon as the planner request
            // starts, so the user sees an active chain instead of a blank pane
            // while the first graph snapshot is still being produced.
            setPlanProgress((previous) => previous ?? {
              phase: 'planning',
              tasks: [],
              current_task_id: null,
              iteration: 0,
              message: event.message,
            });
          },
          onPlanProgress: (event) => {
            perRoundPlanProgressRef.current = event;
            setPlanProgress(event);
            setAgentStatus('');
            const current = messagesRef.current;
            const existingIndex = [...current].map((message, index) => ({ message, index })).reverse()
              .find(({ message }) => message.role === 'assistant' && message.planProgress)?.index ?? -1;
            const nextMessages = existingIndex >= 0
              ? current.map((message, index) => index === existingIndex ? { ...message, planProgress: event } : message)
              : [...current, { role: 'assistant' as const, content: '', planProgress: event }];
            persistPlanMessages(requestSessionId, nextMessages);
          },
          onPlanEvent: (event: PlanRuntimeEvent) => {
            if (event.type === 'search_started') {
              setAgentStatus(`正在搜索资料：${event.query}`);
              setPlanProgress((previous) => {
                if (!previous) return previous;
                const nextTasks = previous.tasks.map((task) => task.requires_web && task.status === 'in_progress'
                  ? { ...task, search_status: 'searching' as const }
                  : task);
                const next = { ...previous, tasks: nextTasks };
                perRoundPlanProgressRef.current = next;
                return next;
              });
              return;
            }
            if (event.type === 'search_completed') {
              setAgentStatus(event.error ? '搜索暂时失败，继续使用已有上下文' : `已找到 ${event.result_count} 条摘要`);
              setPlanProgress((previous) => {
                if (!previous) return previous;
                const next = {
                  ...previous,
                  tasks: previous.tasks.map((task) => task.requires_web && task.status === 'in_progress'
                    ? {
                      ...task,
                      search_status: event.error ? 'failed' as const : 'completed' as const,
                      search_results: event.results ?? task.search_results,
                    }
                    : task),
                };
                perRoundPlanProgressRef.current = next;
                return next;
              });
              return;
            }
            if (event.type === 'task_started') {
              setAgentStatus(`正在执行 Task ${event.task_id}`);
              setPlanProgress((previous) => {
                if (!previous) return previous;
                const next = {
                  ...previous,
                  current_task_id: event.task_id,
                  active_task_ids: Array.from(new Set([...(previous.active_task_ids ?? []), event.task_id])),
                  tasks: previous.tasks.map((task) => task.id === event.task_id
                    ? {
                      ...task,
                      status: 'in_progress' as const,
                      streaming_result: '',
                      search_status: event.requires_web
                        ? (task.search_results?.length ? 'completed' as const : 'searching' as const)
                        : task.search_status,
                    }
                    : task),
                };
                perRoundPlanProgressRef.current = next;
                return next;
              });
              return;
            }
            if (event.type === 'task_delta') {
              setPlanProgress((previous) => {
                if (!previous) return previous;
                const next = {
                  ...previous,
                  tasks: previous.tasks.map((task) => task.id === event.task_id
                    ? { ...task, streaming_result: `${task.streaming_result ?? ''}${event.delta}` }
                    : task),
                };
                perRoundPlanProgressRef.current = next;
                return next;
              });
              return;
            }
            if (event.type === 'task_completed') {
              const nextProgress = (() => {
                const previous = perRoundPlanProgressRef.current;
                if (!previous) return previous;
                return {
                  ...previous,
                  current_task_id: null,
                  active_task_ids: (previous.active_task_ids ?? []).filter((id) => id !== event.task_id),
                  tasks: previous.tasks.map((task) => task.id === event.task_id
                    ? { ...task, status: event.status, result: event.result ?? task.result, error: event.error ?? null, streaming_result: null }
                    : task),
                };
              })();
              if (nextProgress) {
                perRoundPlanProgressRef.current = nextProgress;
                setPlanProgress(nextProgress);
                const current = messagesRef.current;
                const existingIndex = [...current].map((message, index) => ({ message, index })).reverse()
                  .find(({ message }) => message.role === 'assistant' && message.planProgress)?.index ?? -1;
                const nextMessages = existingIndex >= 0
                  ? current.map((message, index) => index === existingIndex ? { ...message, planProgress: nextProgress } : message)
                  : [...current, { role: 'assistant' as const, content: '', planProgress: nextProgress }];
                persistPlanMessages(requestSessionId, nextMessages);
              }
              setAgentStatus('');
              return;
            }
            if (event.type === 'report_delta') {
              const current = messagesRef.current;
              const existingIndex = [...current].map((message, index) => ({ message, index })).reverse()
                .find(({ message }) => message.role === 'assistant' && message.planProgress)?.index ?? -1;
              const previousReport = existingIndex >= 0 ? current[existingIndex]?.streamingReport ?? '' : '';
              const nextMessages = existingIndex >= 0
                ? current.map((message, index) => index === existingIndex ? { ...message, streamingReport: `${previousReport}${event.delta}` } : message)
                : [...current, { role: 'assistant' as const, content: '', streamingReport: event.delta, planProgress: perRoundPlanProgressRef.current ?? undefined }];
              messagesRef.current = nextMessages;
              setMessages(nextMessages);
            }
          },
          onSkillMatched: (event) => {
            setMatchedSkills((prev) => [...prev, event]);
          },
          onDone: (event) => {
            answerPacing.commit(event.answer);
            const current = messagesRef.current;
            const existingIndex = [...current].map((message, index) => ({ message, index })).reverse()
              .find(({ message }) => message.role === 'assistant' && message.planProgress)?.index ?? -1;
            const nextMessages = existingIndex >= 0
              ? current.map((message, index) => index === existingIndex ? {
                ...message,
                content: event.answer,
                streamingReport: undefined,
                planProgress: perRoundPlanProgressRef.current ?? message.planProgress,
              } : message)
              : [...current, { role: 'assistant' as const, content: event.answer, planProgress: perRoundPlanProgressRef.current ?? undefined }];
            persistPlanMessages(requestSessionId, nextMessages);
            setAgentStatus('');
          },
          onError: (event) => {
            setError(event.message);
          },
        }, {
          sessionId: requestSessionId,
          runtimeSettings,
          omniTurnContext,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : '请求失败');
      } finally {
        setIsLoading(false);
        sealOffProcessingNodes();
      }
    } else if (mode === 'agent') {
      // 多智能体协同模式
      try {
        await sendChatMessage(userMessage, mode, {
          onNode: handleNodeEvent,
          onSystemStatus: (event) => {
            setAgentStatus(event.message);
          },
          onAgentTalk: (event) => {
            setAgentTalks((prev) => [...prev, event]);
          },
          onAgentFinalAnswer: (event) => {
            answerPacing.commit(event.answer);
            setMessages((prev) => [...prev, { role: 'assistant', content: event.answer }]);
          },
          onSkillMatched: (event) => {
            setMatchedSkills((prev) => [...prev, event]);
          },
          onDone: () => {
            setAgentStatus('');
          },
          onUsage: (usage) => {
            perRoundTokenUsageRef.current = usage;
            syncRoundStateToLastMessage();
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
          omniTurnContext,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : '请求失败');
      } finally {
        setIsLoading(false);
        sealOffProcessingNodes();
      }
    } else {
      // 普通对话模式（standard / deep / web）
      try {
        let streamedAnswer = '';
        let streamedReasoning = '';
        let completedAnswer = '';
        await sendChatMessage(userMessage, mode, {
          onNode: handleNodeEvent,
          onReasoning: (event) => {
            reasoningPacing.commit(event.reasoning);
            setReasoningSteps((prev) => [...prev, event.reasoning]);
          },
          onReasoningDelta: (token) => {
            streamedReasoning += token;
            reasoningPacing.push(token);
            setReasoningSteps([streamedReasoning]);
          },
          onToken: (token) => {
            streamedAnswer += token;
            answerPacing.push(token);
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: streamedAnswer };
              else next.push({ id: assistantMessageId, role: 'assistant', content: streamedAnswer });
              return next;
            });
          },
          onWebDocs: (event) => {
            // 写入 ref + 同步到最后一条 assistant 消息；右抽屉已移除
            perRoundWebDocsRef.current = mergeWebDocs(perRoundWebDocsRef.current, event.docs ?? []);
            setWebDocs(perRoundWebDocsRef.current);
            syncRoundStateToLastMessage();
          },
          onUsage: (usage) => {
            perRoundTokenUsageRef.current = usage;
            syncRoundStateToLastMessage();
          },
          onMcpEvent: (event: McpEvent) => {
            if (requestToken !== activeRequestTokenRef.current) return;
            if (event.phase === 'start') {
              setMcpActive(true);
            } else if (event.phase === 'tool_call') {
              setMcpActive(true);
              const next = [...perRoundMcpTraceRef.current, { tool_name: event.tool_name, status: 'calling' as const }];
              perRoundMcpTraceRef.current = next;
              setMcpTrace(next);
              syncRoundStateToLastMessage();
            } else if (event.phase === 'tool_result') {
              const next = (() => {
                const prev = perRoundMcpTraceRef.current;
                const idx = prev.findIndex(
                  (t) => t.tool_name === event.tool_name && t.status === 'calling',
                );
                if (idx === -1) {
                  return [...prev, { tool_name: event.tool_name, status: (event.ok ? 'ok' : 'error') as McpTraceItem['status'], preview: event.preview }];
                }
                const next = [...prev];
                next[idx] = { ...next[idx], status: (event.ok ? 'ok' : 'error') as McpTraceItem['status'], preview: event.preview };
                return next;
              })();
              perRoundMcpTraceRef.current = next;
              setMcpTrace(next);
              syncRoundStateToLastMessage();
            } else if (event.phase === 'done' || event.phase === 'error') {
              // 保留显示 5s 后清空
              setTimeout(() => {
                if (requestToken === activeRequestTokenRef.current) setMcpActive(false);
              }, 5000);
            }
          },
          onSkillMatched: (event) => {
            setMatchedSkills((prev) => [...prev, event]);
          },
          onDone: (event) => {
            completedAnswer = event.answer || streamedAnswer;
            if (!streamedAnswer) {
              // 追加答案时同步挂入本轮累积的所有状态
              setMessages((prev) => [...prev, {
                id: assistantMessageId,
                role: 'assistant',
                content: event.answer,
                nodeProgress: perRoundNodeEventsRef.current.length > 0 ? perRoundNodeEventsRef.current : undefined,
                webDocs: perRoundWebDocsRef.current.length > 0 ? perRoundWebDocsRef.current : undefined,
                researchChunks: perRoundResearchChunksRef.current.length > 0 ? perRoundResearchChunksRef.current : undefined,
                tokenUsage: event.usage ?? perRoundTokenUsageRef.current ?? undefined,
                mcpTrace: perRoundMcpTraceRef.current.length > 0 ? perRoundMcpTraceRef.current : undefined,
              }]);
              // Why: 整块源（DeepSeek 非流式兜底）走 commit，伪打字机匀速展开。
              answerPacing.commit(event.answer);
            } else {
              // 流式已经写入最后一条消息，再补一次最终状态作为"快照落点"
              syncRoundStateToLastMessage();
              // Why: done 携带的可能是服务端最终全文（含流式期间未推完的尾部），
              //   commit 对齐总量；队列未排空部分继续匀速展开。
              answerPacing.commit(event.answer);
            }
            if (event.web_docs && event.web_docs.length > 0) {
              perRoundWebDocsRef.current = mergeWebDocs(perRoundWebDocsRef.current, event.web_docs);
              setWebDocs(perRoundWebDocsRef.current);
              syncRoundStateToLastMessage();
            }
          },
          onError: (event) => {
            setError(event.message);
          },
        }, {
          sessionId: requestSessionId,
          runtimeSettings,
          attachments: requestAttachments,
          omniTurnContext,
        });
        const documentContent = completedAnswer || streamedAnswer;
        if (shouldCreateWritingArtifact(preferredCapability, userMessage, documentContent)) {
          try {
            const created = await createConversationArtifact(
              requestSessionId,
              createWritingArtifactInput({
                messageId: assistantMessageId,
                content: documentContent,
                prompt: userMessage,
              }),
            );
            setConversationArtifactLinks((previous) => [
              ...previous.filter((link) => link.id !== created.link.id),
              created.link,
            ]);
          } catch (artifactError) {
            setError(artifactError instanceof Error
              ? `回答已生成，但保存为作品失败：${artifactError.message}`
              : '回答已生成，但保存为作品失败。');
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '请求失败');
      } finally {
        setIsLoading(false);
        sealOffProcessingNodes();
      }
    }
  };

  const handleSelectSession = async (session: SessionSummary) => {
    if (isLoading) return;
    try {
      // Reopening the active writing session must read its persisted snapshot.
      // Saving the currently broken/empty workspace first would overwrite that history.
      if (session.session_id !== activeSessionId) await persistCurrentSession();
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
      // New conversations always start in the all-purpose chat surface. Code mode
      // remains available by explicitly switching modes after the draft opens;
      // this prevents a Code draft from rendering without its workspace shell.
      startDraftSession('omni');
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
    if (nextMode === 'omni') setPreferredCapability('omni');
    if (nextMode === 'code') {
      setIsHistoryOpen(false);
      changeHistoryCollapsed(true);
    }
    try {
      await persistCurrentSession();
      const restoreExistingSessionForMode = nextMode === 'code';
      if (restoreExistingSessionForMode) {
        const target = sessions.find((session) => session.mode === nextMode);
        if (target) {
          await openSession(target);
        } else {
          startDraftSession(nextMode);
        }
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
      const deletedSession = sessions.find((session) => session.session_id === sessionId);
      await deleteSession(sessionId);
      titleRequestedRef.current.delete(sessionId);
      const remaining = sessions.filter(
        (session) => session.session_id !== sessionId,
      );
      setSessions(remaining);
      if (deletedSession?.mode === 'writing' && sessionId === activeSessionId) {
        localStorage.removeItem('ai-writing-draft-v1');
        localStorage.removeItem('ai-writing-document-v2');
        localStorage.removeItem('ai-writing-submitted-instruction-v1');
        localStorage.removeItem('ai-writing-thesis-outline-v1');
      }
      if (sessionId === activeSessionId) {
        if (remaining[0]) {
          await openSession(remaining[0]);
        } else {
          startDraftSession('omni');
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

  const handleRenameSession = async (sessionId: string, title: string) => {
    if (isLoading || !title.trim()) return;
    try {
      const updated = await renameSession(sessionId, title);
      setSessions((previous) => [updated, ...previous.filter((item) => item.session_id !== sessionId)]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '重命名会话失败');
      throw requestError;
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
      startDraftSession('omni');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : '清空历史失败',
      );
    }
  };

  const isPlanMode = mode === 'plan' || mode === 'distributed_plan';
  const isNewConversation = messages.length === 0 && !generatedCode;

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

  const submitPublishedProject = async () => {
    if (!publishVfs || !activeSessionId || !publishTitle.trim()) return;
    setIsPublishing(true);
    setError(null);
    try {
      await publishCodeProject({
        source_session_id: activeSessionId,
        title: publishTitle.trim(),
        category: publishCategory,
        prompt: codePrompts.at(-1) || '继续完善这个 Code 项目',
        cover_image: publishCoverImage,
        vfs: publishVfs,
        project_kind: codeProjectKind,
        published_run_id: codeRunId || activeCodeVersionId || `manual-${Date.now()}`,
      });
      setPublishVfs(null);
      setView('code-showcase');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '发布作品失败');
    } finally {
      setIsPublishing(false);
    }
  };

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 220)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 220 ? 'auto' : 'hidden';
  }, [input]);

  const visibleMessages = mode === 'code'
    ? []
    : mode === 'agent'
      ? messages.filter((message) => message.role === 'user')
      : messages;
  const agentFinalMessages = mode === 'agent'
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

  const latestResearchUserMessage = mode === 'research'
    ? [...messages].reverse().find((message) => message.role === 'user')
    : undefined;
  const latestPlanReportMessage = isPlanMode
    ? [...messages].reverse().find((message) => message.role === 'assistant' && (message.planProgress || message.content.trim() || message.streamingReport))
    : undefined;
  const latestResearchReportMessage = mode === 'research'
    ? [...messages].reverse().find((message) => message.role === 'assistant' && message.type !== 'qwen_feedback')
    : undefined;
  const latestResearchReportIndex = latestResearchReportMessage
    ? messages.lastIndexOf(latestResearchReportMessage)
    : -1;
  const selectedResearchReportIndex = mode === 'research'
    && selectedResearchMessageIndex != null
    && selectedResearchMessageIndex >= 0
    && selectedResearchMessageIndex < messages.length
    && messages[selectedResearchMessageIndex]?.role === 'assistant'
    && messages[selectedResearchMessageIndex]?.type !== 'qwen_feedback'
    && Boolean(messages[selectedResearchMessageIndex]?.content.trim())
    ? selectedResearchMessageIndex
    : latestResearchReportIndex;
  const selectedResearchReportMessage = selectedResearchReportIndex >= 0
    ? messages[selectedResearchReportIndex]
    : undefined;
  const selectedResearchUserMessage = selectedResearchReportIndex >= 0
    ? [...messages.slice(0, selectedResearchReportIndex)].reverse().find((message) => message.role === 'user')
    : latestResearchUserMessage;
  const selectedResearchSources = researchSourcesFromMessage(selectedResearchReportMessage);
  const handleResearchFiguresChange = (figures: ResearchFigure[]) => {
    const fallbackReportIndex = [...messagesRef.current].map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.role === 'assistant' && message.type !== 'qwen_feedback' && message.content.trim().length > 0)?.index ?? -1;
    const targetReportIndex = selectedResearchReportIndex >= 0 ? selectedResearchReportIndex : fallbackReportIndex;
    if (targetReportIndex < 0) return;
    const previous = messagesRef.current[targetReportIndex]?.researchFigures ?? [];
    const previousFingerprint = previous.map((figure) => `${figure.id}:${figure.status}:${figure.image_url ?? ''}`).join('|');
    const nextFingerprint = figures.map((figure) => `${figure.id}:${figure.status}:${figure.image_url ?? ''}`).join('|');
    if (previousFingerprint === nextFingerprint) return;
    const nextMessages = messagesRef.current.map((message, index) => index === targetReportIndex ? { ...message, researchFigures: figures } : message);
    // Keep pending placeholders in React state for immediate loading UI, but
    // do not persist them. The actual server job result is the durable source.
    if (figures.length > 0 && figures.every(isPendingResearchFigure)) {
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      return;
    }
    persistResearchMessages(activeSessionId, nextMessages);
  };
  const handlePlanFiguresChange = (figures: PlanFigure[]) => {
    const targetIndex = [...messagesRef.current].map((message, index) => ({ message, index }))
      .reverse().find(({ message }) => message.role === 'assistant' && message.planProgress)?.index ?? -1;
    if (targetIndex < 0) return;
    const previous = messagesRef.current[targetIndex]?.planFigures ?? [];
    const previousFingerprint = previous.map((figure) => `${figure.id}:${figure.status}:${figure.image_url ?? ''}`).join('|');
    const nextFingerprint = figures.map((figure) => `${figure.id}:${figure.status}:${figure.image_url ?? ''}`).join('|');
    if (previousFingerprint === nextFingerprint) return;
    persistPlanMessages(activeSessionId, messagesRef.current.map((message, index) => index === targetIndex ? { ...message, planFigures: figures } : message));
  };
  const rightPaneIsLiveLatestReport = selectedResearchReportIndex === latestResearchReportIndex;
  // Why: 全模式统一打字机 pacing——答案/报告与推理过程各用一个计数实例（避免串扰），
  //   state 始终存全文（持久化快照安全），渲染层按 displayedLength 切片上屏。
  const { displayedLength: answerPacedLength, active: answerPacingActive, pacing: answerPacing } = useTypewriterPacing();
  const { displayedLength: reasonPacedLength, active: reasonPacingActive, pacing: reasoningPacing } = useTypewriterPacing();
  const researchPaneWidth = researchPaneWidthPx ? `${researchPaneWidthPx}px` : isHistoryCollapsed
    ? 'calc((100vw - 3.5rem) * 0.52)'
    : 'calc((100vw - 18rem) * 0.52)';
  const researchWorkspaceStyle = mode === 'research' && messages.length > 0
    ? ({ '--research-pane-width': researchPaneWidth } as CSSProperties)
    : isPlanMode && messages.length > 0
      ? ({ '--plan-pane-width': researchPaneWidth } as CSSProperties)
    : undefined;
  const workspaceStyle = {
    ...(researchWorkspaceStyle ?? {}),
    '--artifact-panel-width': `${artifactPanelWidth}vw`,
  } as CSSProperties;

  return (
    <div style={workspaceStyle} className={`bg-gradient-to-b from-slate-50 to-slate-100 ${
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
        onRename={(sessionId, title) => handleRenameSession(sessionId, title)}
        onClear={() => void handleClearSessions()}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDirectory={openDirectory}
        onOpenHooks={openHooks}
        onOpenImageStudio={() => openImageWorkspace()}
        onOpenVideoStudio={() => openVideoWorkspace()}
        onOpenVisualWorkflow={openVisualWorkflow}
        onOpenPpt={openPptWorkspace}
        pptHistory={pptHistory}
        pptHistoryLoading={pptHistoryLoading}
        onSelectPptHistory={openPptHistory}
      />
      <SettingsDialog
        open={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false);
          setSettingsInitialSection(null);
          setSettingsInitialSubTab(null);
        }}
        initialSection={settingsInitialSection}
        initialSubTab={settingsInitialSubTab}
        onOpenDirectory={(tab) => openDirectory(tab)}
        onOpenHooks={openHooks}
        onInsertToChat={(text) => {
          setInput(text);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
      />
      {view === 'marketplace' && (
        <div
          className={`fixed inset-y-0 right-0 z-[100] bg-white ${
            isHistoryCollapsed
              ? 'left-0 lg:left-14'
              : 'left-0 lg:left-72'
          }`}
        >
          <DirectoryPage
            initialTab={directoryTab}
            onBack={closeDirectory}
            onOpenSettings={handleOpenSettingsFromDirectory}
            onCreateWithAgent={(prompt) => void handleCreateWithAgent(prompt)}
          />
        </div>
      )}
      {view === 'hooks' && (
        <div
          className={`fixed inset-y-0 right-0 z-[100] bg-white ${
            isHistoryCollapsed ? 'left-0 lg:left-14' : 'left-0 lg:left-72'
          }`}
        >
          <HookCenter onBack={closeHooks} />
        </div>
      )}
      {view === 'code-showcase' && (
        <div className={`fixed inset-y-0 right-0 z-[100] bg-white ${isHistoryCollapsed ? 'left-0 lg:left-14' : 'left-0 lg:left-72'}`}>
          <CodeShowcasePage
            onBack={() => setView('chat')}
            onOpenCode={(project) => { void enterCodeWorkbench(project); }}
            onUsePrompt={async (prompt) => {
              await enterCodeWorkbench();
              setInput(prompt);
            }}
          />
        </div>
      )}
      {view === 'writing' && (
        <div className={`fixed inset-y-0 right-0 z-[110] bg-white ${isHistoryCollapsed ? 'left-0 lg:left-14' : 'left-0 lg:left-72'}`}>
          <WritingWorkspace
            key={writingSessionRestore ? `${writingSessionRestore.sessionId}:${writingSessionRestore.revision}` : 'new-writing-draft'}
            initialResult={writingSessionRestore?.result ?? ''}
            initialInstruction={writingSessionRestore?.instruction ?? ''}
            restoreFromSession={Boolean(writingSessionRestore)}
            initialDraft={writingSessionRestore?.draft}
            initialDocument={writingSessionRestore?.document}
            initialThesisOutline={writingSessionRestore?.thesisOutline}
            onWorkspaceChange={setWritingWorkspaceState}
            onBack={() => { void (writingArtifactBridge
              ? closeWritingArtifactWorkspace()
              : (async () => { await persistCurrentSession(); setView('chat'); startDraftSession('omni'); })()); }}
            onSubmit={writingArtifactBridge ? submitWritingArtifactRevision : submitWritingDraft}
            onEnsureWritingSession={writingArtifactBridge
              ? async () => {
                  if (!activeSessionId) throw new Error('原会话不存在，无法继续编辑。');
                  return activeSessionId;
                }
              : ensureWritingSession}
            onThesisBodyRequest={writingArtifactBridge ? undefined : handleThesisBodyRequest}
          />
        </div>
      )}
      {view === 'image-plaza' && (
        <ImagePlazaWorkspace initialPrompt={input} onBack={() => setView('chat')} />
      )}
      {view === 'image-studio' && (
        <ImageStudioWorkspace
          initialPrompt={imageArtifactBridge?.prompt ?? input}
          initialReferenceImage={imageArtifactBridge?.referenceImage ?? null}
          onBatchGenerated={imageArtifactBridge ? handleImageArtifactBatch : undefined}
          onBack={() => { setImageArtifactBridge(null); setView('chat'); }}
        />
      )}
      {view === 'video-studio' && (
        <VideoStudioWorkspace
          initialPrompt={videoArtifactBridge?.task.prompt ?? input}
          initialTask={videoArtifactBridge?.task ?? null}
          onTaskSucceeded={videoArtifactBridge ? handleVideoArtifactTask : undefined}
          onBack={() => { setVideoArtifactBridge(null); setView('chat'); }}
        />
      )}
      {view === 'video-market' && (
        <VideoMarketWorkspace initialPrompt={input} onBack={() => setView('chat')} onCreate={(prompt) => openVideoWorkspace(prompt ?? '')} />
      )}
      {isCodeWorkbenchTransitioning && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center overflow-hidden bg-slate-950/10 backdrop-blur-[2px]" aria-label="正在打开 Code 工作台" role="status">
          <div className="h-[86vh] w-full rounded-t-[32px] border border-white/70 bg-white shadow-[0_-25px_80px_rgba(15,23,42,0.22)] animate-[code-workbench-rise_360ms_cubic-bezier(0.22,1,0.36,1)]" />
        </div>
      )}
      <RuntimeSettingsDrawer
        isOpen={isRuntimeSettingsOpen}
        mode={mode}
        responseLength={discussionLength}
        webSearch={webSearch}
        deepThinking={deepThinking}
        discussionRounds={discussionRounds}
        selectedAgentIds={discussionAgentIds}
        mcpMode={mcpMode}
        selectedMcpServerIds={selectedMcpServerIds}
        skillMode={skillMode}
        selectedSkillIds={selectedSkillIds}
        onClose={() => setIsRuntimeSettingsOpen(false)}
        onResponseLengthChange={changeResponseLength}
        onWebSearchChange={changeWebSearch}
        onDeepThinkingChange={changeDeepThinking}
        onDiscussionRoundsChange={changeDiscussionRounds}
        onSelectedAgentIdsChange={setDiscussionAgentIds}
        onMcpModeChange={changeMcpMode}
        onSelectedMcpServerIdsChange={changeSelectedMcpServerIds}
        onSkillModeChange={changeSkillMode}
        onSelectedSkillIdsChange={changeSelectedSkillIds}
        onOpenDirectory={openDirectory}
        onReset={resetRuntimeSettings}
      />
      <HookMonitorPanel events={agentTrace.hookEvents ?? []} />
      <ChatNodeNavigator nodes={chatNodes} isSidebarOpen={false} />
      <div className={`${isHistoryCollapsed ? 'lg:pl-14' : 'lg:pl-72'} ${mode === 'research' && !isNewConversation ? 'xl:mr-[var(--research-pane-width)]' : ''} ${isPlanMode && !isNewConversation ? 'xl:mr-[var(--plan-pane-width)]' : ''} ${artifactPanelState.status !== 'closed' && artifactPanelState.displayMode === 'split' ? 'xl:mr-[var(--artifact-panel-width)]' : ''} ${
        mode === 'code' ? 'h-screen overflow-hidden' : ''
      }`}>
        <div className={`p-6 transition-all duration-300 ${
          mode === 'code'
            ? 'flex h-full max-w-none flex-col overflow-hidden pb-4 pt-0'
            : 'max-w-none pb-80 sm:pb-72'
        }`}>
        {/* Header */}
        <header className="sticky top-0 z-30 -mx-6 mb-3 border-b border-slate-200/70 bg-slate-50/85 px-6 py-2.5 backdrop-blur-xl">
          <button
            type="button"
            aria-label="打开历史会话"
            onClick={() => setIsHistoryOpen(true)}
            className="absolute left-0 top-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 shadow-sm lg:hidden"
          >
            ☰ 历史
          </button>
          <div className="flex min-h-9 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white" aria-hidden="true">
                <Sparkles size={16} />
              </span>
              <h1 className="truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
                {mode === 'code' && (!isNewConversation || codeWorkbenchDraft) ? 'Code 工作台' : '全能型智能助手'}
              </h1>
            </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="打开运行设置"
              onClick={() => setIsRuntimeSettingsOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              <SlidersHorizontal size={15} /> <span className="hidden sm:inline">运行设置</span>
            </button>
            <AgentDrawer />
          </div>
          </div>
        </header>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-center">
            <span className="text-red-700">{error}</span>
          </div>
        )}

        {isNewConversation && preferredCapability !== 'omni' && preferredCapability !== 'music' && (
          <OmniModeShowcase
            pageOnly
            capability={preferredCapability}
            initialPrompt={input}
            onBack={() => setPreferredCapability('omni')}
            onOpenWritingWorkspace={preferredCapability === 'writing' ? () => void openWritingWorkspace() : undefined}
            onCancel={() => setPreferredCapability('omni')}
            onUsePrompt={(prompt) => {
              setInput(prompt);
              inputRef.current?.focus();
            }}
          />
        )}

        {/* Chat Messages */}
        <div className={`${isNewConversation ? 'bg-transparent shadow-none' : 'bg-white/60 shadow-sm backdrop-blur'} mx-auto w-full rounded-2xl ${mode === 'code' ? 'max-w-none' : 'max-w-4xl'} ${
          mode === 'code' ? 'min-h-0 flex-1 overflow-hidden p-0' : 'mb-6 min-h-[450px] p-6'
        }`}>
          {mode === 'code' && (!isNewConversation || codeWorkbenchDraft) && (
            <>
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
              onPublishProject={(vfs) => {
                const title = codePrompts.at(-1)?.slice(0, 30) || '我的 Code 作品';
                setPublishVfs(deepCopyVFS(vfs));
                setPublishTitle(title);
                setPublishCoverImage(buildCodeProjectCover(vfs, title));
              }}
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
            {agentTrace.tokenUsage && (
              <div className="border-t border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-400">
                Token · 合计 {agentTrace.tokenUsage.total_tokens}
                {(agentTrace.tokenUsage.reasoning_tokens ?? 0) > 0 ? ` · 推理 ${agentTrace.tokenUsage.reasoning_tokens}` : ''}
              </div>
            )}
            </>
          )}

          {isNewConversation && preferredCapability === 'omni' && !codeWorkbenchDraft && !isLoading && (
            <div className="flex min-h-[34vh] flex-col items-center justify-end px-4 pb-8 text-center">
              <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20" aria-hidden="true">
                <Sparkles size={24} />
              </span>
              <h2 className="min-h-10 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                {typedWelcome}<span className="ml-0.5 inline-block h-7 w-0.5 animate-pulse bg-blue-600 align-middle" aria-hidden="true" />
              </h2>
              <p className="mt-3 text-sm text-slate-500">今天想一起完成什么？</p>
            </div>
          )}

          <div
            className={mode === 'code' ? 'hidden' : 'space-y-4'}
            onClick={() => {
              // Why: 点击消息区立即全量上屏，跳过 pacing 匀速展开。
              if (answerPacingActive) answerPacing.flush();
              if (reasonPacingActive) reasoningPacing.flush();
            }}
          >
            {visibleMessages.map((msg, index) => {
              // Why 改成「任意 assistant 消息」都可能带进度/来源：
              //   旧逻辑只显示「最后一条 assistant 消息」的面板，导致多轮历史里
              //   前几轮的"阅读了多少网页 + 搜索结果"按钮消失（用户报告的问题）。
              //   只要 msg.nodeProgress（或 ref 中正在累积的本轮状态）有内容，就渲染面板。
              const isAssistant = msg.role === 'assistant';
              const msgPlanProgress = isAssistant ? msg.planProgress : undefined;
              // Why: 旧会话只保存了报告和来源，没有保存原始节点事件。
              //   有来源的历史调研仍应显示一个明确的已完成链路摘要，不能退化成只有文档卡片。
              const isQwenFeedback = msg.type === 'qwen_feedback';
              const isResearchDocument = mode === 'research' && isAssistant && !isQwenFeedback && msg.content.trim().length > 0;
              const msgNodeProgress: NodeEvent[] =
                (msg.nodeProgress && msg.nodeProgress.length > 0)
                  ? msg.nodeProgress
                  : (isAssistant && isLoading && perRoundNodeEventsRef.current.length > 0
                      ? perRoundNodeEventsRef.current
                      : (isResearchDocument && (msg.researchChunks?.length || msg.webDocs?.length)
                          ? buildHistoricalResearchChain(msg.researchChunks?.length ?? msg.webDocs?.length ?? 0)
                          : []));
              const hasProgress = msgNodeProgress.length > 0;
              // While the response is still streaming, the latest docs live in the
              // per-round refs until the assistant snapshot catches up. Pass that
              // live state through so the header count and source list appear
              // immediately instead of only after a refresh.
              const msgWebDocs = msg.webDocs?.length
                ? msg.webDocs
                : (isAssistant && isLoading && perRoundWebDocsRef.current.length > 0
                    ? perRoundWebDocsRef.current
                    : undefined);
              const msgResearchChunks = msg.researchChunks?.length
                ? msg.researchChunks
                : (isAssistant && isLoading && perRoundResearchChunksRef.current.length > 0
                    ? perRoundResearchChunksRef.current
                    : undefined);
              const liveReasoning = reasoningSteps.join('\n\n');
              const liveReasoningDisplay = index === visibleMessages.length - 1 && (reasonPacingActive || reasonPacedLength > 0)
                ? liveReasoning.slice(0, reasonPacedLength)
                : liveReasoning;
              const msgReasoningText = isAssistant
                ? (msg.reasoning || (index === visibleMessages.length - 1 ? liveReasoningDisplay : ''))
                : '';
              const showPanel = isAssistant && (hasProgress || Boolean(msgReasoningText.trim()));

              return (
              <div
                id={msg.role === 'user' ? `chat-message-${index}` : undefined}
                key={index}
                className={`scroll-mt-28 flex ${
                  msg.role === 'user'
                    ? 'justify-end'
                    : showPanel || msgPlanProgress
                      // assistant 带进度面板：头像→进度→答案 纵向排列，左对齐（每轮都独立一套，不共享）
                      ? 'justify-start flex-col items-start'
                      // 普通 assistant：头像+气泡 横向并排
                      : 'justify-start items-start gap-3'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="mt-1 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-sm flex-none">
                    <Bot className="w-5 h-5" />
                  </div>
                )}

                {showPanel && (
                  <div className="mt-0.5 w-full max-w-[85%]">
                    <NodeProgressPanel
                      nodeProgress={msgNodeProgress}
                      currentNode={isLoading ? (perRoundCurrentNodeRef.current ?? currentNode) : null}
                      open={isMsgPanelOpen(msg, index)}
                      onToggle={() => toggleMsgPanel(index)}
                      webDocs={msgWebDocs}
                      researchChunks={msgResearchChunks}
                      researchReasoningFallback={msg.researchReasoning ?? msg.reasoning ?? undefined}
                      reasoningText={msgReasoningText}
                    />
                  </div>
                )}

                {/* 自主规划任务产出统一在独立 PlanWorkspace 展示；左侧只保留对话和链路状态。 */}

                {/* Why: 千问反问卡片——内嵌在对话流中，不中断对话 */}
                {isQwenFeedback ? (
                  <div className="mt-1 w-full max-w-[85%]">
                    <div className="rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4">
                      <div className="flex items-start gap-2 mb-3">
                        <span className="text-lg">🤔</span>
                        <span className="text-sm font-semibold text-amber-800">千问深度研究 · 反问确认</span>
                      </div>
                      {/* 模型反问内容 */}
                      {msg.feedbackQuestion && (
                        <div className="mb-3 text-sm text-gray-800 leading-relaxed">
                          <MarkdownMessage content={msg.feedbackQuestion} />
                        </div>
                      )}
                      {/* 已回答：显示用户回答 + 状态 */}
                      {msg.feedbackAnswer ? (
                        <div className="flex items-center gap-2 text-sm text-green-700">
                          <span>✅</span>
                          <span>已回答，正在继续研究...</span>
                        </div>
                      ) : (
                        /* 未回答：显示输入框 + 提交按钮 */
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="请输入您的回答..."
                            className="flex-1 px-3 py-2 text-sm border border-amber-300 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                submitQwenFeedback(index, e.currentTarget.value.trim());
                                e.currentTarget.value = '';
                              }
                            }}
                          />
                          <button
                            onClick={(e) => {
                              const inputEl = (e.target as HTMLButtonElement).previousElementSibling as HTMLInputElement;
                              if (inputEl?.value.trim()) {
                                submitQwenFeedback(index, inputEl.value.trim());
                                inputEl.value = '';
                              }
                            }}
                            className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors shrink-0"
                          >
                            提交
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : isResearchDocument ? (
                  <ResearchDocumentCard
                    title={deriveReportTitle(msg.content)}
                    sourceCount={msgResearchChunks?.length ?? msgWebDocs?.length ?? 0}
                    figureStatus={!msg.researchFigures?.length ? 'idle' : msg.researchFigures.some((figure) => figure.status === 'queued' || figure.status === 'generating') ? 'generating' : msg.researchFigures.some((figure) => figure.status === 'succeeded') ? 'ready' : 'failed'}
                    selected={selectedResearchReportIndex === index}
                    onSelect={() => setSelectedResearchMessageIndex(index)}
                  />
                ) : <div className={`
                  ${showPanel ? 'mt-1' : ''}
                  max-w-[85%] rounded-2xl px-5 py-3 ${
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
                  {msgPlanProgress && (
                    <p className="mb-2 text-xs font-semibold text-cyan-700">
                      {mode === 'distributed_plan' ? '🕸️' : '🧭'} Final Summarizer · 最终报告
                    </p>
                  )}
                  {msg.writingArtifact && (
                    <div className="mb-3 flex max-w-md items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">W</span>
                      <span className="min-w-0"><strong className="block truncate text-sm text-slate-900">{msg.writingArtifact.title}</strong><span className="mt-0.5 block text-xs text-slate-400">{msg.writingArtifact.status === 'generating' ? '正在生成中…' : msg.writingArtifact.status === 'complete' ? 'Word 文档已生成' : '生成失败，请重试'}</span></span>
                    </div>
                  )}
                  <MarkdownMessage
                    content={
                      isAssistant && index === visibleMessages.length - 1 && (answerPacingActive || answerPacedLength > 0)
                        ? msg.content.slice(0, answerPacedLength)
                        : msg.content
                    }
                  />
                  {msg.id && (artifactLinksByMessageId.get(msg.id)?.length ?? 0) > 0 && (
                    <ArtifactMessageCards conversationId={activeSessionId ?? ''} links={artifactLinksByMessageId.get(msg.id) ?? []} onOpen={openArtifactPanel} />
                  )}
                  {isAssistant && answerPacingActive && index === visibleMessages.length - 1 && (
                    <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-blue-600 align-middle" aria-hidden="true" />
                  )}
                  {msg.role === 'assistant' && msg.tokenUsage && (
                    <div className="mt-2 text-[11px] text-slate-400">
                      Token · 输入 {msg.tokenUsage.prompt_tokens ?? (msg.tokenUsage.models ? Object.values(msg.tokenUsage.models).reduce((sum, item) => sum + (item.prompt_tokens || 0), 0) : 0)}
                      {' '}· 输出 {msg.tokenUsage.completion_tokens ?? (msg.tokenUsage.models ? Object.values(msg.tokenUsage.models).reduce((sum, item) => sum + (item.completion_tokens || 0), 0) : 0)}
                      {' '}· 合计 {msg.tokenUsage.total_tokens}
                      {(msg.tokenUsage.cached_tokens ?? 0) > 0 ? ` · 缓存 ${msg.tokenUsage.cached_tokens}` : ''}
                      {(msg.tokenUsage.reasoning_tokens ?? 0) > 0 ? ` · 推理 ${msg.tokenUsage.reasoning_tokens}` : ''}
                    </div>
                  )}
                  {msg.role === 'assistant' && msg.mcpTrace && msg.mcpTrace.length > 0 && (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                      <div className="flex items-center gap-2 font-medium text-slate-600">
                        <span aria-hidden="true">🔧</span>
                        <span>已调用 {msg.mcpTrace.filter((trace) => trace.status === 'ok').length} 个 MCP 工具</span>
                      </div>
                      <ul className="mt-2 space-y-1 pl-5">
                        {msg.mcpTrace.map((trace, traceIndex) => (
                          <li key={`${trace.tool_name}-${traceIndex}`} className="flex items-start gap-1.5">
                            <span aria-hidden="true">{trace.status === 'calling' ? '⏳' : trace.status === 'ok' ? '✅' : '❌'}</span>
                            <span className="font-mono">{trace.tool_name}</span>
                            {trace.preview && <span className="truncate text-slate-400" title={trace.preview}>— {trace.preview.slice(0, 80)}{trace.preview.length > 80 ? '…' : ''}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 可折叠的 R1 深度思考过程：仅非调研模式下保留在答案末尾；
                      调研模式下 reasoning 流程已融入 NodeProgressPanel 链路面板
                      （[Node: DeepThinker] processing→completed），不再在气泡末尾重复展示。 */}
                  {msg.reasoning && mode !== 'research' && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-purple-600 hover:text-purple-800 flex items-center gap-1.5 py-1 select-none">
                        <span>🧠</span>
                        R1 深度思考
                        {msg.reasoning_time != null && (
                          <span className="text-purple-400 font-normal">· {msg.reasoning_time}s</span>
                        )}
                      </summary>
                      <div className="mt-2 p-3 bg-purple-50 border border-purple-100 rounded-lg text-xs text-purple-800 whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                        {index === visibleMessages.length - 1
                          ? (reasonPacingActive || reasonPacedLength > 0 ? msg.reasoning.slice(0, reasonPacedLength) : msg.reasoning)
                          : msg.reasoning}
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
                }
              </div>
              );
            })}

            {/* 思考中占位：用户问题已发出、assistant 答案还没返回时，
                把执行进度显示成一个独立的 assistant 消息气泡，紧挨在问题下面。
                用 perRoundXxxRef 读取当前累积：此时最后一条 assistant 消息可能还未创建 */}
            {isLoading &&
              perRoundNodeEventsRef.current.length > 0 &&
              (visibleMessages.length === 0 ||
                visibleMessages[visibleMessages.length - 1].role === 'user') && (
                <div className="flex justify-start items-start gap-3">
                  <div className="mt-1 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-sm flex-none">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div className="max-w-[90%]">
                    <NodeProgressPanel
                      nodeProgress={perRoundNodeEventsRef.current}
                      currentNode={perRoundCurrentNodeRef.current ?? currentNode}
                      open={true}
                      onToggle={() => { perRoundPanelOpenRef.current = !perRoundPanelOpenRef.current; setMsgPanelOpenKeys({}); }}
                      webDocs={perRoundWebDocsRef.current.length > 0 ? perRoundWebDocsRef.current : undefined}
                      researchChunks={perRoundResearchChunksRef.current.length > 0 ? perRoundResearchChunksRef.current : undefined}
                    />
                  </div>
                </div>
              )}

            {/* Skill 命中提示 —— 本轮注入了哪些 Skill 手册，与 MCP trace 同源反馈 */}
            {matchedSkills.length > 0 && (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2 text-violet-700">
                    <span className="text-base">🧠</span>
                    <span className="font-medium">
                      已加载 {matchedSkills.length} 个技能手册
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1 pl-6 text-xs text-violet-600">
                    {matchedSkills.map((s, i) => (
                      <li key={`${s.skill_name}-${i}`} className="flex items-start gap-1.5">
                        <span>📖</span>
                        <span className="font-mono">{s.skill_name}</span>
                        {s.standard_steps.length > 0 && (
                          <span className="text-violet-400">
                            （{s.standard_steps.length} 步标准流程）
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* MCP 工具调用轨迹 —— 实时可见，确认"MCP 真的被调用了" */}
            {isLoading && (mcpActive || mcpTrace.length > 0) && mcpMode !== 'off' && (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2 text-slate-600">
                    <span className="text-base">🔧</span>
                    <span className="font-medium">
                      {mcpActive && mcpTrace.some((t) => t.status === 'calling')
                        ? 'MCP 工具调用中…'
                        : `已调用 ${mcpTrace.filter((t) => t.status === 'ok').length} 个 MCP 工具`}
                    </span>
                  </div>
                  {mcpTrace.length > 0 && (
                    <ul className="mt-2 space-y-1 pl-6 text-xs text-slate-500">
                      {mcpTrace.map((t, i) => (
                        <li key={`${t.tool_name}-${i}`} className="flex items-start gap-1.5">
                          <span>
                            {t.status === 'calling' ? '⏳' : t.status === 'ok' ? '✅' : '❌'}
                          </span>
                          <span className="font-mono">{t.tool_name}</span>
                          {t.preview && (
                            <span className="truncate text-slate-400" title={t.preview}>
                              — {t.preview.slice(0, 80)}
                              {t.preview.length > 80 ? '…' : ''}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* Research Progress inside chat area
                Why 移除独立 ResearchProgressPanel 渲染：调研模式已复用 NodeProgressPanel 链路面板，
                  research_process 事件被翻译成 NodeEvent 推入同一 nodeProgress 栈，
                  与联网模式共用可伸缩链路面板，紧挨头像下方显示，刷新/重启后从 SessionSnapshot 恢复。
                  researchProgress 状态仍保留（onResearchProcess 回调继续更新），用于触发 sidebar 切换等副作用。 */}

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

            {isPlanMode && (isLoading || planProgress) && (
              <PlanChainTimeline progress={planProgress} status={agentStatus} />
            )}

            {agentFinalMessages.map((msg, index) => (
              <div key={`agent-final-${index}`} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-gray-100 px-5 py-3 text-gray-900">
                  <p className="mb-2 text-xs font-semibold text-indigo-700">🎙️ 主持人 · 聊天小结</p>
                  <MarkdownMessage
                    content={
                        index === agentFinalMessages.length - 1 && (answerPacingActive || answerPacedLength > 0)
                        ? msg.content.slice(0, answerPacedLength)
                        : msg.content
                    }
                  />
                  {answerPacingActive && index === agentFinalMessages.length - 1 && (
                    <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-blue-600 align-middle" aria-hidden="true" />
                  )}
                </div>
              </div>
            ))}

          </div>

          {/* Reasoning Display (Deep Mode) */}
          {false && reasoningSteps.length > 0 && (
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
                      {index === reasoningSteps.length - 1
                        ? (reasonPacingActive || reasonPacedLength > 0 ? reasoning.slice(0, reasonPacedLength) : reasoning)
                        : reasoning}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Fixed Input Area */}
        {(mode !== 'code' || (isNewConversation && !codeWorkbenchDraft)) && <div
          className={`fixed left-0 z-40 bg-gradient-to-t from-slate-100 via-slate-50/95 to-transparent pt-8 transition-[left,right,top,bottom] duration-300 ${
            isHistoryCollapsed ? 'lg:left-14' : 'lg:left-72'
          } ${isNewConversation ? (preferredCapability === 'omni' ? 'bottom-auto top-[43%]' : 'bottom-auto top-[27%]') : 'bottom-0 top-auto'} right-0 ${mode === 'research' && !isNewConversation ? 'xl:right-[var(--research-pane-width)]' : ''} ${isPlanMode && !isNewConversation ? 'xl:right-[var(--plan-pane-width)]' : ''} ${artifactPanelState.status !== 'closed' && artifactPanelState.displayMode === 'split' ? 'xl:right-[var(--artifact-panel-width)]' : ''}`}
        >
          <div className="mx-auto max-w-6xl p-3 sm:p-4">
            <div className="rounded-2xl border border-slate-200/90 bg-white p-2.5 shadow-[0_12px_40px_rgba(15,23,42,0.10)]">
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            {mode === 'research' && researchEngine === 'firecrawl' && <div className="flex justify-end px-1"><ResearchOptionsPopover options={researchOptions} onChange={setResearchOptions} onReset={() => setResearchOptions({ ...DEFAULT_RESEARCH_OPTIONS })}/></div>}
            {mode === 'research' && <div className="flex items-center justify-end gap-2 px-1">
              <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
                {currentModelSettings?.provider === 'qwen' && <button type="button" onClick={() => setResearchEngine('qwen')} className={`rounded-md px-2 py-1 text-[10px] font-medium ${researchEngine === 'qwen' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>千问原生</button>}
                {currentModelSettings?.provider === 'minimax' && <button type="button" onClick={() => setResearchEngine('minimax')} className={`rounded-md px-2 py-1 text-[10px] font-medium ${researchEngine === 'minimax' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>MiniMax 原生</button>}
                <button type="button" onClick={() => setResearchEngine('firecrawl')} className={`rounded-md px-2 py-1 text-[10px] font-medium ${researchEngine === 'firecrawl' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Firecrawl</button>
                <button type="button" onClick={() => setResearchEngine('self-built')} className={`rounded-md px-2 py-1 text-[10px] font-medium ${researchEngine === 'self-built' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>自研引擎</button>
              </div>
              {researchEngine === 'qwen' && <label className="flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" checked={enableFeedback} onChange={(event) => setEnableFeedback(event.target.checked)} className="rounded border-slate-300 text-blue-600"/>反问确认</label>}
            </div>}
            {attachments.length > 0 && <div className="flex flex-wrap gap-2 px-1">{attachments.map((item, index) => <span key={`${item.url.slice(0,30)}-${index}`} className="inline-flex max-w-48 items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs text-sky-800"><Paperclip size={13}/><span className="truncate">{item.name || item.type}</span><button type="button" aria-label={`移除 ${item.name || '附件'}`} onClick={()=>setAttachments((current)=>current.filter((_,i)=>i!==index))}><X size={13}/></button></span>)}</div>}
            <ArtifactReferencePicker conversationId={activeSessionId === LEGACY_GLOBAL_SESSION_ID ? null : activeSessionId} selected={mentionedArtifactSummaries} onChange={setMentionedArtifactSummaries} />
            {preferredCapability === 'video' && <div className="rounded-xl border border-transparent px-1 pb-1">
              <div className="flex items-start gap-3">
                <button type="button" aria-label="添加视频参考素材" onClick={() => setAttachmentMenuOpen(true)} className="flex h-20 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500 transition hover:border-slate-400 hover:bg-slate-100">
                  <Plus size={21} /><span>参考</span>
                </button>
                <textarea
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleInputKeyDown}
                  placeholder="上传图片、视频进行参考生成，使用 @ 快速调用已上传素材"
                  disabled={isLoading}
                  rows={3}
                  className="min-h-20 flex-1 resize-none border-0 bg-transparent px-1 py-1 text-[15px] leading-7 text-slate-900 outline-none placeholder:text-slate-400 disabled:bg-slate-100"
                />
              </div>
            </div>}
            {/* Input Row */}
            <div className={`relative ${preferredCapability === 'video' ? 'hidden' : ''}`} ref={inputContainerRef}>
              {showSkillPicker && filteredSkills.length > 0 && (
                <>
                  <div className="absolute bottom-full left-0 mb-2 w-80 max-h-80 overflow-y-auto bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1 z-50">
                    {filteredSkills.map((skill, idx) => {
                      const isActive = idx === skillPickerSelectedIndex || idx === skillPickerHoveredIndex;
                      return (
                        <button
                          key={skill.skill_id}
                          type="button"
                          onClick={() => insertSkill(skill.skill_name)}
                          onMouseEnter={() => setSkillPickerHoveredIndex(idx)}
                          onMouseLeave={() => setSkillPickerHoveredIndex(null)}
                          className={`w-full flex flex-col items-start px-4 py-2.5 text-left transition-colors ${
                            isActive
                              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' 
                              : 'hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <svg className={`w-4 h-4 ${isActive ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                              <polyline points="14 2 14 8 20 8"></polyline>
                            </svg>
                            <span className="text-sm font-medium">
                              {skill.skill_name}
                            </span>
                          </div>
                          {skill.description && (
                            <div className={`mt-0.5 text-xs line-clamp-1 ${isActive ? 'text-blue-600/70 dark:text-blue-300/70' : 'text-slate-500 dark:text-slate-400'}`}>
                              {skill.description}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {/* 右侧描述浮窗 */}
                  {(() => {
                    const idx = skillPickerHoveredIndex !== null ? skillPickerHoveredIndex : skillPickerSelectedIndex;
                    const skill = filteredSkills[idx];
                    if (!skill) return null;
                    const desc = skill.description || skill.trigger_condition || `类型: ${skill.skill_type}`;
                    return (
                      <div 
                        className="absolute bottom-full left-[21rem] mb-2 w-96 p-4 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 z-[60] text-sm leading-relaxed"
                        style={{ maxWidth: 'calc(100vw - 22rem)' }}
                      >
                        <div className="font-medium text-slate-900 dark:text-white mb-1">{skill.skill_name}</div>
                        <div className="text-slate-600 dark:text-slate-300">{desc}</div>
                      </div>
                    );
                  })()}
                </>
              )}

              <div 
                className="relative flex-1"
                onMouseEnter={() => matchedSkill && setShowMatchedSkillTooltip(true)}
                onMouseLeave={() => setShowMatchedSkillTooltip(false)}
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleInputKeyDown}
                  placeholder={
                    mode === 'web' ? '联网搜索最新信息...（输入/唤起Skills）' :
                    mode === 'research' ? '输入调研主题...（输入/唤起Skills）' :
                    mode === 'distributed_plan' ? '输入需要多位专家协作完成的复杂目标...（输入/唤起Skills）' :
                    mode === 'plan' ? '输入需要拆解和持续执行的复杂任务...（输入/唤起Skills）' :
                    '输入你的问题...（输入/唤起Skills）'
                  }
                  disabled={isLoading}
                  rows={1}
                  className="min-h-20 max-h-[220px] w-full resize-none rounded-xl border-0 bg-transparent px-4 py-3 text-[15px] leading-6 text-slate-900 outline-none placeholder:text-slate-400 disabled:bg-slate-100"
                />
                {/* 匹配Skill蓝色高亮（简单实现） */}
                {matchedSkill && (() => {
                  const regex = new RegExp(`/(${matchedSkill.skill_name})(?=\\s|$)`);
                  const match = input.match(regex);
                  if (!match || match.index === undefined) return null;
                  return (
                    <div className="absolute inset-0 pointer-events-none flex items-center px-4 overflow-hidden whitespace-nowrap">
                      <span className="invisible">{input.slice(0, match.index)}</span>
                      <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded px-0.5 -mx-0.5">
                        /{matchedSkill.skill_name}
                      </span>
                    </div>
                  );
                })()}
                {/* 匹配Skill描述浮窗 */}
                {showMatchedSkillTooltip && matchedSkill && (
                  <div className="absolute bottom-full left-0 mb-2 p-4 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 z-[60] text-sm leading-relaxed max-w-md pointer-events-none">
                    <div className="font-medium text-slate-900 dark:text-white mb-1">{matchedSkill.skill_name}</div>
                    <div className="text-slate-600 dark:text-slate-300">
                      {matchedSkill.description || matchedSkill.trigger_condition || `类型: ${matchedSkill.skill_type}`}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <OmniComposerToolbar
              preferredCapability={preferredCapability}
              webSearch={webSearch}
              deepThinking={deepThinking}
              disabled={isLoading || !isSessionReady}
              onCapabilityChange={(capability) => {
                setPreferredCapability((current) => {
                  const next = selectPreferredCapability(current, capability);
                  if (next === 'omni') setVideoMode('text_to_video');
                  return next;
                });
              }}
              onWebSearchChange={() => changeWebSearch(nextCapabilityMode(webSearch))}
              onDeepThinkingChange={() => changeDeepThinking(nextCapabilityMode(deepThinking))}
              modeControl={<ModeSelector value={mode} compact disabled={isLoading || !isSessionReady} menuPlacement="bottom" onChange={(nextMode) => void handleModeChange(nextMode)} />}
              attachmentControl={<div className="relative">
                <button type="button" aria-label="添加附件" aria-haspopup="menu" aria-expanded={attachmentMenuOpen} onClick={() => setAttachmentMenuOpen((open) => !open)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 hover:text-slate-950">
                  <Plus size={20}/>
                </button>
                {attachmentMenuOpen && <div role="menu" className="absolute bottom-full left-0 z-[70] mb-2 w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                  <button type="button" role="menuitem" onClick={() => openAttachmentPicker('image_url')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"><ImageIcon size={16}/>上传图片</button>
                  <button type="button" role="menuitem" onClick={() => openAttachmentPicker('video_url')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"><Video size={16}/>上传视频</button>
                  <button type="button" role="menuitem" onClick={() => openAttachmentPicker('file_url')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"><FileText size={16}/>上传文件</button>
                </div>}
                <input ref={attachmentInputRef} type="file" className="hidden" onChange={(e)=>{addLocalAttachment(e.target.files?.[0]); e.currentTarget.value='';}}/>
              </div>}
              moreControl={<div className="relative shrink-0">
                <button
                  type="button"
                  aria-label="更多工具"
                  aria-haspopup="menu"
                  aria-expanded={moreToolsOpen}
                  onClick={() => setMoreToolsOpen((open) => !open)}
                  className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                >
                  <Menu size={18}/><span className="hidden sm:inline">更多</span>
                </button>
                {moreToolsOpen && (
                  <div role="menu" aria-label="更多工具列表" className="absolute right-0 top-full z-[80] mt-2 max-h-[min(420px,60vh)] w-48 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_50px_rgba(15,23,42,0.16)]">
                    {[
                      { label: '运行设置', icon: SlidersHorizontal },
                      { label: '代码', icon: Code2 },
                      { label: '翻译', icon: Languages },
                      { label: 'AI 写作', icon: WandSparkles },
                      { label: '研究', icon: Telescope },
                      { label: 'PPT 创作', icon: Presentation },
                      { label: 'AI 生视频', icon: Video },
                      { label: 'AI 生图', icon: ImageIcon },
                    ].map(({ label, icon: ToolIcon }) => (
                      <button
                        key={label}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                           setMoreToolsOpen(false);
                           if (label === '运行设置') setIsRuntimeSettingsOpen(true);
                          if (label.includes('生图')) openImagePlaza(input);
                          if (label.includes('视频')) openVideoMarket(input);
                          if (label === '代码') setView('code-showcase');
                          if (label === 'AI 写作') void openWritingWorkspace();
                          if (label === 'PPT 创作') openPptMarket();
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                      >
                        <ToolIcon size={18} strokeWidth={1.8}/>
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>}
              modelControl={<ModelQuickSwitcher compact disabled={isLoading || !isSessionReady} preferredCapability={preferredCapability} imageModel={imageModel} videoModel={videoModel} onImageModelChange={setImageModel} onVideoModelChange={setVideoModel} videoMode={videoMode} videoParams={videoParams} onVideoParamsChange={setVideoParams}/>}
              videoModeControl={<select aria-label="视频生成模式" value={videoMode} onChange={(event) => setVideoMode(event.target.value as 'text_to_video' | 'multi_image_to_video')} className="h-9 max-w-28 rounded-lg border-0 bg-transparent px-1.5 text-xs font-medium text-slate-600 outline-none"><option value="text_to_video">单镜头生成</option><option value="multi_image_to_video">多参考生成</option></select>}
              sendControl={<button
                type="submit"
                disabled={isLoading || !input.trim() || (preferredCapability === 'video' && videoMode === 'multi_image_to_video' && !attachments.some((item) => item.type === 'image_url'))}
                aria-label="发送消息"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed ${
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
                ) : <ArrowUp size={19} strokeWidth={2.4} />}
              </button>}
            />

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

      {mode === 'research' && !isNewConversation && (
        <ResearchWorkspace
          title={selectedResearchUserMessage?.content || '深度调研报告'}
          report={rightPaneIsLiveLatestReport && (answerPacingActive || answerPacedLength > 0)
            ? (selectedResearchReportMessage?.content || '').slice(0, answerPacedLength)
            : (selectedResearchReportMessage?.content || '')}
          sources={selectedResearchSources.length > 0 || !rightPaneIsLiveLatestReport ? selectedResearchSources : researchChunks}
          loading={isLoading}
          sidebarCollapsed={isHistoryCollapsed}
          sessionId={activeSessionId || undefined}
          researchFigures={selectedResearchReportMessage?.researchFigures}
          onFiguresChange={handleResearchFiguresChange}
          onWidthChange={setResearchPaneWidthPx}
        />
      )}

      {isPlanMode && !isNewConversation && (
        <PlanWorkspace
          progress={latestPlanReportMessage?.planProgress ?? planProgress}
          report={latestPlanReportMessage?.content || latestPlanReportMessage?.streamingReport || ''}
          figures={(latestPlanReportMessage?.planFigures ?? []) as PlanFigure[]}
          loading={isLoading}
          distributed={mode === 'distributed_plan'}
          sidebarCollapsed={isHistoryCollapsed}
          sessionId={activeSessionId || undefined}
          onWidthChange={setResearchPaneWidthPx}
          onFiguresChange={handlePlanFiguresChange}
        />
      )}
      {artifactPanelState.status !== 'closed' && (
        <ArtifactPanel
          state={artifactPanelState}
          onLoaded={handleArtifactLoaded}
          onClose={handleArtifactClose}
          onDisplayModeChange={handleArtifactDisplayModeChange}
          onOpenVersion={handleArtifactOpenVersion}
          panelWidth={artifactPanelWidth}
          onPanelWidthChange={handleArtifactPanelWidthChange}
          onOpenProfessional={(artifact, version) => artifact.kind === 'image'
            ? openImageArtifactWorkspace(artifact, version)
            : artifact.kind === 'video'
              ? openVideoArtifactWorkspace(artifact, version)
              : artifact.kind === 'presentation'
                ? openPptArtifactWorkspace(version)
                : openWritingArtifactWorkspace(artifact, version)}
        />
      )}

      {/* Sidebar + Overlay + Float Button 已移除：
          搜索结果/调研精选按钮改放到每轮对话 NodeProgressPanel 标题栏（"阅读了 X 个网页"旁），
          内联第二视图渲染，不再使用全局右抽屉，保证多轮对话历史各自保留来源且刷新不丢。 */}

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
      {publishVfs && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !isPublishing) setPublishVfs(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="publish-project-title" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><h2 id="publish-project-title" className="text-lg font-semibold text-slate-950">发布到作品广场</h2><p className="mt-1 text-xs leading-5 text-slate-500">发布会保存当前代码的独立副本，删除会话后作品仍然保留。</p></div><button type="button" aria-label="关闭发布窗口" disabled={isPublishing} onClick={() => setPublishVfs(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800"><X size={18}/></button></div>
            <label className="mt-5 block text-sm font-medium text-slate-700">作品名称<input autoFocus value={publishTitle} onChange={(event) => setPublishTitle(event.target.value)} maxLength={80} className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"/></label>
            <label className="mt-4 block text-sm font-medium text-slate-700">作品封面<span className="mt-1 block text-xs font-normal text-slate-400">可上传预览截图；未选择时使用项目类型封面</span><input type="file" accept="image/png,image/jpeg,image/webp" className="mt-2 block w-full text-xs text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-medium file:text-slate-700" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { if (typeof reader.result === 'string') setPublishCoverImage(reader.result); }; reader.readAsDataURL(file); }}/></label>
            <fieldset className="mt-4"><legend className="text-sm font-medium text-slate-700">分类</legend><div className="mt-2 grid grid-cols-2 gap-2">{([['utility','实用工具'],['web','网页设计'],['interactive','娱乐互动'],['education','教育学习']] as const).map(([id,label]) => <button key={id} type="button" aria-pressed={publishCategory === id} onClick={() => setPublishCategory(id)} className={`rounded-xl border px-3 py-2 text-sm ${publishCategory === id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}</div></fieldset>
            <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={isPublishing} onClick={() => setPublishVfs(null)} className="rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">取消</button><button type="button" disabled={isPublishing || !publishTitle.trim()} onClick={() => void submitPublishedProject()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300">{isPublishing ? '发布中…' : '确认发布'}</button></div>
          </section>
        </div>
      )}
    </div>
  );
}
