'use client';

import { useEffect, useMemo, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowLeft, ArrowUp, BookOpen, BriefcaseBusiness, Check, ChevronDown, FilePenLine,
  Copy, Download, FileText, GraduationCap, LayoutTemplate, Maximize2, NotebookPen, PenLine, Share2,
  Sparkles, ThumbsDown, ThumbsUp, MoreHorizontal,
  Trash2, WandSparkles,
} from 'lucide-react';
import { compileWritingPrompt } from './prompts';
import { createDefaultWritingValues, WRITING_SCENE_MAP, WRITING_SCENES } from './writingScenes';
import { documentFromV1Result, createEmptyWritingDocument, formatCitationMarkers, WritingDocumentState, WritingDocumentView } from './writingDocumentTypes';
import { WritingDraft, WritingSceneId } from './writingTypes';
import { routeWritingModel } from './writingModelRouter';
import ThesisOutlineView from './thesis/ThesisOutlineView';
import ThesisBodyView from './thesis/ThesisBodyView';
import { createRestoredReferenceSearchKeys } from './thesis/thesisReferencePersistence';
import { inferBodyArtifactStatus, inferOutlineArtifactLabel } from './writingTimelinePersistence';
import WritingLayoutWorkspace from './layout/WritingLayoutWorkspace';
import WritingFileManifest from './layout/WritingFileManifest';
import WritingDownloadMenu from './layout/WritingDownloadMenu';
import type { LayoutTocSection } from './layout/layoutDocumentTypes';
import { streamThesisBody, streamThesisOutline, streamThesisReferences } from './thesis/thesisApi';
import { createThesisWordDocument } from './thesis/thesisWordExport';
import { thesisOutlineReducer } from './thesis/thesisReducer';
import { EMPTY_THESIS_OUTLINE, ThesisBodyEvent, ThesisChapterLength, ThesisOutlineEvent, ThesisOutlineState, ThesisTargetWords } from './thesis/thesisTypes';
import * as THREE from 'three';

const DRAFT_STORAGE_KEY = 'ai-writing-draft-v1';
const DOCUMENT_STORAGE_KEY = 'ai-writing-document-v2';
const SUBMITTED_INSTRUCTION_KEY = 'ai-writing-submitted-instruction-v1';
const THESIS_OUTLINE_STORAGE_KEY = 'ai-writing-thesis-outline-v1';

const PDF_PAGE_WIDTH_PX = 794;
const PDF_PAGE_HEIGHT_PX = 1123;

type PdfCanvasRenderer = (element: HTMLElement, options: {
  backgroundColor: string;
  height: number;
  logging: boolean;
  scale: number;
  useCORS: boolean;
  width: number;
  windowHeight: number;
  windowWidth: number;
}) => Promise<HTMLCanvasElement>;

async function renderPdfSnapshot(element: HTMLElement, html2canvas: PdfCanvasRenderer, width: number, height: number) {
  const host = window.document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;overflow:hidden;pointer-events:none;z-index:-1;background:#fff;`;
  const clone = element.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id');
  Object.assign(clone.style, {
    boxShadow: 'none',
    height: `${height}px`,
    margin: '0',
    maxWidth: 'none',
    minHeight: '0',
    transform: 'none',
    width: `${width}px`,
  });
  host.appendChild(clone);
  window.document.body.appendChild(host);
  try {
    await window.document.fonts?.ready;
    return await html2canvas(clone, {
      backgroundColor: '#fff',
      height,
      logging: false,
      scale: 2,
      useCORS: true,
      width,
      windowHeight: height,
      windowWidth: width,
    });
  } finally {
    host.remove();
  }
}

async function createWritingPdf(title: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const pdf = new jsPDF({ compress: true, format: 'a4', orientation: 'portrait', unit: 'mm' });
  const layoutPages = Array.from(window.document.querySelectorAll<HTMLElement>('[data-writing-layout-page]'));
  if (layoutPages.length) {
    for (const [index, page] of layoutPages.entries()) {
      const canvas = await renderPdfSnapshot(page, html2canvas as PdfCanvasRenderer, PDF_PAGE_WIDTH_PX, PDF_PAGE_HEIGHT_PX);
      if (index > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    }
  } else {
    const body = window.document.querySelector<HTMLElement>('[data-writing-body-print-root]');
    if (!body) throw new Error('当前文档还没有可下载的内容');
    const bodyHeight = Math.max(PDF_PAGE_HEIGHT_PX, body.scrollHeight, body.getBoundingClientRect().height);
    const canvas = await renderPdfSnapshot(body, html2canvas as PdfCanvasRenderer, PDF_PAGE_WIDTH_PX, bodyHeight);
    const scale = canvas.width / PDF_PAGE_WIDTH_PX;
    const sliceHeight = Math.floor(PDF_PAGE_HEIGHT_PX * scale);
    for (let offset = 0, pageIndex = 0; offset < canvas.height; offset += sliceHeight, pageIndex += 1) {
      const slice = window.document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = Math.min(sliceHeight, canvas.height - offset);
      const context = slice.getContext('2d');
      if (!context) throw new Error('PDF 画布初始化失败');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, slice.width, slice.height);
      context.drawImage(canvas, 0, offset, canvas.width, slice.height, 0, 0, slice.width, slice.height);
      if (pageIndex > 0) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/png'), 'PNG', 0, 0, 210, 297 * (slice.height / sliceHeight), undefined, 'FAST');
    }
  }
  pdf.save(`${title || '论文正文'}.pdf`);
}

function buildThesisTocSections(outline: ThesisOutlineState): LayoutTocSection[] {
  return [
    ...outline.prefaces.map((preface) => ({ id: preface.id, title: preface.title, level: 1 as const })),
    ...outline.chapters.flatMap((chapter) => [
      { id: chapter.id, title: chapter.title, level: 1 as const },
      ...chapter.sections.map((section) => ({ id: section.id, title: section.title, level: 2 as const })),
    ]),
  ];
}

// 星环视觉参数：需要微调效果时，优先只改这里。
const ORBIT_VISUAL = {
  maxRadiusX: 1550,        // 横向半径：越大，场景卡片左右分布越宽
  minRadiusX: 640,        // 小窗口下的最小横向半径
  radiusXRatio: 0.7,     // 横向半径占容器宽度的比例
  radiusY: 250,           // 纵向半径：越大，圆环上下起伏越明显
  stageHeight: 540,       // 整个星环区域高度，放大半径后也要相应增加
  overlayInsetX: 530,     // 星环相对输入框左右外扩距离
  overlayInsetY: 245,     // 星环相对输入框上下外扩距离
  guideRingWidth: 1920,   // 外侧辅助圆环宽度
  guideRingHeight: 680,   // 外侧辅助圆环高度
  innerRingWidth: 1540,    // 内侧辅助圆环宽度
  innerRingHeight: 805,   // 内侧辅助圆环高度
  cardWidth: 136,         // 场景卡片宽度
  cardHeight: 88,         // 场景卡片高度
  iconBoxSize: 44,        // 图标底座大小
  iconSize: 24,           // 图标本身大小
  labelSize: 14,          // 场景文字大小
} as const;

