'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  Copy,
  GalleryHorizontal,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Search,
  Sparkles,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import {
  analyzeImagePlazaAsset,
  listImageBatches,
  listImagePlazaAssets,
  type ImageBatch,
  type ImagePromptAnalysis,
  uploadImagePlazaAsset,
} from '../../lib/api';
import ImageStudioWorkspace from './ImageStudioWorkspace';

interface ImagePlazaWorkspaceProps {
  initialPrompt?: string;
  onBack: () => void;
}

interface PlazaAsset {
  id: string;
  url: string;
  prompt: string;
  model: string;
  uploaded?: boolean;
  promptEn?: string;
  negativePrompt?: string;
  tags?: string[];
}

const categories = ['全部', '产品广告', '人像', '海报', '国风', 'UI 样机', '信息图', '角色设计', '建筑', '复古'];
const categoryHints: Record<string, string[]> = {
  '产品广告': ['产品', '商品', '电商', '护肤', '包装'],
  人像: ['人像', '人物', '女孩', '男孩', '肖像', '模特'],
  海报: ['海报', '广告', '标题', '文字', '宣传'],
  国风: ['国风', '水墨', '古风', '江南', '书法'],
  'UI 样机': ['UI', '界面', '样机', 'App', '网页'],
  信息图: ['信息图', '流程', '图表', '科普'],
  角色设计: ['角色', '立绘', '三视图', '人物设定'],
  建筑: ['建筑', '房屋', '城市', '空间', '室内'],
  复古: ['复古', '胶片', '老照片', '怀旧'],
};

function batchAssets(batches: ImageBatch[]): PlazaAsset[] {
  return batches.flatMap((batch) => batch.images.map((image) => ({
    id: image.id,
    url: image.url,
    prompt: batch.raw_prompt,
    model: batch.director?.recommended_model || 'AI 生图',
  })));
}

