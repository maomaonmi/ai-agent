"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlignCenter,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Circle,
  Copy,
  Download,
  FileSearch,
  ImageIcon,
  LoaderCircle,
  Maximize2,
  Menu,
  MonitorPlay,
  MoreHorizontal,
  MousePointer2,
  Palette,
  Pause,
  Play,
  Plus,
  Redo2,
  RefreshCcw,
  Search,
  Shapes,
  Sparkles,
  Table2,
  TextCursorInput,
  Trash2,
  Undo2,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { PptApiError, pptApi, type PptPresentationResponse } from "../api.ts";
import type { PresentationDocument } from "../types.ts";

type CanvasItem =
  | { id: string; kind: "text"; x: number; y: number; w: number; h: number; text: string }
  | { id: string; kind: "shape"; x: number; y: number; w: number; h: number; shape: "rect" | "ellipse" }
  | { id: string; kind: "image"; x: number; y: number; w: number; h: number; src: string; alt: string }
  | { id: string; kind: "table"; x: number; y: number; w: number; h: number }
  | { id: string; kind: "chart"; x: number; y: number; w: number; h: number };

interface WorkspaceSlide {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  image: string;
  tone: "dark" | "light";
  notes: string;
  items: CanvasItem[];
}

interface WorkflowStep {
  id: string;
  label: string;
  description: string;
  meta: string;
}

type ExportElement = { kind: string; [key: string]: unknown };
type ChatMessage = { id: string; role: "user" | "assistant"; text: string };


const generatedAssets = [
  "/ppt/covers/aurora-business.png",
  "/ppt/covers/future-data.png",
  "/ppt/covers/editorial-architecture.png",
];

const initialSlides: WorkspaceSlide[] = [
  {
    id: "slide-cover",
    eyebrow: "AI · 2026",
    title: "智能体时代的\n协作新范式",
    subtitle: "从自动执行到共同创造，一份面向未来团队的观察",
    image: generatedAssets[0],
    tone: "dark",
    notes: "开场：先用一个问题引出智能体正在改变团队协作方式。",
    items: [],
  },
  {
    id: "slide-map",
    eyebrow: "01 · CONTEXT",
    title: "变化不是一次工具升级",
    subtitle: "当模型获得规划、搜索与行动能力，工作开始围绕目标而非软件菜单组织。",
    image: generatedAssets[1],
    tone: "dark",
    notes: "强调 Agent loop 的四个环节：计划、行动、观察、修正。",
    items: [
      { id: "shape-1", kind: "shape", x: 8, y: 68, w: 20, h: 2, shape: "rect" },
    ],
  },
  {
    id: "slide-insight",
    eyebrow: "02 · INSIGHT",
    title: "人负责判断，AI 负责展开",
    subtitle: "好的工作台让推理过程可见、素材来源可查、每个组件都能被重新编辑。",
    image: generatedAssets[2],
    tone: "light",
    notes: "用三项原则收束：可见、可控、可追溯。",
    items: [],
  },
  {
    id: "slide-end",
    eyebrow: "NEXT STEP",
    title: "把下一次表达，\n变成一次共同创造",
    subtitle: "谢谢观看",
    image: generatedAssets[1],
    tone: "dark",
    notes: "结尾停留两秒，邀请听众进入讨论。",
    items: [],
  },
];

const freshSlides: WorkspaceSlide[] = [
  {
    id: "slide-new-cover",
    eyebrow: "NEW PRESENTATION",
    title: "开始创建你的 PPT",
    subtitle: "描述主题、受众和目标，AI 会从这里开始规划。",
    image: generatedAssets[2],
    tone: "light",
    notes: "在这里写下开场思路，或者先告诉 AI 你想表达什么。",
    items: [],
  },
];

const workflow: WorkflowStep[] = [
  { id: "plan", label: "需求理解与任务规划", description: "拆解受众、目标、页数与叙事结构", meta: "规划 v2" },
  { id: "search-1", label: "联网检索 · 第 1 轮", description: "检索趋势、定义与权威背景资料", meta: "18 条 · DeepSeek / Firecrawl" },
  { id: "search-2", label: "联网检索 · 第 2 轮", description: "验证关键结论并补齐反方观点", meta: "16 条 · 千问原生搜索" },
  { id: "search-3", label: "联网检索 · 第 3 轮", description: "查找案例、数据与可视化素材", meta: "12 条 · GLM 原生搜索" },
  { id: "web-assets", label: "网页图片素材收集", description: "筛选带图网页并保留授权与素材来源", meta: "6 张候选 · 3 张采用" },
  { id: "ai-assets", label: "AI 生成图片", description: "生成封面、中段背景与结尾主视觉", meta: "3 / 3 张" },
  { id: "outline", label: "叙事与视觉方案", description: "统一主题、配色、字体和页面节奏", meta: "16 页大纲" },
  { id: "build", label: "逐页搭建", description: "一个组件一个组件写入可编辑画布", meta: "正在同步右侧" },
  { id: "review", label: "质量检查与导出", description: "检查溢出、引用、可读性与兼容性", meta: "等待执行" },
];

const toolGroups = [
  { label: "文本", ariaLabel: "插入文本", icon: TextCursorInput, kind: "text" as const },
  { label: "图形", ariaLabel: "插入图形", icon: Shapes, kind: "shape" as const },
  { label: "图片", ariaLabel: "插入图片", icon: ImageIcon, kind: "image" as const },
  { label: "图表", ariaLabel: "插入图表", icon: BarChart3, kind: "chart" as const },
  { label: "表格", ariaLabel: "插入表格", icon: Table2, kind: "table" as const },
];


