'use client';

import { ResearchProcessEvent } from '../lib/api';

interface ResearchProgressPanelProps {
  progress: ResearchProcessEvent;
}

const STAGE_CONFIG = {
  fanout: {
    icon: '📡',
    label: '裂变意图',
    desc: '将研究课题进行多路意图裂变',
    color: 'blue',
  },
  fetch: {
    icon: '🌐',
    label: '全网抓取',
    desc: '并发抓取多路搜索结果网页',
    color: 'green',
  },
  chunk: {
    icon: '✂️',
    label: '细粒度切片',
    desc: '将网页内容切分为高密度小片段',
    color: 'yellow',
  },
  rerank: {
    icon: '🎯',
    label: 'Reranker 精选',
    desc: '使用 BGE-Reranker 交叉熵重排打分',
    color: 'orange',
  },
  reason: {
    icon: '🧠',
    label: 'R1 深度思考',
    desc: '使用 DeepSeek-R1 进行长思维链推理',
    color: 'purple',
  },
} as const;

// Why: 千问深度调研四阶段（planning→searching→analyzing→writing），
//   与自研链路五阶段互不冲突，按 stage 前缀自动路由。
const QWEN_STAGE_CONFIG = {
  planning: {
    icon: '🤔',
    label: '反问确认',
    desc: '模型提出澄清问题帮助聚焦方向',
    color: 'blue',
  },
  searching: {
    icon: '🔍',
    label: '深度搜索',
    desc: '多轮联网搜索收集资料',
    color: 'green',
  },
  analyzing: {
    icon: '📊',
    label: '分析整合',
    desc: '分析搜索结果并提取关键信息',
    color: 'orange',
  },
  writing: {
    icon: '️',
    label: '撰写报告',
    desc: '生成结构化深度研究报告',
    color: 'purple',
  },
  complete: {
    icon: '✅',
    label: '研究完成',
    desc: '深度研究报告已生成',
    color: 'green',
  },
} as const;

const STAGE_ORDER = ['fanout', 'fetch', 'chunk', 'rerank', 'reason'] as const;
const QWEN_STAGE_ORDER = ['planning', 'searching', 'analyzing', 'writing', 'complete'] as const;

const COLOR_CLASSES = {
  blue: {
    bar: 'bg-blue-500',
    text: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-200',
    badge: 'bg-blue-100 text-blue-700',
    light: 'bg-blue-100/50',
  },
  green: {
    bar: 'bg-green-500',
    text: 'text-green-600',
    bg: 'bg-green-50 border-green-200',
    badge: 'bg-green-100 text-green-700',
    light: 'bg-green-100/50',
  },
  yellow: {
    bar: 'bg-yellow-500',
    text: 'text-yellow-600',
    bg: 'bg-yellow-50 border-yellow-200',
    badge: 'bg-yellow-100 text-yellow-700',
    light: 'bg-yellow-100/50',
  },
  orange: {
    bar: 'bg-orange-500',
    text: 'text-orange-600',
    bg: 'bg-orange-50 border-orange-200',
    badge: 'bg-orange-100 text-orange-700',
    light: 'bg-orange-100/50',
  },
  purple: {
    bar: 'bg-purple-500',
    text: 'text-purple-600',
    bg: 'bg-purple-50 border-purple-200',
    badge: 'bg-purple-100 text-purple-700',
    light: 'bg-purple-100/50',
  },
};

