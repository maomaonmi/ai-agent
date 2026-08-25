'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Download,
  Film,
  History,
  Image as ImageIcon,
  LoaderCircle,
  Plus,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Volume2,
  WandSparkles,
  XCircle,
} from 'lucide-react';
import {
  createVideoTask,
  analyzeVideoFrames,
  deleteReferenceAsset,
  deleteVideoTask,
  getReferenceAsset,
  getVideoModels,
  listVideoTasks,
  uploadReferenceVideo,
  type VideoReferenceAsset,
  type VideoReferencePurpose,
  type VideoModelCapability,
  type VideoTask,
} from '../../lib/api';
import { useVideoTask, type VideoConnectionState } from './useVideoTask';

interface VideoStudioWorkspaceProps {
  initialPrompt?: string;
  onBack: () => void;
  initialTask?: VideoTask | null;
  onTaskSucceeded?: (task: VideoTask) => Promise<void> | void;
}

type VideoMode = 'text_to_video' | 'image_to_video' | 'start_end_video' | 'reference_to_video';
type FrameInputKind = 'url' | 'file' | 'base64';

const modeLabels: Record<VideoMode, string> = {
  text_to_video: '文生视频',
  image_to_video: '首帧图生视频',
  start_end_video: '首尾帧过渡',
  reference_to_video: '参考视频生成',
};

const referencePurposeLabels: Record<VideoReferencePurpose, string> = {
  subject: '主体',
  style: '风格',
  motion: '动作',
  scene: '场景',
};

const statusLabels: Record<string, string> = {
  PENDING: '排队中',
  RUNNING: '生成中',
  SUCCEEDED: '已完成',
  FAILED: '生成失败',
  CANCELLED: '已取消',
  UNKNOWN: '状态未知',
};

function providerLabel(provider: string) {
  return provider === 'qianwen' ? '千问 AI' : provider === 'zhipu' ? '智谱 AI' : provider;
}

function statusIcon(status: string) {
  if (status === 'SUCCEEDED') return <CheckCircle2 size={16} className="text-emerald-400" />;
  if (status === 'FAILED') return <XCircle size={16} className="text-rose-400" />;
  return <LoaderCircle size={16} className="animate-spin text-cyan-600 dark:text-cyan-300" />;
}

function connectionLabel(state: VideoConnectionState) {
  if (state === 'connected') return 'SSE 实时连接';
  if (state === 'disconnected') return 'SSE 已断开，轮询中';
  if (state === 'connecting') return '正在连接实时进度';
  return '本地状态轮询中';
}

