'use client';

/* Workflow assets can come from a user-configured API host. */
/* eslint-disable @next/next/no-img-element */

import { Image as ImageIcon, Link2, Settings2, Trash2, Upload, Video } from 'lucide-react';
import { useState } from 'react';
import type { Node } from '@xyflow/react';
import { uploadImagePlazaAsset, type VisualWorkflowNodeDefinition } from '../../lib/api';
import type { WorkflowCanvasNodeData } from './types';

type Props = {
  node: Node<WorkflowCanvasNodeData>;
  definitions: VisualWorkflowNodeDefinition[];
  onConfigChange: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
};

const VIDEO_MODELS = [
  ['wan3.0-video', 'Wan 3.0 Video'],
  ['wan2.7-t2v', 'Wan 2.7'],
  ['wan2.7-i2v', 'Wan 2.7 I2V'],
  ['wan2.6-i2v-flash', 'Wan 2.6 I2V Flash'],
  ['wan2.6-i2v', 'Wan 2.6 I2V'],
  ['wan2.2-kf2v-flash', 'Wan 2.2 首尾帧'],
  ['wan2.7-r2v', 'Wan 2.7 R2V'],
  ['wan2.7-r2v-2026-06-12', 'Wan 2.7 R2V 快照'],
  ['wan2.6-r2v-flash', 'Wan 2.6 R2V Flash'],
  ['wan2.6-r2v', 'Wan 2.6 R2V'],
  ['cogvideox-3', 'CogVideoX-3'],
  ['viduq1-image', 'Vidu Q1 Image'],
  ['viduq1-start-end', 'Vidu Q1 首尾帧'],
  ['vidu2-reference', 'Vidu 2 Reference'],
];
const IMAGE_MODELS = [
  ['qwen-image-3.0-pro', '千问 Image 3.0 Pro'],
  ['qwen-image-3.0', '千问 Image 3.0'],
  ['wan2.7-image-pro', 'Wan 2.7 Image Pro'],
  ['wan2.7-image', 'Wan 2.7 Image'],
  ['cogview-4', 'CogView-4'],
];

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block space-y-1.5"><span className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">{label}</span>{children}{hint && <span className="block text-[10px] leading-4 text-slate-400">{hint}</span>}</label>;
}

function inputClass() {
  return 'w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none transition focus:border-cyan-400 dark:border-white/[0.1] dark:bg-slate-950 dark:text-slate-200';
}

