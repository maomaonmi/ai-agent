'use client';

/* Workflow artifacts come from user-configured public URLs; next/image would require a fixed remote host allowlist. */
/* eslint-disable @next/next/no-img-element */

import { ArrowLeft, Check, Cloud, Loader2, Play, Save, ShieldCheck, Undo2, Redo2, CircleHelp, LayoutPanelTop, MoreHorizontal, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createVisualWorkflow,
  createVisualWorkflowRun,
  getVisualWorkflowNodeDefinitions,
  getVisualWorkflowRun,
  listVisualWorkflows,
  saveVisualWorkflowRevision,
  subscribeVisualWorkflowRun,
  validateVisualWorkflow,
  type VisualWorkflow,
  type VisualWorkflowNodeDefinition,
  type VisualWorkflowRun,
  type VisualWorkflowValidationIssue,
} from '../../lib/api';
import WorkflowCanvas from './WorkflowCanvas';
import WorkflowNodeInspector from './WorkflowNodeInspector';
import { useVisualWorkflowStore } from './store';

interface VisualWorkflowWorkspaceProps { onBack: () => void; }

function isPreviewableUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function RunArtifactPreview({ artifact }: { artifact: Record<string, unknown> }) {
  const value = artifact.value;
  const type = artifact.type;
  if (!isPreviewableUrl(value) || (type !== 'image.asset' && type !== 'video.asset')) return null;
  return type === 'video.asset'
    ? <video className="mt-2 max-h-28 w-full rounded-md border border-slate-200 bg-black object-contain dark:border-white/[0.08]" src={value} controls preload="metadata" />
    : <img className="mt-2 max-h-28 w-full rounded-md border border-slate-200 bg-white object-contain dark:border-white/[0.08]" src={value} alt="节点输出预览" loading="lazy" />;
}