export default function VideoStudioWorkspace({ initialPrompt = '', onBack, initialTask = null, onTaskSucceeded }: VideoStudioWorkspaceProps) {
  const [models, setModels] = useState<VideoModelCapability[]>([]);
  const [history, setHistory] = useState<VideoTask[]>([]);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [mode, setMode] = useState<VideoMode>('text_to_video');
  const [model, setModel] = useState('');
  const [ratio, setRatio] = useState('16:9');
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState('720P');
  const [audio, setAudio] = useState(true);
  const [audioUrl, setAudioUrl] = useState('');
  const [firstFrameUrl, setFirstFrameUrl] = useState('');
  const [lastFrameUrl, setLastFrameUrl] = useState('');
  const [referenceAssets, setReferenceAssets] = useState<VideoReferenceAsset[]>([]);
  const [referencePurpose, setReferencePurpose] = useState<VideoReferencePurpose>('motion');
  const [isUploadingReference, setIsUploadingReference] = useState(false);
  const [frameInputKind, setFrameInputKind] = useState<FrameInputKind>('url');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [seed, setSeed] = useState('');
  const [watermark, setWatermark] = useState(false);
  const [shotType, setShotType] = useState<'single' | 'multi'>('single');
  const [promptExtend, setPromptExtend] = useState(true);
  const [taskId, setTaskId] = useState<string | null>(initialTask?.id ?? null);
  const [createdTask, setCreatedTask] = useState<VideoTask | null>(initialTask);
  const notifiedTaskIds = useRef(new Set(initialTask ? [initialTask.id] : []));
  const [activeTab, setActiveTab] = useState<'generate' | 'history'>('generate');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnalyzingFrames, setIsAnalyzingFrames] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { task, connectionState, error: taskError } = useVideoTask(taskId, createdTask);

  useEffect(() => {
    if (task?.status !== 'SUCCEEDED' || notifiedTaskIds.current.has(task.id)) return;
    notifiedTaskIds.current.add(task.id);
    void onTaskSucceeded?.(task);
  }, [onTaskSucceeded, task]);
  const availableModels = useMemo(() => models.filter((item) => item.modes.includes(mode)), [models, mode]);
  const selectedModel = availableModels.find((item) => item.id === model) ?? availableModels[0];

  const loadHistory = async () => {
    try {
      const result = await listVideoTasks(1, 30);
      setHistory(result.tasks);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '历史记录读取失败');
    }
  };

  useEffect(() => {
    void getVideoModels().then((items) => {
      const enabled = items.filter((item) => item.enabled);
      setModels(enabled);
      setModel((current) => current || enabled[0]?.id || '');
    }).catch((cause) => setError(cause instanceof Error ? cause.message : '视频模型读取失败'));
    void loadHistory();
    // The workspace intentionally loads once; model selection is preserved after the request.
  }, []);

  useEffect(() => {
    if (!availableModels.some((item) => item.id === model)) setModel(availableModels[0]?.id ?? '');
  }, [availableModels, model]);

  useEffect(() => {
    if (!selectedModel) return;
    if (!selectedModel.ratios.includes(ratio)) setRatio(selectedModel.ratios[0] ?? '16:9');
    if (!selectedModel.resolutions.includes(resolution)) setResolution(selectedModel.resolutions[0] ?? '720P');
    const options = selectedModel.durations.length > 0
      ? selectedModel.durations
      : [selectedModel.duration_min, 5, 10, selectedModel.duration_max]
        .filter((item, index, items) => item >= selectedModel.duration_min && item <= selectedModel.duration_max && items.indexOf(item) === index)
        .sort((a, b) => a - b);
    if (!options.includes(duration)) setDuration(options[0] ?? selectedModel.duration_min);
    if (!selectedModel.supports_audio) setAudio(false);
    if (!selectedModel.supports_audio_input) setAudioUrl('');
  }, [duration, ratio, resolution, selectedModel]);

  useEffect(() => {
    if (task?.status === 'SUCCEEDED' || task?.status === 'FAILED') void loadHistory();
  }, [task?.status]);

  useEffect(() => {
    if (mode !== 'reference_to_video' || !referenceAssets.some((asset) => !['READY', 'REJECTED', 'EXPIRED', 'DELETED'].includes(asset.status))) return undefined;
    let disposed = false;
    const refresh = async () => {
      const active = referenceAssets.filter((asset) => !['READY', 'REJECTED', 'EXPIRED', 'DELETED'].includes(asset.status));
      const next = await Promise.all(active.map(async (asset) => {
        try { return await getReferenceAsset(asset.assetId); } catch { return asset; }
      }));
      if (disposed || next.length === 0) return;
      setReferenceAssets((current) => current.map((asset) => {
        const refreshed = next.find((item) => item.assetId === asset.assetId);
        return refreshed ? {
          ...refreshed,
          // The API intentionally does not persist browser blob URLs. Keep
          // the local preview while status polling refreshes server metadata.
          previewUrl: refreshed.previewUrl ?? asset.previewUrl,
          thumbnailUrl: refreshed.thumbnailUrl ?? asset.thumbnailUrl,
        } : asset;
      }));
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [mode, referenceAssets]);

  const uploadReference = async (file: File) => {
    if (referenceAssets.length >= 3) { setError('参考视频最多上传 3 个'); return; }
    if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) { setError('参考视频仅支持 MP4、MOV 或 WebM'); return; }
    if (file.size > 100 * 1024 * 1024) { setError('参考视频不能超过 100MB'); return; }
    setIsUploadingReference(true);
    setError('');
    try {
      const asset = await uploadReferenceVideo(file);
      setReferenceAssets((items) => [...items, asset]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '参考视频上传失败');
    } finally {
      setIsUploadingReference(false);
    }
  };

  const removeReference = async (asset: VideoReferenceAsset) => {
    try {
      await deleteReferenceAsset(asset.assetId);
      if (asset.previewUrl) URL.revokeObjectURL(asset.previewUrl);
      if (asset.thumbnailUrl) URL.revokeObjectURL(asset.thumbnailUrl);
      setReferenceAssets((items) => items.filter((item) => item.assetId !== asset.assetId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '参考视频删除失败');
    }
  };

  const durationOptions = useMemo(() => {
    if (!selectedModel) return [5];
    if (selectedModel.durations.length) return selectedModel.durations;
    return [selectedModel.duration_min, 5, 10, selectedModel.duration_max]
      .filter((item, index, items) => item >= selectedModel.duration_min && item <= selectedModel.duration_max && items.indexOf(item) === index)
      .sort((a, b) => a - b);
  }, [selectedModel]);

  const submit = async () => {
    if ((!prompt.trim() && selectedModel?.id === 'wan2.7-i2v') || !selectedModel || isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      const normalizedAudioUrl = audioUrl.trim();
      if (normalizedAudioUrl) {
        try {
          const parsed = new URL(normalizedAudioUrl);
          if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error();
        } catch {
          setError('参考音频必须是可公开访问的 HTTP/HTTPS URL');
          return;
        }
      }
      if (mode !== 'text_to_video' && mode !== 'reference_to_video' && !firstFrameUrl.trim()) {
        setError('请提供首帧图片');
        return;
      }
      if (mode === 'start_end_video' && !lastFrameUrl.trim()) {
        setError('请提供尾帧图片');
        return;
      }
      if (mode === 'reference_to_video') {
        if (!prompt.trim()) { setError('请填写参考视频生成提示词'); return; }
        if (referenceAssets.length === 0) { setError('请先上传至少一个参考视频'); return; }
        if (referenceAssets.some((asset) => asset.status !== 'READY')) { setError('参考视频仍在预处理中，请稍候'); return; }
      }
      const next = await createVideoTask({
        mode, prompt: prompt.trim(), model: selectedModel.id, ratio, duration, resolution,
        audio: selectedModel.supports_audio ? audio : null,
        audio_url: selectedModel.supports_audio_input && normalizedAudioUrl ? normalizedAudioUrl : undefined,
        first_frame_url: mode !== 'text_to_video' && mode !== 'reference_to_video' ? firstFrameUrl.trim() : undefined,
        last_frame_url: mode === 'start_end_video' ? lastFrameUrl.trim() : undefined,
        references: mode === 'reference_to_video' ? referenceAssets.map((asset) => ({ assetId: asset.assetId, mediaKind: 'reference_video' as const, purpose: referencePurpose })) : undefined,
        negative_prompt: negativePrompt.trim() || undefined,
        seed: seed ? Number(seed) : undefined,
        shot_type: selectedModel.id.startsWith('wan2.6-i2v') ? shotType : undefined,
        prompt_extend: promptExtend, watermark,
      });
      setCreatedTask(next);
      setTaskId(next.id);
      setActiveTab('generate');
      await loadHistory();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '视频任务提交失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const retry = (source: VideoTask) => {
    setMode(source.mode ?? 'text_to_video');
    setPrompt(source.prompt);
    setModel(source.model);
    setRatio(source.parameters.ratio);
    setDuration(source.parameters.duration);
    setResolution(source.parameters.resolution);
    setAudioUrl(source.parameters.audio_url ?? '');
    setFirstFrameUrl(source.parameters.first_frame_url ?? '');
    setLastFrameUrl(source.parameters.last_frame_url ?? '');
    setNegativePrompt(source.parameters.negative_prompt ?? '');
    setSeed(source.parameters.seed == null ? '' : String(source.parameters.seed));
    setWatermark(source.parameters.watermark ?? false);
    setShotType(source.parameters.shot_type ?? 'single');
    setTaskId(null);
    setCreatedTask(null);
    setActiveTab('generate');
    setError('');
  };

  const openHistory = () => {
    // History is a list view. Stop the live preview subscription and clear
    // the last generated task so it cannot leak into this tab while loading.
    setTaskId(null);
    setCreatedTask(null);
    setActiveTab('history');
    void loadHistory();
  };

  const deleteHistoryTask = async (source: VideoTask) => {
    if (typeof window !== 'undefined' && !window.confirm('确定删除这条视频生成记录吗？视频文件也会一并移除。')) return;
    setDeletingTaskId(source.id);
    setError('');
    try {
      await deleteVideoTask(source.id);
      setHistory((items) => items.filter((item) => item.id !== source.id));
      if (taskId === source.id) {
        setTaskId(null);
        setCreatedTask(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '历史记录删除失败');
    } finally {
      setDeletingTaskId(null);
    }
  };

  const current = task ?? createdTask;
  const displayError = error || taskError;

  const readFrameFile = (file: File | undefined, target: 'first' | 'last') => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('图片不能超过 10 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      if (target === 'first') setFirstFrameUrl(value);
      else setLastFrameUrl(value);
    };
    reader.onerror = () => setError('图片读取失败');
    reader.readAsDataURL(file);
  };

  const analyzeFrames = async () => {
    if (mode === 'text_to_video' || mode === 'reference_to_video' || !firstFrameUrl.trim() || isAnalyzingFrames) return;
    if (mode === 'start_end_video' && !lastFrameUrl.trim()) {
      setError('首尾帧模式请先提供尾帧图片');
      return;
    }
    setIsAnalyzingFrames(true);
    setError('');
    try {
      const result = await analyzeVideoFrames({
        mode,
        first_frame_url: firstFrameUrl.trim(),
        last_frame_url: mode === 'start_end_video' ? lastFrameUrl.trim() : undefined,
      });
      setPrompt(result.prompt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '图片识别失败，请稍后重试');
    } finally {
      setIsAnalyzingFrames(false);
    }
  };

  return (
    <div className="video-studio-workspace fixed inset-0 z-[110] overflow-x-hidden overflow-y-auto bg-slate-50 text-slate-900 dark:bg-[#0f1013] dark:text-white lg:left-72">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-3 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0f1013]/95 sm:px-5 lg:px-6">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-white/65 dark:hover:bg-white/[0.06] dark:hover:text-white"><ArrowLeft size={17} />返回对话</button>
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold"><Film size={17} className="text-cyan-600 dark:text-cyan-300" />AI 视频 <span className="hidden text-xs font-normal text-slate-400 dark:text-white/35 sm:inline">/ Video Studio</span></div>
        <div className="hidden items-center gap-2 text-xs text-slate-500 dark:text-white/45 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />异步任务引擎</div>
      </header>

      <div className="grid w-full max-w-none gap-5 p-3 sm:p-5 lg:grid-cols-[clamp(330px,31vw,470px)_minmax(0,1fr)] lg:p-6 xl:p-8">
        <aside className="h-fit overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-[#191a20] dark:shadow-2xl dark:shadow-black/25">
          <div className="border-b border-slate-200 px-5 pb-5 pt-6 dark:border-white/[0.07] sm:px-6"><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-white/35">Async Director</p><h1 className="mt-2 text-[22px] font-semibold tracking-tight text-slate-900 dark:text-white">AI 视频生成器</h1></div><Sparkles size={19} className="mt-1 text-cyan-500 dark:text-cyan-300" /></div><p className="mt-2 text-xs leading-5 text-slate-500 dark:text-white/45">文生、图生和参考视频生成，共用一条异步任务链路。</p></div>
          <div className="space-y-5 p-5 sm:p-6">
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-[#111216]" role="tablist" aria-label="视频生成模式"><button type="button" role="tab" aria-selected={mode === 'text_to_video'} onClick={() => setMode('text_to_video')} className={`rounded-lg px-2 py-3 text-xs font-medium transition ${mode === 'text_to_video' ? 'bg-white text-slate-900 shadow-sm dark:bg-[#44444c] dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-white/45 dark:hover:text-white/75'}`}><Film size={14} className="mr-1 inline" />文/图生视频</button><button type="button" role="tab" aria-selected={mode === 'image_to_video' || mode === 'start_end_video'} onClick={() => setMode('image_to_video')} className={`rounded-lg px-2 py-3 text-xs font-medium transition ${(mode === 'image_to_video' || mode === 'start_end_video') ? 'bg-white text-slate-900 shadow-sm dark:bg-[#44444c] dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-white/45 dark:hover:text-white/75'}`}><ImageIcon size={14} className="mr-1 inline" />图像生视频</button><button type="button" role="tab" aria-selected={mode === 'reference_to_video'} onClick={() => setMode('reference_to_video')} className={`rounded-lg px-2 py-3 text-xs font-medium transition ${mode === 'reference_to_video' ? 'bg-white text-slate-900 shadow-sm dark:bg-[#44444c] dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-white/45 dark:hover:text-white/75'}`}><Film size={14} className="mr-1 inline" />参考视频生成</button></div>
            {mode !== 'text_to_video' && mode !== 'reference_to_video' && <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-[#111216]" role="tablist" aria-label="图像视频模式"><button type="button" role="tab" aria-selected={false} onClick={() => setMode('text_to_video')} className="rounded-lg px-2 py-2.5 text-xs text-slate-500 transition dark:text-white/45">文生视频</button><button type="button" role="tab" aria-selected={mode === 'image_to_video'} onClick={() => setMode('image_to_video')} className={`rounded-lg px-2 py-2.5 text-xs transition ${mode === 'image_to_video' ? 'bg-white text-slate-900 shadow-sm dark:bg-[#44444c] dark:text-white' : 'text-slate-500 dark:text-white/45'}`}>首帧图生</button><button type="button" role="tab" aria-selected={mode === 'start_end_video'} onClick={() => setMode('start_end_video')} className={`rounded-lg px-2 py-2.5 text-xs transition ${mode === 'start_end_video' ? 'bg-white text-slate-900 shadow-sm dark:bg-[#44444c] dark:text-white' : 'text-slate-500 dark:text-white/45'}`}>首尾帧过渡</button></div>}

            {mode === 'reference_to_video' && <div className="space-y-3 rounded-xl border border-cyan-200 bg-cyan-50/50 p-3 dark:border-cyan-300/15 dark:bg-cyan-300/[0.04]"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-white/75"><Film size={15} className="text-cyan-600 dark:text-cyan-300" />参考视频输入</div><span className="text-[10px] text-slate-500 dark:text-white/40">{referenceAssets.length}/3</span></div><div className="flex flex-wrap gap-3">{referenceAssets.map((asset) => <div key={asset.assetId} className="relative flex h-24 w-24 shrink-0 flex-col justify-between overflow-hidden rounded-xl border border-cyan-200 bg-white p-2 dark:border-cyan-300/20 dark:bg-[#111216]"><div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-white/[0.05]">{asset.thumbnailUrl ? <Image unoptimized src={asset.thumbnailUrl} alt={`${asset.filename} 缩略图`} width={96} height={96} className="h-full w-full object-cover" /> : asset.previewUrl ? <video src={asset.previewUrl} muted playsInline className="h-full w-full object-cover" /> : <Film size={18} className="text-cyan-600 dark:text-cyan-300" />}</div><div className="mt-1 flex items-center justify-between gap-1"><span className="truncate text-[9px] text-slate-500 dark:text-white/50">{asset.status === 'READY' ? `${asset.durationSeconds?.toFixed(1) ?? '-'}s` : asset.status === 'REJECTED' ? '失败' : `${asset.progress}%`}</span><button type="button" aria-label={`删除${asset.filename}`} onClick={() => void removeReference(asset)} className="text-slate-400 hover:text-rose-500"><Trash2 size={11} /></button></div></div>)}{referenceAssets.length < 3 && <button type="button" disabled={isUploadingReference} onClick={(event) => event.currentTarget.querySelector<HTMLInputElement>('input')?.click()} className="flex h-24 w-24 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-white text-slate-400 transition hover:border-cyan-400 hover:bg-cyan-50 hover:text-cyan-600 dark:border-white/15 dark:bg-white/[0.02] dark:text-zinc-400 dark:hover:border-white/30 dark:hover:bg-white/[0.06] dark:hover:text-white"><Plus className="h-5 w-5" /><span className="px-1 text-center text-[11px] font-medium leading-tight">{isUploadingReference ? '上传中…' : '参考视频'}</span><input aria-label="上传参考视频" accept="video/mp4,video/quicktime,video/webm" className="hidden" type="file" onClick={(event) => event.stopPropagation()} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReference(file); event.currentTarget.value = ''; }} /></button>}</div><label className="block text-[11px] font-medium text-slate-600 dark:text-white/65">参考目的<select value={referencePurpose} onChange={(event) => setReferencePurpose(event.target.value as VideoReferencePurpose)} className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 dark:border-[#111216] dark:bg-[#111216] dark:text-white">{Object.entries(referencePurposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p className="text-[10px] leading-4 text-slate-500 dark:text-white/35">参考目的用于提示词引导；请在提示词中使用 Video 1 或 character1 指代素材。</p></div>}

            {mode !== 'text_to_video' && mode !== 'reference_to_video' && <div className="space-y-3 rounded-xl border border-cyan-200 bg-cyan-50/50 p-3 dark:border-cyan-300/15 dark:bg-cyan-300/[0.04]">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-white/75"><ImageIcon size={15} className="text-cyan-600 dark:text-cyan-300" />图片输入</div>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#111216]">{(['url', 'file', 'base64'] as FrameInputKind[]).map((kind) => <button key={kind} type="button" onClick={() => { setFrameInputKind(kind); setFirstFrameUrl(''); setLastFrameUrl(''); }} className={`rounded-md px-2 py-1.5 text-[10px] transition ${frameInputKind === kind ? 'bg-cyan-500 text-white dark:bg-cyan-300 dark:text-slate-950' : 'text-slate-500 hover:text-slate-900 dark:text-white/45 dark:hover:text-white'}`}>{kind === 'url' ? '公网 URL' : kind === 'file' ? '本地上传' : 'Base64'}</button>)}</div>
              {frameInputKind === 'file' ? <div className="flex flex-wrap gap-3">
                <button type="button" onClick={(event) => event.currentTarget.querySelector<HTMLInputElement>('input')?.click()} className="relative flex h-24 w-24 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400 shadow-sm transition-colors duration-200 hover:border-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:border-white/15 dark:bg-white/[0.02] dark:text-zinc-400 dark:hover:border-white/30 dark:hover:bg-white/[0.06] dark:hover:text-white">
                  {firstFrameUrl ? <><Image unoptimized src={firstFrameUrl} alt="首帧预览" width={96} height={96} className="absolute inset-0 h-full w-full object-cover" /><span className="absolute inset-x-1 bottom-1 rounded-md bg-black/65 px-1 py-1 text-center text-[10px] font-medium leading-tight text-white">首帧 · 已选</span></> : <><Plus className="h-5 w-5" /><span className="px-1 text-center text-[11px] font-medium leading-tight">首帧</span></>}
                  <input aria-label="上传首帧图片" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden" type="file" onClick={(event) => event.stopPropagation()} onChange={(event) => readFrameFile(event.target.files?.[0], 'first')} />
                </button>
                {mode === 'start_end_video' && <button type="button" onClick={(event) => event.currentTarget.querySelector<HTMLInputElement>('input')?.click()} className="relative flex h-24 w-24 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400 shadow-sm transition-colors duration-200 hover:border-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:border-white/15 dark:bg-white/[0.02] dark:text-zinc-400 dark:hover:border-white/30 dark:hover:bg-white/[0.06] dark:hover:text-white">
                  {lastFrameUrl ? <><Image unoptimized src={lastFrameUrl} alt="尾帧预览" width={96} height={96} className="absolute inset-0 h-full w-full object-cover" /><span className="absolute inset-x-1 bottom-1 rounded-md bg-black/65 px-1 py-1 text-center text-[10px] font-medium leading-tight text-white">尾帧 · 已选</span></> : <><Plus className="h-5 w-5" /><span className="px-1 text-center text-[11px] font-medium leading-tight">尾帧</span></>}
                  <input aria-label="上传尾帧图片" accept="image/jpeg,image/jpg,image/png,image/webp" className="hidden" type="file" onClick={(event) => event.stopPropagation()} onChange={(event) => readFrameFile(event.target.files?.[0], 'last')} />
                </button>}
              </div> : <div className="space-y-2"><textarea aria-label="首帧图片输入" value={firstFrameUrl} onChange={(event) => setFirstFrameUrl(event.target.value)} rows={frameInputKind === 'base64' ? 3 : 2} placeholder={frameInputKind === 'url' ? 'https://example.com/first.png' : 'data:image/png;base64,...'} className="w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-[11px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-cyan-500 dark:border-white/[0.1] dark:bg-[#111216] dark:text-white dark:placeholder:text-white/25 dark:focus:border-cyan-300" />{mode === 'start_end_video' && <textarea aria-label="尾帧图片输入" value={lastFrameUrl} onChange={(event) => setLastFrameUrl(event.target.value)} rows={frameInputKind === 'base64' ? 3 : 2} placeholder={frameInputKind === 'url' ? 'https://example.com/last.png' : 'data:image/png;base64,...'} className="w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-[11px] text-slate-900 outline-none placeholder:text-slate-400 focus:border-cyan-500 dark:border-white/[0.1] dark:bg-[#111216] dark:text-white dark:placeholder:text-white/25 dark:focus:border-cyan-300" />}</div>}
              <p className="text-[10px] leading-4 text-slate-500 dark:text-white/35">图片支持公网 URL、本地上传和 Base64；音频仍仅支持公开 HTTP/HTTPS URL。</p>
              <button type="button" onClick={() => void analyzeFrames()} disabled={!firstFrameUrl.trim() || (mode === 'start_end_video' && !lastFrameUrl.trim()) || isAnalyzingFrames} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-cyan-200 bg-white px-3 text-xs font-medium text-cyan-700 transition hover:border-cyan-400 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-cyan-300/20 dark:bg-cyan-300/[0.08] dark:text-cyan-200 dark:hover:bg-cyan-300/[0.14]" aria-label="AI 识图生成提示词">{isAnalyzingFrames ? <LoaderCircle size={14} className="animate-spin" /> : <WandSparkles size={14} />} {isAnalyzingFrames ? '正在识别图片…' : mode === 'start_end_video' ? '识别首尾帧并填入提示词' : '识别首帧并填入提示词'}</button>
            </div>}

            <label htmlFor="video-prompt" className="block text-xs font-medium text-slate-600 dark:text-white/70">提示词</label>
            <textarea id="video-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} maxLength={5000} placeholder="描述镜头、主体、镜头运动、光线，以及结尾状态。" className="w-full resize-none rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/10 dark:border-white/[0.1] dark:bg-[#111216] dark:text-white dark:placeholder:text-white/30 dark:focus:border-cyan-300 dark:focus:ring-cyan-300/10" />
            <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-white/35"><span>提示词越具体，镜头控制越稳定</span><span>{prompt.length}/5000</span></div>

            <label className="block text-xs font-medium text-slate-600 dark:text-white/70">模型<select value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-cyan-500 dark:border-white/[0.1] dark:bg-[#111216] dark:text-white dark:focus:border-cyan-300/60">{availableModels.map((item) => <option key={item.id} value={item.id}>{item.name} · {providerLabel(item.provider)}</option>)}</select></label>
            {selectedModel && <p className="-mt-3 text-[11px] leading-5 text-slate-500 dark:text-white/35">{selectedModel.description} · {selectedModel.duration_min}–{selectedModel.duration_max}s · {selectedModel.resolutions.join(' / ')}</p>}

            <div className="grid grid-cols-3 items-end gap-2 rounded-xl bg-slate-100 p-3 dark:bg-[#202126]"><label className="text-[11px] font-medium text-slate-600 dark:text-white/65">时长<select aria-label="时长" value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none focus:border-cyan-500 dark:border-white/[0.08] dark:bg-[#111216] dark:text-white dark:focus:border-cyan-300">{durationOptions.map((item) => <option key={item} value={item}>{item}s</option>)}</select></label><label className="text-[11px] font-medium text-slate-600 dark:text-white/65">清晰度<select aria-label="分辨率" value={resolution} onChange={(event) => setResolution(event.target.value)} className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none focus:border-cyan-500 dark:border-white/[0.08] dark:bg-[#111216] dark:text-white dark:focus:border-cyan-300">{(selectedModel?.resolutions ?? ['720P']).map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="text-[11px] font-medium text-slate-600 dark:text-white/65">画幅<select aria-label="画幅" value={ratio} onChange={(event) => setRatio(event.target.value)} className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-900 outline-none focus:border-cyan-500 dark:border-white/[0.08] dark:bg-[#111216] dark:text-white dark:focus:border-cyan-300">{(selectedModel?.ratios ?? ['16:9']).map((item) => <option key={item} value={item}>{item === 'auto' ? '自适应' : item}</option>)}</select></label></div>

            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.08] dark:bg-[#111216]"><label className="flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-white/75"><span className="flex items-center gap-2"><SlidersHorizontal size={16} className="text-cyan-600 dark:text-cyan-300" />提示词扩写</span><input type="checkbox" checked={promptExtend} onChange={(event) => setPromptExtend(event.target.checked)} className="h-4 w-4 accent-cyan-600 dark:accent-cyan-300" /></label><p className="text-[11px] text-slate-500 dark:text-white/35">提交前自动补足镜头、光线与运动细节。</p></div>
            {selectedModel?.supports_audio && <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.08] dark:bg-[#111216]"><span className="flex items-center gap-2 text-sm text-slate-700 dark:text-white/75"><Volume2 size={16} className="text-cyan-600 dark:text-cyan-300" />生成声音</span><button type="button" aria-pressed={audio} onClick={() => setAudio((value) => !value)} className={`relative h-6 w-11 rounded-full transition ${audio ? 'bg-cyan-500 dark:bg-cyan-300' : 'bg-slate-200 dark:bg-white/15'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition dark:bg-[#101114] ${audio ? 'left-6' : 'left-1'}`} /></button></div>}
            {selectedModel?.supports_audio_input && <label htmlFor="video-audio-url" className="block rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-medium text-slate-600 dark:border-white/[0.08] dark:bg-[#111216] dark:text-white/70">参考音频 URL（可选）<input id="video-audio-url" type="url" value={audioUrl} onChange={(event) => setAudioUrl(event.target.value)} placeholder="https://example.com/voice.mp3" className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-cyan-500 dark:border-white/[0.1] dark:bg-[#101114] dark:text-white dark:focus:border-cyan-300/60" /><p className="mt-2 text-[11px] font-normal leading-5 text-slate-500 dark:text-white/35">仅支持公开 HTTP/HTTPS URL，WAV/MP3，2–30 秒且不超过 15 MB。</p></label>}

            {mode !== 'text_to_video' && <label className="block text-xs font-medium text-slate-600 dark:text-white/70">负向提示词（可选）<textarea value={negativePrompt} onChange={(event) => setNegativePrompt(event.target.value)} maxLength={500} rows={2} placeholder="模糊、低质量、画面抖动……" className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs outline-none focus:border-cyan-500 dark:border-white/[0.1] dark:bg-[#111216] dark:text-white" /></label>}
            {mode !== 'text_to_video' && <div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium text-slate-600 dark:text-white/65">随机种子<input type="number" min={0} max={2147483647} value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="随机" className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-white/[0.1] dark:bg-[#111216] dark:text-white" /></label>{selectedModel?.id.startsWith('wan2.6-i2v') && <label className="text-xs font-medium text-slate-600 dark:text-white/65">镜头类型<select value={shotType} onChange={(event) => setShotType(event.target.value as 'single' | 'multi')} className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs dark:border-white/[0.1] dark:bg-[#111216] dark:text-white"><option value="single">单镜头</option><option value="multi">多镜头</option></select></label>}</div>}
            <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-white/[0.08] dark:bg-[#111216] dark:text-white/75"><span>AI 生成水印</span><input type="checkbox" checked={watermark} onChange={(event) => setWatermark(event.target.checked)} className="h-4 w-4 accent-cyan-600" /></label>

            {displayError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">{displayError}</div>}
            <button type="button" disabled={!selectedModel || isSubmitting || !prompt.trim() || (mode !== 'text_to_video' && mode !== 'reference_to_video' && !firstFrameUrl.trim()) || (mode === 'start_end_video' && !lastFrameUrl.trim()) || (mode === 'reference_to_video' && (referenceAssets.length === 0 || referenceAssets.some((asset) => asset.status !== 'READY')))} onClick={() => void submit()} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 text-sm font-semibold text-white shadow-lg shadow-cyan-600/20 transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-cyan-300 dark:text-slate-950 dark:shadow-cyan-300/10 dark:hover:bg-cyan-200">{isSubmitting ? <><LoaderCircle size={17} className="animate-spin" />提交任务中…</> : <><Film size={17} />生成视频</>}</button>
          </div>
        </aside>

        <section className="min-w-0 min-h-[min(620px,calc(100dvh-96px))] rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-[#18191e] dark:shadow-2xl dark:shadow-black/20">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 dark:border-white/[0.07] sm:px-5"><div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-white/35">Workspace</p><h2 className="mt-1 text-lg font-semibold">{activeTab === 'generate' ? '任务预览' : '历史记录'}</h2></div><div className="flex rounded-lg bg-slate-100 p-1 dark:bg-white/[0.05]"><button type="button" aria-pressed={activeTab === 'generate'} onClick={() => setActiveTab('generate')} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs transition ${activeTab === 'generate' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950' : 'text-slate-500 hover:text-slate-900 dark:text-white/55 dark:hover:text-white'}`}><Film size={14} />生成</button><button type="button" aria-pressed={activeTab === 'history'} onClick={openHistory} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs transition ${activeTab === 'history' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950' : 'text-slate-500 hover:text-slate-900 dark:text-white/55 dark:hover:text-white'}`}><History size={14} />历史</button></div></div>
          {activeTab === 'generate' ? <TaskPreview task={current} connectionState={connectionState} onRetry={retry} /> : <HistoryList tasks={history} deletingTaskId={deletingTaskId} onSelect={(item) => { setCreatedTask(item); setTaskId(item.id); setActiveTab('generate'); }} onRetry={retry} onDelete={deleteHistoryTask} />}
        </section>
      </div>
    </div>
  );
}

function TaskPreview({ task, connectionState, onRetry }: { task: VideoTask | null; connectionState: VideoConnectionState; onRetry: (task: VideoTask) => void }) {
  if (!task) return <div className="flex min-h-[min(520px,60vh)] flex-col items-center justify-center px-6 text-center"><div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-200 bg-cyan-50 dark:border-cyan-300/20 dark:bg-cyan-300/10"><Film size={28} className="text-cyan-600 dark:text-cyan-300" /></div><h3 className="mt-5 text-base font-semibold">准备好让画面动起来了吗？</h3><p className="mt-2 max-w-sm text-sm leading-6 text-slate-500 dark:text-white/40">左侧提交提示词后，任务会在后台异步生成。你可以切换模块，回来后继续查看。</p></div>;
  const resultUrl = task.result?.video_url;
  return <div className="p-4 sm:p-6 lg:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-2">{statusIcon(task.status)}<span className="text-sm font-semibold">{statusLabels[task.status] ?? task.status}</span><span className="max-w-full truncate rounded-full border border-slate-200 px-2 py-1 text-[11px] text-slate-500 dark:border-white/[0.1] dark:text-white/40">{modeLabels[task.mode ?? 'text_to_video']} · {providerLabel(task.provider)} · {task.model}</span></div><span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-white/40"><Radio size={13} className={connectionState === 'connected' ? 'text-emerald-500 dark:text-emerald-400' : 'text-yellow-600 dark:text-yellow-300'} />{connectionLabel(connectionState)}</span></div>
    {task.status !== 'SUCCEEDED' && <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-white/[0.08] dark:bg-[#111216] sm:p-6"><div className="flex items-center justify-between text-sm"><span className="text-slate-600 dark:text-white/65">预计进度</span><span className="font-mono text-cyan-700 dark:text-cyan-200">{task.progress}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]"><div className="h-full rounded-full bg-cyan-500 transition-all duration-700 dark:bg-cyan-300" style={{ width: `${Math.min(100, task.progress)}%` }} /></div><p className="mt-4 flex items-center gap-2 text-xs leading-5 text-slate-500 dark:text-white/40"><Clock3 size={14} />后台任务会继续运行，关闭页面不会取消。</p></div>}
    {task.status === 'SUCCEEDED' && resultUrl && <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-black dark:border-white/[0.08]"><video controls playsInline className="max-h-[62vh] w-full bg-black object-contain" src={resultUrl} /><div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.12] px-4 py-3"><div className="text-xs text-white/60">{task.parameters.ratio} · {task.parameters.duration}s · {task.parameters.resolution}</div><a href={resultUrl} download className="inline-flex items-center gap-2 rounded-lg border border-white/[0.18] px-3 py-2 text-xs text-white/80 hover:bg-white/[0.1]"><Download size={14} />下载视频</a></div></div>}
    {task.status === 'FAILED' && <div role="alert" className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-5 dark:border-rose-300/20 dark:bg-rose-300/10"><div className="flex items-start gap-3"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-300" /><div><p className="text-sm font-medium text-rose-800 dark:text-rose-100">{task.error?.message || '视频生成失败'}</p><p className="mt-1 text-xs text-rose-700/70 dark:text-rose-100/55">{task.error?.code || '请检查模型配置、额度和提示词后重试。'}</p></div></div><button type="button" onClick={() => onRetry(task)} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-950 dark:hover:bg-white/90"><RotateCcw size={14} />使用原参数重试</button></div>}
    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/[0.07] dark:bg-white/[0.02]">{task.parameters.first_frame_url?.startsWith('http') && <div className="mb-3 flex gap-2"><Image unoptimized width={112} height={80} src={task.parameters.first_frame_url} alt="首帧" className="h-20 w-28 rounded-lg object-cover" />{task.parameters.last_frame_url?.startsWith('http') && <Image unoptimized width={112} height={80} src={task.parameters.last_frame_url} alt="尾帧" className="h-20 w-28 rounded-lg object-cover" />}</div>}<p className="text-xs leading-6 text-slate-600 dark:text-white/50">{task.prompt || '未填写提示词'}</p><div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400 dark:text-white/35"><span>{modeLabels[task.mode ?? 'text_to_video']}</span><span>·</span><span>{task.parameters.ratio}</span><span>·</span><span>{task.parameters.duration}s</span><span>·</span><span>{task.parameters.resolution}</span></div></div>
  </div>;
}

function HistoryList({ tasks, deletingTaskId, onSelect, onRetry, onDelete }: { tasks: VideoTask[]; deletingTaskId: string | null; onSelect: (task: VideoTask) => void; onRetry: (task: VideoTask) => void; onDelete: (task: VideoTask) => void }) {
  if (tasks.length === 0) return <div className="flex min-h-[min(520px,60vh)] flex-col items-center justify-center px-6 text-center"><History size={30} className="text-slate-300 dark:text-white/20" /><p className="mt-4 text-sm text-slate-600 dark:text-white/55">还没有视频任务</p><p className="mt-2 text-xs text-slate-400 dark:text-white/30">提交第一个提示词后，任务会出现在这里。</p></div>;
  return <div className="grid gap-3 p-4 sm:p-6">{tasks.map((item) => { const canDelete = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(item.status); return <div key={item.id} className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/[0.08] dark:bg-[#111216] sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={() => onSelect(item)} className="min-w-0 flex-1 text-left"><div className="flex items-center gap-2">{statusIcon(item.status)}<span className="text-sm font-medium">{statusLabels[item.status] ?? item.status}</span><span className="max-w-[45%] truncate text-[11px] text-slate-400 dark:text-white/30">{item.model}</span></div><p className="mt-2 truncate text-xs text-slate-600 dark:text-white/45">{item.prompt}</p><p className="mt-2 text-[11px] text-slate-400 dark:text-white/25">{item.parameters.ratio} · {item.parameters.duration}s · {item.parameters.resolution}</p></button><div className="flex shrink-0 items-center gap-2">{item.status === 'FAILED' && <button type="button" onClick={() => onRetry(item)} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-white dark:border-white/[0.12] dark:text-white/60 dark:hover:bg-white/[0.06]"><RotateCcw size={13} />重试</button>}{canDelete && <button type="button" aria-label="删除历史记录" title="删除历史记录" disabled={deletingTaskId === item.id} onClick={() => void onDelete(item)} className="inline-flex items-center justify-center rounded-lg border border-rose-200 px-2.5 py-2 text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-300/20 dark:text-rose-300 dark:hover:bg-rose-300/10"><Trash2 size={14} /></button>}</div></div>; })}</div>;
}
