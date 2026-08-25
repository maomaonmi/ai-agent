"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Play, Plus, X } from "lucide-react";

import { pptApi, resolvePptAssetUrl, type PptTemplate, type PptTemplatePage } from "../api";
import type { PresentationDocument, SlideDocument, SlideElement } from "../types";


interface TemplatePreviewDialogProps {
  template: PptTemplate;
  cover: string;
  open: boolean;
  onClose: () => void;
  onUse: (template: PptTemplate) => void;
}

type PreviewPage = {
  title: string;
  thumbnail: string;
  preview: string;
  slide?: SlideDocument;
};

const slideTitles = ["封面", "议程", "核心洞察", "数据看板", "策略路径", "案例拆解", "行动计划", "结束页"];


function publishedDocumentFromTemplate(template: PptTemplate): PresentationDocument | null {
  const value = template.manifest?.presentationDocument;
  if (!value || typeof value !== "object" || !Array.isArray((value as { slides?: unknown }).slides)) return null;
  return value as PresentationDocument;
}


function assetUrl(assetId: string | undefined): string {
  return assetId ? resolvePptAssetUrl(`/api/ppt/assets/${encodeURIComponent(assetId)}/content`) : "";
}


function elementStyle(element: SlideElement): CSSProperties {
  return {
    position: "absolute",
    left: `${element.x * 100}%`,
    top: `${element.y * 100}%`,
    width: `${element.width * 100}%`,
    height: `${element.height * 100}%`,
    opacity: element.opacity,
    zIndex: element.zIndex,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    transformOrigin: "center",
  };
}


function PublishedElement({ element }: { element: SlideElement }) {
  if (element.isHidden || element.type === "GROUP") return null;
  const style = elementStyle(element);
  if (element.type === "TEXT") {
    return <div style={{ ...style, display: "flex", alignItems: element.style.verticalAlign === "TOP" ? "flex-start" : element.style.verticalAlign === "BOTTOM" ? "flex-end" : "center", justifyContent: element.style.align === "RIGHT" ? "flex-end" : element.style.align === "CENTER" ? "center" : "flex-start", color: element.style.color, fontFamily: element.style.fontFamily, fontSize: `clamp(8px, ${Math.max(0.65, element.style.fontSize / 13.333)}vw, ${Math.max(12, element.style.fontSize * 1.6)}px)`, fontWeight: element.style.bold ? 700 : 400, fontStyle: element.style.italic ? "italic" : undefined, textDecoration: element.style.underline ? "underline" : undefined, textAlign: element.style.align.toLowerCase() as CSSProperties["textAlign"], whiteSpace: "pre-wrap", overflow: "hidden", lineHeight: 1.15 }}>{element.text}</div>;
  }
  if (element.type === "IMAGE") {
    return <img src={assetUrl(element.assetId)} alt={element.alt || "演示文稿图片"} style={{ ...style, objectFit: element.fit.toLowerCase() as CSSProperties["objectFit"] }} />;
  }
  if (element.type === "SHAPE") {
    return <div style={{ ...style, background: element.fill, border: `${Math.max(1, element.strokeWidth)}px solid ${element.stroke}`, borderRadius: element.shapeType === "ELLIPSE" ? "999px" : element.shapeType === "ROUND_RECT" ? "14px" : "2px" }} />;
  }
  if (element.type === "TABLE") {
    return <div style={{ ...style, display: "grid", gridTemplateRows: `repeat(${Math.max(element.rows.length, 1)}, 1fr)`, gridTemplateColumns: `repeat(${Math.max(element.rows[0]?.length ?? 1, 1)}, 1fr)`, border: `1px solid ${element.borderColor}`, overflow: "hidden", background: "#fff", color: "#1f2937", fontSize: "clamp(7px, 0.65vw, 12px)" }}>{element.rows.flatMap((row, rowIndex) => row.map((cell, cellIndex) => <span key={`${rowIndex}-${cellIndex}`} style={{ display: "flex", alignItems: "center", padding: "2px 5px", background: cell.fill ?? (rowIndex === 0 ? "#ede9fe" : "#fff"), borderRight: `1px solid ${element.borderColor}`, borderBottom: `1px solid ${element.borderColor}`, overflow: "hidden" }}>{cell.text}</span>))}</div>;
  }
  if (element.type === "CHART") {
    const values = element.series[0]?.values ?? [];
    const max = Math.max(...values, 1);
    return <div style={{ ...style, display: "flex", alignItems: "flex-end", gap: "4%", padding: "8% 7%", borderRadius: "8px", background: "rgba(255,255,255,0.9)" }}>{values.map((value, index) => <i key={index} style={{ flex: 1, height: `${Math.max(8, (value / max) * 100)}%`, background: element.series[index % Math.max(1, element.series.length)]?.color ?? "#7657ff", borderRadius: "4px 4px 0 0" }} />)}</div>;
  }
  return <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed rgba(100,116,139,0.5)", color: "#64748b", fontSize: "clamp(8px, 0.8vw, 13px)" }}>媒体内容</div>;
}


