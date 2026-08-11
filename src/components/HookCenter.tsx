'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, FileCode2, RefreshCw, ShieldCheck, Sparkles, ToggleLeft, ToggleRight, Upload, XCircle } from 'lucide-react';
import { createHookDraft, getHookSource, getHooks, HookDraftResult, HookLifecycle, HookRecord, parseHookFile, saveHookSource, toggleHook } from '../lib/api';

interface HookCenterProps { onBack: () => void; }
const LIFECYCLE_LABELS: Record<HookLifecycle, string> = {
  on_session_start: '会话开始', before_llm_call: 'LLM 调用前', after_llm_call: 'LLM 调用后',
  before_tool_call: '工具调用前', after_tool_call: '工具调用后', on_error: '错误处理',
};
const POLICY_LABELS: Record<string, string> = { allow: '放行', transform: '变更', block: '阻断', observe: '观察' };

export default function HookCenter({ onBack }: HookCenterProps) {
  const [hooks, setHooks] = useState<HookRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const [sourcePath, setSourcePath] = useState('');
  const [sourceDirty, setSourceDirty] = useState(false);
  const [sourceSaving, setSourceSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDraft, setAiDraft] = useState<HookDraftResult | null>(null);
  const [uploadDraft, setUploadDraft] = useState<HookDraftResult | null>(null);
  const [activeTool, setActiveTool] = useState<'overview' | 'source' | 'ai' | 'upload'>('overview');

  const loadHooks = useCallback(async () => {
    setLoading(true); setError('');
    try { const payload = await getHooks(); setHooks(payload.hooks); setSelectedId((current) => current && payload.hooks.some((h) => h.id === current) ? current : payload.hooks[0]?.id ?? null); }
    catch (err) { setError(err instanceof Error ? err.message : 'HOOK 列表加载失败'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadHooks(); }, [loadHooks]);
  const selected = useMemo(() => hooks.find((hook) => hook.id === selectedId) ?? null, [hooks, selectedId]);

  useEffect(() => {
    if (!selected) return;
    void getHookSource(selected.id).then((doc) => { setSource(doc.content); setSourcePath(doc.source_path); setSourceDirty(false); }).catch(() => setSource(''));
  }, [selected]);

  const handleToggle = async (hook: HookRecord) => {
    setBusyId(hook.id); setError('');
    try { const updated = await toggleHook(hook.id, !hook.enabled); setHooks((current) => current.map((item) => item.id === updated.id ? updated : item)); }
    catch (err) { setError(err instanceof Error ? err.message : 'HOOK 状态更新失败'); }
    finally { setBusyId(null); }
  };
  const saveSource = async () => {
    if (!selected || !sourceDirty) return;
    setSourceSaving(true); setError('');
    try { await saveHookSource(selected.id, source); setSourceDirty(false); setError('源文件草稿已保存（不会热加载执行）'); }
    catch (err) { setError(err instanceof Error ? err.message : '源文件草稿保存失败'); }
    finally { setSourceSaving(false); }
  };
  const handleUpload = async (file?: File) => {
    if (!file) return;
    try { setUploadDraft(await parseHookFile(file.name, await file.text())); setActiveTool('upload'); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'HOOK 文件解析失败'); }
  };
  const handleAi = async () => {
    if (!aiPrompt.trim()) return;
    try { setAiDraft(await createHookDraft(aiPrompt.trim())); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'AI 草稿生成失败'); }
  };

  return <main className="flex h-full min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3"><button type="button" onClick={onBack} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">返回</button><div><h1 className="text-lg font-semibold">HOOK 管理中心</h1><p className="text-xs text-slate-500">内置生命周期拦截器、安全策略与可审核草稿</p></div></div>
      <button type="button" aria-label="刷新 HOOK 列表" onClick={() => void loadHooks()} disabled={loading} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button>
    </header>
    {error && <div role="status" className="mx-5 mt-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">{error}</div>}
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-5 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
      <section className="min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800"><h2 className="text-sm font-semibold">已注册 HOOK</h2><p className="mt-1 text-xs text-slate-500">{hooks.filter((h) => h.enabled).length} 个启用 / {hooks.length} 个内置</p></div>{loading ? <div role="status" className="space-y-2 p-4"><div className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /><div className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" /></div> : <ul className="space-y-1 p-2">{hooks.map((hook) => <li key={hook.id}><button type="button" onClick={() => { setSelectedId(hook.id); setActiveTool('overview'); }} className={`w-full rounded-lg px-3 py-3 text-left ${selectedId === hook.id ? 'bg-sky-50 ring-1 ring-sky-200 dark:bg-sky-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'}`}><span className="flex items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-2"><ShieldCheck size={16} className={hook.enabled ? 'text-emerald-600' : 'text-slate-400'} /><span className="truncate text-sm font-medium">{hook.name}</span></span><span className="text-xs text-slate-500">{hook.enabled ? '启用' : '停用'}</span></span><span className="mt-1 block truncate pl-6 text-xs text-slate-500">{LIFECYCLE_LABELS[hook.lifecycle]} · {POLICY_LABELS[hook.policy] ?? hook.policy}</span></button></li>)}</ul>}</section>
      <section className="min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">{selected ? <div className="p-5 sm:p-7"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-wide text-sky-600">内置 HOOK</p><h2 className="mt-1 text-xl font-semibold">{selected.name}</h2><p className="mt-1 text-sm text-slate-500">{selected.id}</p></div><button type="button" onClick={() => void handleToggle(selected)} disabled={busyId === selected.id} aria-label={selected.enabled ? `停用 ${selected.name}` : `启用 ${selected.name}`} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800">{selected.enabled ? <ToggleRight size={30} className="text-emerald-600" /> : <ToggleLeft size={30} />}</button></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70"><p className="text-xs text-slate-500">生命周期</p><p className="mt-1 text-sm font-medium">{LIFECYCLE_LABELS[selected.lifecycle]}</p></div><div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70"><p className="text-xs text-slate-500">执行策略</p><p className="mt-1 text-sm font-medium">{POLICY_LABELS[selected.policy] ?? selected.policy}</p></div><div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70"><p className="text-xs text-slate-500">优先级</p><p className="mt-1 text-sm font-medium">{selected.priority}</p></div></div>
        <div className="mt-6 flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">{[['overview', '运行观察', Activity], ['source', '编辑原始文件', FileCode2], ['ai', 'AI 创建', Sparkles], ['upload', '上传解析', Upload]].map(([id, label, Icon]) => <button key={id as string} type="button" onClick={() => setActiveTool(id as typeof activeTool)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${activeTool === id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}><Icon size={14} />{label as string}</button>)}</div>
        {activeTool === 'overview' && <div className="mt-5 rounded-lg border border-slate-200 p-4 dark:border-slate-800"><div className="flex items-center gap-2"><Activity size={17} className="text-sky-600" /><h3 className="text-sm font-semibold">实时运行观察</h3></div><p className="mt-2 text-sm leading-6 text-slate-500">运行期间会显示命中、变更、阻断和异常。面板默认折叠，事件只保留安全摘要和字段级 diff。</p><div className="mt-4 flex items-center gap-2 text-xs text-slate-500">{selected.enabled ? <CheckCircle2 size={15} className="text-emerald-600" /> : <XCircle size={15} />} 当前状态：{selected.enabled ? '运行中' : '已停用'}</div></div>}
        {activeTool === 'source' && <div className="mt-5 space-y-3"><div className="flex items-center justify-between text-xs text-slate-500"><span className="truncate">{sourcePath || '内置 handler'}</span><span>仅保存草稿，不会执行</span></div><textarea value={source} onChange={(e) => { setSource(e.target.value); setSourceDirty(true); }} className="min-h-[300px] w-full rounded-lg border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-slate-100 outline-none focus:ring-2 focus:ring-sky-500" spellCheck={false} /><button type="button" onClick={() => void saveSource()} disabled={!sourceDirty || sourceSaving} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{sourceSaving ? '保存中…' : '保存源文件草稿'}</button></div>}
        {activeTool === 'ai' && <div className="mt-5 space-y-3"><textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="例如：在调用外部工具前，观察并记录是否包含敏感字段" className="min-h-28 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm outline-none focus:ring-2 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950" /><button type="button" onClick={() => void handleAi()} disabled={!aiPrompt.trim()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">让 AI 生成草稿</button>{aiDraft && <DraftCard draft={aiDraft} />}</div>}
        {activeTool === 'upload' && <div className="mt-5 space-y-3"><label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500 hover:border-sky-400 dark:border-slate-700"><Upload size={18} />选择 .py / .md / .json 文件<input type="file" accept=".py,.md,.markdown,.json" className="sr-only" onChange={(e) => void handleUpload(e.target.files?.[0])} /></label>{uploadDraft && <DraftCard draft={uploadDraft} />}</div>}
      </div> : <div className="flex h-full min-h-64 items-center justify-center p-8 text-sm text-slate-500">选择一个 HOOK 查看详情</div>}</section>
    </div>
  </main>;
}

function DraftCard({ draft }: { draft: HookDraftResult }) {
  return <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30"><div className="flex items-center gap-2 font-semibold"><Sparkles size={15} />草稿预览（不可执行）</div><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-slate-500">名称</dt><dd>{draft.parsed.name}</dd></div><div><dt className="text-slate-500">生命周期</dt><dd>{draft.parsed.lifecycle}</dd></div><div><dt className="text-slate-500">策略</dt><dd>{draft.parsed.policy}</dd></div><div><dt className="text-slate-500">优先级</dt><dd>{draft.parsed.priority ?? 100}</dd></div></dl>{draft.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-amber-800 dark:text-amber-200">{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div>;
}
