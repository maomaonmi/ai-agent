"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Play, Plus, X } from "lucide-react";

import type { PptTemplate } from "../api";


interface TemplatePreviewDialogProps {
  template: PptTemplate;
  cover: string;
  open: boolean;
  onClose: () => void;
  onUse: (template: PptTemplate) => void;
}

const slideTitles = ["封面", "议程", "核心洞察", "数据看板", "策略路径", "案例拆解", "行动计划", "结束页"];


export default function TemplatePreviewDialog({
  template,
  cover,
  open,
  onClose,
  onUse,
}: TemplatePreviewDialogProps) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pages = useMemo(
    () => Array.from({ length: Math.min(Math.max(template.pageCount || 8, 8), 18) }, (_, index) => ({
      title: slideTitles[index % slideTitles.length],
      cover,
    })),
    [cover, template.pageCount],
  );

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ) ?? []);
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") setPage((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") setPage((current) => Math.min(pages.length - 1, current + 1));
      if (event.key === "Tab") {
        const items = focusable();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, [onClose, open, pages.length]);

  useEffect(() => {
    if (open) {
      setPage(0);
      setZoom(1);
    }
  }, [open, template.id]);

  if (!open) return null;

  const fullscreen = async () => {
    if (!stageRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await stageRef.current.requestFullscreen();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ppt-preview-title"
        className="flex h-[min(900px,94vh)] w-full max-w-[1500px] flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[#f7f7f8] shadow-[0_36px_100px_rgba(2,6,23,0.42)]"
      >
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
          <div className="min-w-0">
            <h2 id="ppt-preview-title" className="truncate text-base font-semibold text-slate-950">{template.name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">完整预览 · {pages.length} 页 · 动画将在工作台中呈现</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onUse(template)} className="hidden h-10 items-center gap-2 rounded-full bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 sm:inline-flex">
              <Play size={14} fill="currentColor" /> 使用此模板
            </button>
            <button data-autofocus type="button" onClick={onClose} aria-label="关闭模板预览" className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-950">
              <X size={20} />
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-48 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 md:block" aria-label="幻灯片列表">
            <div className="space-y-3">
              {pages.map((item, index) => (
                <button
                  key={`${item.title}-${index}`}
                  type="button"
                  aria-label={`查看第 ${index + 1} 页：${item.title}`}
                  onClick={() => setPage(index)}
                  className={`w-full rounded-xl border p-1.5 text-left transition ${page === index ? "border-violet-500 bg-violet-50" : "border-transparent hover:border-slate-300"}`}
                >
                  <div className="relative aspect-[16/9] overflow-hidden rounded-lg bg-slate-900">
                    <Image src={item.cover} alt="" fill sizes="180px" className="object-cover" />
                    <span className="absolute inset-x-2 bottom-2 truncate text-[9px] font-semibold text-white drop-shadow">{item.title}</span>
                  </div>
                  <span className="mt-1.5 block text-[11px] font-medium text-slate-500">{index + 1}. {item.title}</span>
                </button>
              ))}
            </div>
          </aside>
          <main className="relative flex min-w-0 flex-1 flex-col bg-[#eceef2]">
            <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5 sm:p-10">
              <div
                className="relative aspect-[16/9] w-full max-w-[1120px] shrink-0 overflow-hidden rounded-[4px] bg-slate-950 shadow-[0_24px_70px_rgba(15,23,42,0.22)] transition-transform"
                style={{ transform: `scale(${zoom})` }}
              >
                <Image src={pages[page].cover} alt={`第 ${page + 1} 页预览`} fill sizes="1120px" className="object-cover" priority />
                <div className={`absolute inset-0 flex p-[7%] ${page % 3 === 1 ? "items-end justify-end text-right" : page % 3 === 2 ? "items-center justify-center text-center" : "items-center"}`}>
                  <div className={`max-w-[62%] ${cover.includes("editorial") ? "text-slate-950" : "text-white"}`}>
                    <p className="mb-3 text-[clamp(10px,1.1vw,16px)] font-semibold uppercase tracking-[0.22em] opacity-70">{template.scene}</p>
                    <h3 className="text-[clamp(24px,4.2vw,62px)] font-semibold leading-[1.06] tracking-[-0.04em]">{page === 0 ? template.name : pages[page].title}</h3>
                    <p className="mt-5 max-w-xl text-[clamp(11px,1.25vw,18px)] leading-relaxed opacity-75">由 AI 规划内容、素材与版式，让观点清晰抵达每一位听众。</p>
                  </div>
                </div>
              </div>
            </div>
            <footer className="flex h-14 shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 sm:px-6">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} aria-label="上一页" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={18} /></button>
                <span className="min-w-16 text-center text-xs font-medium text-slate-500">{page + 1} / {pages.length}</span>
                <button type="button" onClick={() => setPage((current) => Math.min(pages.length - 1, current + 1))} disabled={page === pages.length - 1} aria-label="下一页" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={18} /></button>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setZoom((value) => Math.max(0.7, value - 0.1))} aria-label="缩小" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><Minus size={16} /></button>
                <span className="w-12 text-center text-[11px] font-medium text-slate-500">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setZoom((value) => Math.min(1.4, value + 0.1))} aria-label="放大" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><Plus size={16} /></button>
                <button type="button" onClick={() => void fullscreen()} aria-label="全屏预览" className="ml-1 flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><Maximize2 size={16} /></button>
              </div>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