function PublishedSlidePreview({ slide, compact = false }: { slide: SlideDocument; compact?: boolean }) {
  const background = slide.background;
  const backgroundStyle: CSSProperties = background.type === "SOLID"
    ? { background: background.color }
    : background.type === "GRADIENT"
      ? { background: `linear-gradient(${background.angle}deg, ${background.stops.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(", ")})` }
      : { background: "#0f172a" };
  return <div className="relative aspect-video w-full overflow-hidden bg-slate-950" style={backgroundStyle}>
    {background.type === "IMAGE" && <img src={assetUrl(background.assetId)} alt="幻灯片背景" className="absolute inset-0 h-full w-full" style={{ objectFit: background.fit.toLowerCase() as CSSProperties["objectFit"], opacity: background.opacity }} />}
    {slide.elements.filter((element) => !element.isHidden).sort((a, b) => a.zIndex - b.zIndex).map((element) => <PublishedElement key={element.id} element={element} />)}
    {compact && <div className="pointer-events-none absolute inset-0" />}
  </div>;
}


export default function TemplatePreviewDialog({
  template,
  cover,
  open,
  onClose,
  onUse,
}: TemplatePreviewDialogProps) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [remotePages, setRemotePages] = useState<PptTemplatePage[] | null>(null);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [resolvedTemplate, setResolvedTemplate] = useState(template);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setResolvedTemplate(template);
    setPagesLoading(true);
    setPagesError(null);
    setRemotePages(null);
    void Promise.all([
      pptApi.getTemplate(template.id, controller.signal).catch(() => template),
      pptApi.getTemplatePages(template.id, controller.signal),
    ])
      .then(([detail, result]) => {
        if (controller.signal.aborted) return;
        setResolvedTemplate(detail);
        setRemotePages(result.length > 0 ? result : detail.isPrivate ? [] : null);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (template.isPrivate) setPagesError(error instanceof Error ? error.message : "无法加载 PPT 页面");
        setRemotePages(template.isPrivate ? [] : null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPagesLoading(false);
      });
    return () => controller.abort();
  }, [open, template]);

  const publishedDocument = useMemo(() => publishedDocumentFromTemplate(resolvedTemplate), [resolvedTemplate]);
  const publishedSlides = useMemo(() => publishedDocument?.slides ?? [], [publishedDocument]);

  const pages = useMemo<PreviewPage[]>(
    () => remotePages && remotePages.length > 0
      ? remotePages.map((item) => ({
        title: item.title?.trim() || `第 ${item.pageNumber} 页`,
        thumbnail: resolvePptAssetUrl(item.thumbnailUrl) || cover,
        preview: resolvePptAssetUrl(item.previewUrl) || resolvePptAssetUrl(item.thumbnailUrl) || cover,
      }))
      : publishedSlides.length > 0
        ? publishedSlides.map((slide, index) => {
          const titleElement = slide.elements.find((element) => element.type === "TEXT" && element.id.endsWith("-title"));
          return { title: titleElement?.type === "TEXT" ? titleElement.text.trim() || `第 ${index + 1} 页` : `第 ${index + 1} 页`, thumbnail: "", preview: "", slide };
        })
      : resolvedTemplate.isPrivate
        ? []
        : Array.from({ length: Math.min(Math.max(resolvedTemplate.pageCount || 8, 8), 18) }, (_, index) => ({
          title: slideTitles[index % slideTitles.length],
          thumbnail: cover,
          preview: cover,
        })),
    [cover, publishedSlides, remotePages, resolvedTemplate.isPrivate, resolvedTemplate.pageCount],
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
            <h2 id="ppt-preview-title" className="truncate text-base font-semibold text-slate-950">{resolvedTemplate.name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{pagesLoading ? "正在加载真实页面…" : pagesError ? "页面加载失败" : `完整预览 · ${pages.length} 页 · 动画将在工作台中呈现`}</p>
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
                    {item.slide ? <PublishedSlidePreview slide={item.slide} compact /> : <img src={item.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" />}
                    <span className="absolute inset-x-2 bottom-2 truncate text-[9px] font-semibold text-white drop-shadow">{item.title}</span>
                  </div>
                  <span className="mt-1.5 block text-[11px] font-medium text-slate-500">{index + 1}. {item.title}</span>
                </button>
              ))}
            </div>
          </aside>
          <main className="relative flex min-w-0 flex-1 flex-col bg-[#eceef2]">
            <div ref={stageRef} className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5 sm:p-10">
              {pagesLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-500 shadow-sm">正在从服务器读取每一页预览…</div>
              ) : pages.length === 0 ? (
                <div className="max-w-sm rounded-2xl border border-rose-200 bg-white px-6 py-5 text-center text-sm text-rose-600 shadow-sm">
                  <p className="font-semibold">暂时没有可用的页面预览</p>
                  <p className="mt-2 text-xs text-slate-500">{pagesError ?? "该 PPT 尚未完成解析，请稍后刷新重试。"}</p>
                </div>
              ) : <div
                className="relative aspect-[16/9] w-full max-w-[1120px] shrink-0 overflow-hidden rounded-[4px] bg-slate-950 shadow-[0_24px_70px_rgba(15,23,42,0.22)] transition-transform"
                style={{ transform: `scale(${zoom})` }}
              >
                {pages[page].slide ? <PublishedSlidePreview slide={pages[page].slide} /> : <img src={pages[page].preview} alt={`第 ${page + 1} 页预览`} className="absolute inset-0 h-full w-full object-contain" />}
                {(!remotePages || remotePages.length === 0) && publishedSlides.length === 0 && (
                  <div className={`absolute inset-0 flex p-[7%] ${page % 3 === 1 ? "items-end justify-end text-right" : page % 3 === 2 ? "items-center justify-center text-center" : "items-center"}`}>
                    <div className={`max-w-[62%] ${cover.includes("editorial") ? "text-slate-950" : "text-white"}`}>
                      <p className="mb-3 text-[clamp(10px,1.1vw,16px)] font-semibold uppercase tracking-[0.22em] opacity-70">{resolvedTemplate.scene}</p>
                      <h3 className="text-[clamp(24px,4.2vw,62px)] font-semibold leading-[1.06] tracking-[-0.04em]">{page === 0 ? resolvedTemplate.name : pages[page].title}</h3>
                      <p className="mt-5 max-w-xl text-[clamp(11px,1.25vw,18px)] leading-relaxed opacity-75">由 AI 规划内容、素材与版式，让观点清晰抵达每一位听众。</p>
                    </div>
                  </div>
                )}
              </div>}
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
