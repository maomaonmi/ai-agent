'use client';

/* Canvas previews may point to user-configured asset hosts; next/image would require a fixed allowlist. */
/* eslint-disable @next/next/no-img-element */

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
  type OnConnect,
} from '@xyflow/react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, CheckCircle2, CircleAlert, GripVertical, Image as ImageIcon, Loader2, Music2, Plus, Search, Sparkles, SlidersHorizontal, Upload, Video, Wrench } from 'lucide-react';
import { uploadImagePlazaAsset, uploadReferenceVideo, type VisualWorkflowNodeDefinition } from '../../lib/api';
import { useVisualWorkflowStore } from './store';
import { displayLabel, type WorkflowCanvasNode } from './types';
import { isValidWorkflowConnection } from './validation';
import '@xyflow/react/dist/style.css';

const CATEGORY_LABELS: Record<string, string> = {
  input: '输入',
  transform: '转换',
  generate: '生成',
  image: '图像生成',
  video: '视频生成',
  output: '输出',
};

const CATEGORY_TONES: Record<string, { dot: string; text: string; soft: string }> = {
  input: { dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300', soft: 'bg-sky-50 dark:bg-sky-500/10' },
  transform: { dot: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-300', soft: 'bg-violet-50 dark:bg-violet-500/10' },
  image: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300', soft: 'bg-amber-50 dark:bg-amber-500/10' },
  video: { dot: 'bg-cyan-500', text: 'text-cyan-700 dark:text-cyan-300', soft: 'bg-cyan-50 dark:bg-cyan-500/10' },
  generate: { dot: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300', soft: 'bg-orange-50 dark:bg-orange-500/10' },
  output: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', soft: 'bg-emerald-50 dark:bg-emerald-500/10' },
};

const IMAGE_MODEL_OPTIONS = [
  ['qwen-image-3.0-pro', '千问 Image 3.0 Pro'],
  ['qwen-image-3.0', '千问 Image 3.0'],
  ['wan2.7-image-pro', 'Wan 2.7 Image Pro'],
  ['wan2.7-image', 'Wan 2.7 Image'],
  ['cogview-4', 'CogView-4'],
] as const;
const VIDEO_MODEL_OPTIONS = [
  ['wan3.0-video', 'Wan 3.0 Video'],
  ['wan2.7-t2v', 'Wan 2.7'],
  ['wan2.7-i2v', 'Wan 2.7 I2V'],
  ['wan2.2-kf2v-flash', 'Wan 2.2 首尾帧'],
  ['wan2.7-r2v', 'Wan 2.7 R2V'],
  ['wan2.7-r2v-2026-06-12', 'Wan 2.7 R2V 快照'],
  ['wan2.6-r2v-flash', 'Wan 2.6 R2V Flash'],
  ['wan2.6-r2v', 'Wan 2.6 R2V'],
  ['cogvideox-3', 'CogVideoX-3'],
  ['viduq1-image', 'Vidu Q1 Image'],
  ['viduq1-start-end', 'Vidu Q1 首尾帧'],
  ['vidu2-reference', 'Vidu 2 Reference'],
] as const;

type MediaArtifact = { type?: unknown; value?: unknown };

function artifactValue(artifact: MediaArtifact): string | null {
  return typeof artifact.value === 'string' && artifact.value.trim() ? artifact.value : null;
}

function NodeMediaPreview({ artifacts, imageUrls = [], videoUrl }: { artifacts: MediaArtifact[]; imageUrls?: string[]; videoUrl?: string }) {
  const imageArtifacts = artifacts.filter((artifact) => String(artifact.type ?? '').startsWith('image.')).map(artifactValue).filter((value): value is string => Boolean(value));
  const videoArtifact = artifacts.find((artifact) => String(artifact.type ?? '').startsWith('video.'));
  const resolvedImages = imageArtifacts.length ? imageArtifacts : imageUrls.filter(Boolean);
  const resolvedVideo = artifactValue(videoArtifact ?? {}) ?? videoUrl;
  if (!resolvedImages.length && !resolvedVideo) return null;
  return <div className="mb-3 min-w-0 overflow-hidden rounded-lg border border-slate-200/90 bg-slate-50 p-1.5 dark:border-white/[0.1] dark:bg-black/20">
    {resolvedImages.length > 0 && <div className="grid min-w-0 grid-cols-2 gap-1.5">{resolvedImages.slice(0, 4).map((url, index) => <img key={`${url}-${index}`} src={url} alt={`节点图片预览 ${index + 1}`} className="aspect-square min-w-0 max-w-full rounded-md bg-white object-cover dark:bg-black/20" loading="lazy" />)}</div>}
    {resolvedVideo && <video className="max-h-40 min-w-0 max-w-full rounded-md bg-black object-contain" src={resolvedVideo} controls preload="metadata" />}
  </div>;
}

const WorkflowNodeCard = memo(function WorkflowNodeCard({ data, selected, id }: NodeProps<WorkflowCanvasNode>) {
  const definition = data.definition;
  const inputs = definition?.inputs ?? [];
  const outputs = definition?.outputs ?? [];
  const status = data.status ?? 'idle';
  const tone = CATEGORY_TONES[definition?.category ?? 'output'] ?? CATEGORY_TONES.output;
  const updateNodeConfig = useVisualWorkflowStore((state) => state.updateNodeConfig);
  const isImageGenerator = data.kind === 'image_generate' || data.kind === 'image_edit';
  const isVideoGenerator = ['text_to_video', 'image_to_video', 'start_end_video', 'reference_to_video'].includes(data.kind);
  const isImageInput = data.kind === 'image_input';
  const isVideoInput = data.kind === 'video_input';
  const defaultModel = data.kind === 'text_to_video' ? 'wan2.7-t2v' : data.kind === 'image_to_video' ? 'wan2.7-i2v' : data.kind === 'start_end_video' ? 'wan2.2-kf2v-flash' : data.kind === 'reference_to_video' ? 'wan2.7-r2v' : 'qwen-image-3.0';
  const modelOptions = isImageGenerator ? IMAGE_MODEL_OPTIONS : VIDEO_MODEL_OPTIONS;
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const config = data.config ?? {};
  const runtimeArtifacts = data.runtimeArtifacts ?? [];
  const imageUrls = Array.isArray(config.previewUrls)
    ? config.previewUrls.map(String)
    : Array.isArray(config.urls) ? config.urls.map(String) : config.url ? [String(config.url)] : [];
  const previewVideoUrl = typeof config.previewUrl === 'string' ? config.previewUrl : typeof config.url === 'string' ? config.url : undefined;

  const handleImageUpload = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setIsUploading(true); setUploadError('');
    try {
      const assets = await Promise.all(files.slice(0, 6).map((file) => uploadImagePlazaAsset(file)));
      const urls = assets.map((asset) => asset.url);
      updateNodeConfig(id, { url: urls[0], urls, previewUrls: urls, assetIds: assets.map((asset) => asset.id), filenames: files.slice(0, assets.length).map((file) => file.name) });
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : '图片上传失败');
    } finally { setIsUploading(false); }
  }, [id, updateNodeConfig]);

  const handleVideoUpload = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setIsUploading(true); setUploadError('');
    try {
      const asset = await uploadReferenceVideo(file);
      updateNodeConfig(id, {
        referenceAssetId: asset.assetId,
        previewUrl: asset.previewUrl ?? asset.thumbnailUrl,
        filename: asset.filename,
        mediaKind: 'reference_video',
      });
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : '视频上传失败');
    } finally { setIsUploading(false); }
  }, [id, updateNodeConfig]);
  return (
    <div className={`workflow-node-card w-[320px] min-w-[320px] max-w-[calc(100vw-2rem)] overflow-visible rounded-xl border bg-white shadow-[0_8px_24px_rgba(15,23,42,0.10)] transition dark:bg-[#151b23] ${selected ? 'border-cyan-500 ring-2 ring-cyan-500/20' : 'border-slate-200/90 dark:border-white/[0.1]'}`}>
      {inputs.map((port, index) => (
        <Handle key={`target-${port.id}`} type="target" position={Position.Left} id={port.id} isConnectable={true} style={{ top: `${54 + index * 22}px` }} />
      ))}
      {outputs.map((port, index) => (
        <Handle key={`source-${port.id}`} type="source" position={Position.Right} id={port.id} isConnectable={true} style={{ top: `${54 + index * 22}px` }} />
      ))}
      <div className={`flex items-center gap-2 rounded-t-xl border-b border-slate-100 px-3 py-2 dark:border-white/[0.08] ${tone.soft}`}>
        <GripVertical size={14} className="text-slate-400" />
        <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{data.label}</span>
        {status === 'success' && <CheckCircle2 size={14} className="text-emerald-500" />}
        {status === 'error' && <CircleAlert size={14} className="text-rose-500" />}
        {status === 'running' && <Sparkles size={14} className="animate-pulse text-cyan-500" />}
      </div>
      <div className="px-3 py-2.5 text-[10px] text-slate-500 dark:text-slate-400">
        <p className={`mb-2 truncate font-mono ${tone.text}`}>{data.kind}</p>
        {data.kind === 'prompt_input' && <textarea value={String(config.text ?? '')} onChange={(event) => updateNodeConfig(id, { text: event.target.value })} onMouseDown={(event) => event.stopPropagation()} className="scrollbar-none mb-3 min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs leading-5 text-slate-700 outline-none transition focus:border-cyan-400 dark:border-white/[0.1] dark:bg-black/20 dark:text-slate-200" placeholder="输入提示词…" aria-label="节点提示词" />}
        <NodeMediaPreview artifacts={runtimeArtifacts} imageUrls={imageUrls} videoUrl={(isVideoInput || isVideoGenerator) ? previewVideoUrl : undefined} />
        {isImageInput && <div className="mb-3">
          <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 py-2 text-[10px] font-medium text-slate-500 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 dark:border-white/[0.14] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:border-cyan-500/40 dark:hover:bg-cyan-500/10 dark:hover:text-cyan-300">
            {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}<span>{isUploading ? '上传中…' : '添加图片'}</span>
            <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" multiple className="hidden" disabled={isUploading} onMouseDown={(event) => event.stopPropagation()} onChange={(event) => { void handleImageUpload(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} />
          </label>
          {uploadError && <p className="mt-1 text-[9px] leading-4 text-rose-500">{uploadError}</p>}
        </div>}
        {isVideoInput && <div className="mb-3">
          <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-slate-50 px-2 py-2 text-[10px] font-medium text-slate-500 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 dark:border-white/[0.14] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:border-cyan-500/40 dark:hover:bg-cyan-500/10 dark:hover:text-cyan-300">
            {isUploading ? <Loader2 size={13} className="animate-spin" /> : <Video size={13} />}<span>{isUploading ? '上传中…' : '添加视频'}</span>
            <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" disabled={isUploading} onMouseDown={(event) => event.stopPropagation()} onChange={(event) => { void handleVideoUpload(event.target.files?.[0]); event.currentTarget.value = ''; }} />
          </label>
          {uploadError && <p className="mt-1 text-[9px] leading-4 text-rose-500">{uploadError}</p>}
        </div>}
        {(isImageGenerator || isVideoGenerator) && <select value={String(data.config.model ?? defaultModel)} onChange={(event) => updateNodeConfig(id, { model: event.target.value })} onMouseDown={(event) => event.stopPropagation()} className="mb-3 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-[10px] text-slate-700 outline-none focus:border-cyan-400 dark:border-white/[0.1] dark:bg-black/20 dark:text-slate-200" aria-label="节点模型">{modelOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
        <div className="grid grid-cols-2 gap-2">
          <div><p className="mb-1 uppercase tracking-[0.12em] text-[9px] text-slate-400">输入</p>{inputs.length ? inputs.map((port) => <p key={port.id} className="truncate leading-5">{port.id}</p>) : <p className="leading-5 text-slate-300 dark:text-slate-600">—</p>}</div>
          <div className="text-right"><p className="mb-1 uppercase tracking-[0.12em] text-[9px] text-slate-400">输出</p>{outputs.length ? outputs.map((port) => <p key={port.id} className="truncate leading-5">{port.id}</p>) : <p className="leading-5 text-slate-300 dark:text-slate-600">—</p>}</div>
        </div>
      </div>
    </div>
  );
});

