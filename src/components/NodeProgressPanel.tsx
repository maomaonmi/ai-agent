import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  ExternalLink,
  Check,
} from 'lucide-react';
import { NodeEvent, WebDoc, ResearchChunk, AgentLoopStageKind } from '../lib/api';

interface NodeProgressPanelProps {
  nodeProgress: NodeEvent[];
  currentNode: string | null;
  open: boolean;
  onToggle: () => void;
  webDocs?: WebDoc[];
  researchChunks?: ResearchChunk[];
  /** Why fallback：老快照 DeepThinker extras 里没有 reasoning_full，需从 ChatMessage 兜底读取 */
  researchReasoningFallback?: string;
}

type InlineView = 'timeline' | 'sources';

/**
 * 融入背景的紧凑 Agent 时间轴（参考 Kimi/Dot）：
 * - 无卡片、无边框、无阴影，直接靠在聊天消息背景上
 * - 每个节点一行：小状态点 + 阶段名 + 消息，信息密度高
 * - Agent Loop 模式：按 iteration 分组渲染 Think/Search/Observe/Final 子节点
 * - 旧链路（fanout/fetch/chunk/rerank/reason）：无 iteration 字段，按时间序平铺
 * - 搜索来源以内联紧凑列表呈现，不另开抽屉
 * - 深度思考可展开，展开后像正文段落一样平铺
 */
