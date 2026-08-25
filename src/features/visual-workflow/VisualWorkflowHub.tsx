'use client';

/* Workflow artifacts are user/provider URLs; next/image would require a fixed host allowlist. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Clock3, FilePlus2, FolderOpen, Grid2X2, Image as ImageIcon, Loader2, Plus, RefreshCw, Sparkles, Video } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createVisualWorkflow, listVisualWorkflows, type VisualWorkflow } from '../../lib/api';

function previewFrom(workflow: VisualWorkflow): { type: 'image' | 'video'; url: string } | null {
  for (const node of workflow.document.nodes) {
    const artifacts = node.config.outputArtifacts;
    if (!Array.isArray(artifacts)) continue;
    for (const artifact of artifacts) {
      if (!artifact || typeof artifact !== 'object') continue;
      const value = (artifact as Record<string, unknown>).value;
      const type = (artifact as Record<string, unknown>).type;
      if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) continue;
      if (type === 'image.asset') return { type: 'image', url: value };
      if (type === 'video.asset') return { type: 'video', url: value };
    }
  }
  return null;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚更新';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export default function VisualWorkflowHub() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<VisualWorkflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const loadWorkflows = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await listVisualWorkflows(1, 50);
      setWorkflows(result.workflows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '历史画布加载失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadWorkflows(); }, [loadWorkflows]);

  const createCanvas = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);
    setError('');
    try {
      const created = await createVisualWorkflow('未命名视频流画布', '可视化 AI 视频生成流程');
      router.push(`/visual-workflow/canvas/${created.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '新建画布失败');
      setIsCreating(false);
    }
  }, [isCreating, router]);

  const sortedWorkflows = useMemo(() => [...workflows].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [workflows]);

  return (
    <main className="flex h-screen min-h-0 overflow-hidden bg-slate-50 text-slate-900 transition-colors dark:bg-[#0c0d11] dark:text-white">
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-slate-200 bg-white/80 p-5 dark:border-white/[0.08] dark:bg-[#15161b] md:flex">
        <button type="button" onClick={() => router.push('/visual-workflow')} className="mb-8 flex items-center gap-3 text-left" aria-label="返回视频流工作台主页">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-cyan-300 shadow-sm dark:bg-white dark:text-slate-950"><Sparkles size={20} /></span>
          <span><span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">ASYNC DIRECTOR</span><span className="mt-1 block text-base font-semibold">视频流工作台</span></span>
        </button>
        <button type="button" onClick={() => void createCanvas()} disabled={isCreating} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"><Plus size={17} />{isCreating ? '创建中…' : '新建画布'}</button>
        <nav className="mt-8 space-y-1 text-sm">
          <div className="flex items-center gap-3 rounded-lg bg-slate-100 px-3 py-2.5 font-medium dark:bg-white/[0.08]"><Grid2X2 size={16} className="text-cyan-500" />我的画布</div>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-slate-500 dark:text-slate-400"><FolderOpen size={16} />历史画布</div>
        </nav>
        <div className="mt-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400"><p className="font-medium text-slate-700 dark:text-slate-200">无限画布 · 异步执行</p><p className="mt-1">把提示词、图片、视频和生成模型连接成可复用的视觉流程。</p></div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1500px] px-5 py-6 sm:px-8 sm:py-8 lg:px-12">
          <header className="flex items-start justify-between gap-4">
            <div><p className="text-[11px] font-bold uppercase tracking-[0.24em] text-cyan-600 dark:text-cyan-400">WORKSPACE</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">我的视频流画布</h1><p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">创建、复用和批量运行你的 AI 视频生成流程。</p></div>
            <button type="button" onClick={() => void createCanvas()} disabled={isCreating} className="hidden h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-cyan-300 hover:text-cyan-700 disabled:opacity-60 dark:border-white/[0.14] dark:bg-white/[0.06] dark:text-white dark:hover:border-cyan-500/50 dark:hover:text-cyan-300 sm:flex"><FilePlus2 size={16} />{isCreating ? '创建中…' : '新建画布'}</button>
          </header>

          <div className="mt-8 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-white/[0.08]"><div className="flex items-center gap-2 text-sm font-semibold"><FolderOpen size={17} className="text-cyan-500" />历史画布<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-white/[0.08] dark:text-slate-400">{workflows.length}</span></div><button type="button" onClick={() => void loadWorkflows()} disabled={isLoading} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-white"><RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />刷新</button></div>

          {error && <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"><span>{error}</span><button type="button" onClick={() => void loadWorkflows()} className="font-medium underline">重试</button></div>}
          {isLoading ? <div className="flex min-h-[360px] items-center justify-center text-sm text-slate-500 dark:text-slate-400"><Loader2 size={18} className="mr-2 animate-spin" />正在加载历史画布…</div> : sortedWorkflows.length === 0 ? <div className="mt-8 flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 text-center dark:border-white/[0.12] dark:bg-white/[0.02]"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300"><Sparkles size={25} /></span><h2 className="mt-4 text-base font-semibold">准备好搭建第一条视频流了吗？</h2><p className="mt-2 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">新建画布，把提示词、图片输入和视频模型连成一条可执行流程。</p><button type="button" onClick={() => void createCanvas()} className="mt-5 flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-600"><Plus size={16} />新建画布</button></div> : <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{sortedWorkflows.map((workflow) => { const preview = previewFrom(workflow); return <button key={workflow.id} type="button" onClick={() => router.push(`/visual-workflow/canvas/${workflow.id}`)} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-lg dark:border-white/[0.1] dark:bg-[#17181e] dark:hover:border-cyan-500/40"><div className="relative flex aspect-[1.55] items-center justify-center overflow-hidden bg-slate-100 dark:bg-[#101116]">{preview?.type === 'image' ? <img src={preview.url} alt="画布输出预览" className="h-full w-full object-cover" loading="lazy" /> : preview?.type === 'video' ? <video src={preview.url} className="h-full w-full object-cover" muted preload="metadata" /> : <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300"><Video size={22} /></div>}<span className="absolute right-3 top-3 rounded-full bg-black/45 px-2 py-1 text-[10px] font-medium text-white backdrop-blur">v{workflow.currentRevision}</span></div><div className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{workflow.name || '未命名视频流画布'}</h3><p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{workflow.description || '可视化 AI 视频生成流程'}</p></div><ArrowRight size={16} className="mt-0.5 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-cyan-500" /></div><div className="mt-4 flex items-center gap-3 text-[11px] text-slate-400"><span className="flex items-center gap-1"><Clock3 size={12} />{dateLabel(workflow.updatedAt)}</span><span className="flex items-center gap-1"><ImageIcon size={12} />{workflow.document.nodes.length} 个节点</span></div></div></button>; })}</div>}
        </div>
      </section>
    </main>
  );
}
