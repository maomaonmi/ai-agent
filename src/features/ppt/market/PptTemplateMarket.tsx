"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  CheckCircle2,
  FileUp,
  GraduationCap,
  LayoutGrid,
  LoaderCircle,
  Search,
  Sparkles,
  UploadCloud,
} from "lucide-react";

import type { PptTemplate } from "../api";
import { usePptMarketStore } from "../store";
import TemplatePreviewDialog from "./TemplatePreviewDialog";


const covers = [
  "/ppt/covers/aurora-business.png",
  "/ppt/covers/editorial-architecture.png",
  "/ppt/covers/future-data.png",
];

const demoTemplates: PptTemplate[] = [
  { id: "aurora-strategy", name: "极光战略发布", description: "适合商业策略、产品发布与年度汇报", scene: "BUSINESS", source: "SYSTEM", isPrivate: false, status: "READY", pageCount: 18, coverUrl: null, createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z" },
  { id: "quiet-editorial", name: "静谧编辑叙事", description: "杂志感图文排版，适合作品集与品牌故事", scene: "CREATIVE", source: "SYSTEM", isPrivate: false, status: "READY", pageCount: 16, coverUrl: null, createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z" },
  { id: "future-data", name: "未来数据洞察", description: "科技数据与研究结论的高密度呈现", scene: "TECHNOLOGY", source: "SYSTEM", isPrivate: false, status: "READY", pageCount: 20, coverUrl: null, createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z" },
  { id: "brand-growth", name: "品牌增长提案", description: "从市场机会到执行路径的一体化方案", scene: "MARKETING", source: "SYSTEM", isPrivate: false, status: "READY", pageCount: 14, coverUrl: null, createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z" },
  { id: "course-framework", name: "课程知识框架", description: "清晰的章节结构与教学重点呈现", scene: "EDUCATION", source: "SYSTEM", isPrivate: false, status: "READY", pageCount: 22, coverUrl: null, createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z" },
  { id: "research-brief", name: "研究简报", description: "适合调研结论、案例分析与学术分享", scene: "RESEARCH", source: "SYSTEM", isPrivate: false, status: "READY", pageCount: 17, coverUrl: null, createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z" },
];

const categories = [
  { id: null, label: "全部", icon: LayoutGrid },
  { id: "BUSINESS", label: "商业汇报", icon: BriefcaseBusiness },
  { id: "MARKETING", label: "营销提案", icon: Sparkles },
  { id: "EDUCATION", label: "教育培训", icon: GraduationCap },
  { id: "RESEARCH", label: "研究报告", icon: BookOpen },
] as const;


function coverFor(template: PptTemplate, index = 0): string {
  if (template.id.includes("editorial") || template.scene === "CREATIVE" || template.scene === "EDUCATION") return covers[1];
  if (template.id.includes("data") || template.scene === "TECHNOLOGY" || template.scene === "RESEARCH") return covers[2];
  return covers[index % covers.length];
}


function orbitDistance(index: number, activeIndex: number, total: number): number {
  if (total <= 1) return 0;
  let distance = index - activeIndex;
  const half = total / 2;
  if (distance > half) distance -= total;
  if (distance < -half) distance += total;
  return distance;
}


function OrbitTemplateCard({
  template,
  cover,
  ringIndex,
  angle,
  radius,
  distance,
  onActivate,
  onPreview,
  onUse,
}: {
  template: PptTemplate;
  cover: string;
  ringIndex: number;
  angle: number;
  radius: number;
  distance: number;
  onActivate: () => void;
  onPreview: () => void;
  onUse: () => void;
}) {
  const active = distance === 0;
  const magnitude = Math.abs(distance);
  const scale = active ? 1 : Math.max(0.7, 1 - magnitude * 0.045);
  const opacity = magnitude > 3 ? 0.08 : Math.max(0.28, 1 - magnitude * 0.18);
  const lift = Math.min(magnitude * 14, 46);

  return (
    <article
      className="group absolute left-1/2 top-[54%] w-[min(60vw,420px)] -translate-x-1/2 -translate-y-1/2 transition-[transform,opacity,filter] duration-700 ease-out [backface-visibility:visible] motion-reduce:transition-none"
      style={{
        transform: `translate(-50%, -50%) translateY(-${lift}px) rotateY(${ringIndex * angle}deg) translateZ(${radius}px) scale(${scale})`,
        opacity,
        zIndex: active ? 30 : 20 - magnitude,
        filter: active ? "none" : `blur(${Math.min(magnitude * 0.45, 2)}px)`,
        pointerEvents: magnitude > 4 ? "none" : "auto",
      }}
      aria-hidden={magnitude > 4}
    >
      <div className={`overflow-hidden rounded-[26px] border bg-white shadow-[0_28px_80px_rgba(15,23,42,0.2)] ${active ? "border-white ring-4 ring-white/80" : "border-white/60"}`}>
        <button
          type="button"
          onClick={onActivate}
          aria-label={`查看模板：${template.name}`}
          aria-current={active ? "true" : undefined}
          className="group relative block aspect-[0.76] w-full overflow-hidden bg-slate-950 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400"
        >
          <Image src={cover} alt={`${template.name} 模板封面`} fill sizes="(max-width: 768px) 60vw, 420px" className="object-cover transition duration-500 group-hover:scale-[1.04]" />
          <span className="absolute inset-0 bg-gradient-to-t from-slate-950/40 via-transparent to-white/5 opacity-70 transition group-hover:opacity-100" />
          <span className="sr-only">{template.isPrivate ? "私有模板" : "精选模板"}，{template.name}</span>
        </button>
        <div className="pointer-events-none absolute inset-x-4 bottom-4 flex translate-y-2 items-center gap-2 opacity-0 transition group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100">
          <button type="button" onClick={onPreview} className="h-9 flex-1 rounded-full border border-white/60 bg-white/90 text-xs font-semibold text-slate-800 shadow-lg backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">预览</button>
          <button type="button" onClick={onUse} className="h-9 flex-1 rounded-full bg-violet-600 text-xs font-semibold text-white shadow-lg transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">使用模板</button>
        </div>
      </div>
    </article>
  );
}


export default function PptTemplateMarket() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragStartX = useRef<number | null>(null);
  const [selected, setSelected] = useState<PptTemplate | null>(null);
  const [activeOrbitIndex, setActiveOrbitIndex] = useState(0);
  const {
    templates,
    loading,
    error,
    filters,
    uploads,
    setFilters,
    loadFirstPage,
    loadMore,
    upsertUpload,
  } = usePptMarketStore();

  useEffect(() => {
    void usePptMarketStore.persist.rehydrate();
    void loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    const pending = uploads.filter((upload) => upload.status === "QUEUED" || upload.status === "UPLOADING" || upload.status === "PROCESSING");
    if (pending.length === 0) return;
    const timers = pending.map((upload) => window.setTimeout(() => {
      upsertUpload({ ...upload, status: "READY", progress: 100, templateId: upload.templateId ?? `private-${upload.id}` });
    }, 520));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [uploads, upsertUpload]);

  const sourceTemplates = templates.length > 0 ? templates : demoTemplates;
  const visibleTemplates = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return sourceTemplates.filter((template) => (
      (!filters.scene || template.scene === filters.scene)
      && (!filters.source || template.source === filters.source)
      && (!query || `${template.name} ${template.description ?? ""}`.toLowerCase().includes(query))
    ));
  }, [filters.query, filters.scene, filters.source, sourceTemplates]);

  useEffect(() => {
    setActiveOrbitIndex((current) => visibleTemplates.length === 0 ? 0 : Math.min(current, visibleTemplates.length - 1));
  }, [visibleTemplates.length]);

  const moveOrbit = (delta: number) => {
    if (visibleTemplates.length === 0) return;
    setActiveOrbitIndex((current) => (current + delta + visibleTemplates.length) % visibleTemplates.length);
  };

  const handleOrbitKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveOrbit(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveOrbit(1);
    }
  };

  const handleOrbitPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStartX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleOrbitPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartX.current === null) return;
    const delta = event.clientX - dragStartX.current;
    dragStartX.current = null;
    if (Math.abs(delta) >= 36) moveOrbit(delta > 0 ? -1 : 1);
  };

  const handleOrbitWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) < 8 && Math.abs(event.deltaY) < 8) return;
    event.preventDefault();
    moveOrbit(event.deltaX + event.deltaY > 0 ? 1 : -1);
  };

  const selectScene = (scene: string | null) => {
    setFilters({ scene });
    window.setTimeout(() => void loadFirstPage(), 0);
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `upload-${Date.now()}`;
    if (!extension || !["pptx", "potx"].includes(extension)) {
      upsertUpload({ id, fileName: file.name, status: "FAILED", progress: 0, errorCode: "PPT_FILE_TYPE_UNSUPPORTED" });
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      upsertUpload({ id, fileName: file.name, status: "FAILED", progress: 0, errorCode: "PPT_FILE_TOO_LARGE" });
      return;
    }
    const queued = { id, fileName: file.name, status: "PROCESSING" as const, progress: 35, templateId: `private-${id}` };
    upsertUpload(queued);
    window.setTimeout(() => upsertUpload({ ...queued, status: "READY", progress: 100 }), 520);
  };

  const handleUseTemplate = (template: PptTemplate) => {
    router.push(`/ppt/workspace/new?templateId=${encodeURIComponent(template.id)}`);
  };

  return (
    <div className="min-h-screen bg-[#f7f7f8] text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[68px] max-w-[1540px] items-center justify-between px-4 sm:px-7 lg:px-10">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="返回聊天" className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:bg-slate-100 hover:text-slate-950">
              <ArrowLeft size={18} />
            </Link>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white shadow-[0_8px_20px_rgba(124,58,237,0.25)]">
              <Sparkles size={19} />
            </span>
            <div>
              <p className="text-[15px] font-semibold tracking-tight">AI PPT</p>
              <p className="text-[11px] text-slate-500">从想法到完整演示</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="hidden h-10 items-center rounded-full px-4 text-sm font-medium text-slate-600 hover:bg-slate-100 sm:inline-flex">我的演示</button>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50">
              <UploadCloud size={16} /> 上传模板
            </button>
            <input ref={fileInputRef} type="file" accept=".pptx,.potx,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="sr-only" onChange={handleUpload} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1540px] px-4 pb-20 pt-6 sm:px-7 lg:px-10 lg:pt-9">
        <section className="relative overflow-hidden rounded-[30px] bg-[#0a1022] text-white shadow-[0_28px_80px_rgba(15,23,42,0.16)]">
          <div className="absolute inset-y-0 right-0 w-full opacity-70 lg:w-[58%]">
            <Image src={covers[0]} alt="紫蓝极光商务模板" fill priority sizes="(max-width: 1024px) 100vw, 60vw" className="object-cover" />
          </div>
          <div className="absolute inset-0 bg-slate-950/35" />
          <div className="relative max-w-3xl px-6 py-14 sm:px-10 sm:py-20 lg:px-16 lg:py-24">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md">
              <Sparkles size={13} /> Agent 驱动的完整 PPT 工作流
            </span>
            <h1 className="mt-6 max-w-2xl text-4xl font-semibold leading-[1.06] tracking-[-0.045em] sm:text-5xl lg:text-[64px]">选一个风格，<br />让想法自然成型。</h1>
            <p className="mt-5 max-w-xl text-sm leading-7 text-white/70 sm:text-base">AI 会规划结构、多次查阅资料、收集图片并逐页搭建。你可以随时接手编辑每一个元素。</p>
            <div className="mt-8 flex max-w-2xl items-center rounded-2xl border border-white/20 bg-white p-1.5 shadow-[0_18px_50px_rgba(2,6,23,0.25)]">
              <Search size={18} className="ml-3 shrink-0 text-slate-400" />
              <input
                value={filters.query}
                onChange={(event) => setFilters({ query: event.target.value })}
                placeholder="搜索模板、场景或风格"
                className="h-11 min-w-0 flex-1 bg-transparent px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              <button type="button" onClick={() => void loadFirstPage()} className="flex h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500">探索 <ArrowRight size={15} /></button>
            </div>
          </div>
        </section>

        {uploads.length > 0 && (
          <section className="mt-6 rounded-[22px] border border-slate-200 bg-white p-4" aria-label="模板上传任务">
            <div className="flex flex-wrap items-center gap-3">
              {[...new Map(uploads.map((upload) => [upload.fileName, upload])).values()].slice(0, 3).map((upload) => (
                <div key={upload.id} className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                  {upload.status === "FAILED" ? <FileUp size={18} className="text-rose-500" /> : upload.status === "READY" ? <CheckCircle2 size={18} className="text-emerald-600" /> : <LoaderCircle size={18} className="animate-spin text-violet-600" />}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{upload.fileName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{upload.status === "FAILED" ? upload.errorCode : upload.status === "READY" ? "主题、配色与版式已提取 · 可立即使用" : "正在本地解析主题与版式…"}</p>
                  </div>
                  {upload.status === "READY" && <button type="button" onClick={() => router.push(`/ppt/workspace/new?templateId=${encodeURIComponent(upload.templateId ?? `private-${upload.id}`)}`)} className="ml-auto shrink-0 rounded-full bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-500">立即使用</button>}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-10">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Template gallery</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-slate-950 sm:text-3xl">为每一种表达找到合适的舞台</h2>
            </div>
            <div className="flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="模板场景筛选">
              {categories.map(({ id, label, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={filters.scene === id}
                  onClick={() => selectScene(id)}
                  className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition ${filters.scene === id ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950"}`}
                >
                  <Icon size={15} /> {label}
                </button>
              ))}
            </div>
          </div>

          {error && templates.length === 0 && (
            <p className="mt-5 text-xs text-slate-400">暂时使用本地精选模板 · {error}</p>
          )}

          {visibleTemplates.length > 0 ? (
            <div
              className="group/rail relative mt-6 h-[520px] overflow-hidden rounded-[30px] border border-white/70 bg-[#fbfcfe] shadow-[0_24px_70px_rgba(15,23,42,0.08)] [background-image:radial-gradient(#dce3ed_1.2px,transparent_1.2px),radial-gradient(#e8edf4_1px,transparent_1px),radial-gradient(circle_at_50%_38%,#ffffff_0%,#f7f9fc_56%,#edf1f7_100%)] [background-position:0_0,16px_18px,0_0] [background-size:28px_28px,44px_44px,100%_100%] [perspective:1800px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              role="region"
              aria-label="环形模板浏览器"
              tabIndex={0}
              onKeyDown={handleOrbitKeyDown}
              onPointerDown={handleOrbitPointerDown}
              onPointerUp={handleOrbitPointerUp}
              onPointerCancel={() => { dragStartX.current = null; }}
              onWheel={handleOrbitWheel}
              style={{ transformStyle: "preserve-3d" }}
            >
              <div className="pointer-events-none absolute left-1/2 top-[49%] z-0 h-[260px] w-[min(86vw,1240px)] rounded-[50%] border border-slate-300/25 bg-white/20 shadow-[0_0_90px_rgba(148,163,184,0.16)]" style={{ transform: "translate(-50%, -50%) rotateX(64deg)" }} aria-hidden="true" />
              <div className="pointer-events-none absolute inset-x-[8%] bottom-[-40%] h-[70%] rounded-[50%] bg-slate-400/25 blur-3xl" aria-hidden="true" />
              <div className="pointer-events-none absolute inset-x-[7%] bottom-0 h-28 bg-gradient-to-t from-[#fbfcfe] via-[#fbfcfe]/70 to-transparent" aria-hidden="true" />
              {(() => {
                const orbitAngle = 360 / Math.max(visibleTemplates.length, 1);
                const orbitRadius = visibleTemplates.length <= 4 ? 360 : 470;
                const orbitRotation = -activeOrbitIndex * orbitAngle;
                return (
                  <div
                    className="absolute inset-0 z-10 [transform-style:preserve-3d] transition-transform duration-700 ease-out motion-reduce:transition-none"
                    style={{ transform: `translateY(30px) rotateX(-4deg) rotateY(${orbitRotation}deg)`, transformStyle: "preserve-3d" }}
                  >
                    {visibleTemplates.map((template, index) => {
                      const distance = orbitDistance(index, activeOrbitIndex, visibleTemplates.length);
                      return (
                        <OrbitTemplateCard
                          key={template.id}
                          template={template}
                          cover={coverFor(template, index)}
                          ringIndex={index}
                          angle={orbitAngle}
                          radius={orbitRadius}
                          distance={distance}
                          onActivate={() => setActiveOrbitIndex(index)}
                          onPreview={() => setSelected(template)}
                          onUse={() => handleUseTemplate(template)}
                        />
                      );
                    })}
                  </div>
                );
              })()}
              <button type="button" onClick={() => moveOrbit(-1)} aria-label="上一个模板" className="absolute left-5 top-1/2 z-40 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/90 bg-white/80 text-slate-700 opacity-0 shadow-lg backdrop-blur transition hover:bg-white group-hover/rail:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"><ArrowLeft size={18} /></button>
              <button type="button" onClick={() => moveOrbit(1)} aria-label="下一个模板" className="absolute right-5 top-1/2 z-40 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/90 bg-white/80 text-slate-700 opacity-0 shadow-lg backdrop-blur transition hover:bg-white group-hover/rail:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"><ArrowRight size={18} /></button>
            </div>
          ) : (
            <div className="mt-6 flex min-h-[300px] flex-col items-center justify-center rounded-[30px] border border-dashed border-slate-300 bg-white text-center">
              <Search size={28} className="text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">没有找到匹配的模板</p>
              <p className="mt-1 text-xs text-slate-400">试试其他关键词或切换场景</p>
            </div>
          )}

          <div className="mt-5 flex flex-col items-center justify-between gap-4 rounded-[22px] border border-dashed border-slate-300 bg-white px-5 py-4 sm:flex-row">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><UploadCloud size={19} /></span>
              <div><p className="text-sm font-semibold text-slate-900">使用你的 PPT 作为私有模板</p><p className="mt-1 text-xs text-slate-500">仅提取主题、配色与版式；原文件保持私有，并支持完整预览。</p></div>
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"><UploadCloud size={15} />上传模板</button>
          </div>

          {templates.length > 0 && (
            <div className="mt-8 flex justify-center">
              <button type="button" disabled={loading} onClick={() => void loadMore()} className="h-11 rounded-full border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{loading ? "加载中…" : "加载更多"}</button>
            </div>
          )}
        </section>
      </main>

      {selected && (
        <TemplatePreviewDialog
          template={selected}
          cover={coverFor(selected, visibleTemplates.findIndex((item) => item.id === selected.id))}
          open
          onClose={() => setSelected(null)}
          onUse={handleUseTemplate}
        />
      )}
    </div>
  );
}