export default function NodeProgressPanel({
  nodeProgress,
  currentNode,
  open,
  onToggle,
  webDocs,
  researchChunks,
  researchReasoningFallback,
}: NodeProgressPanelProps) {
  if (nodeProgress.length === 0 && !currentNode) return null;

  const readCount = Math.max(
    0,
    ...nodeProgress.map((e) => (e.kept_count != null ? e.kept_count : e.hit_count ?? 0)),
  );
  const isHistoricalFallback = nodeProgress.some((event) => event.extras?.history_fallback === true);

  const thinkingTime = useMemo(() => {
    const start = nodeProgress[0]?.timestamp_ms;
    const end = [...nodeProgress].reverse().find((e) => e.status === 'completed')?.timestamp_ms;
    if (!start) return 0;
    const baseMs = end ? end - start : Date.now() - start;
    const fromExtras = nodeProgress
      .flatMap((e) => (typeof e.extras?.reasoning_time === 'number' ? [e.extras.reasoning_time as number] : []))
      .reduce((a, b) => a + b, 0);
    return Math.max(1, Math.round(baseMs / 1000) + Math.round(fromExtras));
  }, [nodeProgress]);

  const [inlineView, setInlineView] = useState<InlineView>('timeline');
  const [expandedNodeId, setExpandedNodeId] = useState<number | string | null>(null);

  const toggleNode = (id: number | string | undefined) => {
    if (id == null) return;
    setExpandedNodeId((prev) => (prev === id ? null : id));
  };

  const sources = useMemo<SourceItem[]>(() => {
    if (researchChunks && researchChunks.length > 0) {
      return researchChunks.map((c, i) => {
        const cast = c as unknown as { title?: string; text?: string; content?: string; url?: string; score?: number };
        return {
          id: `${c.id ?? i}`,
          title: cast.title || '未命名片段',
          url: cast.url,
          description: cast.text || cast.content || '',
          score: cast.score,
          kind: 'chunk' as const,
        };
      });
    }
    if (webDocs && webDocs.length > 0) {
      return webDocs.map((d, i) => ({
        id: `${d.id ?? i}`,
        title: d.title || '未命名页面',
        url: d.url,
        description: d.content || '',
        score: d.score,
        kind: 'web' as const,
      }));
    }
    return [];
  }, [researchChunks, webDocs]);

  const faviconDots = useMemo(() => {
    const palette = ['#FF5D3B', '#22C55E', '#3B82F6', '#A855F7', '#F59E0B', '#10B981'];
    return sources.slice(0, 6).map((s, i) => ({
      color: palette[(s.url?.length ?? i) % palette.length],
      id: `${s.id}-${i}`,
    }));
  }, [sources]);

  // Why（Agent Loop 重构）：移除原"连续重复 completed 合并"的 compactProgress 逻辑。
  //   Agent Loop 模式下同名 Think/Search/Observe/Final 节点会跨轮重复，合并去重会把多轮迭代压成一条
  //   导致用户看不到完整循环过程。改为按 iteration 分组 + 时间序平铺双路径渲染。
  const renderItems = useMemo(() => buildRenderItems(nodeProgress), [nodeProgress]);

  return (
    <div className="w-full max-w-[820px]">
      {/* 折叠标题：一行 meta，无背景 */}
      <button
        type="button"
        onClick={onToggle}
        className="group flex w-full items-center gap-2 py-2 text-left text-[13px] text-gray-500 hover:text-gray-700"
        aria-label={open ? '收起链路' : '展开链路'}
      >
        <span className="flex-none text-sky-500">
          {currentNode ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="font-medium text-gray-700">{isHistoricalFallback ? '历史链路摘要' : '已思考'}</span>
        <span className="tabular-nums">{isHistoricalFallback ? '（旧会话已完成）' : `（用时 ${thinkingTime} 秒）`}</span>
        {readCount > 0 && (
          <>
            <span className="text-gray-300">·</span>
            <span>搜索到 <span className="tabular-nums font-medium text-gray-700">{readCount}</span> 个网页</span>
          </>
        )}
        {faviconDots.length > 0 && (
          <span className="ml-1 -space-x-1 inline-flex items-center">
            {faviconDots.map((d, i) => (
              <span
                key={d.id}
                className="h-3.5 w-3.5 rounded-full border border-white inline-block"
                style={{ backgroundColor: d.color, zIndex: faviconDots.length - i }}
              />
            ))}
          </span>
        )}
        {sources.length > 0 && (
          <>
            <span className="text-gray-300">·</span>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); setInlineView(inlineView === 'sources' ? 'timeline' : 'sources'); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setInlineView(inlineView === 'sources' ? 'timeline' : 'sources'); } }}
              className="cursor-pointer underline-offset-2 hover:underline"
            >
              {inlineView === 'sources' ? '返回过程' : `${sources.length} 条来源`}
            </span>
          </>
        )}
        <span className="ml-auto text-gray-400 transition-colors group-hover:text-gray-600">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {/* 时间轴 */}
      {open && inlineView === 'timeline' && (
        <ul className="relative ml-0.5 border-l border-gray-100 pl-[18px] pb-1">
          {renderItems.map((item, index) => {
            if (item.type === 'iteration_header') {
              return (
                <li
                  key={`iter-header-${item.iteration}`}
                  className="relative py-1.5 leading-relaxed"
                >
                  <span className="absolute -left-[21px] top-2.5 flex h-4 w-4 items-center justify-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                  </span>
                  <div className="text-[12px] font-medium text-gray-500">
                    迭代 {item.iteration}
                  </div>
                </li>
              );
            }
            const entry = item.entry;
            const nodeId = entry.id ?? `n-${index}`;
            const isProcessing = entry.status === 'processing';
            const isExpanded = expandedNodeId === nodeId;
            const sem = stageSemantic(entry.node_name, entry.status, entry.stageKind);

            const extrasObj = (entry.extras as Record<string, unknown> | undefined) ?? {};
            // Why: Agent Loop Think 节点 reasoning 优先读 thought_snippet（新格式），
            //   旧 DeepThinker 节点读 reasoning_full；researchReasoningFallback 作最后兜底。
            const thoughtSnippet = typeof extrasObj.thought_snippet === 'string'
              ? (extrasObj.thought_snippet as string)
              : '';
            const reasoningFromExtras = typeof extrasObj.reasoning_full === 'string'
              ? (extrasObj.reasoning_full as string)
              : '';
            // Why: Think 节点（Agent Loop 新格式）显示 thought_snippet；DeepThinker（旧 reason 链路）显示 reasoning_full。
            const isAgentLoopThink = entry.stageKind === 'think' || entry.node_name === 'Think';
            const isLegacyDeepThinker = entry.node_name === 'DeepThinker';
            const showThinkReasoning =
              isAgentLoopThink &&
              entry.status === 'completed' &&
              thoughtSnippet.length > 0;
            const showLegacyReasoning =
              isLegacyDeepThinker &&
              entry.status === 'completed' &&
              (reasoningFromExtras.length > 0 || (researchReasoningFallback?.length ?? 0) > 0);
            const activeReasoningText = isAgentLoopThink
              ? thoughtSnippet
              : (reasoningFromExtras.length > 0
                  ? reasoningFromExtras
                  : (researchReasoningFallback ?? ''));

            // Why: Agent Loop Search 节点展示 tool_name + tool_input 摘要
            const toolName = typeof extrasObj.tool_name === 'string'
              ? (extrasObj.tool_name as string)
              : '';
            const toolInput = extrasObj.tool_input as Record<string, unknown> | undefined;
            const observationSummary = typeof extrasObj.observation_summary === 'string'
              ? (extrasObj.observation_summary as string)
              : '';

            const pages =
              Array.isArray(entry.extras?.pages) && (entry.extras.pages as Array<unknown>).length > 0
                ? (entry.extras.pages as Array<{ title?: string; url?: string }>)
                    .filter((p) => p && typeof p === 'object' && (p.title || p.url))
                    .slice(0, 5)
                : null;
            const totalPagesCount = Array.isArray(entry.extras?.pages)
              ? (entry.extras.pages as unknown[]).length
              : 0;

            return (
              <li key={nodeId} className="relative py-1.5 leading-relaxed">
                <span className="absolute -left-[21px] top-2.5 flex h-4 w-4 items-center justify-center">
                  {isProcessing ? (
                    <span className="h-2 w-2 rounded-full border-2 border-gray-200 border-t-gray-500 animate-spin" />
                  ) : entry.status === 'completed' ? (
                    <span className={`h-2 w-2 rounded-full ${sem.dotBg}`} />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-gray-200" />
                  )}
                </span>

                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
                  <span className="text-gray-400">{sem.label}</span>
                  <span className="text-gray-800">
                    {cleanMessage(entry.message) ?? (isProcessing ? '执行中…' : '完成')}
                  </span>
                  {toolName && (
                    <span className="text-[12px] text-gray-500">工具 · {toolName}</span>
                  )}
                  {toolInput && (
                    <ToolInputSummary toolInput={toolInput} />
                  )}
                  {entry.hit_count != null && entry.hit_count > 0 && (
                    <span className="text-[12px] text-gray-400">命中 {entry.hit_count}</span>
                  )}
                  {entry.kept_count != null && entry.kept_count > 0 && (
                    <span className="text-[12px] text-gray-400">保留 {entry.kept_count}</span>
                  )}
                </div>

                {observationSummary && (
                  <div className="mt-0.5 text-[12.5px] text-gray-500">
                    观察 · {observationSummary}
                  </div>
                )}

                {pages && pages.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {pages.map((p, i) => (
                      <a
                        key={`${p.url ?? i}`}
                        href={p.url || '#'}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="group inline-flex max-w-full items-center gap-1 text-[12.5px] text-gray-600 hover:text-gray-900"
                      >
                        <span className="truncate underline decoration-gray-200 underline-offset-2 group-hover:decoration-gray-500">
                          {p.title?.trim() || p.url || '未命名页面'}
                        </span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-gray-300 group-hover:text-gray-500" />
                      </a>
                    ))}
                    {totalPagesCount > pages.length && (
                      <button
                        type="button"
                        onClick={() => toggleNode(nodeId)}
                        className="text-[12px] text-gray-500 hover:text-gray-700"
                      >
                        查看全部（{totalPagesCount}）
                      </button>
                    )}
                  </div>
                )}

                {(showThinkReasoning || showLegacyReasoning) && (
                  <div className="mt-1.5">
                    <button
                      type="button"
                      onClick={() => toggleNode(nodeId)}
                      className="text-[12px] text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline"
                    >
                      {isExpanded ? '收起思考脉络' : '展开思考脉络'}
                    </button>
                    {isExpanded && (
                      <div className="mt-2 whitespace-pre-wrap text-[13px] leading-7 text-gray-700">
                        {activeReasoningText}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 来源内联列表 */}
      {open && inlineView === 'sources' && sources.length > 0 && (
        <div className="mt-1 space-y-2">
          {sources.map((s, i) => (
            <a
              key={s.id}
              href={s.url || '#'}
              target="_blank"
              rel="noreferrer noopener"
              className="group block py-1"
            >
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <span className="rounded bg-gray-100 px-1 py-0.5 text-gray-600 tabular-nums">#{i + 1}</span>
                {s.score != null && <span>相关度 {Number(s.score).toFixed(3)}</span>}
                <ExternalLink className="ml-auto h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
              </div>
              <div className="mt-0.5 text-[13px] font-medium text-gray-800 group-hover:text-sky-700">
                {s.title}
              </div>
              <div className="line-clamp-2 text-[12.5px] leading-5 text-gray-500">
                {s.description}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

interface SourceItem {
  id: string;
  title: string;
  url?: string;
  description?: string;
  score?: number;
  kind: 'web' | 'chunk';
}

// Why: 时间轴渲染项——iteration_header 用于在两轮迭代之间插入"迭代 N"小标题，
//   node 项承载具体节点。无 iteration 字段的旧链路节点会按时间序平铺，不插入 header。
type RenderItem =
  | { type: 'iteration_header'; iteration: number }
  | { type: 'node'; entry: NodeEvent };

// Why: 把扁平 nodeProgress 列表转换为带 iteration header 的渲染序列。
//   - 同一 iteration 的多个节点之间不重复插入 header（只在第一次出现时插入）。
//   - 无 iteration 字段（旧链路 fanout/fetch/chunk/rerank/reason）的节点不插入 header，按时间序平铺。
//   - Agent Loop final 节点归属其所在 iteration，不单独分组。
function buildRenderItems(nodeProgress: NodeEvent[]): RenderItem[] {
  const items: RenderItem[] = [];
  const seenIterations = new Set<number>();
  for (const entry of nodeProgress) {
    const iter = resolveIteration(entry);
    if (iter != null && !seenIterations.has(iter)) {
      seenIterations.add(iter);
      items.push({ type: 'iteration_header', iteration: iter });
    }
    items.push({ type: 'node', entry });
  }
  return items;
}

// Why: 优先读 NodeEvent.iteration（新字段），其次从 extras.iteration 兜底（兼容早期事件）。
//   返回 null 表示旧链路事件，按无迭代分组渲染。
function resolveIteration(entry: NodeEvent): number | null {
  if (typeof entry.iteration === 'number' && Number.isFinite(entry.iteration)) {
    return entry.iteration;
  }
  const fromExtras = (entry.extras as Record<string, unknown> | undefined)?.iteration;
  if (typeof fromExtras === 'number' && Number.isFinite(fromExtras)) {
    return fromExtras;
  }
  return null;
}

// Why: 渲染工具入参摘要——把 queries/urls/top_n 等常见字段拼成短文本，避免长 JSON 占据面板。
function ToolInputSummary({ toolInput }: { toolInput: Record<string, unknown> }) {
  const summary = useMemo(() => summarizeToolInput(toolInput), [toolInput]);
  if (!summary) return null;
  return <span className="text-[12px] text-gray-400">{summary}</span>;
}

function summarizeToolInput(toolInput: Record<string, unknown>): string | null {
  const parts: string[] = [];
  // queries: string[]
  if (Array.isArray(toolInput.queries)) {
    const qs = toolInput.queries.filter((q): q is string => typeof q === 'string');
    if (qs.length > 0) {
      parts.push(`queries=[${qs.slice(0, 2).map((q) => truncate(q, 24)).join('; ')}${qs.length > 2 ? ` …+${qs.length - 2}` : ''}]`);
    }
  }
  // urls: string[]
  if (Array.isArray(toolInput.urls)) {
    const us = toolInput.urls.filter((u): u is string => typeof u === 'string');
    if (us.length > 0) {
      parts.push(`urls=${us.length}`);
    }
  }
  // top_n / max_chars_per_page 等数字参数
  if (typeof toolInput.top_n === 'number') {
    parts.push(`top_n=${toolInput.top_n}`);
  }
  if (typeof toolInput.max_chars_per_page === 'number') {
    parts.push(`max_chars=${toolInput.max_chars_per_page}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function stageSemantic(
  nodeName: string,
  _status: string,
  stageKind?: AgentLoopStageKind,
): { dotBg: string; label: string } {
  // Why: Agent Loop stageKind 优先匹配，保证 Think/Search/Observe/Final 即使 node_name 拼写有差异也能正确着色。
  if (stageKind === 'think') return { dotBg: 'bg-violet-400', label: '思考' };
  if (stageKind === 'search') return { dotBg: 'bg-emerald-400', label: '搜索' };
  if (stageKind === 'observe') return { dotBg: 'bg-blue-400', label: '观察' };
  if (stageKind === 'final') return { dotBg: 'bg-amber-400', label: '最终答案' };

  const n = nodeName.toLowerCase();
  if (n === 'think') return { dotBg: 'bg-violet-400', label: '思考' };
  if (n === 'search') return { dotBg: 'bg-emerald-400', label: '搜索' };
  if (n === 'observe') return { dotBg: 'bg-blue-400', label: '观察' };
  if (n === 'finalanswer' || n === 'final') return { dotBg: 'bg-amber-400', label: '最终答案' };
  // Legacy fanout/fetch/chunk/rerank/reason
  if (n.includes('fanout') || n.includes('fan') || n.includes('plan')) {
    return { dotBg: 'bg-sky-400', label: '规划' };
  }
  if (n.includes('websearch') || n.includes('web') || n.includes('search') || n.includes('fetch') || n.includes('crawl')) {
    return { dotBg: 'bg-emerald-400', label: '搜索' };
  }
  if (n.includes('chunk') || n.includes('chunker') || n.includes('document')) {
    return { dotBg: 'bg-blue-400', label: '切片' };
  }
  if (n.includes('rerank') || n.includes('rank') || n.includes('select')) {
    return { dotBg: 'bg-amber-400', label: '精选' };
  }
  if (n.includes('deepthink') || n.includes('think') || n.includes('reason') || n.includes('analyst')) {
    return { dotBg: 'bg-violet-400', label: '思考' };
  }
  if (n.includes('chat')) {
    return { dotBg: 'bg-indigo-400', label: '综合' };
  }
  return { dotBg: 'bg-gray-300', label: nodeName };
}

function cleanMessage(msg: string | undefined): string | undefined {
  if (!msg) return msg;
  return msg.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1FFFF}\u{2300}-\u{23FF}️*]+/u, '').trimStart() || msg;
}
