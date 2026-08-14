'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Globe, X, RotateCcw, AlertTriangle, Plus } from 'lucide-react';
import type { QwenNativeSearchOptions } from '../lib/api';

interface QwenSearchOptionsPopoverProps {
  options: QwenNativeSearchOptions;
  onChange: (options: QwenNativeSearchOptions) => void;
  onReset: () => void;
  /** 当前模型 ID，用于判断 agent_max 是否可用 */
  modelId?: string;
}

/**
 * 千问原生联网搜索参数 Popover 面板。
 *
 * Why: 千问走 OpenAI 兼容协议，原生搜索参数通过 extra_body.search_options 注入，
 * 与 DeepSeek 的 Firecrawl 面板完全独立。仅在 provider==='qwen' 时渲染。
 * 官方文档明确 OpenAI 兼容协议不支持 enable_source/enable_citation/citation_format。
 */
export default function QwenSearchOptionsPopover({
  options,
  onChange,
  onReset,
  modelId,
}: QwenSearchOptionsPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Why: 点击外部自动关闭 Popover，避免遮挡输入框
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const isTurbo = options.searchStrategy === 'turbo';
  const isTurboOrMax = options.searchStrategy === 'turbo' || options.searchStrategy === 'max';
  const isAgentSeries = options.searchStrategy === 'agent' || options.searchStrategy === 'agent_max';

  // Why: agent_max 仅 qwen3-max 思考模式可用，非该模型时置灰
  const agentMaxAvailable = !modelId || /qwen3.*max/i.test(modelId);

  const strategies: Array<{
    id: QwenNativeSearchOptions['searchStrategy'];
    label: string;
    desc: string;
    extraCost: boolean;
    disabled?: boolean;
  }> = [
    { id: 'turbo', label: 'Turbo', desc: '兼顾速度与效果', extraCost: false },
    { id: 'max', label: 'Max', desc: '多源详尽，响应更长', extraCost: false },
    { id: 'agent', label: 'Agent', desc: '多轮检索，额外收费', extraCost: true },
    {
      id: 'agent_max',
      label: 'Agent Max',
      desc: '全文阅读，仅 qwen3-max 思考模式',
      extraCost: true,
      disabled: !agentMaxAvailable,
    },
  ];

  const freshnessOptions: Array<{ value: QwenNativeSearchOptions['freshness']; label: string }> = [
    { value: 0, label: '不限' },
    { value: 7, label: '7天' },
    { value: 30, label: '30天' },
    { value: 180, label: '180天' },
    { value: 365, label: '365天' },
  ];

  // Why: 限定站点 Tag 输入：回车添加，点击 × 删除，最多 25 个
  const [siteInput, setSiteInput] = useState('');
  const addSite = useCallback(() => {
    const trimmed = siteInput.trim();
    if (!trimmed) return;
    if (options.assignedSiteList.length >= 25) return;
    if (options.assignedSiteList.includes(trimmed)) {
      setSiteInput('');
      return;
    }
    onChange({ ...options, assignedSiteList: [...options.assignedSiteList, trimmed] });
    setSiteInput('');
  }, [siteInput, options, onChange]);

  const removeSite = (site: string) => {
    onChange({ ...options, assignedSiteList: options.assignedSiteList.filter((s) => s !== site) });
  };

  const hasCustomSettings =
    options.searchStrategy !== 'turbo' ||
    options.forcedSearch ||
    options.enableSearchExtension ||
    options.freshness !== 0 ||
    options.assignedSiteList.length > 0 ||
    options.promptIntervene.trim() !== '';

  return (
    <div ref={containerRef} className="relative">
      {/* 触发器：地球+齿轮图标按钮 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="千问联网搜索参数"
        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
          open || hasCustomSettings
            ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        <Globe className="h-3 w-3" />
        <span>千问搜索</span>
        {hasCustomSettings && (
          <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
        )}
      </button>

      {/* Popover 弹出层 */}
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[340px] rounded-xl border border-slate-200 bg-white shadow-xl">
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-xs font-semibold text-slate-800">
              千问原生搜索参数
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="max-h-[420px] space-y-3.5 overflow-y-auto px-4 py-3">
            {/* 1. 搜索策略 */}
            <div>
              <label className="text-[11px] font-medium text-slate-600">搜索策略</label>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                {strategies.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={s.disabled}
                    onClick={() => onChange({ ...options, searchStrategy: s.id })}
                    className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
                      options.searchStrategy === s.id
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    } ${s.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                  >
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-semibold">{s.label}</span>
                      {s.extraCost && (
                        <span className="rounded bg-amber-100 px-1 text-[9px] text-amber-700">
                          付费
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{s.desc}</div>
                  </button>
                ))}
              </div>
              {/* agent 系列收费警告 */}
              {isAgentSeries && (
                <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    此策略每次调用额外收费，且仅 search_strategy 生效，
                    其他参数（时效性/限定站点等）将被服务端忽略。
                  </span>
                </div>
              )}
            </div>

            {/* 2. 强制搜索 */}
            <div className={`space-y-1.5 ${!isTurboOrMax ? 'opacity-50' : ''}`}>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-[11px] font-medium text-slate-600">
                  强制搜索
                  <span className="ml-1 text-[10px] text-slate-400">不依赖模型判断</span>
                </span>
                <button
                  type="button"
                  disabled={!isTurboOrMax}
                  onClick={() => onChange({ ...options, forcedSearch: !options.forcedSearch })}
                  className={`relative h-4 w-7 rounded-full transition-colors ${
                    options.forcedSearch ? 'bg-blue-500' : 'bg-slate-300'
                  } ${!isTurboOrMax ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                      options.forcedSearch ? 'left-3.5' : 'left-0.5'
                    }`}
                  />
                </button>
              </label>
            </div>

            {/* 3. 垂域搜索 */}
            <div className={`space-y-1.5 ${!isTurboOrMax ? 'opacity-50' : ''}`}>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-[11px] font-medium text-slate-600">
                  垂域搜索
                  <span className="ml-1 text-[10px] text-slate-400">天气/股票/汇率</span>
                </span>
                <button
                  type="button"
                  disabled={!isTurboOrMax}
                  onClick={() =>
                    onChange({ ...options, enableSearchExtension: !options.enableSearchExtension })
                  }
                  className={`relative h-4 w-7 rounded-full transition-colors ${
                    options.enableSearchExtension ? 'bg-blue-500' : 'bg-slate-300'
                  } ${!isTurboOrMax ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                      options.enableSearchExtension ? 'left-3.5' : 'left-0.5'
                    }`}
                  />
                </button>
              </label>
            </div>

            {/* 4. 时效性（仅 turbo 生效） */}
            <div className={`space-y-1.5 ${!isTurbo ? 'opacity-50' : ''}`}>
              <label className="text-[11px] font-medium text-slate-600">
                时效性
                <span className="ml-1 text-[10px] text-slate-400">仅 Turbo 生效</span>
              </label>
              <div className="grid grid-cols-5 gap-1 rounded-lg bg-slate-100 p-1">
                {freshnessOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={!isTurbo}
                    onClick={() => onChange({ ...options, freshness: opt.value })}
                    className={`rounded-md px-1 py-1 text-[10px] font-medium transition-colors ${
                      options.freshness === opt.value
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    } ${!isTurbo ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 5. 限定来源站点（仅 turbo 生效） */}
            <div className={`space-y-1.5 ${!isTurbo ? 'opacity-50' : ''}`}>
              <label className="text-[11px] font-medium text-slate-600">
                限定来源站点
                <span className="ml-1 text-[10px] text-slate-400">
                  仅 Turbo · 最多 25 个 · 已 {options.assignedSiteList.length}/25
                </span>
              </label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={siteInput}
                  disabled={!isTurbo}
                  onChange={(e) => setSiteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSite();
                    }
                  }}
                  placeholder="baidu.com"
                  className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 focus:border-blue-400 focus:outline-none disabled:bg-slate-50"
                />
                <button
                  type="button"
                  disabled={!isTurbo || !siteInput.trim() || options.assignedSiteList.length >= 25}
                  onClick={addSite}
                  className="rounded-md bg-slate-100 px-2 text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Tag 列表 */}
              {options.assignedSiteList.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {options.assignedSiteList.map((site) => (
                    <span
                      key={site}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600"
                    >
                      {site}
                      <button
                        type="button"
                        onClick={() => removeSite(site)}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 6. 检索范围引导（仅 turbo 生效） */}
            <div className={`space-y-1.5 ${!isTurbo ? 'opacity-50' : ''}`}>
              <label className="text-[11px] font-medium text-slate-600">
                检索范围引导
                <span className="ml-1 text-[10px] text-slate-400">
                  仅 Turbo · {options.promptIntervene.length}/200 字
                </span>
              </label>
              <textarea
                value={options.promptIntervene}
                disabled={!isTurbo}
                onChange={(e) =>
                  onChange({
                    ...options,
                    promptIntervene: e.target.value.slice(0, 200),
                  })
                }
                placeholder="例如：仅检索 AI 技术相关内容"
                rows={2}
                className="w-full resize-none rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 focus:border-blue-400 focus:outline-none disabled:bg-slate-50"
              />
            </div>
          </div>

          {/* 底部操作栏 */}
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700"
            >
              <RotateCcw className="h-3 w-3" />
              恢复默认
            </button>
            <span className="text-[10px] text-slate-400">千问原生搜索 · 会话级</span>
          </div>
        </div>
      )}
    </div>
  );
}