const SCENE_ICONS: Record<WritingSceneId, typeof FileText> = {
  general: FileText,
  essay: FilePenLine,
  novel: BookOpen,
  thesis: GraduationCap,
  'work-summary': BriefcaseBusiness,
  reflection: NotebookPen,
  internship: PenLine,
  application: FileText,
  report: FilePenLine,
  thought: NotebookPen,
  teaching: GraduationCap,
  rewrite: PenLine,
  scheme: LayoutTemplate,
  'business-plan': BriefcaseBusiness,
  blessing: Sparkles,
  'friend-circle': Share2,
  'little-red-book': BookOpen,
  'book-review': NotebookPen,
  speech: FileText,
  poem: PenLine,
  'emotional-reply': ThumbsUp,
  'self-introduction': FileText,
  'daily-report': FileText,
  survey: FileText,
};

interface WritingSceneOrbitProps {
  activeScene: WritingSceneId;
  onSelect: (scene: WritingSceneId) => void;
}

function WritingSceneOrbit({ activeScene, onSelect }: WritingSceneOrbitProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, rotation: 0, tilt: 58 });
  const orbitRotationRef = useRef(0);
  const orbitTiltRef = useRef(58);
  const pauseUntilRef = useRef(0);
  const [rotation, setRotation] = useState(0);
  const [tilt, setTilt] = useState(58);
  const [hoveredScene, setHoveredScene] = useState<WritingSceneId | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [stageWidth, setStageWidth] = useState(760);
  const step = 360 / WRITING_SCENES.length;
  const activeIndex = Math.max(0, WRITING_SCENES.findIndex((scene) => scene.id === activeScene));
  const radiusX = Math.min(ORBIT_VISUAL.maxRadiusX, Math.max(ORBIT_VISUAL.minRadiusX, stageWidth * ORBIT_VISUAL.radiusXRatio));
  const radiusY = ORBIT_VISUAL.radiusY;

  orbitRotationRef.current = rotation;
  orbitTiltRef.current = tilt;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = stageRef.current;
    if (!canvas || !host) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.2, 10);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    const orbit = new THREE.Group();
    scene.add(orbit);

    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.58 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.025, 10, 180), ringMaterial);
    ring.rotation.x = Math.PI / 2.7;
    orbit.add(ring);
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.012, 8, 140), new THREE.MeshBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.4 }));
    innerRing.rotation.x = Math.PI / 2.7;
    orbit.add(innerRing);

    const particlePositions = new Float32Array(420 * 3);
    for (let index = 0; index < 420; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 3.05 + Math.random() * 1.35;
      particlePositions[index * 3] = Math.cos(angle) * radius;
      particlePositions[index * 3 + 1] = (Math.random() - 0.5) * 0.32;
      particlePositions[index * 3 + 2] = Math.sin(angle) * radius;
    }
    const particles = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(particlePositions, 3)),
      new THREE.PointsMaterial({ color: 0x60a5fa, size: 0.035, transparent: true, opacity: 0.75 }),
    );
    particles.rotation.x = Math.PI / 2.7;
    orbit.add(particles);

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, bounds.width), Math.max(1, bounds.height), false);
      camera.aspect = Math.max(1, bounds.width) / Math.max(1, bounds.height);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    let frame = 0;
    const animate = () => {
      orbit.rotation.y = orbitRotationRef.current * 0.008 + (reducedMotion ? 0 : frame * 0.0007);
      orbit.rotation.x = THREE.MathUtils.degToRad((orbitTiltRef.current - 58) * 0.28);
      particles.rotation.z = frame * 0.00035;
      renderer.render(scene, camera);
      frame += 1;
      animationFrame = window.requestAnimationFrame(animate);
    };
    let animationFrame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      ring.geometry.dispose(); ringMaterial.dispose();
      innerRing.geometry.dispose(); (innerRing.material as THREE.Material).dispose();
      particles.geometry.dispose(); (particles.material as THREE.Material).dispose();
      renderer.dispose();
    };
  }, [reducedMotion]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const resize = () => setStageWidth(stage.getBoundingClientRect().width);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    setRotation(-activeIndex * step);
    pauseUntilRef.current = Date.now() + 1100;
  }, [activeIndex, step]);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => {
      if (dragging || hoveredScene || Date.now() < pauseUntilRef.current) return;
      setRotation((value) => value + 0.12);
    }, 40);
    return () => window.clearInterval(timer);
  }, [dragging, hoveredScene, reducedMotion]);

  const selectOrbitScene = (scene: WritingSceneId) => {
    pauseUntilRef.current = Date.now() + 1600;
    onSelect(scene);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    pointerRef.current = { x: event.clientX, y: event.clientY, rotation, tilt };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) {
      const bounds = stageRef.current?.getBoundingClientRect();
      if (bounds) setTilt(50 + ((event.clientY - bounds.top) / bounds.height) * 18);
      return;
    }
    const deltaX = event.clientX - pointerRef.current.x;
    const deltaY = event.clientY - pointerRef.current.y;
    setRotation(pointerRef.current.rotation + deltaX * 0.42);
    setTilt(Math.min(76, Math.max(38, pointerRef.current.tilt - deltaY * 0.18)));
  };
  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    pauseUntilRef.current = Date.now() + 900;
  };
  const resetPointerTilt = () => {
    if (!dragging) setTilt(58);
  };

  return (
    <section
      aria-label="写作场景星环"
      className="pointer-events-none relative my-6 select-none overflow-visible"
      style={{ height: ORBIT_VISUAL.stageHeight }}
    >
      <div
        ref={stageRef}
        role="region"
        tabIndex={0}
        aria-label="可拖动的写作场景环。使用左右方向键切换场景。"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onPointerLeave={resetPointerTilt}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          const nextIndex = (activeIndex + (event.key === 'ArrowRight' ? 1 : -1) + WRITING_SCENES.length) % WRITING_SCENES.length;
          selectOrbitScene(WRITING_SCENES[nextIndex].id);
        }}
        className={`pointer-events-none relative mx-auto h-full w-full max-w-5xl overflow-visible rounded-[40px] bg-[radial-gradient(ellipse_at_center,rgba(219,234,254,0.7),rgba(255,255,255,0)_68%)] outline-none [perspective:1100px] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-90" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-blue-200/70 bg-blue-100/[0.04] shadow-[0_0_55px_rgba(59,130,246,0.14)] [transform:rotateX(67deg)_rotateZ(-7deg)]" style={{ width: ORBIT_VISUAL.guideRingWidth, height: ORBIT_VISUAL.guideRingHeight }} />
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-dashed border-cyan-200/60 [transform:rotateX(67deg)_rotateZ(-7deg)]" style={{ width: ORBIT_VISUAL.innerRingWidth, height: ORBIT_VISUAL.innerRingHeight }} />
        <div
          className="absolute inset-0 z-10"
        >
          {WRITING_SCENES.map((sceneItem, index) => {
            const Icon = SCENE_ICONS[sceneItem.id];
            const angle = index * step + rotation;
            const normalized = ((angle % 360) + 360) % 360;
            const depth = Math.cos((normalized * Math.PI) / 180);
            const isActive = sceneItem.id === activeScene;
            const isHovered = sceneItem.id === hoveredScene;
            const opacity = Math.max(0.24, Math.min(1, 0.48 + depth * 0.52));
            const scale = 0.76 + Math.max(0, depth) * 0.24;
            const x = Math.cos((angle * Math.PI) / 180) * radiusX;
            const tiltScale = Math.max(0.58, Math.min(1.15, tilt / 58));
            const y = Math.sin((angle * Math.PI) / 180) * radiusY * tiltScale;
            return (
              <button
                key={sceneItem.id}
                type="button"
                aria-pressed={isActive}
                aria-label={`${sceneItem.label}场景`}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => selectOrbitScene(sceneItem.id)}
                onMouseEnter={() => setHoveredScene(sceneItem.id)}
                onMouseLeave={() => setHoveredScene(null)}
                className={`pointer-events-auto absolute flex flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 font-medium backdrop-blur-md transition-[transform,opacity,filter,box-shadow,border-color] duration-500 ${
                  isActive ? 'border-blue-400 bg-white text-blue-700 shadow-[0_0_30px_rgba(37,99,235,0.38)]' : isHovered ? 'border-cyan-300 bg-white text-slate-950 shadow-[0_0_28px_rgba(34,211,238,0.48)]' : 'border-white/70 bg-white/80 text-slate-700 shadow-[0_8px_25px_rgba(15,23,42,0.12)]'
                }`}
                style={{
                  opacity: isHovered || isActive ? 1 : opacity,
                  filter: depth < -0.15 && !isActive ? 'blur(1.5px)' : 'none',
                  left: `calc(50% + ${x}px)`,
                  top: `calc(50% + ${y}px)`,
                  width: ORBIT_VISUAL.cardWidth,
                  height: ORBIT_VISUAL.cardHeight,
                  fontSize: ORBIT_VISUAL.labelSize,
                  transform: `translate(-50%, -50%) rotate(${-angle * 0.025}deg) scale(${isHovered ? 1.08 : isActive ? 1.05 : scale})`,
                  zIndex: Math.round((depth + 1) * 100) + (isActive ? 20 : 0),
                }}
              >
                <span className={`flex shrink-0 items-center justify-center rounded-xl ${isActive ? 'bg-blue-500/20 text-cyan-200' : 'bg-slate-100 text-blue-600'}`} style={{ width: ORBIT_VISUAL.iconBoxSize, height: ORBIT_VISUAL.iconBoxSize }}><Icon size={ORBIT_VISUAL.iconSize} /></span>
                <span className="max-w-full truncate">{sceneItem.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] tracking-[0.18em] text-slate-400">拖动倾斜 · 悬停聚焦 · 点击入轨</div>
    </section>
  );
}

interface WritingWorkspaceProps {
  onBack: () => void;
  onSubmit: (payload: { instruction: string; compiledPrompt: ReturnType<typeof compileWritingPrompt> }) => Promise<string>;
  onEnsureWritingSession: (instruction: string) => Promise<string>;
  onThesisBodyRequest?: (payload: { phase: 'start' | 'complete' | 'failed'; title: string }) => Promise<void> | void;
  initialResult?: string;
  initialInstruction?: string;
  restoreFromSession?: boolean;
  initialDraft?: WritingDraft;
  initialDocument?: WritingDocumentState;
  initialThesisOutline?: ThesisOutlineState;
  onWorkspaceChange?: (state: { draft: WritingDraft; document: WritingDocumentState; thesisOutline: ThesisOutlineState }) => void;
}

function readDraft(): WritingDraft {
  const fallback = { scene: 'general' as const, instruction: '', valuesByScene: createDefaultWritingValues() };
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) ?? 'null') as Partial<WritingDraft> | null;
    if (!stored?.scene || !WRITING_SCENE_MAP[stored.scene]) return fallback;
    const hydratedValues = Object.fromEntries(
      WRITING_SCENES.map((scene) => [scene.id, { ...fallback.valuesByScene[scene.id], ...(stored.valuesByScene?.[scene.id] ?? {}) }]),
    ) as WritingDraft['valuesByScene'];
    return { ...fallback, ...stored, valuesByScene: hydratedValues };
  } catch { return fallback; }
}

function readDocument(scene: WritingSceneId, initialResult: string, allowStoredDocument = true): WritingDocumentState {
  if (allowStoredDocument && typeof window !== 'undefined') {
    try {
      const stored = JSON.parse(localStorage.getItem(DOCUMENT_STORAGE_KEY) ?? 'null') as WritingDocumentState | null;
      if (stored?.scene && WRITING_SCENE_MAP[stored.scene]) return stored;
    } catch { /* corrupted local draft falls back safely */ }
  }
  return initialResult.trim() ? documentFromV1Result(scene, initialResult) : createEmptyWritingDocument(scene);
}

function readThesisOutline(): ThesisOutlineState {
  if (typeof window === 'undefined') return EMPTY_THESIS_OUTLINE;
  try { return JSON.parse(localStorage.getItem(THESIS_OUTLINE_STORAGE_KEY) ?? 'null') as ThesisOutlineState || EMPTY_THESIS_OUTLINE; }
  catch { return EMPTY_THESIS_OUTLINE; }
}

export default function WritingWorkspace({ onBack, onSubmit, onEnsureWritingSession, onThesisBodyRequest, initialResult = '', initialInstruction = '', restoreFromSession = false, initialDraft, initialDocument, initialThesisOutline, onWorkspaceChange }: WritingWorkspaceProps) {
  const [draft, setDraft] = useState<WritingDraft>(() => {
    if (initialDraft) return initialDraft;
    const restored = readDraft();
    return restoreFromSession ? { ...restored, instruction: initialInstruction } : restored;
  });
  const [writingDoc, setWritingDoc] = useState<WritingDocumentState>(() => initialDocument ?? readDocument(initialDraft?.scene ?? readDraft().scene, initialResult, !restoreFromSession));
  const [submittedInstruction, setSubmittedInstruction] = useState(() => {
    if (restoreFromSession) return initialInstruction;
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(SUBMITTED_INSTRUCTION_KEY) ?? '';
  });
  const [workspaceStarted, setWorkspaceStarted] = useState(() => {
    const stored = readDocument('general', initialResult, !restoreFromSession);
    return stored.generatedLength > 0 || stored.researchStatus !== 'idle';
  });
  const [openField, setOpenField] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bodyPaused, setBodyPaused] = useState(false);
  const [error, setError] = useState('');
  const [bodyArtifactStatus, setBodyArtifactStatus] = useState<'generating' | 'complete' | 'failed' | null>(null);
  const [bodyArtifactUrl, setBodyArtifactUrl] = useState<string | null>(null);
  const [outlineTypingText, setOutlineTypingText] = useState('');
  const [leftPanePercent, setLeftPanePercent] = useState(42);
  const [copied, setCopied] = useState(false);
  const [fileManifestOpen, setFileManifestOpen] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [thesisOutline, dispatchThesisOutline] = useReducer(thesisOutlineReducer, initialThesisOutline, (value) => value ?? readThesisOutline());
  const layoutTocSections = useMemo(() => draft.scene === 'thesis' ? buildThesisTocSections(thesisOutline) : undefined, [draft.scene, thesisOutline]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const referenceSearchKeyRef = useRef<Set<string>>(createRestoredReferenceSearchKeys(thesisOutline));
  const bodyAbortRef = useRef<AbortController | null>(null);
  const outlineQueueRef = useRef<Array<{ event: ThesisOutlineEvent; text: string; commit: boolean }>>([]);
  const outlineActiveRef = useRef<{ event: ThesisOutlineEvent; text: string; index: number; commit: boolean } | null>(null);
  const bodyQueueRef = useRef<ThesisBodyEvent[]>([]);
  const bodyActiveRef = useRef<{ event: ThesisBodyEvent; index: number } | null>(null);
  const writingDocRef = useRef(writingDoc);
  const documentPaneRef = useRef<HTMLElement>(null);
  const scene = WRITING_SCENE_MAP[draft.scene];
  const values = draft.valuesByScene[draft.scene];
  const compiled = useMemo(() => compileWritingPrompt(draft.scene, draft.instruction, values), [draft, values]);
  const route = routeWritingModel(compiled);
  const activeSection = writingDoc.sections.find((item) => item.id === writingDoc.activeSectionId) ?? writingDoc.sections[0];
  const displayedInstruction = submittedInstruction.trim() || draft.instruction.trim() || writingDoc.title;
  const documentTitle = thesisOutline.title || writingDoc.title || '论文正文';
  const restoredBodyArtifactStatus = inferBodyArtifactStatus(writingDoc);
  const displayedBodyArtifactStatus = bodyArtifactStatus ?? restoredBodyArtifactStatus;
  const outlineArtifactLabel = inferOutlineArtifactLabel(thesisOutline);

  const outlinePreviewText = (event: ThesisOutlineEvent) => {
    if (event.type === 'title') return event.title;
    if (event.type === 'preface') return [event.title, event.writing_brief].filter(Boolean).join('：');
    if (event.type === 'chapter') return [event.title, event.summary].filter(Boolean).join('：');
    if (event.type === 'section') return [event.title, event.writing_brief].filter(Boolean).join('：');
    return '';
  };

  const handleThesisOutlineEvent = (event: ThesisOutlineEvent) => {
    if (event.type === 'thesis_outline_started') {
      outlineQueueRef.current = [];
      outlineActiveRef.current = null;
      setOutlineTypingText('');
      dispatchThesisOutline(event);
      return;
    }
    if (event.type === 'token' || event.type === 'chapter_search_started' || event.type === 'research_phase' || event.type === 'reference_found' || event.type === 'reference_scraped' || event.type === 'chapter_search_completed' || event.type === 'chapter_search_failed' || event.type === 'error' || event.type === 'done') {
      dispatchThesisOutline(event);
      return;
    }
    // 先提交结构，再进入视觉打字队列；否则搜索返回时章节尚不存在，来源事件会被丢弃。
    dispatchThesisOutline(event);
    outlineQueueRef.current.push({ event, text: outlinePreviewText(event), commit: false });
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!outlineActiveRef.current) {
        const next = outlineQueueRef.current.shift();
        if (next) {
          outlineActiveRef.current = { ...next, index: 0 };
          setOutlineTypingText('');
        }
      }
      const active = outlineActiveRef.current;
      if (active && active.index < active.text.length) {
        const nextIndex = active.index + 1;
        setOutlineTypingText(active.text.slice(0, nextIndex));
        active.index = nextIndex;
      } else if (active) {
        if (active.commit) dispatchThesisOutline(active.event);
        outlineActiveRef.current = null;
        setOutlineTypingText('');
      }

      const bodyActive = bodyActiveRef.current;
      if (!bodyActive) {
        const nextBodyEvent = bodyQueueRef.current.shift();
        if (nextBodyEvent) bodyActiveRef.current = { event: nextBodyEvent, index: 0 };
      }
      const currentBody = bodyActiveRef.current;
      if (!currentBody) return;
      if (currentBody.event.type === 'body_token' && currentBody.index < currentBody.event.token.length) {
        const token = currentBody.event.token[currentBody.index];
        applyThesisBodyEventImmediate({ ...currentBody.event, token });
        currentBody.index += 1;
        return;
      }
      if (currentBody.event.type === 'body_token') {
        bodyActiveRef.current = null;
        return;
      }
      applyThesisBodyEventImmediate(currentBody.event);
      bodyActiveRef.current = null;
    }, 32);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!restoreFromSession) localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [draft, restoreFromSession]);
  useEffect(() => {
    onWorkspaceChange?.({ draft, document: writingDoc, thesisOutline });
  }, [draft, onWorkspaceChange, thesisOutline, writingDoc]);
  useEffect(() => { writingDocRef.current = writingDoc; }, [writingDoc]);
  useEffect(() => () => { if (bodyArtifactUrl) URL.revokeObjectURL(bodyArtifactUrl); }, [bodyArtifactUrl]);
  useEffect(() => {
    if (restoreFromSession) return;
    const timeout = window.setTimeout(() => localStorage.setItem(DOCUMENT_STORAGE_KEY, JSON.stringify(writingDoc)), 250);
    return () => window.clearTimeout(timeout);
  }, [writingDoc, restoreFromSession]);
  useEffect(() => {
    const timeout = window.setTimeout(() => localStorage.setItem(THESIS_OUTLINE_STORAGE_KEY, JSON.stringify(thesisOutline)), 250);
    return () => window.clearTimeout(timeout);
  }, [thesisOutline]);
  useEffect(() => {
    if (writingDoc.generatedLength > 0 || writingDoc.researchStatus !== 'idle') setWorkspaceStarted(true);
  }, [writingDoc.generatedLength, writingDoc.researchStatus]);
  useEffect(() => {
    const area = textareaRef.current; if (!area) return;
    area.style.height = '0px'; area.style.height = `${Math.min(Math.max(area.scrollHeight, 104), 280)}px`;
  }, [draft.instruction]);
  useEffect(() => {
    const close = (event: MouseEvent) => !(event.target as HTMLElement).closest('[data-writing-select]') && setOpenField(null);
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => {
    if (draft.scene !== 'thesis' || thesisOutline.status === 'failed' || !thesisOutline.chapters.length) return;
    // 大纲节点是流式到达的；每个新章节立即启动自己的检索，参考资料无需等待整篇大纲完成。
    const instruction = submittedInstruction || draft.instruction || thesisOutline.title;
    for (const chapter of thesisOutline.chapters) {
      // 会话快照已经持久化 references/searchStatus；恢复页面时不得重复消耗检索额度。
      if (chapter.searchStatus === 'complete' || chapter.references.length > 0) {
        referenceSearchKeyRef.current.add(chapter.id);
        continue;
      }
      if (referenceSearchKeyRef.current.has(chapter.id)) continue;
      referenceSearchKeyRef.current.add(chapter.id);
      void streamThesisReferences({
        instruction,
        chapters: [{ id: chapter.id, title: chapter.title, summary: chapter.summary }],
      }, dispatchThesisOutline).catch((reason) => {
        setError(reason instanceof Error ? reason.message : '参考资料搜索失败');
      });
    }
  }, [draft.instruction, draft.scene, submittedInstruction, thesisOutline.chapters, thesisOutline.status, thesisOutline.title]);

  const selectScene = (next: WritingSceneId) => {
    setDraft((current) => ({ ...current, scene: next }));
    setWritingDoc((current) => ({ ...current, scene: next, updatedAt: Date.now() }));
    setOpenField(null);
  };
  const selectValue = (fieldId: string, value: string) => setDraft((current) => ({ ...current, valuesByScene: { ...current.valuesByScene, [current.scene]: { ...current.valuesByScene[current.scene], [fieldId]: value } } }));
  const clearDraft = () => {
    localStorage.removeItem(DRAFT_STORAGE_KEY); localStorage.removeItem(DOCUMENT_STORAGE_KEY); localStorage.removeItem(SUBMITTED_INSTRUCTION_KEY); localStorage.removeItem(THESIS_OUTLINE_STORAGE_KEY);
    setDraft({ scene: 'general', instruction: '', valuesByScene: createDefaultWritingValues() });
    setWritingDoc(createEmptyWritingDocument('general')); setSubmittedInstruction(''); setWorkspaceStarted(false); setError('');
  };
  const submit = async () => {
    if (!draft.instruction.trim() || isSubmitting) return;
    setSubmittedInstruction(draft.instruction);
    localStorage.setItem(SUBMITTED_INSTRUCTION_KEY, draft.instruction);
    setWorkspaceStarted(true); setIsSubmitting(true); setError('');
    if (draft.scene === 'thesis') {
      referenceSearchKeyRef.current.clear();
      setWritingDoc((current) => ({ ...current, title: draft.instruction.slice(0, 44) || '未命名论文', view: 'outline', researchStatus: 'planning', updatedAt: Date.now() }));
      try {
        const sessionId = await onEnsureWritingSession(draft.instruction);
        const parsedLength = Number(values.length?.match(/\d+/)?.[0] || 0);
        await streamThesisOutline({
          instruction: draft.instruction,
          thesisType: values.type || '通用类型',
          educationLevel: values.level || '学段不限',
          targetWords: parsedLength ? parsedLength as ThesisTargetWords : null,
          sessionId,
        }, handleThesisOutlineEvent);
        setWritingDoc((current) => ({ ...current, researchStatus: 'searching', updatedAt: Date.now() }));
      } catch (reason) {
        dispatchThesisOutline({ type: 'error', message: reason instanceof Error ? reason.message : '论文大纲生成失败' });
        setError(reason instanceof Error ? reason.message : '论文大纲生成失败');
        setWritingDoc((current) => ({ ...current, researchStatus: 'failed', updatedAt: Date.now() }));
      } finally { setIsSubmitting(false); }
      return;
    }
    setWritingDoc((current) => ({ ...current, researchStatus: 'writing', sections: current.sections.map((section) => ({ ...section, status: 'generating' })), updatedAt: Date.now() }));
    try {
      const content = await onSubmit({ instruction: draft.instruction, compiledPrompt: compiled });
      setWritingDoc(documentFromV1Result(draft.scene, content, draft.instruction.slice(0, 44) || '未命名写作'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '写作任务提交失败');
      setWritingDoc((current) => ({ ...current, researchStatus: 'failed', sections: current.sections.map((section) => ({ ...section, status: 'failed' })), updatedAt: Date.now() }));
    } finally { setIsSubmitting(false); }
  };
  const regenerateThesisOutline = async () => {
    if (thesisOutline.status !== 'ready' || isSubmitting) return;
    referenceSearchKeyRef.current.clear();
    setIsSubmitting(true); setError('');
    try {
      const sessionId = await onEnsureWritingSession(draft.instruction);
      await streamThesisOutline({
        instruction: submittedInstruction || draft.instruction,
        thesisType: values.type || '通用类型', educationLevel: values.level || '学段不限',
        targetWords: (Number(values.length?.match(/\d+/)?.[0] || 0) || null) as ThesisTargetWords | null, sessionId, previousOutline: thesisOutline,
      }, handleThesisOutlineEvent);
    } catch (reason) { dispatchThesisOutline({ type: 'error', message: reason instanceof Error ? reason.message : '候选大纲生成失败' }); }
    finally { setIsSubmitting(false); }
  };
  const setChapterLength = (chapterId: string, length: ThesisChapterLength) => {
    dispatchThesisOutline({ type: 'chapter_length', chapter_id: chapterId, length });
  };
  const addThesisSection = (chapterId: string, title: string, writingBrief: string) => {
    const chapter = thesisOutline.chapters.find((item) => item.id === chapterId); if (!chapter) return;
    dispatchThesisOutline({ type: 'section', chapter_id: chapterId, id: `${chapterId}-manual-${Date.now()}`, order: chapter.sections.length + 1, title, writing_brief: writingBrief, target_words: 0 });
  };
  const deleteThesisChapter = (chapterId: string) => {
    dispatchThesisOutline({ type: 'chapter_deleted', chapter_id: chapterId });
  };
  const updateThesisBodySection = (sectionId: string, content: string) => {
    setWritingDoc((current) => {
      const sections = current.sections.map((section) => section.id === sectionId ? { ...section, content } : section);
      return {
        ...current,
        sections,
        generatedLength: sections.reduce((total, section) => total + section.content.replace(/\s/g, '').length, 0),
        updatedAt: Date.now(),
      };
    });
  };
  const applyThesisBodyEventImmediate = (event: ThesisBodyEvent) => {
    setWritingDoc((current) => {
      if (event.type === 'body_started') return { ...current, view: 'body', researchStatus: 'writing', updatedAt: Date.now() };
      if (event.type === 'body_completed') return { ...current, researchStatus: 'done', updatedAt: Date.now() };
      if (event.type === 'body_error') return { ...current, researchStatus: 'failed', updatedAt: Date.now() };
      if (event.type === 'body_citation') {
        const citationId = `${event.chapter_id}:${event.reference_id}`;
        if (current.citations.some((citation) => citation.id === citationId)) return current;
        return { ...current, citations: [...current.citations, { id: citationId, sectionId: event.chapter_id, referenceId: event.reference_id, status: 'needs-review' }], updatedAt: Date.now() };
      }
      if (event.type === 'body_citation_verified') {
        const citationId = `${event.chapter_id}:${event.reference_id}`;
        return { ...current, citations: current.citations.map((citation) => citation.id === citationId ? { ...citation, status: event.status === 'partial' ? 'partial' : event.status } : citation), updatedAt: Date.now() };
      }
      if (event.type === 'body_verification_started') return { ...current, researchStatus: 'verifying', activeSectionId: event.chapter_id, updatedAt: Date.now() };
      const sectionIndex = current.sections.findIndex((section) => section.id === event.chapter_id);
      if (sectionIndex === -1) return current;
      const sections = current.sections.map((section, index) => {
        if (index !== sectionIndex) return section;
        if (event.type === 'body_chapter_started') return { ...section, status: 'generating' as const };
        if (event.type === 'body_token') return { ...section, content: section.content + event.token, status: 'generating' as const };
        if (event.type === 'body_chapter_completed') return { ...section, status: 'complete' as const };
        return section;
      });
      return { ...current, sections, activeSectionId: event.chapter_id, generatedLength: sections.reduce((total, section) => total + section.content.replace(/\s/g, '').length, 0), updatedAt: Date.now() };
    });
  };
  const applyThesisBodyEvent = (event: ThesisBodyEvent) => {
    if (event.type === 'body_token') {
      bodyQueueRef.current.push(event);
      return;
    }
    bodyQueueRef.current.push(event);
  };
  const generateThesisBody = async () => {
    if (isSubmitting || thesisOutline.status !== 'ready') return;
    const completedChapterIds = writingDoc.sections.filter((section) => section.status === 'complete').map((section) => section.id);
    setBodyArtifactStatus('generating');
    setBodyArtifactUrl((current) => { if (current) URL.revokeObjectURL(current); return null; });
    if (!writingDoc.sections.some((section) => thesisOutline.chapters.some((chapter) => chapter.id === section.id))) {
      setWritingDoc((current) => ({
        ...current, title: thesisOutline.title || current.title, view: 'body', researchStatus: 'writing',
        sections: thesisOutline.chapters.map((chapter) => ({ id: chapter.id, outlineId: chapter.id, title: chapter.title, level: 1, content: '', targetLength: chapter.targetWords, status: 'pending' })),
        references: thesisOutline.chapters.flatMap((chapter) => chapter.references.map((reference) => ({ id: reference.id, title: reference.title, url: reference.url, excerpt: reference.snippet, status: 'needs-review' as const }))),
        citations: [], activeSectionId: thesisOutline.chapters[0]?.id, generatedLength: 0, updatedAt: Date.now(),
      }));
    } else {
      // 未完成章节恢复时从章节起点重写，避免把重试文本重复追加到半截内容后。
      setWritingDoc((current) => ({ ...current, view: 'body', sections: current.sections.map((section) => section.status === 'complete' ? section : { ...section, content: '', status: 'pending' }), updatedAt: Date.now() }));
    }
    const controller = new AbortController(); bodyAbortRef.current = controller;
    setBodyPaused(false); setIsSubmitting(true); setError('');
    try {
      try { await onThesisBodyRequest?.({ phase: 'start', title: documentTitle }); } catch { /* conversation persistence must not block document generation */ }
      await streamThesisBody({ outline: thesisOutline, completedChapterIds }, applyThesisBodyEvent, controller.signal);
      await new Promise<void>((resolve) => {
        const waitForVisualQueue = () => {
          if (!bodyQueueRef.current.length && !bodyActiveRef.current) resolve();
          else window.setTimeout(waitForVisualQueue, 32);
        };
        waitForVisualQueue();
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const wordBlob = await createThesisWordDocument(writingDocRef.current, layoutTocSections, true);
      setBodyArtifactUrl(URL.createObjectURL(wordBlob));
      setBodyArtifactStatus('complete');
      try { await onThesisBodyRequest?.({ phase: 'complete', title: documentTitle }); } catch { /* document generation already succeeded */ }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : '论文正文生成失败');
        applyThesisBodyEvent({ type: 'body_error', message: reason instanceof Error ? reason.message : '论文正文生成失败' });
        setBodyArtifactStatus('failed');
        try { await onThesisBodyRequest?.({ phase: 'failed', title: documentTitle }); } catch { /* conversation persistence should not mask the generation error */ }
      }
    } finally { if (bodyAbortRef.current === controller) bodyAbortRef.current = null; setIsSubmitting(false); }
  };
  const pauseThesisBody = () => {
    bodyAbortRef.current?.abort(); setBodyPaused(true);
    setWritingDoc((current) => ({ ...current, researchStatus: 'writing', updatedAt: Date.now() }));
  };
  const copyWritingDocument = async () => {
    const text = [writingDoc.title, ...writingDoc.sections.flatMap((section) => [section.title, formatCitationMarkers(section.content, writingDoc.references)])].filter(Boolean).join('\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const downloadWritingDocument = async (formatted = writingDoc.layoutStatus === 'formatted') => {
    const blob = await createThesisWordDocument(writingDocRef.current, layoutTocSections, formatted);
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${writingDoc.title || '论文正文'}.docx`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const downloadWritingPdf = async () => {
    setDownloadMenuOpen(false);
    setError('');
    try {
      await createWritingPdf(documentTitle);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'PDF 鐢熸垚澶辫触');
    }
  };
  const applyLayoutTemplate = (layoutTemplateId: string) => setWritingDoc((current) => ({ ...current, layoutTemplateId, layoutStatus: 'formatted', view: 'layout', updatedAt: Date.now() }));
  const updateLayoutMetadata = (layoutMetadata: NonNullable<WritingDocumentState['layoutMetadata']>) => setWritingDoc((current) => ({ ...current, layoutMetadata, updatedAt: Date.now() }));
  const toggleDocumentFullscreen = async () => {
    if (window.document.fullscreenElement) await window.document.exitFullscreen();
    else await documentPaneRef.current?.requestFullscreen();
  };
  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.parentElement;
    if (!container) return;
    const move = (moveEvent: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      const next = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      setLeftPanePercent(Math.min(65, Math.max(30, next)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    event.preventDefault();
  };

  if (!workspaceStarted) return <main data-writing-document data-writing-empty className="flex h-full min-h-0 flex-col overflow-hidden bg-white text-slate-950">
    <div className="scrollbar-none flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10 sm:px-8">
      <div className="w-full max-w-4xl">
        <div className="text-center"><span className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm"><WandSparkles size={24}/></span><h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">灵感落地成文</h1><p className="mt-2 text-sm text-slate-500">把想法整理成清晰、完整的文字</p></div>
        <div className="relative mx-auto mt-10">
          <div
            className="pointer-events-none absolute z-30"
            style={{
              left: -ORBIT_VISUAL.overlayInsetX,
              right: -ORBIT_VISUAL.overlayInsetX,
              top: -ORBIT_VISUAL.overlayInsetY,
              bottom: -ORBIT_VISUAL.overlayInsetY,
            }}
          >
            <div className="pointer-events-none h-full"><WritingSceneOrbit activeScene={draft.scene} onSelect={selectScene} /></div>
          </div>
          <div className="relative z-20 rounded-[26px] border border-slate-200 bg-white p-3 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
          <textarea ref={textareaRef} value={draft.instruction} onChange={(event) => setDraft((current) => ({ ...current, instruction: event.target.value }))} placeholder={scene.placeholder} aria-label="写作需求" className="min-h-28 w-full resize-none border-0 bg-transparent px-4 py-3 text-[16px] leading-7 outline-none placeholder:text-slate-400" />
          <div className="relative flex min-w-0 flex-nowrap items-center gap-1.5 overflow-visible border-t border-slate-100 px-1 pt-2">
            <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-blue-50 px-3 text-sm font-medium text-blue-700"><Sparkles size={15}/>AI 写作</span>
            <div data-writing-select className="relative shrink-0">
              <button type="button" aria-haspopup="listbox" aria-expanded={openField === '__scene__'} onClick={() => setOpenField(openField === '__scene__' ? null : '__scene__')} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"><span>{scene.label}场景</span><ChevronDown size={14}/></button>
              {openField === '__scene__' && <div role="listbox" aria-label="写作场景" className="absolute left-0 top-full z-50 mt-2 min-w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">{WRITING_SCENES.map((item) => <button key={item.id} type="button" role="option" aria-selected={draft.scene === item.id} onClick={() => selectScene(item.id)} className={`block w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ${draft.scene === item.id ? 'bg-slate-100 font-medium text-slate-950' : 'text-slate-600 hover:bg-slate-50'}`}>{item.label}场景</button>)}</div>}
            </div>
            {scene.fields.map((item) => <div key={item.id} data-writing-select className="relative shrink-0"><button type="button" aria-haspopup="listbox" aria-expanded={openField === item.id} onClick={() => setOpenField(openField === item.id ? null : item.id)} className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-sm text-slate-700 hover:bg-slate-100"><span>{item.label}：{values[item.id]}</span><ChevronDown size={14}/></button>{openField === item.id && <div role="listbox" aria-label={item.label} className="absolute left-0 top-full z-50 mt-2 min-w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">{item.options.map((option) => <button key={option.value} type="button" role="option" aria-selected={values[item.id] === option.value} onClick={() => { selectValue(item.id, option.value); setOpenField(null); }} className={`block w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm ${values[item.id] === option.value ? 'bg-slate-100 font-medium text-slate-950' : 'text-slate-600 hover:bg-slate-50'}`}>{option.label}</button>)}</div>}</div>)}
            {draft.scene === 'thesis' && <span title="大纲生成后按章联网检索真实来源" className="inline-flex h-8 shrink-0 items-center rounded-full bg-blue-50 px-3 text-xs text-blue-600">联网参考 · 逐章检索</span>}
            <button type="button" disabled={!draft.instruction.trim() || isSubmitting} onClick={() => void submit()} aria-label="开始写作" className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white transition hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400"><ArrowUp size={18}/></button>
          </div>
          </div>
        </div>
      </div>
    </div>
  </main>;

  return <main data-writing-document data-writing-workspace style={{ gridTemplateColumns: `${leftPanePercent}% 8px minmax(0, 1fr)` }} className="grid h-full min-h-0 grid-cols-none overflow-hidden bg-white text-slate-950">
    <section className="relative flex min-h-0 min-w-0 flex-col bg-white">
      <header className="flex h-14 shrink-0 items-center justify-between px-5 sm:px-7">
        <div className="flex min-w-0 items-center gap-3"><button type="button" onClick={onBack} aria-label="返回对话" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ArrowLeft size={17}/></button><span className="truncate text-base font-medium text-slate-900">Qwen3.7-千问</span><ChevronDown size={15} className="text-slate-500" /></div>
        <span className="hidden text-xs text-slate-400 sm:inline">{route.label}</span>
        <button type="button" onClick={clearDraft} aria-label="清除草稿" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-rose-600"><Trash2 size={16}/></button>
      </header>
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 pb-32 pt-2 sm:px-10">
        <div className="flex justify-end"><div className="max-w-[82%] rounded-2xl bg-blue-50 px-4 py-3 text-[15px] leading-6 text-slate-900">{displayedInstruction}</div></div>
        <div className="mt-12 text-[15px] leading-7 text-slate-800">
          <p>为确保完全符合你的创作要求，我们会分步骤生成全文。你可以修改大纲来优化内容，也可以继续提出修改要求。</p>
          <button type="button" onClick={() => setWritingDoc((current) => ({ ...current, view: 'outline', updatedAt: Date.now() }))} className="mt-5 flex w-full max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm hover:border-blue-200 hover:bg-blue-50/30">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-500"><FileText size={18}/></span><span><strong className="block text-sm">大纲｜{writingDoc.title}</strong><span className="mt-0.5 block text-xs text-slate-400">{outlineArtifactLabel}</span></span>
          </button>
          {displayedBodyArtifactStatus && <div data-writing-word-message className="mt-10" aria-live="polite">
            <div className="flex justify-end"><div className="max-w-[82%] rounded-2xl bg-blue-50 px-4 py-3 text-[15px] leading-6 text-slate-900">我要基于大纲生成正文</div></div>
            <div className="mt-6 max-w-md rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm" role="status" aria-label="Word 文档生成状态">
              <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">W</span><span className="min-w-0"><strong className="block truncate text-sm text-slate-900">{documentTitle || '论文正文'}</strong><span className="mt-0.5 block text-xs text-slate-400">{displayedBodyArtifactStatus === 'generating' ? '正在生成中…' : displayedBodyArtifactStatus === 'complete' ? '已生成 Word 文档' : '生成失败，请重试'}</span></span></div>
              {displayedBodyArtifactStatus === 'complete' && <button type="button" onClick={() => void downloadWritingDocument()} className="mt-3 inline-flex text-xs font-medium text-blue-600 hover:text-blue-700">下载 Word 文档</button>}
            </div>
          </div>}
          {writingDoc.layoutStatus === 'formatted' && <div className="mt-10"><div className="flex justify-end"><div className="max-w-[82%] rounded-2xl bg-blue-50 px-4 py-3 text-[15px] leading-6 text-slate-900">我要基于正文排版</div></div><button type="button" onClick={() => setWritingDoc((current) => ({ ...current, view: 'layout' }))} className="mt-6 flex w-full max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 font-bold text-white">W</span><span><strong className="block text-sm">{documentTitle}</strong><span className="text-xs text-blue-600">已排版 · 点击查看</span></span></button></div>}
          <div className="mt-6 flex items-center gap-5 text-slate-500"><button type="button" aria-label="满意" className="hover:text-slate-900"><ThumbsUp size={18}/></button><button type="button" aria-label="不满意" className="hover:text-slate-900"><ThumbsDown size={18}/></button><button type="button" aria-label="分享" className="hover:text-slate-900"><Share2 size={18}/></button><button type="button" aria-label="更多操作" className="hover:text-slate-900"><MoreHorizontal size={19}/></button></div>
        </div>
      </div>
      <div className="absolute bottom-5 left-5 right-5 hidden lg:block">
        <div className="rounded-[22px] border border-slate-200 bg-white p-2 shadow-[0_10px_35px_rgba(15,23,42,0.06)]">
          <textarea value={draft.instruction} onChange={(event) => setDraft((current) => ({ ...current, instruction: event.target.value }))} placeholder="向 AI 写作提出修改要求" className="min-h-14 w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-slate-400"/>
          <div className="flex items-center gap-3 px-2 pb-1 text-xs text-slate-600"><Sparkles size={14} className="text-blue-600"/><span>修改全文</span><button type="button" disabled={!draft.instruction.trim() || isSubmitting} onClick={() => void submit()} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-white disabled:bg-slate-200"><ArrowUp size={16}/></button></div>
        </div>
      </div>
    </section>

    <div
      role="separator"
      aria-label="调整对话与文档区域宽度"
      aria-valuemin={30}
      aria-valuemax={65}
      aria-valuenow={Math.round(leftPanePercent)}
      tabIndex={0}
      onPointerDown={handleResizeStart}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') setLeftPanePercent((value) => Math.max(30, value - 2));
        if (event.key === 'ArrowRight') setLeftPanePercent((value) => Math.min(65, value + 2));
      }}
      className="group relative z-10 flex w-2 cursor-col-resize items-center justify-center border-x border-slate-200 bg-slate-50 outline-none hover:bg-blue-50 focus-visible:bg-blue-50"
    >
      <span className="h-12 w-0.5 rounded-full bg-slate-300 transition group-hover:bg-blue-400" />
    </div>

    <section ref={documentPaneRef} className="flex min-h-0 min-w-0 flex-col bg-white fullscreen:h-screen fullscreen:w-screen">
      <header className="relative z-40 h-16 shrink-0 bg-white" style={{ minHeight: 64 }}>
        <h1 className="truncate text-[15px] font-semibold text-slate-950" style={{ position: 'absolute', left: 28, top: '50%', width: '25%', transform: 'translateY(-50%)' }}>{writingDoc.title}</h1>
        <div role="tablist" aria-label="文档视图" className="flex items-center rounded-lg bg-slate-50 p-1" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}>{(draft.scene === 'thesis' ? [['outline','大纲'],['body','正文'],['layout','排版']] : [['body','正文'],['layout','排版']] as [WritingDocumentView, string][]).map(([value,label]) => <button key={value} type="button" role="tab" aria-selected={writingDoc.view === value} onClick={() => setWritingDoc((current) => ({ ...current, view: value as WritingDocumentView, updatedAt: Date.now() }))} className={`rounded-md px-3 py-1.5 text-sm ${writingDoc.view === value ? 'bg-white font-medium text-slate-950 shadow-sm' : 'text-slate-400'}`}>{label}</button>)}</div>
        <div className="flex items-center gap-1 text-sm text-slate-900" style={{ position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)' }}>
          <div className="relative"><button type="button" onClick={() => { setFileManifestOpen((value) => !value); setDownloadMenuOpen(false); }} className="mr-2 inline-flex h-9 items-center gap-1.5 rounded-md px-2 hover:bg-slate-50"><FileText size={16}/>{writingDoc.layoutStatus === 'formatted' ? 3 : 2}</button><WritingFileManifest document={writingDoc} open={fileManifestOpen}/></div>
          <button type="button" onClick={() => void copyWritingDocument()} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 hover:bg-slate-50" aria-label="复制全文"><Copy size={17}/><span className="hidden xl:inline">{copied ? '已复制' : '复制'}</span></button>
          <div className="relative"><button type="button" onClick={() => { setDownloadMenuOpen((value) => !value); setFileManifestOpen(false); }} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 hover:bg-slate-50" aria-label="下载文档"><Download size={18}/><span className="hidden xl:inline">下载</span></button><WritingDownloadMenu open={downloadMenuOpen} layoutView={writingDoc.view === 'layout'} formatted={writingDoc.layoutStatus === 'formatted'} onWord={(formatted) => void downloadWritingDocument(formatted)} onPdf={downloadWritingPdf}/></div>
          <button type="button" onClick={() => void toggleDocumentFullscreen()} className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-slate-50" aria-label="全屏显示"><Maximize2 size={17}/></button>
        </div>
      </header>
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto" style={{ padding: 0 }}>
        <div
          data-writing-body-print-root={writingDoc.view === 'layout' ? undefined : ''}
          className={writingDoc.view === 'body' && draft.scene === 'thesis' ? 'w-full' : ''}
          style={writingDoc.view === 'body' && draft.scene === 'thesis'
            ? { width: '100%' }
            : { width: 'calc(100% - 96px)', maxWidth: 980, margin: '0 auto', paddingTop: 32, paddingBottom: 48 }}
        >
          {writingDoc.view === 'outline' && draft.scene === 'thesis' && <><label className="mb-5 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">期望字数：<select aria-label="期望字数" value={values.length || '不限'} onChange={(event) => selectValue('length', event.target.value)} className="cursor-pointer bg-transparent font-medium outline-none">{scene.fields.find((field) => field.id === 'length')?.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><ThesisOutlineView outline={thesisOutline} typingText={outlineTypingText} onSetChapterLength={setChapterLength} onAddSection={addThesisSection} onDeleteChapter={deleteThesisChapter} onRegenerate={() => void regenerateThesisOutline()} onGenerateBody={() => void generateThesisBody()}/></>}
          {writingDoc.view === 'body' && draft.scene === 'thesis' && <ThesisBodyView document={writingDoc} outline={thesisOutline} generating={isSubmitting} paused={bodyPaused} onPause={pauseThesisBody} onContinue={() => void generateThesisBody()} onSectionChange={updateThesisBodySection}/>} 
          {writingDoc.view === 'body' && draft.scene !== 'thesis' && <article><h1 className="text-2xl font-semibold">{writingDoc.title}</h1>{isSubmitting ? <div className="mt-8 space-y-4" aria-busy="true"><div className="h-4 w-3/4 animate-pulse rounded bg-slate-100"/><div className="h-4 w-full animate-pulse rounded bg-slate-100"/><div className="h-4 w-5/6 animate-pulse rounded bg-slate-100"/></div> : <div className="mt-7 whitespace-pre-wrap text-[15px] leading-8 text-slate-800">{activeSection?.content || '正文正在生成，请稍候…'}</div>}</article>}
          {writingDoc.view === 'layout' && <WritingLayoutWorkspace document={writingDoc} tocSections={layoutTocSections} onTemplate={applyLayoutTemplate} onMetadata={updateLayoutMetadata}/>} 
          {error && <div role="alert" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        </div>
      </div>
      <footer className="flex h-10 shrink-0 items-center border-t border-slate-100 px-6 text-xs text-slate-400"><Check size={14} className="mr-1"/>{isSubmitting ? '正在生成' : '已保存'}<span className="ml-auto">{writingDoc.generatedLength} 字</span></footer>
    </section>
  </main>;
}