export default function VisualWorkflowWorkspace({ onBack }: VisualWorkflowWorkspaceProps) {
  const [workflow, setWorkflow] = useState<VisualWorkflow | null>(null);
  const [definitions, setDefinitions] = useState<VisualWorkflowNodeDefinition[]>([]);
  const [issues, setIssues] = useState<VisualWorkflowValidationIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState('');
  const [run, setRun] = useState<VisualWorkflowRun | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const hydrate = useVisualWorkflowStore((state) => state.hydrate);
  const name = useVisualWorkflowStore((state) => state.name);
  const dirty = useVisualWorkflowStore((state) => state.dirty);
  const revision = useVisualWorkflowStore((state) => state.revision);
  const setName = useVisualWorkflowStore((state) => state.setName);
  const undo = useVisualWorkflowStore((state) => state.undo);
  const redo = useVisualWorkflowStore((state) => state.redo);
  const toDocument = useVisualWorkflowStore((state) => state.toDocument);
  const markSaved = useVisualWorkflowStore((state) => state.markSaved);
  const nodes = useVisualWorkflowStore((state) => state.nodes);
  const selectedNodeId = useVisualWorkflowStore((state) => state.selectedNodeId);
  const setGraph = useVisualWorkflowStore((state) => state.setGraph);
  const selectNode = useVisualWorkflowStore((state) => state.selectNode);
  const setNodeStatuses = useVisualWorkflowStore((state) => state.setNodeStatuses);
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);

  const applyRun = useCallback((next: VisualWorkflowRun) => {
    setRun(next);
    setIsRunning(!['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(next.status));
    setNodeStatuses(
      Object.fromEntries(next.nodeRuns.map((nodeRun) => [nodeRun.node_id, nodeRun.status.toLowerCase() as 'idle' | 'running' | 'success' | 'error'])),
      Object.fromEntries(next.nodeRuns.map((nodeRun) => [nodeRun.node_id, nodeRun.output_artifacts ?? []])),
    );
  }, [setNodeStatuses]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [nodeDefinitions, existing] = await Promise.all([
          getVisualWorkflowNodeDefinitions(),
          listVisualWorkflows(1, 1),
        ]);
        if (!active) return;
        const created = existing.workflows[0] ?? await createVisualWorkflow('未命名工作流', '可视化 AI 视频生成流程');
        setDefinitions(nodeDefinitions);
        hydrate(created.document, nodeDefinitions);
        setWorkflow(created);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '工作流初始化失败');
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => { active = false; };
  }, [hydrate]);

  const refreshRun = useCallback(async () => {
    if (!workflow || !run) return;
    try { applyRun(await getVisualWorkflowRun(workflow.id, run.id)); } catch (cause) { setError(cause instanceof Error ? cause.message : '运行状态读取失败'); }
  }, [applyRun, run, workflow]);

  useEffect(() => {
    if (!run || !workflow || ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(run.status)) return;
    const unsubscribe = subscribeVisualWorkflowRun(workflow.id, run.id, () => { void refreshRun(); }, () => { void refreshRun(); });
    const timer = window.setInterval(() => { void refreshRun(); }, 2000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [refreshRun, run, workflow]);

  const save = useCallback(async () => {
    if (!workflow || !dirty) return;
    setIsSaving(true); setError(''); setIssues([]);
    try {
      const next = await saveVisualWorkflowRevision(workflow.id, revision, toDocument());
      setWorkflow(next); hydrate(next.document, definitions); markSaved(next.currentRevision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally { setIsSaving(false); }
  }, [definitions, dirty, hydrate, markSaved, revision, toDocument, workflow]);

  const validate = useCallback(async () => {
    if (!workflow) return;
    setIsValidating(true); setError('');
    try {
      const result = await validateVisualWorkflow(workflow.id, toDocument(), false);
      setIssues(result.issues);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '校验失败');
    } finally { setIsValidating(false); }
  }, [toDocument, workflow]);

  const updateSelectedNode = useCallback((patch: Record<string, unknown>) => {
    if (!selectedNode) return;
    const { label, ...configPatch } = patch;
    setGraph(
      nodes.map((node) => node.id === selectedNode.id ? {
        ...node,
        data: {
          ...node.data,
          ...(typeof label === 'string' ? { label } : {}),
          config: { ...node.data.config, ...configPatch },
        },
      } : node),
      useVisualWorkflowStore.getState().edges,
    );
  }, [nodes, selectedNode, setGraph]);

  const deleteSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    const nextNodes = nodes.filter((node) => node.id !== selectedNode.id);
    const nextEdges = useVisualWorkflowStore.getState().edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id);
    setGraph(nextNodes, nextEdges);
    selectNode(null);
  }, [nodes, selectNode, selectedNode, setGraph]);

  const runWorkflow = useCallback(async () => {
    if (!workflow || isRunning) return;
    setIsRunning(true); setError(''); setIssues([]);
    try {
      let currentWorkflow = workflow;
      if (dirty) {
        currentWorkflow = await saveVisualWorkflowRevision(workflow.id, revision, toDocument());
        setWorkflow(currentWorkflow);
        hydrate(currentWorkflow.document, definitions);
        markSaved(currentWorkflow.currentRevision);
      }
      const created = await createVisualWorkflowRun({ workflowId: currentWorkflow.id, revision: currentWorkflow.currentRevision, mode: 'execute', requireInputs: true, clientRequestId: crypto.randomUUID() });
      applyRun(created);
    } catch (cause) {
      setIsRunning(false);
      setError(cause instanceof Error ? cause.message : '工作流运行失败');
    }
  }, [applyRun, definitions, dirty, hydrate, isRunning, markSaved, revision, toDocument, workflow]);

  if (isLoading) return <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400"><Loader2 className="mr-2 animate-spin" size={18} />正在准备工作流画布…</div>;
  if (error && !workflow) return <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center dark:bg-slate-950"><p className="text-sm text-rose-600 dark:text-rose-400">{error}</p><button type="button" onClick={onBack} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">返回</button></div>;

  return (
    <div className="visual-workflow-shell flex h-full min-h-0 flex-col bg-[#f6f8fb] text-slate-900 dark:bg-[#0b0f14] dark:text-slate-100">
      <header className="z-30 flex min-h-[72px] shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 shadow-[0_1px_0_rgba(15,23,42,0.03)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#10151c]/90 sm:px-6">
        <button type="button" onClick={onBack} aria-label="返回聊天" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 dark:border-white/[0.1] dark:hover:border-cyan-500/40 dark:hover:bg-cyan-500/10 dark:hover:text-cyan-300"><ArrowLeft size={17} /></button>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <span className="hidden text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-600 dark:text-cyan-400 sm:inline">AI WORKFLOW / V2</span>
            <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/[0.06] dark:text-slate-400 sm:inline">编辑模式</span>
          </div>
          <div className="flex items-center gap-2">
            <input value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 max-w-[260px] truncate bg-transparent text-sm font-semibold outline-none transition placeholder:text-slate-400 focus:text-cyan-700 dark:focus:text-cyan-300 sm:text-base" aria-label="工作流名称" />
            <span className="shrink-0 text-[10px] font-mono text-slate-400">v{revision}</span>
          </div>
        </div>
        <div className="hidden items-center gap-2 text-xs text-slate-500 lg:flex"><LayoutPanelTop size={14} className="text-cyan-500" />无限画布</div>
        <span className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:flex ${dirty ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'}`}><Cloud size={13} />{dirty ? '未保存' : '已保存'}</span>
        <div className="flex items-center gap-1 border-l border-slate-200 pl-2 dark:border-white/[0.08]">
          <button type="button" onClick={undo} aria-label="撤销" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/[0.06] dark:hover:text-white" title="撤销"><Undo2 size={15} /></button>
          <button type="button" onClick={redo} aria-label="重做" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-white/[0.06] dark:hover:text-white" title="重做"><Redo2 size={15} /></button>
          <button type="button" aria-label="更多工作流操作" className="hidden h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 dark:hover:bg-white/[0.06] sm:flex" title="更多"><MoreHorizontal size={17} /></button>
        </div>
        <button type="button" onClick={() => void validate()} disabled={isValidating} className="hidden h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:opacity-60 dark:border-white/[0.1] dark:text-slate-300 dark:hover:border-cyan-500/40 dark:hover:bg-cyan-500/10 sm:flex"><ShieldCheck size={14} />{isValidating ? '校验中' : '校验'}</button>
        <button type="button" onClick={() => void save()} disabled={isSaving || !dirty} className="flex h-8 items-center gap-1.5 rounded-md bg-cyan-500 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-45"><Save size={14} />{isSaving ? '保存中' : '保存'}</button>
        <button type="button" onClick={() => void runWorkflow()} disabled={isRunning || isSaving || !workflow} className="flex h-8 items-center gap-1.5 rounded-md border border-cyan-200 px-3 text-xs font-semibold text-cyan-700 transition hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-cyan-900 dark:text-cyan-300 dark:hover:bg-cyan-500/10"><Play size={13} />{isRunning ? '运行中' : '运行'}</button>
      </header>
      <div className="relative min-h-0 flex-1">
        <WorkflowCanvas definitions={definitions} />
        <aside className="absolute right-4 top-4 z-20 hidden w-[292px] overflow-hidden rounded-xl border border-slate-200/90 bg-white/95 shadow-[0_12px_40px_rgba(15,23,42,0.12)] backdrop-blur-xl md:block dark:border-white/[0.1] dark:bg-[#111820]/95">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/[0.08]">
            <div><p className="text-xs font-semibold text-slate-800 dark:text-slate-100">检查面板</p><p className="mt-0.5 text-[10px] text-slate-400">节点与连线状态</p></div>
            <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${issues.length ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'}`}>{issues.length ? `${issues.length} 个问题` : '结构正常'}</span>
          </div>
          <div className="max-h-[calc(100vh-180px)] overflow-y-auto p-4">
            {error && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
            {selectedNode ? <WorkflowNodeInspector node={selectedNode} definitions={definitions} onConfigChange={updateSelectedNode} onDelete={deleteSelectedNode} /> : <div className="mb-4 flex items-start gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-xs leading-5 text-slate-500 dark:border-white/[0.12] dark:text-slate-400"><CircleHelp size={15} className="mt-0.5 shrink-0 text-cyan-500" />点击画布中的节点，在这里查看和编辑节点信息。</div>}
            {run && <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]"><div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">运行进度</p><span className="font-mono text-[10px] text-cyan-600 dark:text-cyan-300">{run.progress}% · {run.status}</span></div><div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/[0.08]"><div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${run.progress}%` }} /></div><div className="space-y-2">{run.nodeRuns.map((nodeRun) => <div key={nodeRun.id} className="rounded-md border border-slate-200/80 bg-white/70 p-2 dark:border-white/[0.06] dark:bg-white/[0.02]"><div className="flex items-center gap-2 text-[10px]"><span className={`h-1.5 w-1.5 rounded-full ${nodeRun.status === 'SUCCEEDED' ? 'bg-emerald-500' : nodeRun.status === 'FAILED' ? 'bg-rose-500' : nodeRun.status === 'RUNNING' ? 'animate-pulse bg-cyan-500' : 'bg-slate-300'}`} /><span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">{nodes.find((node) => node.id === nodeRun.node_id)?.data.label ?? nodeRun.node_id}</span><span className="font-mono text-slate-400">{nodeRun.status}</span></div>{nodeRun.output_artifacts.map((artifact, index) => <RunArtifactPreview key={`${nodeRun.id}-artifact-${index}`} artifact={artifact} />)}</div>)}</div>{run.status === 'FAILED' && <div className="mt-3 flex items-start gap-1.5 text-[10px] leading-4 text-rose-600 dark:text-rose-300"><XCircle size={13} className="mt-0.5 shrink-0" />节点执行失败，请检查模型配置和公开媒体 URL。</div>}</div>}
            {issues.length ? <div className="space-y-2">{issues.map((issue, index) => <div key={`${issue.code}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"><strong className="font-mono text-[10px]">{issue.code}</strong><p className="mt-0.5">{issue.message}</p></div>)}</div> : <div className="flex items-start gap-2 text-xs leading-5 text-slate-500 dark:text-slate-400"><Check size={15} className="mt-0.5 shrink-0 text-emerald-500" />画布结构可保存。每个端口支持多条连线，校验器会检查类型、重复边和 DAG 环。</div>}
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-[10px] text-slate-400 dark:border-white/[0.08]"><div><p className="text-slate-500 dark:text-slate-300">节点类型</p><p className="mt-0.5 font-mono">{definitions.length}</p></div><div><p className="text-slate-500 dark:text-slate-300">画布节点</p><p className="mt-0.5 font-mono">{nodes.length}</p></div></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
