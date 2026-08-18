'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  createImageGeneration,
  directImagePrompt,
  getImageModels,
  listImageBatches,
  type ImageBatch,
  type ImageAsset,
  type ImageDirectorResult,
  type ImageModelCapability,
} from '../../lib/api';

interface ImageStudioWorkspaceProps {
  initialPrompt?: string;
  onBack: () => void;
  initialReferenceImage?: { url: string; name?: string } | null;
}

interface ReferenceImage {
  url: string;
  name: string;
}

const examples = [
  '科技感赛博朋克猫咪在写代码，带“2026”霓虹字',
  '极简白底护肤品电商主图，柔和自然光',
  '江南水乡雨夜，国风电影感，远景构图',
];
const ratios = ['1:1', '4:3', '3:4', '16:9', '9:16'];
const outputOptions = [1, 2, 4];

interface ImageCandidate {
  image: ImageAsset;
  batch: ImageBatch;
  round: number;
}

function modelLabel(model: ImageModelCapability | undefined) {
  if (!model) return '等待导演分析';
  return `${model.name} · ${model.provider}`;
}

export default function ImageStudioWorkspace({ initialPrompt = '', onBack, initialReferenceImage = null }: ImageStudioWorkspaceProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [models, setModels] = useState<ImageModelCapability[]>([]);
  const [director, setDirector] = useState<ImageDirectorResult | null>(null);
  const [batch, setBatch] = useState<ImageBatch | null>(null);
  const [history, setHistory] = useState<ImageBatch[]>([]);
  const [manualModel, setManualModel] = useState('');
  const [ratio, setRatio] = useState('1:1');
  const [count, setCount] = useState(1);
  const [resolution, setResolution] = useState('1K');
  const [isDirecting, setIsDirecting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(initialReferenceImage ? { url: initialReferenceImage.url, name: initialReferenceImage.name || '参考图' } : null);
  const [selectedCandidate, setSelectedCandidate] = useState<ImageCandidate | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [error, setError] = useState('');
  const referenceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getImageModels().then(setModels).catch(() => setModels([]));
    void listImageBatches().then((result) => setHistory(result.batches)).catch(() => setHistory([]));
  }, []);

  const selectedModel = manualModel || director?.recommended_model || '';
  const selectedCapability = useMemo(() => models.find((model) => model.id === selectedModel), [models, selectedModel]);
  const selectedName = selectedCapability?.name || director?.recommended_model || '智能推荐模型';
  const maxOutputs = selectedCapability?.max_outputs ?? 4;

  useEffect(() => {
    const supportedCounts = outputOptions.filter((value) => value <= maxOutputs);
    const fallbackCount = supportedCounts[supportedCounts.length - 1] ?? 1;
    if (count > maxOutputs) setCount(fallbackCount);
  }, [count, maxOutputs]);

  const direct = async () => {
    if (!prompt.trim()) return;
    setIsDirecting(true);
    setError('');
    try {
      const result = await directImagePrompt({ raw_prompt: prompt, ratio, count, model_mode: manualModel ? 'manual' : 'auto', model: manualModel || null });
      setDirector(result);
      if (!manualModel && result.suggested_ratio && ratios.includes(result.suggested_ratio)) setRatio(result.suggested_ratio);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '视觉导演暂时不可用');
    } finally {
      setIsDirecting(false);
    }
  };

  const imageUrlToDataUrl = async (url: string) => {
    if (url.startsWith('data:')) return url;
    const response = await fetch(url);
    if (!response.ok) throw new Error('参考图读取失败，请重新选择图片');
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('参考图读取失败，请重新选择图片'));
      reader.readAsDataURL(blob);
    });
  };

  const handleReferenceUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = Array.from(event.target.files || []).find((item) => item.type.startsWith('image/'));
    if (!file) {
      event.target.value = '';
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('参考图不能超过 20MB');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setReferenceImage({ url: String(reader.result), name: file.name });
    reader.onerror = () => setError('参考图读取失败，请重试');
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const handleUseAsReference = (url: string, name = '生成结果参考图') => {
    setReferenceImage({ url, name });
    setError('');
  };

  const generate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError('');
    try {
      const referenceImageData = referenceImage ? await imageUrlToDataUrl(referenceImage.url) : undefined;
      const result = await createImageGeneration({ raw_prompt: prompt, ratio, count, model_mode: manualModel ? 'manual' : 'auto', model: manualModel || null, enhance: true, reference_image: referenceImageData });
      setBatch(result);
      setHistory((current) => [result, ...current.filter((item) => item.batch_id !== result.batch_id)]);
      if (result.director) setDirector(result.director);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成失败，请检查图片模型配置');
    } finally {
      setIsGenerating(false);
    }
  };

  const currentImages = batch?.images ?? [];
  const totalHistoryImages = history.reduce((sum, item) => sum + (item.images?.length ?? 0), 0);
  const historyCandidates = useMemo(() => history.flatMap((item, batchIndex) =>
    (item.images ?? []).map((image) => ({ image, batch: item, round: history.length - batchIndex })),
  ), [history]);

  return (
    <div className="fixed inset-y-0 left-0 right-0 z-[110] overflow-y-auto bg-slate-50 text-slate-950 dark:bg-[#0f1013] dark:text-white lg:left-72">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0f1013]/95 sm:px-7">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 dark:text-white/65 dark:hover:bg-white/[0.06] dark:hover:text-white"><ArrowLeft size={17} />返回对话</button>
        <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={16} className="text-cyan-600 dark:text-cyan-300" />AI 生图 <span className="hidden text-xs font-normal text-slate-400 dark:text-white/35 sm:inline">/ Image Studio</span></div>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-white/45"><span className="hidden items-center gap-1.5 sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />模型服务正常</span><span className="rounded-full border border-slate-200 px-2.5 py-1 dark:border-white/10">按供应商计费</span></div>
      </header>

      <div className="grid w-full gap-4 p-3 sm:gap-5 sm:p-5 lg:grid-cols-[clamp(280px,18vw,380px)_minmax(0,1fr)] lg:p-6 xl:p-8">
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-[#18191e] dark:shadow-2xl dark:shadow-black/20">
          <div className="border-b border-slate-200 px-4 pb-4 pt-5 dark:border-white/[0.07] sm:px-5"><div className="flex items-start justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-600/80 dark:text-cyan-300/80">Visual Director</p><h1 className="mt-2 text-xl font-semibold tracking-tight">创建图片</h1></div><Sparkles size={19} className="mt-1 text-yellow-500 dark:text-yellow-300" /></div><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-white/45">一句话描述画面，自动增强提示词并选择最适合的模型。</p></div>
          <div className="space-y-5 p-4 sm:p-5">
            <label htmlFor="image-prompt" className="block text-xs font-medium text-slate-600 dark:text-white/65">描述</label>
            <div className="relative">{referenceImage && <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-start gap-2"><div className="relative pointer-events-auto"><img src={referenceImage.url} alt={referenceImage.name} className="h-16 w-16 rounded-lg border border-white/80 object-cover shadow-md" /><button type="button" aria-label="移除参考图" onClick={() => setReferenceImage(null)} className="absolute -right-2 -top-2 rounded-full bg-slate-900/80 p-1 text-white shadow"><X size={11} /></button></div><button type="button" aria-label="继续添加参考图" onClick={() => referenceInputRef.current?.click()} className="pointer-events-auto flex h-16 w-12 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white/70 text-xl text-slate-400 hover:border-cyan-400 hover:text-cyan-600 dark:border-white/20 dark:bg-white/5 dark:text-white/40">+</button></div>}<textarea id="image-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} onBlur={() => { if (prompt.trim()) void direct(); }} rows={6} placeholder="例如：科技感赛博朋克猫咪在写代码，带“2026”霓虹字" className={`w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/[0.1] dark:bg-[#111216] dark:text-white dark:placeholder:text-white/25 dark:focus:border-cyan-300/60 ${referenceImage ? 'pt-24' : ''}`} /></div>
            <div className="flex flex-wrap gap-1.5">{examples.map((example) => <button key={example} type="button" onClick={() => setPrompt(example)} className="max-w-full truncate rounded-full border border-slate-200 px-2.5 py-1.5 text-[11px] text-slate-500 transition hover:border-cyan-400 hover:text-cyan-700 dark:border-white/[0.1] dark:text-white/45 dark:hover:border-cyan-300/45 dark:hover:text-cyan-200">{example.slice(0, 15)}…</button>)}</div>
            <div><div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-slate-600 dark:text-white/65">模型</span><span className="text-[11px] text-cyan-700/80 dark:text-cyan-200/70">{manualModel ? '手动锁定' : '自动导演'}</span></div><select value={manualModel} onChange={(event) => setManualModel(event.target.value)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-cyan-500 dark:border-white/[0.1] dark:bg-[#111216] dark:text-white dark:focus:border-cyan-300/60"><option value="">智能推荐模型{director ? `（${director.recommended_model}）` : ''}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.provider}</option>)}</select><p className="mt-2 text-[11px] leading-4 text-slate-500 dark:text-white/35">{modelLabel(selectedCapability)}</p></div>
            <div><span className="mb-2 block text-xs font-medium text-slate-600 dark:text-white/65">画幅比例</span><div className="grid grid-cols-5 gap-1.5">{ratios.map((value) => <button key={value} type="button" onClick={() => setRatio(value)} className={`rounded-lg border px-1 py-2 text-[11px] transition ${ratio === value ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:border-cyan-300/70 dark:bg-cyan-300/10 dark:text-cyan-100' : 'border-slate-200 text-slate-500 hover:border-cyan-300 hover:text-slate-800 dark:border-white/[0.1] dark:text-white/45 dark:hover:border-white/25 dark:hover:text-white/80'}`}><span className="mx-auto mb-1 block h-5 w-5 border border-current opacity-75" style={{ aspectRatio: value.replace(':', '/') }} /><span>{value}</span></button>)}</div></div>
            <div><span className="mb-2 block text-xs font-medium text-slate-600 dark:text-white/65">输出数量</span><div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#111216]">{outputOptions.map((value) => { const disabled = value > maxOutputs; return <button key={value} type="button" disabled={disabled} onClick={() => setCount(value)} className={`rounded-md py-2 text-xs transition ${count === value ? 'bg-white text-slate-900 shadow-sm dark:bg-white/[0.16] dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-white/45 dark:hover:text-white'} ${disabled ? 'cursor-not-allowed opacity-20' : ''}`}>{value}<span className="ml-1 text-[10px]">张</span></button>; })}</div></div>
            <div><span className="mb-2 block text-xs font-medium text-slate-600 dark:text-white/65">清晰度</span><div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#111216]">{['1K', '2K', '4K'].map((value) => <button key={value} type="button" onClick={() => setResolution(value)} className={`rounded-md py-2 text-xs transition ${resolution === value ? 'bg-white text-slate-900 shadow-sm dark:bg-white/[0.16] dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-white/45 dark:hover:text-white'}`}>{value}{value === '4K' && <span className="ml-1 text-[9px] text-yellow-600 dark:text-yellow-300">PRO</span>}</button>)}</div><p className="mt-2 text-[10px] text-slate-400 dark:text-white/30">实际分辨率由所选模型能力决定</p></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.08] dark:bg-[#111216]"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-white/75"><WandSparkles size={14} className="text-cyan-600 dark:text-cyan-300" />导演建议</div><button type="button" onClick={() => void direct()} disabled={!prompt.trim() || isDirecting} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-cyan-700 transition hover:bg-cyan-100 disabled:opacity-40 dark:text-cyan-200 dark:hover:bg-cyan-300/10">{isDirecting ? <LoaderCircle size={11} className="animate-spin" /> : <WandSparkles size={11} />}智能优化</button></div><p className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-white/40">{director?.routing_reasons?.join(' · ') || '点击智能优化后显示中文识别、构图和模型路由依据。'}</p>{director?.enhanced_prompt_zh && <details className="mt-2 text-[11px] text-cyan-700/80 dark:text-cyan-200/70"><summary className="cursor-pointer">查看增强提示词</summary><p className="mt-2 whitespace-pre-wrap leading-5 text-slate-600 dark:text-white/45">{director.enhanced_prompt_zh}</p></details>}</div>
            {referenceImage ? <div className="relative overflow-hidden rounded-xl border border-cyan-300/60 bg-cyan-50 p-2 dark:border-cyan-300/30 dark:bg-cyan-300/10"><img src={referenceImage.url} alt={referenceImage.name} className="h-24 w-full rounded-lg object-cover" /><div className="mt-2 flex items-center justify-between gap-2"><span className="min-w-0 truncate text-[11px] text-cyan-800 dark:text-cyan-100">已添加参考图 · {referenceImage.name}</span><button type="button" aria-label="移除参考图" onClick={() => setReferenceImage(null)} className="rounded-full p-1 text-cyan-700 hover:bg-cyan-100 dark:text-cyan-100 dark:hover:bg-cyan-300/20"><X size={13} /></button></div></div> : <button data-testid="reference-image-upload" type="button" className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-3 text-xs text-slate-500 transition hover:border-cyan-400 hover:text-cyan-700 dark:border-white/[0.13] dark:text-white/40 dark:hover:border-cyan-300/40 dark:hover:text-cyan-200" onClick={() => referenceInputRef.current?.click()}><Upload size={15} />添加参考图 <span className="text-[10px]">PNG / JPG / WebP</span></button>}
            <input ref={referenceInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={handleReferenceUpload} />
            {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 dark:border-rose-300/20 dark:bg-rose-300/10 dark:text-rose-200">{error}</p>}
          </div>
          <div className="border-t border-slate-200 p-4 dark:border-white/[0.07] sm:p-5"><button type="button" onClick={() => void generate()} disabled={!prompt.trim() || isGenerating} className="flex w-full items-center justify-center gap-2 rounded-xl bg-yellow-300 px-4 py-3.5 text-sm font-semibold text-[#17130a] shadow-lg shadow-yellow-300/10 transition hover:bg-yellow-200 disabled:cursor-not-allowed disabled:opacity-45">{isGenerating ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={17} />}生成图片 <span className="font-normal opacity-60">· {count} 张</span></button><p className="mt-2 text-center text-[10px] text-slate-400 dark:text-white/25">{selectedName} · {ratio} · {resolution}</p></div>
        </aside>

        <main className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-[#18191e] dark:shadow-2xl dark:shadow-black/20 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-5 dark:border-white/[0.07]">
            <div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-white/35">Image Gallery</p><h2 className="mt-1 text-xl font-semibold">作品画廊</h2></div>
            <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-slate-500 dark:text-white/40">
              <span>{selectedCandidate ? '已选择 1 张候选' : currentImages.length ? `本轮 ${currentImages.length} 张图` : history.length ? `历史 ${history.length} 批次 · ${totalHistoryImages} 张图` : '还没有作品'}</span>
              <button data-testid="regenerate-images" type="button" onClick={() => void generate()} disabled={!prompt.trim() || isGenerating} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-700 transition hover:border-cyan-400 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.12] dark:text-white/70 dark:hover:border-cyan-300/50 dark:hover:text-cyan-200">
                <RefreshCw size={14} className={isGenerating ? 'animate-spin' : ''} />换一换
              </button>
            </div>
          </div>

          {selectedCandidate && <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-300/20 dark:bg-emerald-300/10"><img src={selectedCandidate.image.url} alt={selectedCandidate.batch.raw_prompt.slice(0, 80)} className="h-14 w-14 rounded-lg object-cover" /><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200"><Check size={14} />已选为最终候选</div><p className="mt-1 truncate text-[11px] text-emerald-700/70 dark:text-emerald-100/55">第 {selectedCandidate.round} 轮 · {selectedCandidate.batch.raw_prompt}</p></div><button type="button" onClick={() => setLightbox(selectedCandidate.image.url)} className="rounded-lg p-2 text-emerald-700 hover:bg-emerald-100 dark:text-emerald-200 dark:hover:bg-emerald-300/10" aria-label="预览已选择图片"><Maximize2 size={16} /></button></div>}

          {currentImages.length > 0 ? <div className="mt-5 columns-1 gap-4 sm:columns-2 2xl:columns-3">{currentImages.map((image) => {
            const isSelected = selectedCandidate?.image.id === image.id;
            return <article key={image.id} className={`group relative mb-4 break-inside-avoid overflow-hidden rounded-xl border bg-slate-50 transition dark:bg-[#111216] ${isSelected ? 'border-emerald-500 ring-2 ring-emerald-500/20 dark:border-emerald-300' : 'border-slate-200 dark:border-white/[0.08]'}`}><img src={image.url} alt={prompt.slice(0, 80)} className="block w-full object-cover" /><button type="button" aria-pressed={isSelected} onClick={() => { if (batch) setSelectedCandidate({ image, batch, round: history.length }); }} className={`absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur ${isSelected ? 'bg-emerald-500 text-white' : 'bg-white/90 text-slate-700 hover:bg-white dark:bg-black/65 dark:text-white'}`}>{isSelected && <Check size={13} />}{isSelected ? '已选择' : '选择这张'}</button><div className="absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-between bg-white/95 px-3 py-2.5 text-xs transition-transform group-hover:translate-y-0 dark:bg-[#0f1013]/90"><span className="truncate pr-2 text-slate-500 dark:text-white/45">{selectedName}</span><div className="flex shrink-0 gap-1.5"><button type="button" aria-label="放大图片" onClick={() => setLightbox(image.url)} className="rounded-md bg-slate-100 p-1.5 text-slate-700 hover:bg-slate-200 dark:bg-white/[0.1] dark:text-white dark:hover:bg-white/[0.2]"><Maximize2 size={14} /></button><button type="button" aria-label="用作参考图" onClick={() => handleUseAsReference(image.url, '本次生成结果')} className="rounded-md bg-cyan-300 p-1.5 text-[#0d1820]" title="用作参考图"><ImageIcon size={14} /></button><a href={image.url} download className="rounded-md bg-slate-100 p-1.5 text-slate-700 dark:bg-white/[0.1] dark:text-white" aria-label="下载图片"><Download size={14} /></a></div></div></article>;
          })}</div> : <div className="mt-5 flex min-h-[min(520px,55vh)] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center dark:border-white/[0.12] dark:bg-[#111216]"><ImageIcon size={36} className="text-slate-300 dark:text-white/20" /><p className="mt-4 text-sm font-medium text-slate-600 dark:text-white/55">你的作品会出现在这里</p><p className="mt-1 max-w-xs text-xs leading-5 text-slate-400 dark:text-white/30">生成后可以继续“换一换”，每次结果都会保留在候选历史中。</p></div>}

          {historyCandidates.length > 0 && <section className="mt-8 border-t border-slate-200 pt-6 dark:border-white/[0.07]"><div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-sm font-semibold">全部历史候选</h3><p className="mt-1 text-[11px] text-slate-400 dark:text-white/30">每次换一换都会新增候选，不会覆盖之前的作品。</p></div><span className="text-xs text-slate-400 dark:text-white/30">{history.length} 批次 · {totalHistoryImages} 张图</span></div><div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">{historyCandidates.map(({ image, batch: item, round }) => <button key={`${item.batch_id}-${image.id}`} type="button" aria-pressed={selectedCandidate?.image.id === image.id} onClick={() => setSelectedCandidate({ image, batch: item, round })} className={`group overflow-hidden rounded-xl border bg-slate-50 text-left transition dark:bg-[#111216] ${selectedCandidate?.image.id === image.id ? 'border-emerald-500 ring-2 ring-emerald-500/20 dark:border-emerald-300' : 'border-slate-200 hover:border-cyan-400 dark:border-white/[0.08] dark:hover:border-cyan-300/40'}`}><div className="relative aspect-square bg-slate-100 dark:bg-white/[0.03]"><img src={image.url} alt={item.raw_prompt.slice(0, 60)} className="h-full w-full object-cover transition group-hover:scale-[1.03]" /><span className="absolute left-2 top-2 rounded-full bg-slate-950/65 px-2 py-1 text-[10px] text-white">第 {round} 轮</span>{selectedCandidate?.image.id === image.id && <span className="absolute right-2 top-2 rounded-full bg-emerald-500 p-1.5 text-white"><Check size={13} /></span>}</div><p className="truncate px-2.5 py-2 text-[11px] text-slate-600 dark:text-white/50">{item.raw_prompt}</p></button>)}</div></section>}
        </main>
      </div>

      {lightbox && <div role="dialog" aria-modal="true" aria-label="图片预览" className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 p-3 dark:bg-black/90 sm:p-5" onClick={() => setLightbox(null)}><button type="button" aria-label="关闭预览" onClick={() => setLightbox(null)} className="absolute right-4 top-4 rounded-full bg-white/80 p-2 text-slate-900 transition hover:bg-white dark:bg-white/[0.1] dark:text-white dark:hover:bg-white/[0.2] sm:right-5 sm:top-5"><X size={20} /></button><div className="relative max-h-full max-w-full" onClick={(event) => event.stopPropagation()}><img src={lightbox} alt={prompt.slice(0, 80)} className="max-h-[calc(100vh-80px)] max-w-[calc(100vw-24px)] rounded-xl object-contain sm:max-w-[calc(100vw-40px)]" /><div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/90 px-3 py-2 text-xs text-slate-700 backdrop-blur dark:bg-black/60 dark:text-white/70"><span>{selectedName} · {ratio}</span><div className="flex items-center gap-2 sm:gap-3"><button type="button" onClick={() => { setPrompt(batch?.raw_prompt || prompt); setLightbox(null); }} className="inline-flex items-center gap-1.5 hover:text-slate-950 dark:hover:text-white"><RotateCcw size={13} />做同款</button><button type="button" aria-label="用作参考图" onClick={() => { handleUseAsReference(lightbox, '放大预览参考图'); setLightbox(null); }} className="inline-flex items-center gap-1.5 hover:text-slate-950 dark:hover:text-white"><ImageIcon size={13} />用作参考图</button><a href={lightbox} download className="inline-flex items-center gap-1.5 hover:text-slate-950 dark:hover:text-white"><Download size={13} />下载</a></div></div></div></div>}
    </div>
  );
}