export default function WorkflowNodeInspector({ node, definitions, onConfigChange, onDelete }: Props) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const config = node.data.config ?? {};
  const definition = definitions.find((item) => item.kind === node.data.kind);
  const isImage = node.data.kind === 'image_generate' || node.data.kind === 'image_edit';
  const isVideo = ['text_to_video', 'image_to_video', 'start_end_video', 'reference_to_video'].includes(node.data.kind);
  const isMediaInput = ['image_input', 'video_input', 'audio_url_input'].includes(node.data.kind);

  const imageUrls = Array.isArray(config.urls) ? config.urls.map(String) : config.url ? [String(config.url)] : [];
  const handleImageUpload = async (files: File[]) => {
    if (!files.length) return;
    setIsUploading(true); setUploadError('');
    try {
      const assets = await Promise.all(files.slice(0, 6).map((file) => uploadImagePlazaAsset(file)));
      const urls = assets.map((asset) => asset.url);
      onConfigChange({ url: urls[0], urls, previewUrls: urls, assetIds: assets.map((asset) => asset.id), filenames: files.slice(0, assets.length).map((file) => file.name) });
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : '图片上传失败');
    } finally { setIsUploading(false); }
  };

  return <div className="space-y-3 rounded-lg border border-cyan-200/80 bg-cyan-50/60 p-3 dark:border-cyan-500/20 dark:bg-cyan-500/[0.07]">
    <div className="flex items-center gap-2"><Settings2 size={14} className="text-cyan-600 dark:text-cyan-300" /><p className="text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">节点 Inspector</p><span className="ml-auto font-mono text-[9px] text-slate-400">{definition?.executorKey ?? node.data.kind}</span><button type="button" onClick={onDelete} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-300" aria-label="删除节点" title="删除节点"><Trash2 size={13} /></button></div>
    <Field label="节点名称"><input value={node.data.label} onChange={(event) => onConfigChange({ label: event.target.value })} className={inputClass()} aria-label="节点名称" /></Field>
    {node.data.kind === 'prompt_input' && <Field label="提示词"><textarea value={String(config.text ?? '')} onChange={(event) => onConfigChange({ text: event.target.value })} className={`${inputClass()} min-h-24 resize-y`} placeholder="输入提示词…" /></Field>}
    {isMediaInput && node.data.kind === 'image_input' && <Field label="图片输入" hint="支持 PNG、JPG、JPEG、WebP；可一次选择多张图片。"><div className="space-y-2"><div className="flex flex-wrap gap-2">{imageUrls.map((url, index) => <div key={`${url}-${index}`} className="relative h-16 w-16 overflow-hidden rounded-md border border-cyan-200 bg-white dark:border-cyan-500/20 dark:bg-black/20"><img src={url} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" /></div>)}<label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-cyan-300 bg-white/70 text-cyan-600 transition hover:bg-white dark:border-cyan-500/30 dark:bg-black/20 dark:text-cyan-300"><Upload size={14} /><span className="text-[9px]">{isUploading ? '上传中' : '本地图片'}</span><input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" multiple className="hidden" disabled={isUploading} onChange={(event) => { void handleImageUpload(Array.from(event.target.files ?? [])); event.currentTarget.value = ''; }} /></label></div>{uploadError && <p className="text-[10px] text-rose-600 dark:text-rose-300">{uploadError}</p>}<div className="relative"><Link2 size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" /><input value={String(config.url ?? '')} onChange={(event) => onConfigChange({ url: event.target.value, urls: [event.target.value], previewUrls: [event.target.value] })} className={`${inputClass()} pl-8`} placeholder="或粘贴公开图片 URL" /></div></div></Field>}
    {isMediaInput && node.data.kind !== 'image_input' && <Field label={node.data.kind === 'audio_url_input' ? '公开音频 URL' : '公开媒体 URL'} hint="供应商需要公开可访问的 HTTPS URL；本地文件请先上传到资产服务。"><div className="relative"><Link2 size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400" /><input value={String(config.url ?? '')} onChange={(event) => onConfigChange({ url: event.target.value })} className={`${inputClass()} pl-8`} placeholder="https://cdn.example.com/asset" /></div></Field>}
    {isImage && <>
      <Field label="图片模型"><select value={String(config.model ?? IMAGE_MODELS[1][0])} onChange={(event) => onConfigChange({ model: event.target.value })} className={inputClass()}>{IMAGE_MODELS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="画幅"><select value={String(config.ratio ?? '1:1')} onChange={(event) => onConfigChange({ ratio: event.target.value })} className={inputClass()}>{['1:1', '16:9', '9:16', '4:3', '3:4'].map((value) => <option value={value} key={value}>{value}</option>)}</select></Field><Field label="输出张数"><input type="number" min={1} max={6} value={Number(config.count ?? 1)} onChange={(event) => onConfigChange({ count: Number(event.target.value) })} className={inputClass()} /></Field></div>
      <div className="flex items-center gap-2 text-[10px] text-slate-400"><ImageIcon size={13} className="text-amber-500" />参考图端口支持多张图片。</div>
    </>}
    {isVideo && <>
      <Field label="视频模型"><select value={String(config.model ?? '')} onChange={(event) => onConfigChange({ model: event.target.value })} className={inputClass()}><option value="">自动选择</option>{VIDEO_MODELS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-2"><Field label="时长（秒）"><input type="number" min={2} max={30} value={Number(config.duration ?? 5)} onChange={(event) => onConfigChange({ duration: Number(event.target.value) })} className={inputClass()} /></Field><Field label="分辨率"><select value={String(config.resolution ?? '720P')} onChange={(event) => onConfigChange({ resolution: event.target.value })} className={inputClass()}>{['480P', '720P', '1080P', '2K', '4K'].map((value) => <option value={value} key={value}>{value}</option>)}</select></Field></div>
      <Field label="画幅"><select value={String(config.ratio ?? '16:9')} onChange={(event) => onConfigChange({ ratio: event.target.value })} className={inputClass()}>{['auto', '16:9', '9:16', '1:1', '4:3', '3:4'].map((value) => <option value={value} key={value}>{value}</option>)}</select></Field>
      {node.data.kind === 'reference_to_video' && <Field label="参考目的"><select value={String(config.referencePurpose ?? 'motion')} onChange={(event) => onConfigChange({ referencePurpose: event.target.value })} className={inputClass()}>{[['motion', '动作/运镜'], ['subject', '主体'], ['style', '风格'], ['scene', '场景']].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field>}
      <div className="flex items-center gap-2 text-[10px] text-slate-400"><Video size={13} className="text-cyan-500" />视频任务将在后台异步执行，可随时恢复状态。</div>
    </>}
    {!isImage && !isVideo && !isMediaInput && node.data.kind !== 'prompt_input' && <p className="text-[10px] leading-4 text-slate-400">该节点由上游端口驱动，当前无需额外参数。</p>}
  </div>;
}