export default function ResearchProgressPanel({ progress }: ResearchProgressPanelProps) {
  // Why: 根据 stage 自动路由到对应的阶段配置（自研链路五阶段 vs 千问四阶段）。
  //   Agent Loop 模式下 stage 为 `iteration_N_think/search/observe/final`，走 fallback 渲染。
  const isQwenStage = QWEN_STAGE_ORDER.includes(progress.stage as (typeof QWEN_STAGE_ORDER)[number]);
  const isLegacyStage = STAGE_ORDER.includes(progress.stage as (typeof STAGE_ORDER)[number]);

  const stageConfig = isQwenStage
    ? QWEN_STAGE_CONFIG[progress.stage as keyof typeof QWEN_STAGE_CONFIG]
    : isLegacyStage
    ? STAGE_CONFIG[progress.stage as (typeof STAGE_ORDER)[number]]
    : STAGE_CONFIG.fanout; // fallback

  const stageOrder: readonly string[] = isQwenStage ? QWEN_STAGE_ORDER : STAGE_ORDER;
  const currentIndex = stageOrder.indexOf(stageConfig === STAGE_CONFIG.fanout ? 'fanout' : progress.stage);
  const colors = COLOR_CLASSES[stageConfig.color];
  const isRunning = progress.status === 'running';
  const isDone = progress.status === 'done';

  return (
    <div className={`rounded-xl border p-4 ${colors.bg}`}>
      {/* 阶段标题 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">{stageConfig.icon}</span>
          <span className="font-semibold text-gray-900">{stageConfig.label}</span>
          <span className="text-sm text-gray-500">— {stageConfig.desc}</span>
        </div>
        {isRunning && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: `${colors.bar} transparent transparent transparent` }} />
            <span className={`text-sm font-medium ${colors.text}`}>处理中...</span>
          </div>
        )}
        {isDone && (
          <span className="text-sm text-green-600 font-medium">✓ 完成</span>
        )}
      </div>

      {/* 阶段流水线指示器 */}
      <div className="flex items-center gap-0 mb-4">
        {stageOrder.map((stage, idx) => {
          const cfg = isQwenStage
            ? QWEN_STAGE_CONFIG[stage as keyof typeof QWEN_STAGE_CONFIG]
            : STAGE_CONFIG[stage as (typeof STAGE_ORDER)[number]];
          const stageColors = COLOR_CLASSES[cfg.color];
          const isPast = currentIndex > idx || (currentIndex === idx && isDone);

          return (
            <div key={stage} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${
                    isPast ? `${stageColors.bar} text-white` : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {isPast ? '✓' : cfg.icon}
                </div>
                <span className={`text-xs mt-1 ${isPast ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
                  {cfg.label}
                </span>
              </div>
              {idx < stageOrder.length - 1 && (
                <div className={`w-12 h-0.5 mx-1 ${currentIndex > idx ? stageColors.bar : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* 阶段数据展示 */}
      {isDone && progress.status === 'done' && (
        <div className="space-y-3">
          {/* Fanout: 搜索词列表 */}
          {progress.stage === 'fanout' && progress.queries && (
            <div className="bg-white/60 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-2 font-medium">
                广播生成 {progress.queries.length} 个并行搜索通道:
              </p>
              <ul className="space-y-1">
                {progress.queries.map((q, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                    <span className="text-gray-400 font-mono text-xs shrink-0 mt-0.5">[{i + 1}]</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Fetch: 抓取的页面列表 */}
          {progress.stage === 'fetch' && progress.pages && (
            <div className="bg-white/60 rounded-lg p-3">
              <p className="text-xs text-gray-500 mb-2 font-medium">
                成功抓取到 {progress.pages.length} 篇不重复的全网网页内容:
              </p>
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {progress.pages.map((page, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-gray-400 font-mono text-xs shrink-0 mt-0.5">[{i + 1}]</span>
                    <div className="min-w-0">
                      <span className="text-gray-800">{page.title}</span>
                      <a
                        href={page.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-blue-500 hover:text-blue-700 truncate max-w-xs"
                      >
                        {page.url}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Chunk: 切片数量 */}
          {progress.stage === 'chunk' && (
            <div className="bg-white/60 rounded-lg p-3">
              <p className="text-sm text-gray-700">
                原始文本切割完成！共生成
                <span className={`ml-1 font-bold ${colors.text}`}>{progress.chunk_count || progress.count}</span>
                个待精炼切片
              </p>
            </div>
          )}

          {/* Rerank: 精选片段列表 */}
          {progress.stage === 'rerank' && progress.top_chunks && (
            <div className="space-y-2">
              <p className="text-sm text-gray-700">
                已从 {progress.count} 条数据中提炼出得分最高的
                <span className={`ml-1 font-bold ${colors.text}`}>{progress.top_chunks.length}</span>
                条金子切片:
              </p>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {progress.top_chunks.map((chunk) => (
                  <div key={chunk.id} className={`${colors.light} rounded-lg p-3`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="font-medium text-gray-900 text-sm line-clamp-1 flex-1">
                        {chunk.title}
                      </h4>
                      <span className={`${colors.badge} text-xs px-1.5 py-0.5 rounded-full shrink-0 font-mono`}>
                        {(chunk.score as number).toFixed(4)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-2 mb-2">
                      {chunk.text}
                    </p>
                    <a
                      href={chunk.url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      {chunk.url as string}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Running 状态提示 */}
      {isRunning && progress.message && (
        <div className="text-sm text-gray-500 italic">
          {progress.message}
        </div>
      )}
    </div>
  );
}
