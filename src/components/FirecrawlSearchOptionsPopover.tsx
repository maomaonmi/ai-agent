'use client';

import { useState, useRef, useEffect } from 'react';
import { Globe, X, RotateCcw } from 'lucide-react';
import type { WebSearchOptions } from '../lib/api';
import { DEFAULT_WEB_SEARCH_OPTIONS } from '../lib/api';

interface FirecrawlSearchOptionsPopoverProps {
  options: WebSearchOptions;
  onChange: (options: WebSearchOptions) => void;
  onReset: () => void;
}

/**
 * Firecrawl 搜索参数 Popover 面板（输入框旁触发，仿 QwenSearchOptionsPopover）。
 *
 * Why: 仅 DeepSeek 走 web_search_node → Firecrawl 独立搜索链路时生效，
 *   GLM/Qwen 走原生联网不吃这些参数，ChatInterface 中按 provider 条件渲染。
 *   放在输入框旁而非运行设置抽屉里，因为用户每次搜索都可能想调参数（和官方 Playground 一样）。
 */
export default function FirecrawlSearchOptionsPopover({
  options,
  onChange,
  onReset,
}: FirecrawlSearchOptionsPopoverProps) {
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

  const hasCustomSettings =
    options.limit !== DEFAULT_WEB_SEARCH_OPTIONS.limit ||
    options.timeRange !== DEFAULT_WEB_SEARCH_OPTIONS.timeRange ||
    options.location !== DEFAULT_WEB_SEARCH_OPTIONS.location ||
    options.scrapeTopN !== DEFAULT_WEB_SEARCH_OPTIONS.scrapeTopN ||
    options.highlights !== DEFAULT_WEB_SEARCH_OPTIONS.highlights;

  const timeRangeOptions: Array<{ id: WebSearchOptions['timeRange']; label: string }> = [
    { id: '', label: '不限' },
    { id: 'd', label: '24h' },
    { id: 'w', label: '1周' },
    { id: 'm', label: '1月' },
    { id: 'y', label: '1年' },
  ];

  return (
    <div ref={containerRef} className="relative">
      {/* 触发器：地球+齿轮图标按钮 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Firecrawl 搜索参数"
        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
          open || hasCustomSettings
            ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        <Globe className="h-3 w-3" />
        <span>搜索参数</span>
        {hasCustomSettings && (
          <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
        )}
      </button>

      {/* Popover 弹出层 */}
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[320px] rounded-xl border border-slate-200 bg-white shadow-xl">
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-xs font-semibold text-slate-800">
              Firecrawl 搜索参数
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
            {/* 1. 返回条数 */}
            <div>
              <label className="text-[11px] font-medium text-slate-600">
                返回条数
                <span className="ml-1 text-[10px] text-slate-400">1-20</span>
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={options.limit}
                  onChange={(e) =>
                    onChange({
                      ...options,
                      limit: Math.max(1, Math.min(20, Number(e.target.value) || 10)),
                    })
                  }
                  className="flex-1 accent-blue-500"
                />
                <span className="w-8 text-center text-xs font-semibold text-slate-700">
                  {options.limit}
                </span>
              </div>
            </div>

            {/* 2. 时效性 */}
            <div>
              <label className="text-[11px] font-medium text-slate-600">时效性</label>
              <div className="mt-1.5 grid grid-cols-5 gap-1 rounded-lg bg-slate-100 p-1">
                {timeRangeOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChange({ ...options, timeRange: opt.id })}
                    className={`rounded-md px-1 py-1.5 text-[10px] font-medium transition-colors ${
                      options.timeRange === opt.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. 地域倾斜 */}
            <div>
              <label className="text-[11px] font-medium text-slate-600">地域倾斜</label>
              <select
                value={options.location}
                onChange={(e) => onChange({ ...options, location: e.target.value })}
                className="mt-1.5 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-blue-400 focus:outline-none"
              >
                <option value="">全球（无偏）</option>
                <option value="China">中国</option>
                <option value="United States">美国</option>
                <option value="Japan">日本</option>
              </select>
            </div>

            {/* 4. 全文抓取 Top N */}
            <div>
              <label className="text-[11px] font-medium text-slate-600">
                全文抓取 Top N
                <span className="ml-1 text-[10px] text-slate-400">0=只用摘要 · 0-10</span>
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={10}
                  value={options.scrapeTopN}
                  onChange={(e) =>
                    onChange({
                      ...options,
                      scrapeTopN: Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                    })
                  }
                  className="flex-1 accent-blue-500"
                />
                <span className="w-8 text-center text-xs font-semibold text-slate-700">
                  {options.scrapeTopN}
                </span>
              </div>
            </div>

            {/* 5. 高亮摘要 */}
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-slate-600">
                显示高亮摘要
              </label>
              <button
                type="button"
                onClick={() =>
                  onChange({ ...options, highlights: !options.highlights })
                }
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  options.highlights ? 'bg-blue-500' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    options.highlights ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Credit 估算 */}
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-500">
              预计消耗约 <span className="font-semibold text-slate-700">{options.limit + options.scrapeTopN}</span> credits/轮
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
            <span className="text-[10px] text-slate-400">Firecrawl · 会话级</span>
          </div>
        </div>
      )}
    </div>
  );
}
