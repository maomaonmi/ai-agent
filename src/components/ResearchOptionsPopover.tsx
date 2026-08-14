'use client';

import { useState, useRef, useEffect } from 'react';
import { Microscope, X, RotateCcw } from 'lucide-react';
import type { ResearchOptions } from '../lib/api';
import { DEFAULT_RESEARCH_OPTIONS } from '../lib/api';

interface ResearchOptionsPopoverProps {
  options: ResearchOptions;
  onChange: (options: ResearchOptions) => void;
  onReset: () => void;
}

/**
 * Firecrawl Deep Research 参数 Popover。
 *
 * Why: 仅在调研模式 + Firecrawl 深度研究引擎时显示，
 *   控制 maxDepth/timeLimit/maxUrls 三个核心参数。
 *   仿 FirecrawlSearchOptionsPopover / QwenSearchOptionsPopover 的交互模式。
 */
export default function ResearchOptionsPopover({
  options,
  onChange,
  onReset,
}: ResearchOptionsPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    options.maxDepth !== DEFAULT_RESEARCH_OPTIONS.maxDepth ||
    options.timeLimit !== DEFAULT_RESEARCH_OPTIONS.timeLimit ||
    options.maxUrls !== DEFAULT_RESEARCH_OPTIONS.maxUrls;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="深度研究参数"
        className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
          open || hasCustomSettings
            ? 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-300'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
      >
        <Microscope className="h-3 w-3" />
        <span>研究参数</span>
        {hasCustomSettings && (
          <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-indigo-500" />
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[300px] rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-xs font-semibold text-slate-800">
              Firecrawl 深度研究参数
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-3.5 px-4 py-3">
            {/* maxDepth */}
            <div>
              <label className="text-[11px] font-medium text-slate-600">
                研究深度
                <span className="ml-1 text-[10px] text-slate-400">1-12 级迭代</span>
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={options.maxDepth}
                  onChange={(e) =>
                    onChange({
                      ...options,
                      maxDepth: Math.max(1, Math.min(12, Number(e.target.value) || 7)),
                    })
                  }
                  className="flex-1 accent-indigo-500"
                />
                <span className="w-8 text-center text-xs font-semibold text-slate-700">
                  {options.maxDepth}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-slate-400">
                数值越大搜索越深，但耗时越长
              </p>
            </div>

            {/* timeLimit */}
            <div>
              <label className="text-[11px] font-medium text-slate-600">
                时间限制
                <span className="ml-1 text-[10px] text-slate-400">30-600 秒</span>
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="range"
                  min={30}
                  max={600}
                  step={30}
                  value={options.timeLimit}
                  onChange={(e) =>
                    onChange({
                      ...options,
                      timeLimit: Math.max(30, Math.min(600, Number(e.target.value) || 300)),
                    })
                  }
                  className="flex-1 accent-indigo-500"
                />
                <span className="w-12 text-center text-xs font-semibold text-slate-700">
                  {options.timeLimit}s
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-slate-400">
                研究任务最长运行时间
              </p>
            </div>

            {/* maxUrls */}
            <div>
              <label className="text-[11px] font-medium text-slate-600">
                最大来源数
                <span className="ml-1 text-[10px] text-slate-400">1-1000 个 URL</span>
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={Math.min(options.maxUrls, 100)}
                  onChange={(e) =>
                    onChange({
                      ...options,
                      maxUrls: Math.max(1, Math.min(1000, Number(e.target.value) || 20)),
                    })
                  }
                  className="flex-1 accent-indigo-500"
                />
                <span className="w-8 text-center text-xs font-semibold text-slate-700">
                  {options.maxUrls}
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-slate-400">
                每个 URL 消耗 1 credit
              </p>
            </div>

            {/* Credit 估算 */}
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] text-slate-500">
              预计消耗约 <span className="font-semibold text-slate-700">{options.maxUrls}</span> credits ·
              耗时最多 <span className="font-semibold text-slate-700">{options.timeLimit}s</span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700"
            >
              <RotateCcw className="h-3 w-3" />
              恢复默认
            </button>
            <span className="text-[10px] text-slate-400">Firecrawl Deep Research</span>
          </div>
        </div>
      )}
    </div>
  );
}