export default function ImagePlazaWorkspace({ initialPrompt = '', onBack }: ImagePlazaWorkspaceProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [batches, setBatches] = useState<ImageBatch[]>([]);
  const [uploaded, setUploaded] = useState<PlazaAsset[]>([]);
  const [category, setCategory] = useState('全部');
  const [query, setQuery] = useState('');
  const [activeSlide, setActiveSlide] = useState(0);
  const [showStudio, setShowStudio] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<PlazaAsset | null>(null);
  const [referenceAsset, setReferenceAsset] = useState<PlazaAsset | null>(null);
  const [analysis, setAnalysis] = useState<ImagePromptAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [copied, setCopied] = useState(false);
  const [isCarouselPaused, setIsCarouselPaused] = useState(false);
  const [galleryColumnCount, setGalleryColumnCount] = useState(2);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([listImageBatches(48), listImagePlazaAssets(48)])
      .then(([batchResult, plazaResult]) => {
        setBatches(batchResult.batches);
        setUploaded(plazaResult.assets.map((asset) => ({
          id: asset.id,
          url: asset.url,
          prompt: asset.prompt || '用户上传图片',
          model: '我的上传',
          uploaded: true,
          promptEn: asset.prompt_en,
          negativePrompt: asset.negative_prompt,
          tags: asset.tags,
        })));
      })
      .catch(() => {
        setBatches([]);
        setUploaded([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const assets = useMemo(() => [...uploaded, ...batchAssets(batches)], [batches, uploaded]);
  const filteredAssets = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const hints = categoryHints[category];
    return assets.filter((asset) => {
      const searchable = `${asset.prompt} ${asset.model}`.toLowerCase();
      const categoryMatch = category === '全部' || hints?.some((hint) => searchable.includes(hint.toLowerCase()));
      return categoryMatch && (!keyword || searchable.includes(keyword));
    });
  }, [assets, category, query]);
  const carouselAssets = filteredAssets.length > 0 ? filteredAssets : assets;
  useEffect(() => {
    setActiveSlide(0);
  }, [category, query]);

  useEffect(() => {
    if (isCarouselPaused || carouselAssets.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveSlide((value) => (value + 1) % carouselAssets.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [carouselAssets.length, isCarouselPaused]);

  useEffect(() => {
    if (!selectedAsset) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedAsset(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAsset]);

  useEffect(() => {
    const updateGalleryColumns = () => {
      const width = window.innerWidth;
      setGalleryColumnCount(width >= 1536 ? 5 : width >= 1024 ? 4 : width >= 640 ? 3 : 2);
    };
    updateGalleryColumns();
    window.addEventListener('resize', updateGalleryColumns);
    return () => window.removeEventListener('resize', updateGalleryColumns);
  }, []);

  const openAsset = (asset: PlazaAsset) => {
    setSelectedAsset(asset);
    setCopied(false);
    setAnalysisError('');
    if (asset.prompt && !asset.uploaded) {
      setAnalysis({ asset_id: asset.id, status: 'ready', prompt: asset.prompt, prompt_en: asset.promptEn, negative_prompt: asset.negativePrompt, tags: asset.tags || [] });
      return;
    }
    if (asset.prompt && asset.prompt !== '用户上传图片') {
      setAnalysis({ asset_id: asset.id, status: 'ready', prompt: asset.prompt, prompt_en: asset.promptEn, negative_prompt: asset.negativePrompt, tags: asset.tags || [] });
      return;
    }
    setAnalysis(null);
    setIsAnalyzing(true);
    void analyzeImagePlazaAsset(asset.id)
      .then((result) => setAnalysis(result))
      .catch((error: unknown) => setAnalysisError(error instanceof Error ? error.message : '提示词解析失败，请稍后重试'))
      .finally(() => setIsAnalyzing(false));
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      event.target.value = '';
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const next = await Promise.all(files.map((file) => uploadImagePlazaAsset(file)));
      setUploaded((current) => [...next.map((asset) => ({ id: asset.id, url: asset.url, prompt: asset.prompt || '用户上传图片', model: '我的上传', uploaded: true })), ...current]);
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : '上传失败，请检查图片格式与大小');
    } finally {
      setUploading(false);
    }
    event.target.value = '';
  };

  const copyPrompt = () => {
    if (!analysis?.prompt) return;
    void navigator.clipboard?.writeText(analysis.prompt).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  const onUseAsReference = (asset: PlazaAsset) => {
    setPrompt(asset.prompt === '用户上传图片' ? '请参考这张图片进行创作' : asset.prompt);
    setReferenceAsset(asset);
    setSelectedAsset(null);
    setShowStudio(true);
  };

  const galleryColumns = useMemo(() => Array.from({ length: galleryColumnCount }, (_, columnIndex) => (
    filteredAssets.filter((_, assetIndex) => assetIndex % galleryColumnCount === columnIndex)
  )).filter((column) => column.length > 0), [filteredAssets, galleryColumnCount]);

  const renderGalleryCard = (asset: PlazaAsset, key: string) => <article key={key} className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white text-left dark:border-white/[0.08] dark:bg-[#18191e]"><button type="button" onClick={() => openAsset(asset)} className="block w-full text-left" aria-label={`查看作品：${asset.prompt}`}><img src={asset.url} alt={asset.prompt} className="block w-full object-cover transition duration-500 group-hover:scale-[1.03]" /></button><div className="pointer-events-none absolute inset-x-0 top-0 flex justify-end gap-2 p-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"><button type="button" aria-label="放大查看" onClick={() => openAsset(asset)} className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/75 text-white shadow-lg backdrop-blur transition hover:bg-slate-950"><Maximize2 size={16} /></button><button type="button" aria-label="用作参考图" onClick={() => onUseAsReference(asset)} className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/90 text-white shadow-lg backdrop-blur transition hover:bg-cyan-400"><ImageIcon size={16} /></button></div><span className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-full bg-slate-950/85 p-3 text-white transition-transform group-hover:translate-y-0"><span className="line-clamp-2 block text-xs leading-5">{asset.prompt}</span><span className="mt-1 block text-[10px] text-white/55">{asset.model}{asset.uploaded ? ' · 我的上传' : ''}</span></span></article>;

  const renderCarouselCard = (asset: PlazaAsset | undefined, offset: number, width: string, height: string, isCenter: boolean, distance: number) => {
    if (!asset) return <article key={`empty-${offset}`} className={`relative flex ${height} shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-300 dark:border-white/[0.1] dark:bg-[#18191e] dark:text-white/20`} style={{ width }}><ImageIcon size={28} /></article>;
    return <article key={`${asset.id}-${offset}`} className={`group relative shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white text-left transition-all duration-500 dark:border-white/[0.1] dark:bg-[#18191e] ${distance === 3 ? 'hidden 2xl:block' : distance === 2 ? 'hidden xl:block' : ''} ${isCenter ? 'z-20 shadow-2xl shadow-slate-300/40 dark:shadow-black/40' : 'z-10 opacity-75 hover:opacity-95'}`} style={{ width }}><button type="button" onClick={() => openAsset(asset)} className="block h-full w-full text-left" aria-label={`查看作品：${asset.prompt}`}><img src={asset.url} alt={asset.prompt} className={`block ${height} w-full object-cover`} /><span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 to-transparent px-3 pb-3 pt-12 text-white sm:px-4 sm:pb-4 sm:pt-14"><span className="block truncate text-sm font-medium">{asset.prompt}</span><span className="mt-1 block text-[11px] text-white/65">{asset.model}</span></span></button><div className="pointer-events-none absolute right-3 top-3 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"><button type="button" aria-label="放大查看" onClick={() => openAsset(asset)} className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-950/75 text-white shadow-lg backdrop-blur hover:bg-slate-950"><Maximize2 size={16} /></button><button type="button" aria-label="用作参考图" onClick={() => onUseAsReference(asset)} className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-500/90 text-white shadow-lg backdrop-blur hover:bg-cyan-400"><ImageIcon size={16} /></button></div></article>;
  };

  if (showStudio) return <ImageStudioWorkspace initialPrompt={prompt} initialReferenceImage={referenceAsset ? { url: referenceAsset.url, name: referenceAsset.prompt || '市场参考图' } : null} onBack={() => setShowStudio(false)} />;

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-50 text-slate-950 dark:bg-[#0f1013] dark:text-white">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0f1013]/90">
        <div className="mx-auto flex h-16 w-full items-center gap-4 px-4 sm:px-7"><button type="button" onClick={onBack} aria-label="返回对话" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white"><ArrowLeft size={18} /></button><div className="flex items-center gap-2 font-semibold"><Sparkles size={18} className="text-cyan-600 dark:text-cyan-300" />AI 生图广场</div><nav className="ml-4 hidden items-center gap-1 text-sm text-slate-500 dark:text-white/55 md:flex"><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="rounded-lg bg-slate-100 px-3 py-1.5 text-slate-900 dark:bg-white/[0.1] dark:text-white">发现</button><button type="button" onClick={() => document.getElementById('discover-section')?.scrollIntoView({ behavior: 'smooth' })} className="rounded-lg px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-white/[0.06]">模板</button><button type="button" onClick={() => document.getElementById('my-publish-title')?.scrollIntoView({ behavior: 'smooth' })} className="rounded-lg px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-white/[0.06]">我的发布</button></nav><div className="ml-auto flex items-center gap-2"><button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:border-cyan-400 hover:text-cyan-700 disabled:cursor-wait disabled:opacity-60 dark:border-white/[0.12] dark:text-white/75 dark:hover:border-cyan-300/50 dark:hover:text-cyan-200"><Upload size={15} />{uploading ? '上传中…' : '上传图片'}</button><button type="button" onClick={() => setShowStudio(true)} className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 dark:bg-cyan-300 dark:text-[#0b1720] dark:hover:bg-cyan-200"><Sparkles size={15} />开始创作</button></div><input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only" onChange={handleUpload} /></div>
      </header>

      <aside className="fixed bottom-0 left-0 top-16 z-20 hidden w-20 flex-col items-center border-r border-slate-200 bg-white/85 py-6 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0f1013]/85 lg:flex"><div className="flex flex-col items-center gap-3"><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="发现" className="rounded-xl bg-slate-100 p-3 text-cyan-700 dark:bg-white/[0.1] dark:text-cyan-200"><Compass size={19} /></button><button type="button" onClick={() => setShowStudio(true)} aria-label="生成" className="rounded-xl p-3 text-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white"><Sparkles size={19} /></button><button type="button" onClick={() => fileInputRef.current?.click()} aria-label="上传图片" className="rounded-xl p-3 text-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white"><GalleryHorizontal size={19} /></button></div><button type="button" onClick={() => document.getElementById('my-publish-title')?.scrollIntoView({ behavior: 'smooth' })} aria-label="我的发布" className="mt-auto rounded-xl p-3 text-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white"><UserRound size={19} /></button></aside>

      <main className="mx-auto w-full max-w-[2200px] px-4 pb-16 pt-8 sm:px-7 lg:pl-28 lg:pr-10">
        <section className="mx-auto max-w-4xl text-center"><p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-cyan-600 dark:text-cyan-300">Image Ecosystem</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">让灵感开始循环</h1><p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-500 dark:text-white/50">发现社区作品、复用创作思路，或上传你的图片加入 AI 生图生态。</p><div className="mx-auto mt-6 flex max-w-2xl flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-white/[0.1] dark:bg-[#18191e] sm:flex-row"><div className="flex min-w-0 flex-1 items-center gap-2 px-3"><Sparkles size={17} className="shrink-0 text-cyan-600 dark:text-cyan-300" /><input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述你想创作的画面…" className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-white/30" /></div><button type="button" onClick={() => setShowStudio(true)} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100">进入工作台</button></div></section>

        <section className="mx-auto mt-12 max-w-[1800px]" aria-labelledby="featured-title" onMouseEnter={() => setIsCarouselPaused(true)} onMouseLeave={() => setIsCarouselPaused(false)} onFocusCapture={() => setIsCarouselPaused(true)} onBlurCapture={() => setIsCarouselPaused(false)}>
          <div className="mb-4 flex items-end justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-white/35">Featured Loop</p><h2 id="featured-title" className="mt-1 text-xl font-semibold">精选灵感轮播</h2></div>{carouselAssets.length > 0 && <div className="flex items-center gap-2"><span className="hidden text-xs text-slate-400 sm:inline dark:text-white/35">自动轮播 · 5 秒</span><button type="button" aria-label="上一张精选作品" onClick={() => setActiveSlide((value) => (value - 1 + carouselAssets.length) % carouselAssets.length)} className="rounded-full border border-slate-200 p-2 text-slate-500 hover:border-cyan-400 hover:text-cyan-700 dark:border-white/[0.12] dark:text-white/55 dark:hover:border-cyan-300/50 dark:hover:text-cyan-200"><ArrowLeft size={15} /></button><button type="button" aria-label="下一张精选作品" onClick={() => setActiveSlide((value) => (value + 1) % carouselAssets.length)} className="rounded-full border border-slate-200 p-2 text-slate-500 hover:border-cyan-400 hover:text-cyan-700 dark:border-white/[0.12] dark:text-white/55 dark:hover:border-cyan-300/50 dark:hover:text-cyan-200"><ArrowRight size={15} /></button></div>}</div>
          <div className="flex h-[250px] items-center justify-center gap-3 overflow-hidden px-1 sm:h-[330px] lg:h-[380px]">
            {[-3, -2, -1, 0, 1, 2, 3].map((offset) => {
              const asset = carouselAssets.length > 0 ? carouselAssets[(activeSlide + offset + carouselAssets.length * 10) % carouselAssets.length] : undefined;
              const isCenter = offset === 0;
              const distance = Math.abs(offset);
              const width = isCenter ? 'min(48vw, 650px)' : distance === 1 ? 'min(17vw, 230px)' : distance === 2 ? 'min(13vw, 170px)' : 'min(9vw, 120px)';
              const height = isCenter ? 'h-[250px] sm:h-[330px] lg:h-[380px]' : distance === 1 ? 'h-[225px] sm:h-[300px] lg:h-[340px]' : distance === 2 ? 'h-[205px] sm:h-[270px] lg:h-[300px]' : 'h-[185px] sm:h-[240px] lg:h-[270px]';
              return renderCarouselCard(asset, offset, width, height, isCenter, distance);
            })}
          </div>
        </section>

        <section id="discover-section" className="mt-14" aria-labelledby="discover-title"><div className="flex flex-col gap-4 border-b border-slate-200 pb-4 dark:border-white/[0.08] lg:flex-row lg:items-end lg:justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-white/35">Community Gallery</p><h2 id="discover-title" className="mt-1 text-2xl font-semibold">发现作品</h2></div><label className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 dark:border-white/[0.1] dark:bg-[#18191e] dark:text-white/45 lg:max-w-xs"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词或模型" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400 dark:placeholder:text-white/30" /></label></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1">{categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={`shrink-0 rounded-full px-3.5 py-2 text-xs transition ${category === item ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.06] dark:text-white/55 dark:hover:bg-white/[0.12]'}`}>{item}</button>)}</div>{uploadError && <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">{uploadError}</p>}{loading ? <div className="flex min-h-64 items-center justify-center text-sm text-slate-400"><LoaderCircle size={18} className="mr-2 animate-spin" />加载社区作品</div> : filteredAssets.length > 0 ? <div className="image-plaza-waterfall mt-5 overflow-hidden rounded-2xl px-2 py-8"><div className="image-plaza-waterfall-canvas flex w-full items-start gap-3 -rotate-[1.2deg] scale-[1.03] origin-top-left">{galleryColumns.map((column, columnIndex) => { const items = [...column, ...column]; return <div key={`gallery-column-${columnIndex}`} className="min-w-0 flex-1" style={{ marginTop: columnIndex % 2 ? '2.5rem' : '0' }}><div className="image-plaza-waterfall-track flex flex-col gap-4" data-direction={columnIndex % 2 === 0 ? 'up' : 'down'}>{items.map((asset, itemIndex) => renderGalleryCard(asset, `${asset.id}-${columnIndex}-${itemIndex}`))}</div></div>; })}</div></div> : <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center dark:border-white/[0.12] dark:bg-[#18191e]"><ImagePlus size={30} className="mx-auto text-slate-300 dark:text-white/25" /><p className="mt-3 text-sm font-medium text-slate-600 dark:text-white/60">还没有匹配的作品</p><p className="mt-1 text-xs text-slate-400 dark:text-white/35">上传一张图片，成为广场里的第一位创作者。</p><button type="button" onClick={() => fileInputRef.current?.click()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 dark:bg-cyan-300 dark:text-[#0b1720]"><Upload size={14} />上传图片</button></div>}</section>

        {uploaded.length > 0 && <section className="mt-14" aria-labelledby="my-publish-title"><div className="flex items-center justify-between"><h2 id="my-publish-title" className="text-lg font-semibold">我的发布</h2><span className="text-xs text-slate-400 dark:text-white/35">已持久化 · 点击图片查看解析</span></div><div className="mt-4 flex flex-wrap gap-3">{uploaded.map((asset) => <div key={asset.id} className="relative w-32 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/[0.1] dark:bg-[#18191e]"><button type="button" onClick={() => openAsset(asset)} className="block w-full text-left"><img src={asset.url} alt={asset.prompt} className="aspect-square w-full object-cover" /><span className="block truncate px-2 py-1.5 text-[10px] text-slate-500 dark:text-white/45">{asset.prompt}</span></button><button type="button" aria-label={`从当前视图移除 ${asset.prompt}`} onClick={() => setUploaded((current) => current.filter((item) => item.id !== asset.id))} className="absolute right-1.5 top-1.5 rounded-full bg-slate-950/60 p-1 text-white"><X size={12} /></button></div>)}</div></section>}
        {selectedAsset && <div role="dialog" aria-modal="true" aria-label="图片详情" className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedAsset(null); }}><div className="flex max-h-[min(900px,calc(100vh-24px))] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-white/[0.12] dark:bg-[#18191e] lg:flex-row"><div className="relative flex min-h-[280px] items-center justify-center bg-slate-100 p-4 sm:min-h-[420px] lg:w-[56%] lg:p-8 dark:bg-[#101116]"><img src={selectedAsset.url} alt={selectedAsset.prompt} className="max-h-[68vh] w-full rounded-xl object-contain lg:max-h-[760px]" /><button type="button" aria-label="关闭图片详情" onClick={() => setSelectedAsset(null)} className="absolute right-4 top-4 rounded-full bg-slate-950/60 p-2 text-white hover:bg-slate-950/80"><X size={18} /></button></div><div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5 sm:p-8 lg:w-[44%]"><div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-600 dark:text-cyan-300">Image Detail</p><h2 className="mt-2 text-xl font-semibold leading-tight sm:text-2xl">{selectedAsset.prompt === '用户上传图片' ? '我的参考图' : selectedAsset.prompt.slice(0, 48)}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500 dark:bg-white/[0.08] dark:text-white/55">{selectedAsset.uploaded ? '我的上传' : selectedAsset.model}</span></div><div className="mt-5 flex flex-wrap gap-2">{(analysis?.tags?.length ? analysis.tags : [selectedAsset.uploaded ? '用户上传' : 'AI 生图', '提示词可复用']).map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600 dark:bg-white/[0.08] dark:text-white/60">{tag}</span>)}</div><div className="mt-6 rounded-2xl bg-slate-50 p-4 dark:bg-[#111216]"><div className="flex items-center justify-between"><h3 className="font-semibold">提示词</h3><button type="button" onClick={copyPrompt} disabled={!analysis?.prompt} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-200 disabled:opacity-40 dark:text-white/55 dark:hover:bg-white/[0.08]">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制'}</button></div>{isAnalyzing ? <div className="flex items-center gap-2 py-8 text-sm text-slate-500 dark:text-white/50"><LoaderCircle size={16} className="animate-spin" />正在解析图片提示词…</div> : analysisError ? <p className="py-6 text-sm leading-6 text-rose-600 dark:text-rose-300">{analysisError}</p> : <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700 dark:text-white/75">{analysis?.prompt || '等待视觉解析…'}</p>}</div>{analysis?.prompt_en && <div className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-white/[0.1]"><h3 className="text-sm font-semibold">English prompt</h3><p className="mt-2 text-xs leading-6 text-slate-500 dark:text-white/50">{analysis.prompt_en}</p></div>}{analysis?.negative_prompt && <div className="mt-4"><h3 className="text-sm font-semibold">Negative Prompt</h3><p className="mt-2 text-xs leading-6 text-slate-500 dark:text-white/50">{analysis.negative_prompt}</p></div>}<div className="mt-auto flex flex-col gap-2 pt-7 sm:flex-row"><button type="button" aria-label="用作参考图" onClick={() => onUseAsReference(selectedAsset)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-300 px-4 py-3 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 dark:border-cyan-300/40 dark:text-cyan-200 dark:hover:bg-cyan-300/10"><ImageIcon size={15} />用作参考图</button><button type="button" onClick={() => { setPrompt(analysis?.prompt || selectedAsset.prompt); setReferenceAsset(selectedAsset); setSelectedAsset(null); setShowStudio(true); }} className="flex-1 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 dark:bg-cyan-300 dark:text-[#0b1720]">立即试用</button><button type="button" onClick={() => setSelectedAsset(null)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-white/[0.12] dark:text-white/65 dark:hover:bg-white/[0.06]">关闭</button></div>{analysis?.status === 'fallback' && <p className="mt-3 text-[11px] leading-5 text-slate-400 dark:text-white/35">{analysis.message}</p>}</div></div></div>}
      </main>
    </div>
  );
}