function WorkflowCanvasInner({ definitions }: { definitions: VisualWorkflowNodeDefinition[] }) {
  const reactFlow = useReactFlow<WorkflowCanvasNode>();
  const nodes = useVisualWorkflowStore((state) => state.nodes);
  const edges = useVisualWorkflowStore((state) => state.edges);
  const setGraph = useVisualWorkflowStore((state) => state.setGraph);
  const setViewport = useVisualWorkflowStore((state) => state.setViewport);
  const selectNode = useVisualWorkflowStore((state) => state.selectNode);
  const selectedNodeId = useVisualWorkflowStore((state) => state.selectedNodeId);
  const [search, setSearch] = useState('');
  const [catalogMode, setCatalogMode] = useState<'all' | 'models' | 'tools' | 'inputs'>('all');
  const [isDarkTheme, setIsDarkTheme] = useState(false);

  useEffect(() => {
    const syncTheme = () => setIsDarkTheme(document.documentElement.classList.contains('dark'));
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    window.addEventListener('appearance-settings-changed', syncTheme);
    return () => { observer.disconnect(); window.removeEventListener('appearance-settings-changed', syncTheme); };
  }, []);

  const nodeTypes = useMemo(() => ({ workflow: WorkflowNodeCard }), []);
  const definitionMap = useMemo(() => new Map(definitions.map((definition) => [definition.kind, definition])), [definitions]);
  const filteredDefinitions = useMemo(
    () => definitions
      .filter((definition) => catalogMode === 'all' || (catalogMode === 'models' ? ['image', 'video'].includes(definition.category) : catalogMode === 'tools' ? ['transform', 'output'].includes(definition.category) : definition.category === 'input'))
      .filter((definition) => `${definition.kind} ${displayLabel(definition.kind)}`.toLowerCase().includes(search.toLowerCase())),
    [catalogMode, definitions, search],
  );

  const onNodesChange = useCallback((changes: Parameters<typeof applyNodeChanges<WorkflowCanvasNode>>[0]) => {
    const hasDocumentChange = changes.some((change) => change.type !== 'select');
    const removedIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    const nextEdges = removedIds.size ? edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)) : edges;
    setGraph(applyNodeChanges(changes, nodes), nextEdges, { recordHistory: hasDocumentChange, markDirty: hasDocumentChange });
    if (selectedNodeId && removedIds.has(selectedNodeId)) selectNode(null);
  }, [edges, nodes, selectNode, selectedNodeId, setGraph]);
  const onEdgesChange = useCallback((changes: Parameters<typeof applyEdgeChanges>[0]) => {
    setGraph(nodes, applyEdgeChanges(changes, edges));
  }, [edges, nodes, setGraph]);
  const onConnect = useCallback<OnConnect>((connection) => {
    if (!isValidWorkflowConnection(connection, nodes, edges, definitions)) return;
    setGraph(nodes, addEdge({ ...connection, id: `edge_${crypto.randomUUID()}`, type: 'smoothstep' }, edges));
  }, [definitions, edges, nodes, setGraph]);

  const addNode = useCallback((definition: VisualWorkflowNodeDefinition) => {
    const point = reactFlow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const next: WorkflowCanvasNode = {
      id: `${definition.kind}_${crypto.randomUUID().slice(0, 8)}`,
      type: 'workflow',
      position: point,
      data: { kind: definition.kind, label: displayLabel(definition.kind), config: {}, definition },
    };
    setGraph([...nodes, next], edges);
    selectNode(next.id);
  }, [edges, nodes, reactFlow, selectNode, setGraph]);

  return (
    <div className="visual-workflow-canvas flex h-full min-h-0">
      <aside className="z-10 flex w-[304px] shrink-0 border-r border-slate-200/90 bg-white/90 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#10151c]/90">
        <nav className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-slate-100 py-4 dark:border-white/[0.06]" aria-label="工作流目录">
          {[["all", Boxes, "全部节点"], ["models", ImageIcon, "模型"], ["tools", Wrench, "工具箱"], ["inputs", Music2, "输入素材"]].map(([mode, Icon, label]) => <button key={mode as string} type="button" title={label as string} aria-label={label as string} onClick={() => setCatalogMode(mode as 'all' | 'models' | 'tools' | 'inputs')} className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${catalogMode === mode ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.08] dark:hover:text-white'}`}><Icon size={16} /></button>)}
          <div className="my-1 h-px w-6 bg-slate-200 dark:bg-white/[0.08]" />
          <button type="button" title="画布设置" aria-label="画布设置" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.08] dark:hover:text-white"><SlidersHorizontal size={16} /></button>
          <button type="button" title="视频节点" aria-label="视频节点" onClick={() => setCatalogMode('models')} className="flex h-9 w-9 items-center justify-center rounded-lg text-cyan-500 transition hover:bg-cyan-50 dark:hover:bg-cyan-500/10"><Video size={16} /></button>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="mb-4 flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-600 dark:text-cyan-400">组件库 / {catalogMode === 'models' ? '模型' : catalogMode === 'tools' ? '工具箱' : catalogMode === 'inputs' ? '输入素材' : '全部'}</p><h3 className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">节点预设</h3></div><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-mono text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">{definitions.length}</span></div>
          <div className="relative mb-3"><Search size={14} className="pointer-events-none absolute left-3 top-2.5 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索节点、模型或工具…" className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-xs outline-none transition placeholder:text-slate-400 focus:border-cyan-400 focus:bg-white dark:border-white/[0.1] dark:bg-white/[0.04] dark:focus:border-cyan-500/50 dark:focus:bg-white/[0.06]" /></div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {(['input', 'transform', 'image', 'video', 'generate', 'output'] as const).map((category) => {
              const items = filteredDefinitions.filter((definition) => definition.category === category);
              if (!items.length) return null;
              const tone = CATEGORY_TONES[category] ?? CATEGORY_TONES.output;
              return <section key={category}><p className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />{CATEGORY_LABELS[category]}</p><div className="space-y-1">{items.map((definition) => <button key={definition.kind} type="button" onClick={() => addNode(definition)} className="group flex w-full items-center gap-2 rounded-lg border border-transparent px-2.5 py-2.5 text-left text-xs text-slate-700 transition hover:border-cyan-200/80 hover:bg-cyan-50/70 dark:text-slate-200 dark:hover:border-cyan-500/20 dark:hover:bg-cyan-500/[0.07]"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${tone.soft}`}><Plus size={13} className={`${tone.text} transition group-hover:scale-110`} /></span><span className="min-w-0 flex-1 truncate">{displayLabel(definition.kind)}</span><span className="text-[10px] text-slate-300 transition group-hover:text-cyan-500 dark:text-slate-600">＋</span></button>)}</div></section>;
            })}
            {!filteredDefinitions.length && <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400 dark:border-white/[0.1]">没有匹配的节点</div>}
          </div>
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/[0.08]"><p className="text-[10px] leading-5 text-slate-400">点击节点加入画布。输入、输出端口均支持多条连接；媒体端口可汇聚图片与视频。</p></div>
        </div>
      </aside>
      <div className="relative min-w-0 flex-1 bg-[var(--workflow-canvas-bg)]">
        <ReactFlow<WorkflowCanvasNode>
          nodes={nodes.map((node) => ({ ...node, data: { ...node.data, definition: node.data.definition ?? definitionMap.get(node.data.kind) } }))}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={(connection) => isValidWorkflowConnection(connection, nodes, edges, definitions)}
          onNodeClick={(_, node) => selectNode(node.id)}
          onPaneClick={() => selectNode(null)}
          deleteKeyCode={['Backspace', 'Delete']}
          onMoveEnd={(_, viewport) => setViewport(viewport)}
          defaultEdgeOptions={{ type: 'smoothstep', animated: false }}
          connectionLineStyle={{ stroke: '#22d3ee', strokeWidth: 2 }}
          fitView
          colorMode={isDarkTheme ? 'dark' : 'light'}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color="rgb(100 116 139 / 0.18)" />
          <MiniMap pannable zoomable nodeColor="#22d3ee" maskColor="rgb(15 23 42 / 0.08)" className="!bottom-4 !right-4 !m-0 !overflow-hidden !rounded-lg !border !border-slate-200/80 !bg-white/90 !shadow-lg dark:!border-white/[0.1] dark:!bg-[#111820]/90" />
          <Controls position="bottom-left" showInteractive={false} className="!bottom-4 !left-4 !m-0 !overflow-hidden !rounded-lg !border !border-slate-200/80 !bg-white/90 !shadow-lg dark:!border-white/[0.1] dark:!bg-[#111820]/90" />
          <Panel position="top-left" className="!left-4 !top-4 !m-0"><div className="rounded-lg border border-slate-200/80 bg-white/90 px-3 py-2 text-[11px] text-slate-500 shadow-sm backdrop-blur dark:border-white/[0.1] dark:bg-[#111820]/90 dark:text-slate-400"><span className="font-medium text-slate-700 dark:text-slate-200">{selectedNodeId ? '节点已选中' : '开始搭建工作流'}</span><span className="mx-2 text-slate-300 dark:text-slate-600">·</span><span>滚轮缩放 · 拖动画布</span></div></Panel>
          {!nodes.length && <Panel position="top-center" className="!top-1/2 !m-0 !-translate-y-1/2"><div className="pointer-events-none w-[280px] rounded-xl border border-dashed border-slate-300 bg-white/85 px-5 py-6 text-center shadow-sm backdrop-blur dark:border-white/[0.14] dark:bg-[#111820]/85"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300"><Plus size={19} /></div><p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">画布还是空的</p><p className="mt-1 text-xs leading-5 text-slate-400">从左侧选择一个节点，开始你的第一条 AI 视频流水线。</p></div></Panel>}
        </ReactFlow>
      </div>
    </div>
  );
}

export default function WorkflowCanvas(props: { definitions: VisualWorkflowNodeDefinition[] }) {
  return <ReactFlowProvider><WorkflowCanvasInner {...props} /></ReactFlowProvider>;
}