function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}`;
}


function createSlide(index: number): WorkspaceSlide {
  return {
    id: nextId("slide"),
    eyebrow: `${String(index + 1).padStart(2, "0")} · NEW SLIDE`,
    title: "点击输入标题",
    subtitle: "从工具栏插入文本、图形、图片、图表或表格",
    image: generatedAssets[index % generatedAssets.length],
    tone: index % 2 ? "light" : "dark",
    notes: "在这里输入演讲者备注。",
    items: [],
  };
}


function timestamp(): string {
  return new Date().toISOString();
}


function canonicalTextElement(id: string, text: string, x: number, y: number, width: number, height: number, color: "#FFFFFF" | "#111827"): Record<string, unknown> {
  return {
    type: "TEXT",
    id,
    x,
    y,
    width,
    height,
    rotation: 0,
    zIndex: 3,
    opacity: 1,
    isLocked: false,
    isHidden: false,
    text,
    style: {
      fontFamily: "Microsoft YaHei",
      fontSize: 28,
      color,
      bold: true,
      italic: false,
      underline: false,
      align: "LEFT",
      verticalAlign: "MIDDLE",
    },
  };
}


function canonicalElementFromItem(item: CanvasItem, index: number): Record<string, unknown> {
  const geometry = {
    id: item.id,
    x: item.x / 100,
    y: item.y / 100,
    width: item.w / 100,
    height: item.h / 100,
    rotation: 0,
    zIndex: 4 + index,
    opacity: 1,
    isLocked: false,
    isHidden: false,
  };
  if (item.kind === "text") {
    return {
      type: "TEXT",
      ...geometry,
      text: item.text,
      style: {
        fontFamily: "Microsoft YaHei",
        fontSize: 18,
        color: "#FFFFFF",
        bold: false,
        italic: false,
        underline: false,
        align: "LEFT",
        verticalAlign: "MIDDLE",
      },
    };
  }
  if (item.kind === "shape") {
    return { type: "SHAPE", ...geometry, shapeType: item.shape === "ellipse" ? "ELLIPSE" : "ROUND_RECT", fill: "#7C3AED", stroke: "#A78BFA", strokeWidth: 1.5 };
  }
  if (item.kind === "image") {
    return { type: "IMAGE", ...geometry, assetId: `asset-generated-${index + 1}`, alt: item.alt, fit: "COVER" };
  }
  if (item.kind === "table") {
    return { type: "TABLE", ...geometry, rows: [[{ text: "Q1" }, { text: "Q2" }, { text: "Q3" }], [{ text: "24" }, { text: "42" }, { text: "68" }]], borderColor: "#CBD5E1" };
  }
  return {
    type: "CHART",
    ...geometry,
    chartType: "BAR",
    categories: ["Q1", "Q2", "Q3"],
    series: [{ name: "增长", values: [24, 42, 68], color: "#7C3AED" }],
    showLegend: false,
  };
}


function canonicalSlideFromWorkspace(slide: WorkspaceSlide, index: number): Record<string, unknown> {
  const dark = slide.tone === "dark";
  const elements = [
    canonicalTextElement(`${slide.id}-eyebrow`, slide.eyebrow, 0.07, 0.08, 0.65, 0.05, dark ? "#FFFFFF" : "#111827"),
    canonicalTextElement(`${slide.id}-title`, slide.title, 0.07, 0.18, 0.68, 0.25, dark ? "#FFFFFF" : "#111827"),
    {
      ...canonicalTextElement(`${slide.id}-subtitle`, slide.subtitle, 0.07, 0.58, 0.62, 0.14, dark ? "#FFFFFF" : "#111827"),
      zIndex: 2,
      style: { fontFamily: "Microsoft YaHei", fontSize: 14, color: dark ? "#FFFFFF" : "#111827", bold: false, italic: false, underline: false, align: "LEFT", verticalAlign: "MIDDLE" },
    },
    ...slide.items.map((item, itemIndex) => canonicalElementFromItem(item, itemIndex)),
  ];
  return {
    id: slide.id,
    order: index,
    background: { type: "SOLID", color: dark ? "#0F172A" : "#F4EFE8" },
    elements,
    animations: [],
    notes: slide.notes,
  };
}


function presentationDocumentFromWorkspace(presentationId: string, templateId: string | null, slides: WorkspaceSlide[]): PresentationDocument {
  const now = timestamp();
  return {
    schemaVersion: 1,
    presentationId,
    revision: 0,
    title: slides[0]?.title.replace(/\n/g, " ").slice(0, 500) || "新建 AI PPT",
    aspectRatio: "16:9",
    canvas: { width: 13.333, height: 7.5 },
    theme: {
      name: "Aurora",
      colors: { background: "#0B1020", surface: "#151C33", text: "#F7F8FC", mutedText: "#AAB2C8", accent1: "#7657FF", accent2: "#39C6B4" },
      fonts: { heading: "Microsoft YaHei", body: "Microsoft YaHei", mono: "Cascadia Mono" },
    },
    slides: slides.map((slide, index) => canonicalSlideFromWorkspace(slide, index)) as unknown as PresentationDocument["slides"],
    metadata: { ...(templateId ? { templateId } : {}), language: "zh-CN", createdAt: now, updatedAt: now },
  };
}


function workspaceSlidesFromDocument(document: PresentationDocument): WorkspaceSlide[] {
  return document.slides.map((slide, index) => {
    const textElements = slide.elements.filter((element) => element.type === "TEXT");
    const title = textElements.find((element) => element.id.endsWith("-title"))?.text ?? `第 ${index + 1} 页`;
    const subtitle = textElements.find((element) => element.id.endsWith("-subtitle"))?.text ?? "从资料、观点到下一步行动。";
    const eyebrow = textElements.find((element) => element.id.endsWith("-eyebrow"))?.text ?? `${String(index + 1).padStart(2, "0")} · AI PPT`;
    const items: CanvasItem[] = [];
    for (const element of slide.elements.filter((element) => !element.id.endsWith("-title") && !element.id.endsWith("-subtitle") && !element.id.endsWith("-eyebrow"))) {
      const base = { id: element.id, x: element.x * 100, y: element.y * 100, w: element.width * 100, h: element.height * 100 };
      if (element.type === "TEXT") items.push({ ...base, kind: "text", text: element.text });
      else if (element.type === "SHAPE") items.push({ ...base, kind: "shape", shape: element.shapeType === "ELLIPSE" ? "ellipse" : "rect" });
      else if (element.type === "IMAGE") items.push({ ...base, kind: "image", src: generatedAssets[index % generatedAssets.length], alt: element.alt });
      else if (element.type === "TABLE") items.push({ ...base, kind: "table" });
      else if (element.type === "CHART") items.push({ ...base, kind: "chart" });
    }
    const backgroundColor = slide.background.type === "SOLID" ? slide.background.color : "#0F172A";
    return { id: slide.id, eyebrow, title, subtitle, image: generatedAssets[index % generatedAssets.length], tone: backgroundColor === "#F4EFE8" ? "light" : "dark", notes: slide.notes ?? "", items };
  });
}


function workflowStepForPhase(phase: string): number {
  const index = ["PLAN", "SEARCH_1", "SEARCH_2", "SEARCH_3", "WEB_ASSETS", "AI_ASSETS", "OUTLINE", "BUILD", "REVIEW"].indexOf(phase);
  return index < 0 ? 0 : index;
}


async function imageUrlToDataUrl(src: string): Promise<string> {
  const response = await fetch(src);
  if (!response.ok) throw new Error("图片读取失败");
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}


function SlideSurface({
  slide,
  selectedItemId,
  onSelectItem,
  onChange,
  compact = false,
}: {
  slide: WorkspaceSlide;
  selectedItemId?: string | null;
  onSelectItem?: (id: string | null) => void;
  onChange?: (patch: Partial<WorkspaceSlide>) => void;
  compact?: boolean;
}) {
  const dark = slide.tone === "dark";
  const titleClass = dark ? "text-white" : "text-slate-950";
  const mutedClass = dark ? "text-white/65" : "text-slate-500";
  return (
    <div className={`relative aspect-video w-full overflow-hidden bg-[#111827] ${dark ? "" : "bg-[#f4efe8]"}`}>
      <Image src={slide.image} alt="演示文稿视觉素材" fill priority={slide.id.endsWith("cover")} sizes={compact ? "220px" : "(max-width: 1024px) 100vw, 65vw"} className={`object-cover ${dark ? "opacity-75" : "opacity-55"}`} />
      <div className={`absolute inset-0 ${dark ? "bg-slate-950/45" : "bg-white/35"}`} />
      <div className={`absolute inset-y-0 left-0 ${compact ? "w-[76%] p-[7%]" : "w-[72%] p-[7.5%]"}`}>
        <p className={`${mutedClass} ${compact ? "text-[5px]" : "text-[clamp(8px,0.72vw,12px)]"} font-semibold tracking-[0.22em]`}>{slide.eyebrow}</p>
        {compact ? (
          <p className={`mt-[8%] whitespace-pre-line text-[10px] font-semibold leading-[1.05] ${titleClass}`}>{slide.title}</p>
        ) : (
          <div
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label="幻灯片标题"
            onBlur={(event) => onChange?.({ title: event.currentTarget.innerText })}
            className={`mt-[7%] whitespace-pre-line text-[clamp(24px,3.5vw,56px)] font-semibold leading-[1.02] tracking-[-0.045em] outline-none ${titleClass}`}
          >
            {slide.title}
          </div>
        )}
        {!compact && (
          <div
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label="幻灯片副标题"
            onBlur={(event) => onChange?.({ subtitle: event.currentTarget.innerText })}
            className={`mt-[7%] max-w-[86%] text-[clamp(10px,1.15vw,18px)] leading-relaxed outline-none ${mutedClass}`}
          >
            {slide.subtitle}
          </div>
        )}
      </div>
      <div className={`absolute bottom-[8%] right-[6%] h-px w-[15%] ${dark ? "bg-violet-400" : "bg-violet-700"}`} />

      {!compact && slide.items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={(event) => { event.stopPropagation(); onSelectItem?.(item.id); }}
          className={`absolute overflow-hidden text-left ${selectedItemId === item.id ? "ring-2 ring-violet-500 ring-offset-2 ring-offset-transparent" : ""}`}
          style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.w}%`, height: `${item.h}%` }}
        >
          {item.kind === "text" && <span className={`block text-[clamp(10px,1.2vw,18px)] font-medium ${titleClass}`}>{item.text}</span>}
          {item.kind === "shape" && <span className={`block h-full w-full border-2 border-violet-400 bg-violet-500/25 ${item.shape === "ellipse" ? "rounded-full" : "rounded-xl"}`} />}
          {item.kind === "image" && <Image src={item.src} alt={item.alt} fill sizes="320px" className="object-cover" />}
          {item.kind === "table" && (
            <span className="grid h-full grid-cols-3 overflow-hidden rounded-md border border-white/50 bg-white/85 text-[9px] text-slate-700">
              {Array.from({ length: 9 }, (_, index) => <i key={index} className="border-b border-r border-slate-300 p-1 not-italic">{index < 3 ? `Q${index + 1}` : index * 12}</i>)}
            </span>
          )}
          {item.kind === "chart" && (
            <span className="flex h-full items-end gap-[6%] rounded-md bg-white/90 p-[9%]">
              {[42, 78, 58, 92, 70].map((height, index) => <i key={index} className="flex-1 bg-violet-600" style={{ height: `${height}%` }} />)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}


function WorkflowPanel({
  step,
  running,
  started,
  messages,
  onToggle,
  onRestart,
  onSendMessage,
}: {
  step: number;
  running: boolean;
  started: boolean;
  messages: ChatMessage[];
  onToggle: () => void;
  onRestart: () => void;
  onSendMessage: (message: string) => void;
}) {
  const [workflowOpen, setWorkflowOpen] = useState(true);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length > 1 && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);
  const submit = () => {
    const message = draft.trim();
    if (!message) return;
    onSendMessage(message);
    setDraft("");
  };
  const progress = started ? Math.min(100, ((step + 1) / workflow.length) * 100) : 0;
  return (
    <aside aria-label="AI 工作流" className="flex min-h-0 w-full flex-col border-r border-slate-200 bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
        <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><WandSparkles size={16} /></span><div><p className="text-sm font-semibold text-slate-950">AI PPT 助手</p><p className="text-[10px] text-slate-400">对话驱动的演示创作</p></div></div>
        <button type="button" onClick={onToggle} aria-label={started ? (running ? "暂停生成" : "继续生成") : "等待你的指令"} disabled={!started} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300">{running ? <Pause size={15} /> : <Play size={15} />}</button>
      </div>

      <div ref={messagesRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === "user" ? "rounded-br-md bg-slate-950 text-white" : "rounded-bl-md bg-slate-100 text-slate-700"}`}>{message.text}</div>
            </div>
          ))}

          {started && <section aria-label="AI 工作流链路" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button type="button" aria-expanded={workflowOpen} onClick={() => setWorkflowOpen((value) => !value)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><FileSearch size={15} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-900">AI 工作流链路</span><span className="mt-0.5 block text-[11px] text-slate-500">{started ? `${Math.min(step + 1, workflow.length)} / ${workflow.length} 阶段 · ${running ? "正在执行" : "已暂停"}` : "等待你的指令后开始"} · 每次不超过 20 条</span></span>
              <ChevronDown size={15} className={`text-slate-400 transition ${workflowOpen ? "rotate-180" : ""}`} />
            </button>
            {workflowOpen && <div className="border-t border-slate-100 px-4 pb-3 pt-3">
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-violet-600 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
              <div className="space-y-1">
                {workflow.map((item, index) => {
                  const complete = started && index < step;
                  const active = started && index === step;
                  const expanded = expandedSteps[item.id] ?? active;
                  return <div key={item.id} className="rounded-xl border border-transparent hover:border-slate-200">
                    <button type="button" aria-expanded={expanded} onClick={() => setExpandedSteps((current) => ({ ...current, [item.id]: !expanded }))} className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${complete ? "border-violet-600 bg-violet-600 text-white" : active ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-300"}`}>{complete ? <Check size={12} /> : active ? <LoaderCircle size={12} className={running ? "animate-spin" : ""} /> : <Circle size={7} />}</span>
                      <span className={`min-w-0 flex-1 truncate text-xs font-semibold ${complete || active ? "text-slate-900" : "text-slate-400"}`}>{item.label}</span><span className="shrink-0 text-[10px] text-slate-400">{item.meta}</span><ChevronDown size={12} className={`shrink-0 text-slate-300 transition ${expanded ? "rotate-180" : ""}`} />
                    </button>
                    {expanded && <div className="ml-10 mr-2 pb-2 text-[11px] leading-5 text-slate-500"><p>{item.description}</p>{active && item.id.startsWith("search") && <div className="mt-2 space-y-1 text-violet-700">{["行业研究与权威报告", "产品案例与数据证据", "关键观点交叉验证"].map((label) => <div key={label} className="flex items-center gap-1.5"><Search size={10} />{label}</div>)}</div>}</div>}
                  </div>;
                })}
              </div>
              <div className="mt-3 border-t border-slate-100 pt-3"><div className="flex items-center justify-between"><span className="text-[11px] font-semibold text-slate-700">素材来源</span><span className="text-[10px] text-slate-400">可追溯</span></div><div className="mt-2 grid grid-cols-3 gap-2">{generatedAssets.map((asset, index) => <div key={asset} className="relative aspect-square overflow-hidden rounded-lg bg-slate-100"><Image src={asset} alt={index === 0 ? "AI 生成封面" : "视觉素材"} fill priority sizes="96px" className="object-cover" /><span className="absolute inset-x-1 bottom-1 rounded bg-slate-950/70 px-1 py-0.5 text-center text-[8px] text-white">{index === 1 ? "网页图片" : "AI 生成图片"}</span></div>)}</div><p className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500"><FileSearch size={11} />3 个带图网页 · 3 张 AI 图片</p></div>
            </div>}
          </section>}
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 p-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-violet-300 focus-within:ring-2 focus-within:ring-violet-100">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} aria-label="AI PPT 对话输入" placeholder="描述你想制作的 PPT…" rows={2} className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400" />
          <div className="flex items-center justify-between px-1"><span className="text-[10px] text-slate-400">Enter 发送 · Shift + Enter 换行</span><button type="button" onClick={submit} aria-label="发送 PPT 需求" disabled={!draft.trim()} className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:bg-slate-200 disabled:text-slate-400"><ArrowRight size={15} /></button></div>
        </div>
        {started && <button type="button" onClick={onRestart} className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-lg text-[11px] font-medium text-slate-500 hover:bg-slate-50"><RefreshCcw size={12} /> 重新规划并生成</button>}
      </div>
    </aside>
  );
}


export default function PptWorkspace({ presentationId }: { presentationId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const freshFromSidebar = searchParams.get("source") === "sidebar";
  const templateId = freshFromSidebar ? "blank" : (searchParams.get("templateId") ?? "aurora-strategy");
  const [slides, setSlides] = useState<WorkspaceSlide[]>(() => freshFromSidebar ? freshSlides : initialSlides);
  const [activeSlideId, setActiveSlideId] = useState(() => freshFromSidebar ? freshSlides[0].id : initialSlides[0].id);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [workflowStep, setWorkflowStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [zoom, setZoom] = useState(82);
  const [exporting, setExporting] = useState(false);
  const [mobileWorkflowOpen, setMobileWorkflowOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(420);
  const [serverPresentation, setServerPresentation] = useState<PptPresentationResponse | null>(null);
  const [serverState, setServerState] = useState<"loading" | "ready" | "offline" | "error">("loading");
  const [runId, setRunId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => [{
    id: "welcome",
    role: "assistant",
    text: freshFromSidebar ? "你好，我是 AI PPT 助手。告诉我主题、受众和你希望达成的目标，我会先和你确认方向，再开始规划。" : "模板已经载入。你可以先告诉我想修改的主题、受众或页数，我会和你一起重新规划。",
  }]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const serverPresentationRef = useRef<PptPresentationResponse | null>(null);
  const persistenceQueueRef = useRef(Promise.resolve());
  const runPollRef = useRef<number | null>(null);
  const clientPresentationIdRef = useRef(presentationId === "new" ? `presentation-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1000)}`}` : presentationId);
  const activeSlide = slides.find((slide) => slide.id === activeSlideId) ?? slides[0];
  const activeIndex = slides.findIndex((slide) => slide.id === activeSlide.id);
  const started = running || workflowStep > 0 || chatMessages.some((message) => message.role === "user");

  useEffect(() => {
    let cancelled = false;
    const loadPresentation = async () => {
      setServerState("loading");
      try {
        const nextPresentation = presentationId === "new"
          ? await pptApi.createPresentation({
            presentationId: clientPresentationIdRef.current,
            templateId: templateId === "blank" ? undefined : templateId,
            title: freshFromSidebar ? "新建 AI PPT" : "智能体时代的协作新范式",
            document: presentationDocumentFromWorkspace(clientPresentationIdRef.current, templateId === "blank" ? null : templateId, freshFromSidebar ? freshSlides : initialSlides),
          })
          : await pptApi.getPresentation(presentationId);
        if (cancelled) return;
        serverPresentationRef.current = nextPresentation;
        setServerPresentation(nextPresentation);
        setServerState("ready");
        if (presentationId === "new") {
          const query = new URLSearchParams();
          if (freshFromSidebar) query.set("source", "sidebar");
          if (templateId !== "blank") query.set("templateId", templateId);
          router.replace(`/ppt/workspace/${encodeURIComponent(nextPresentation.presentationId)}${query.toString() ? `?${query}` : ""}`);
        } else {
          const restoredSlides = workspaceSlidesFromDocument(nextPresentation.document);
          if (restoredSlides.length > 0) {
            setSlides(restoredSlides);
            setActiveSlideId(restoredSlides[0].id);
          }
        }
      } catch (error) {
        if (cancelled) return;
        setServerState(error instanceof PptApiError && error.status >= 500 ? "error" : "offline");
      }
    };
    void loadPresentation();
    return () => { cancelled = true; };
  }, [freshFromSidebar, presentationId, router, templateId]);

  useEffect(() => () => {
    if (runPollRef.current !== null) window.clearTimeout(runPollRef.current);
  }, []);

  useEffect(() => {
    if (!running || workflowStep >= workflow.length - 1) return;
    const timer = window.setTimeout(() => setWorkflowStep((value) => Math.min(workflow.length - 1, value + 1)), 1500);
    return () => window.clearTimeout(timer);
  }, [running, workflowStep]);

  const statusText = useMemo(() => {
    if (!started) return "等待你的指令";
    if (workflowStep >= workflow.length - 1) return "已完成 · 所有页面均可编辑";
    return `正在${workflow[workflowStep].label}`;
  }, [started, workflowStep]);

  const persistOperations = (operations: Array<Record<string, unknown>>) => {
    if (operations.length === 0 || !serverPresentationRef.current) return;
    persistenceQueueRef.current = persistenceQueueRef.current.then(async () => {
      const current = serverPresentationRef.current;
      if (!current) return;
      try {
        const updated = await pptApi.applyOperations(current.presentationId, {
          baseRevision: current.revision,
          operations,
        });
        serverPresentationRef.current = updated;
        setServerPresentation(updated);
        setServerState("ready");
      } catch (error) {
        if (error instanceof PptApiError && error.status === 409) {
          try {
            const latest = await pptApi.getPresentation(current.presentationId);
            serverPresentationRef.current = latest;
            setServerPresentation(latest);
          } catch {
            setServerState("error");
          }
        } else {
          setServerState("offline");
        }
      }
    }).catch(() => setServerState("error"));
  };

  const startAgentRun = async (prompt: string) => {
    const currentPresentation = serverPresentationRef.current;
    if (!currentPresentation) return;
    try {
      const run = await pptApi.createRun({
        presentationId: currentPresentation.presentationId,
        prompt,
        maxIterations: 3,
      });
      setRunId(run.runId);
      setWorkflowStep(workflowStepForPhase(run.phase));
      const poll = async () => {
        try {
          const snapshot = await pptApi.getRun(run.runId);
          setWorkflowStep(workflowStepForPhase(snapshot.phase));
          if (snapshot.status === "COMPLETED" || snapshot.status === "CANCELLED" || snapshot.status === "FAILED") {
            runPollRef.current = null;
            setRunning(false);
            return;
          }
          runPollRef.current = window.setTimeout(() => void poll(), 220);
        } catch {
          runPollRef.current = null;
        }
      };
      runPollRef.current = window.setTimeout(() => void poll(), 120);
    } catch {
      // The local timer remains the offline fallback when the API is unavailable.
    }
  };

  const sendChatMessage = (message: string) => {
    setChatMessages((current) => [...current, { id: nextId("user"), role: "user", text: message }, { id: nextId("assistant"), role: "assistant", text: "收到。我会先拆解需求，再进行多轮检索和素材收集；你可以在右侧实时看到每一页的搭建过程。" }]);
    setWorkflowStep(0);
    setRunning(true);
    void startAgentRun(message);
  };

  const restartWorkflow = () => {
    setChatMessages((current) => [...current, { id: nextId("assistant"), role: "assistant", text: "我会重新规划这一版结构，并从第一轮资料检索开始。" }]);
    setWorkflowStep(0);
    setRunning(true);
    void startAgentRun("重新规划当前演示文稿");
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftWidth;
    const move = (moveEvent: globalThis.PointerEvent) => setLeftWidth(Math.max(320, Math.min(620, startWidth + moveEvent.clientX - startX)));
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const updateActiveSlide = (patch: Partial<WorkspaceSlide>) => {
    const previous = activeSlide;
    setSlides((items) => items.map((slide) => slide.id === previous.id ? { ...slide, ...patch } : slide));
    const operations: Array<Record<string, unknown>> = [];
    if (patch.title !== undefined) operations.push({ operationId: nextId("op-title"), type: "UPDATE_ELEMENT", slideId: previous.id, elementId: `${previous.id}-title`, patch: { text: patch.title } });
    if (patch.subtitle !== undefined) operations.push({ operationId: nextId("op-subtitle"), type: "UPDATE_ELEMENT", slideId: previous.id, elementId: `${previous.id}-subtitle`, patch: { text: patch.subtitle } });
    if (patch.notes !== undefined) operations.push({ operationId: nextId("op-notes"), type: "SET_NOTES", slideId: previous.id, notes: patch.notes });
    if (patch.items) {
      const before = new Map(previous.items.map((item) => [item.id, item]));
      const after = new Map(patch.items.map((item) => [item.id, item]));
      for (const item of patch.items) if (!before.has(item.id)) operations.push({ operationId: nextId("op-add"), type: "ADD_ELEMENT", slideId: previous.id, element: canonicalElementFromItem(item, patch.items.indexOf(item)) });
      for (const item of previous.items) if (!after.has(item.id)) operations.push({ operationId: nextId("op-delete"), type: "DELETE_ELEMENT", slideId: previous.id, elementId: item.id });
    }
    persistOperations(operations);
  };

  const insertItem = (kind: "text" | "shape" | "image" | "table" | "chart") => {
    let item: CanvasItem;
    if (kind === "text") item = { id: nextId("text"), kind, x: 54, y: 18, w: 34, h: 12, text: "新增文本" };
    else if (kind === "shape") item = { id: nextId("shape"), kind, x: 60, y: 48, w: 18, h: 18, shape: "ellipse" };
    else if (kind === "image") item = { id: nextId("image"), kind, x: 60, y: 22, w: 30, h: 32, src: generatedAssets[(activeIndex + 1) % generatedAssets.length], alt: "插入图片" };
    else if (kind === "table") item = { id: nextId("table"), kind, x: 52, y: 38, w: 40, h: 32 };
    else item = { id: nextId("chart"), kind, x: 55, y: 32, w: 36, h: 40 };
    updateActiveSlide({ items: [...activeSlide.items, item] });
    setSelectedItemId(item.id);
  };

  const addSlide = () => {
    const slide = createSlide(slides.length);
    setSlides((items) => [...items, slide]);
    setActiveSlideId(slide.id);
    setSelectedItemId(null);
    persistOperations([{ operationId: nextId("op-slide"), type: "ADD_SLIDE", slide: canonicalSlideFromWorkspace(slide, slides.length) }]);
  };

  const duplicateSlide = () => {
    const copy = { ...activeSlide, id: nextId("slide"), title: `${activeSlide.title}（副本）`, items: activeSlide.items.map((item) => ({ ...item, id: nextId(item.kind) })) };
    const next = [...slides];
    next.splice(activeIndex + 1, 0, copy);
    setSlides(next);
    setActiveSlideId(copy.id);
    persistOperations([{ operationId: nextId("op-slide"), type: "ADD_SLIDE", slide: canonicalSlideFromWorkspace(copy, activeIndex + 1) }]);
  };

  const deleteSlide = () => {
    if (slides.length === 1) return;
    const next = slides.filter((slide) => slide.id !== activeSlide.id);
    setSlides(next);
    setActiveSlideId(next[Math.max(0, activeIndex - 1)].id);
    persistOperations([{ operationId: nextId("op-slide-delete"), type: "DELETE_SLIDE", slideId: activeSlide.id }]);
  };

  const deleteSelected = () => {
    if (!selectedItemId) return;
    updateActiveSlide({ items: activeSlide.items.filter((item) => item.id !== selectedItemId) });
    setSelectedItemId(null);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const imageData = await Promise.all([...new Set(slides.map((slide) => slide.image))].map(async (src) => [src, await imageUrlToDataUrl(src)] as const));
      const imageMap = new Map(imageData);
      const document = {
        title: "智能体时代的协作新范式",
        author: "AI PPT",
        language: "zh-CN",
        slides: slides.map((slide) => {
          const elements: ExportElement[] = [
            { kind: "image", x: 0, y: 0, w: 13.333, h: 7.5, data: imageMap.get(slide.image)!, alt: "幻灯片背景" },
            { kind: "shape", x: 0, y: 0, w: 13.333, h: 7.5, shape: "rect", fill: slide.tone === "dark" ? "0F172A" : "FFFFFF", transparency: slide.tone === "dark" ? 38 : 32 },
            { kind: "text", x: 0.9, y: 0.8, w: 8.2, h: 0.3, text: slide.eyebrow, fontSize: 9, color: slide.tone === "dark" ? "C4B5FD" : "6D28D9", bold: true },
            { kind: "text", x: 0.9, y: 1.7, w: 8.2, h: 2.2, text: slide.title, fontSize: 30, color: slide.tone === "dark" ? "FFFFFF" : "111827", bold: true },
            { kind: "text", x: 0.9, y: 4.4, w: 7.2, h: 0.9, text: slide.subtitle, fontSize: 13, color: slide.tone === "dark" ? "CBD5E1" : "475569" },
          ];
          slide.items.forEach((item) => {
            const pos = { x: item.x * 0.13333, y: item.y * 0.075, w: item.w * 0.13333, h: item.h * 0.075 };
            if (item.kind === "text") elements.push({ kind: "text", ...pos, text: item.text, fontSize: 16, color: slide.tone === "dark" ? "FFFFFF" : "111827" });
            if (item.kind === "shape") elements.push({ kind: "shape", ...pos, shape: item.shape, fill: "7C3AED", transparency: 20, line: "A78BFA" });
            if (item.kind === "image") elements.push({ kind: "image", ...pos, data: imageMap.get(item.src) ?? imageMap.get(slide.image)!, alt: item.alt });
            if (item.kind === "table") elements.push({ kind: "table", ...pos, rows: [["Q1", "Q2", "Q3"], ["24", "42", "68"]], headerFill: "7C3AED", borderColor: "CBD5E1" });
            if (item.kind === "chart") elements.push({ kind: "chart", ...pos, chartType: "bar", series: [{ name: "增长", labels: ["Q1", "Q2", "Q3"], values: [24, 42, 68] }], showLegend: false });
          });
          return { background: slide.tone === "dark" ? "0F172A" : "F8FAFC", notes: slide.notes, elements };
        }),
      };
      const response = await fetch("/api/ppt/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(document),
      });
      if (!response.ok) throw new Error("PPTX 导出失败");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = "AI-PPT-智能体协作.pptx";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div data-ppt-workspace className="flex h-screen min-h-[720px] flex-col overflow-hidden bg-[#eef0f4] text-slate-950">
      <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/ppt" aria-label="返回模板市场" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><ArrowLeft size={18} /></Link>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white"><Sparkles size={15} /></span>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{serverPresentation?.title ?? (freshFromSidebar ? "新建 AI PPT" : "智能体时代的协作新范式")}</p><p className="truncate text-[10px] text-slate-400">{presentationId === "new" ? "新演示" : presentationId} · {freshFromSidebar ? "空白工作台" : `模板 ${templateId}`}{runId ? ` · Run ${runId.slice(-8)}` : ""}</p></div>
          <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium md:flex ${serverState === "ready" ? "bg-emerald-50 text-emerald-700" : serverState === "loading" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}><span className={`h-1.5 w-1.5 rounded-full ${serverState === "ready" ? "bg-emerald-500" : serverState === "loading" ? "bg-amber-500" : "bg-slate-400"}`} /> {serverState === "ready" ? "已连接 · 自动保存" : serverState === "loading" ? "正在连接" : "本地编辑 · 稍后同步"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setMobileWorkflowOpen(true)} className="flex h-9 items-center gap-2 rounded-full border border-slate-200 px-3 text-xs font-medium lg:hidden"><Menu size={15} /> 工作流</button>
          <button type="button" className="hidden h-9 items-center gap-2 rounded-full px-3 text-xs font-medium text-slate-600 hover:bg-slate-100 sm:flex"><MonitorPlay size={15} /> 放映 <ChevronDown size={12} /></button>
          <button type="button" onClick={() => void handleExport()} disabled={exporting} className="flex h-9 items-center gap-2 rounded-full bg-slate-950 px-3.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"><Download size={14} /> {exporting ? "导出中…" : "导出 PPTX"}</button>
          <button type="button" aria-label="更多操作" className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><MoreHorizontal size={18} /></button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="hidden min-h-0 shrink-0 lg:flex" style={{ width: leftWidth }}><WorkflowPanel step={workflowStep} running={running} started={started} messages={chatMessages} onToggle={() => setRunning((value) => !value)} onRestart={restartWorkflow} onSendMessage={sendChatMessage} /></div>
        <div role="separator" aria-label="调整 AI 对话区宽度" aria-orientation="vertical" onPointerDown={beginResize} className="hidden w-1 shrink-0 cursor-col-resize bg-slate-200 transition hover:bg-violet-300 lg:block" />
        {mobileWorkflowOpen && (
          <div className="fixed inset-0 z-50 flex bg-slate-950/30 lg:hidden" onClick={() => setMobileWorkflowOpen(false)}>
            <div className="relative flex h-full w-[min(92vw,430px)]" onClick={(event) => event.stopPropagation()}><WorkflowPanel step={workflowStep} running={running} started={started} messages={chatMessages} onToggle={() => setRunning((value) => !value)} onRestart={restartWorkflow} onSendMessage={sendChatMessage} /><button type="button" aria-label="关闭工作流" onClick={() => setMobileWorkflowOpen(false)} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-500 shadow"><X size={15} /></button></div>
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-5">
            <div className="flex items-center gap-1">
              <button type="button" aria-label="选择工具" className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-800"><MousePointer2 size={17} /></button>
              {toolGroups.map(({ label, ariaLabel, icon: Icon, kind }) => (
                <button key={label} type="button" onClick={() => insertItem(kind)} aria-label={ariaLabel} className="flex h-12 min-w-[48px] flex-col items-center justify-center gap-1 rounded-xl px-2 text-[10px] text-slate-600 hover:bg-slate-100 hover:text-slate-950"><Icon size={17} /><span className="hidden sm:block">{label}</span></button>
              ))}
              <span className="mx-1 h-8 w-px bg-slate-200" />
              <button type="button" aria-label="格式" className="hidden h-12 min-w-[48px] flex-col items-center justify-center gap-1 rounded-xl px-2 text-[10px] text-slate-600 hover:bg-slate-100 sm:flex"><Palette size={17} />格式</button>
              <button type="button" aria-label="动画" className="hidden h-12 min-w-[48px] flex-col items-center justify-center gap-1 rounded-xl px-2 text-[10px] text-slate-600 hover:bg-slate-100 sm:flex"><Sparkles size={17} />动画</button>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" aria-label="撤销" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><Undo2 size={16} /></button>
              <button type="button" aria-label="重做" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><Redo2 size={16} /></button>
              <button type="button" onClick={deleteSelected} disabled={!selectedItemId} aria-label="删除所选元素" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 size={15} /></button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <aside aria-label="幻灯片缩略图" className="flex w-[118px] shrink-0 flex-col border-r border-slate-200 bg-[#f7f7f8] sm:w-[168px]">
              <div className="flex h-12 shrink-0 items-center gap-1 border-b border-slate-200 px-2 sm:px-3">
                <button type="button" onClick={addSlide} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-700 hover:border-violet-300"><Plus size={14} /> <span className="hidden sm:inline">新建幻灯片</span><span className="sm:hidden">新建</span></button>
                <button type="button" aria-label="新建幻灯片菜单" className="flex h-8 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500"><ChevronDown size={12} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-3">
                <div className="space-y-3">
                  {slides.map((slide, index) => (
                    <button key={slide.id} type="button" onClick={() => { setActiveSlideId(slide.id); setSelectedItemId(null); }} className="group flex w-full items-start gap-1.5 text-left">
                      <span className={`mt-1 w-3 shrink-0 text-right text-[10px] ${slide.id === activeSlide.id ? "text-violet-600" : "text-slate-400"}`}>{index + 1}</span>
                      <span className={`block flex-1 overflow-hidden rounded-lg border-2 bg-slate-900 shadow-sm transition ${slide.id === activeSlide.id ? "border-violet-600" : "border-transparent group-hover:border-slate-300"}`}><SlideSurface slide={slide} compact /></span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 border-t border-slate-200 p-2">
                <button type="button" onClick={duplicateSlide} aria-label="复制幻灯片" className="flex h-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white"><Copy size={14} /></button>
                <button type="button" onClick={deleteSlide} aria-label="删除幻灯片" className="flex h-8 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={14} /></button>
              </div>
            </aside>

            <section className="flex min-w-0 flex-1 flex-col bg-[#e9ebef]" onClick={() => setSelectedItemId(null)}>
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-300/60 px-4 text-[11px] text-slate-500">
                <span className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${workflowStep >= workflow.length - 1 ? "bg-emerald-500" : "bg-violet-500"}`} /> {statusText}</span>
                <span>{activeIndex + 1} / {slides.length}</span>
              </div>
              <div ref={canvasRef} className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 sm:p-8 xl:p-10">
                <div className="w-full max-w-[1120px] transition-transform" style={{ width: `${zoom}%` }} onClick={(event) => event.stopPropagation()}>
                  <div className="overflow-hidden rounded-sm bg-white shadow-[0_20px_70px_rgba(15,23,42,0.18)] ring-1 ring-slate-300"><SlideSurface slide={activeSlide} selectedItemId={selectedItemId} onSelectItem={setSelectedItemId} onChange={updateActiveSlide} /></div>
                </div>
              </div>
              <div className="flex min-h-[72px] shrink-0 items-stretch border-t border-slate-300/70 bg-white">
                <div className="flex w-28 shrink-0 items-center justify-center gap-2 border-r border-slate-200 text-[11px] font-medium text-slate-500"><AlignCenter size={14} /> 演讲者备注</div>
                <textarea value={activeSlide.notes} onChange={(event) => updateActiveSlide({ notes: event.target.value })} aria-label="演讲者备注" className="min-h-[72px] flex-1 resize-none px-4 py-3 text-xs leading-5 text-slate-600 outline-none placeholder:text-slate-400" placeholder="为当前幻灯片添加备注…" />
              </div>
            </section>
          </div>

          <footer className="flex h-38px h-[38px] shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 text-[10px] text-slate-400">
            <span>AI 生成内容请核验 · 素材来源已记录</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setZoom((value) => Math.max(45, value - 5))} aria-label="缩小" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100"><ZoomOut size={13} /></button>
              <span className="w-9 text-center text-slate-600">{zoom}%</span>
              <button type="button" onClick={() => setZoom((value) => Math.min(110, value + 5))} aria-label="放大" className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100"><ZoomIn size={13} /></button>
              <button type="button" onClick={() => canvasRef.current?.requestFullscreen?.()} aria-label="全屏画布" className="ml-1 flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100"><Maximize2 size={13} /></button>
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
