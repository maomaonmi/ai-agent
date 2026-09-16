/**
 * API 调用和 SSE 处理
 * 支持：标准对话 / 深度思考 / 联网搜索 / 深度调研
 */

import type { OmniTurnContext } from '../features/omni/types';
import { CodeAgentEventBuffer } from '../Code/codeEventStream.ts';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const ACCEPTANCE_REQUEST_TIMEOUT_MS = 50_000;

// Visual workflow contracts are intentionally kept close to the API layer so
// the canvas, persistence controls, and future run panel share one wire shape.
export type WorkflowPortDataType =
  | 'prompt.text'
  | 'image.asset'
  | 'video.asset'
  | 'media.asset'
  | 'audio.url'
  | 'image.asset[]'
  | 'video.asset[]';

export interface VisualWorkflowPosition { x: number; y: number; }
export interface VisualWorkflowViewport { x: number; y: number; zoom: number; }
export interface VisualWorkflowPort {
  id: string;
  direction: 'input' | 'output';
  dataType: WorkflowPortDataType;
  required: boolean;
  cardinality: 'one' | 'many';
  maxConnections?: number;
}
export interface VisualWorkflowNode {
  id: string;
  kind: string;
  definitionVersion: number;
  position: VisualWorkflowPosition;
  label?: string | null;
  config: Record<string, unknown>;
  isDisabled: boolean;
}
export interface VisualWorkflowEdge {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}
export interface VisualWorkflowDocument {
  schemaVersion: 1;
  workflowId: string;
  revision: number;
  name: string;
  nodes: VisualWorkflowNode[];
  edges: VisualWorkflowEdge[];
  viewport: VisualWorkflowViewport;
}
export interface VisualWorkflow {
  id: string;
  name: string;
  description?: string | null;
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
  document: VisualWorkflowDocument;
}
export interface VisualWorkflowNodeDefinition {
  kind: string;
  version: number;
  category: string;
  inputs: VisualWorkflowPort[];
  outputs: VisualWorkflowPort[];
  configSchema: Record<string, unknown>;
  cachePolicy: 'pure' | 'ttl' | 'none' | string;
  executorKey: string;
}
export interface VisualWorkflowValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  portId?: string;
  edgeId?: string;
}

export interface VisualWorkflowCompilePlan {
  workflowId: string;
  revision: number;
  nodeIds: string[];
  requestedNodeIds?: string[] | null;
  predecessors: Record<string, string[]>;
  successors: Record<string, string[]>;
  batches: string[][];
}

export interface VisualWorkflowRun {
  id: string;
  workflowId: string;
  revision: number;
  status: 'PLANNED' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | string;
  mode: 'dry-run' | 'execute' | string;
  progress: number;
  requestedNodeIds: string[];
  clientRequestId?: string | null;
  createdAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
  plan: VisualWorkflowCompilePlan;
  nodeRuns: VisualWorkflowNodeRun[];
}

export interface VisualWorkflowNodeRun {
  id: string;
  run_id: string;
  node_id: string;
  attempt: number;
  status: 'PENDING' | 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED' | string;
  provider?: string | null;
  provider_task_id?: string | null;
  input_artifacts: Array<Record<string, unknown>>;
  output_artifacts: Array<Record<string, unknown>>;
  error_code?: string | null;
  error_message?: string | null;
  started_at?: number | null;
  completed_at?: number | null;
}

export async function getVisualWorkflowNodeDefinitions(): Promise<VisualWorkflowNodeDefinition[]> {
  const response = await fetch(`${API_BASE_URL}/api/visual-workflow-node-definitions`);
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { definitions?: VisualWorkflowNodeDefinition[] };
  return payload.definitions ?? [];
}

export async function createVisualWorkflow(name: string, description?: string): Promise<VisualWorkflow> {
  const response = await fetch(`${API_BASE_URL}/api/visual-workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<VisualWorkflow>;
}

export async function listVisualWorkflows(page = 1, pageSize = 20): Promise<{
  workflows: VisualWorkflow[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const response = await fetch(`${API_BASE_URL}/api/visual-workflows?${params.toString()}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function getVisualWorkflow(workflowId: string): Promise<VisualWorkflow> {
  const response = await fetch(`${API_BASE_URL}/api/visual-workflows/${encodeURIComponent(workflowId)}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<VisualWorkflow>;
}

export async function saveVisualWorkflowRevision(
  workflowId: string,
  baseRevision: number,
  document: VisualWorkflowDocument,
): Promise<VisualWorkflow> {
  const response = await fetch(`${API_BASE_URL}/api/visual-workflows/${encodeURIComponent(workflowId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseRevision, document }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<VisualWorkflow>;
}

export async function validateVisualWorkflow(
  workflowId: string,
  document: VisualWorkflowDocument,
  requireInputs = false,
): Promise<{ valid: boolean; issues: VisualWorkflowValidationIssue[] }> {
  const response = await fetch(`${API_BASE_URL}/api/visual-workflows/${encodeURIComponent(workflowId)}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document, requireInputs }),
  });
  if (response.ok) return response.json() as Promise<{ valid: boolean; issues: VisualWorkflowValidationIssue[] }>;
  const payload = await response.json().catch(() => null) as { error?: { details?: { issues?: VisualWorkflowValidationIssue[] } } } | null;
  if (payload?.error?.details?.issues) return { valid: false, issues: payload.error.details.issues };
  throw new Error(await parseApiError(response));
}

export async function compileVisualWorkflow(input: {
  workflowId: string;
  revision?: number;
  requestedNodeIds?: string[];
  requireInputs?: boolean;
}): Promise<VisualWorkflowCompilePlan> {
  const response = await fetch(`${API_BASE_URL}/api/visual-workflows/${encodeURIComponent(input.workflowId)}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      revision: input.revision,
      requestedNodeIds: input.requestedNodeIds,
      requireInputs: input.requireInputs ?? false,
    }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { plan: VisualWorkflowCompilePlan };
  return payload.plan;
}

export async function createVisualWorkflowDryRun(input: {
  workflowId: string;
  revision?: number;
  requestedNodeIds?: string[];
  requireInputs?: boolean;
  clientRequestId?: string;
}): Promise<VisualWorkflowRun> {
  return createVisualWorkflowRun({ ...input, mode: 'dry-run' });
}

export async function createVisualWorkflowRun(input: {
  workflowId: string;
  mode: 'dry-run' | 'execute';
  revision?: number;
  requestedNodeIds?: string[];
  requireInputs?: boolean;
  clientRequestId?: string;
}): Promise<VisualWorkflowRun> {
  const response = await fetch(`${API_BASE_URL}/api/visual-workflows/${encodeURIComponent(input.workflowId)}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: input.mode,
      revision: input.revision,
      requestedNodeIds: input.requestedNodeIds,
      requireInputs: input.requireInputs ?? false,
      clientRequestId: input.clientRequestId,
    }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<VisualWorkflowRun>;
}

export async function getVisualWorkflowRun(workflowId: string, runId: string): Promise<VisualWorkflowRun> {
  const response = await fetch(`${API_BASE_URL}/api/visual-workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<VisualWorkflowRun>;
}

export type VisualWorkflowRunEvent = {
  sequence?: number;
  eventType?: string;
  nodeId?: string | null;
  payload?: Record<string, unknown>;
};

export function subscribeVisualWorkflowRun(
  workflowId: string,
  runId: string,
  onEvent: (event: VisualWorkflowRunEvent) => void,
  onError?: () => void,
): () => void {
  const source = new EventSource(`${API_BASE_URL}/api/visual-workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}/stream`);
  const handle = (event: MessageEvent<string>) => {
    try { onEvent(JSON.parse(event.data) as VisualWorkflowRunEvent); } catch { onError?.(); }
  };
  source.onmessage = handle;
  source.addEventListener('snapshot', handle);
  source.addEventListener('node_started', handle);
  source.addEventListener('node_succeeded', handle);
  source.addEventListener('node_failed', handle);
  source.addEventListener('run_succeeded', handle);
  source.addEventListener('run_failed', handle);
  source.onerror = () => onError?.();
  return () => source.close();
}

export async function cancelVisualWorkflowRun(workflowId: string, runId: string): Promise<VisualWorkflowRun> {
  const response = await fetch(`${API_BASE_URL}/api/visual-workflows/${encodeURIComponent(workflowId)}/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<VisualWorkflowRun>;
}

export interface ImageModelCapability {
  id: string;
  name: string;
  provider: string;
  description: string;
  max_outputs: number;
  max_width: number;
  max_height: number;
  supports_negative_prompt: boolean;
  enabled: boolean;
}

export interface ImageDirectorResult {
  recommended_model: string;
  fallback_models?: string[];
  enhanced_prompt_zh: string;
  enhanced_prompt_en?: string;
  negative_prompt?: string;
  routing_reasons?: string[];
  suggested_ratio?: string;
  warnings?: string[];
}

export interface ImageAsset {
  id: string;
  url: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  mime_type?: string;
}

export interface ImageBatch {
  batch_id: string;
  task_id?: string;
  status: string;
  raw_prompt: string;
  director?: ImageDirectorResult | null;
  images: ImageAsset[];
}

export interface ImagePlazaAsset {
  id: string;
  url: string;
  mime_type?: string;
  prompt?: string;
  prompt_en?: string;
  negative_prompt?: string;
  tags?: string[];
  source?: string;
  created_at?: number;
  updated_at?: number;
}

export interface ImagePromptAnalysis {
  asset_id: string;
  status: 'ready' | 'fallback';
  prompt: string;
  prompt_en?: string;
  negative_prompt?: string;
  tags?: string[];
  message?: string;
}

export async function getImageModels(): Promise<ImageModelCapability[]> {
  const response = await fetch(`${API_BASE_URL}/api/image/models`);
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { models?: ImageModelCapability[] };
  return payload.models ?? [];
}

export async function directImagePrompt(input: {
  raw_prompt: string;
  ratio?: string;
  count?: number;
  model_mode?: 'auto' | 'manual';
  model?: string | null;
}): Promise<ImageDirectorResult> {
  const response = await fetch(`${API_BASE_URL}/api/image/direct`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function createImageGeneration(input: {
  raw_prompt: string;
  ratio?: string;
  count?: number;
  model_mode?: 'auto' | 'manual';
  model?: string | null;
  enhance?: boolean;
  reference_image?: string;
}): Promise<ImageBatch> {
  const response = await fetch(`${API_BASE_URL}/api/image/generations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  const batch = await response.json() as ImageBatch;
  return { ...batch, images: (batch.images ?? []).map((image) => ({ ...image, url: image.url.startsWith('http') ? image.url : `${API_BASE_URL}${image.url}` })) };
}

export async function listImageBatches(limit = 24, query = ''): Promise<{ batches: ImageBatch[]; count: number }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set('query', query);
  const response = await fetch(`${API_BASE_URL}/api/image/batches?${params.toString()}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { batches: ImageBatch[]; count: number };
  return { ...payload, batches: payload.batches.map((batch) => ({ ...batch, images: (batch.images ?? []).map((image) => ({ ...image, url: image.url.startsWith('http') ? image.url : `${API_BASE_URL}${image.url}` })) })) };
}

export async function listImagePlazaAssets(limit = 48): Promise<{ assets: ImagePlazaAsset[]; count: number }> {
  const response = await fetch(`${API_BASE_URL}/api/image/plaza/assets?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { assets?: ImagePlazaAsset[]; count: number };
  return {
    ...payload,
    assets: (payload.assets ?? []).map((asset) => ({
      ...asset,
      url: asset.url.startsWith('http') ? asset.url : `${API_BASE_URL}${asset.url}`,
    })),
  };
}

export async function uploadImagePlazaAsset(file: File): Promise<ImagePlazaAsset> {
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(`${API_BASE_URL}/api/image/plaza/assets`, { method: 'POST', body });
  if (!response.ok) throw new Error(await parseApiError(response));
  const asset = await response.json() as ImagePlazaAsset;
  return { ...asset, url: asset.url.startsWith('http') ? asset.url : `${API_BASE_URL}${asset.url}` };
}

export async function analyzeImagePlazaAsset(assetId: string): Promise<ImagePromptAnalysis> {
  const response = await fetch(`${API_BASE_URL}/api/image/plaza/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_id: assetId }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<ImagePromptAnalysis>;
}

export interface VideoFramePromptAnalysis {
  status: 'ready';
  prompt: string;
  model?: string;
  mode: 'image_to_video' | 'start_end_video';
}

export async function analyzeVideoFrames(input: {
  mode: 'image_to_video' | 'start_end_video';
  first_frame_url: string;
  last_frame_url?: string;
}): Promise<VideoFramePromptAnalysis> {
  const response = await fetch(`${API_BASE_URL}/api/video/analyze_frames`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<VideoFramePromptAnalysis>;
}

export interface VideoModelCapability {
  id: string;
  name: string;
  provider: 'qianwen' | 'zhipu' | string;
  description: string;
  modes: string[];
  future_modes: string[];
  ratios: string[];
  resolutions: string[];
  duration_min: number;
  duration_max: number;
  durations: number[];
  supports_audio: boolean;
  supports_audio_input: boolean;
  enabled: boolean;
  docs_url?: string;
}

export interface VideoTask {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN' | string;
  progress: number;
  provider: string;
  model: string;
  prompt: string;
  mode?: 'text_to_video' | 'image_to_video' | 'start_end_video' | 'reference_to_video' | 'multi_image_to_video';
  parameters: {
    ratio: string; duration: number; resolution: string; audio_url?: string | null;
    first_frame_url?: string | null; last_frame_url?: string | null; negative_prompt?: string | null;
    seed?: number | null; prompt_extend?: boolean; watermark?: boolean; shot_type?: 'single' | 'multi' | null;
    references?: VideoReference[];
  };
  provider_status?: string | null;
  created_at: number;
  updated_at: number;
  submitted_at?: number | null;
  started_at?: number | null;
  completed_at?: number | null;
  result?: { video_url?: string | null; asset_id?: string | null } | null;
  error?: { code?: string | null; message?: string | null } | null;
}

export type VideoReferencePurpose = 'subject' | 'style' | 'motion' | 'scene';

export interface VideoReference {
  assetId?: string;
  url?: string;
  mediaKind: 'reference_video' | 'reference_image' | 'first_frame';
  purpose?: VideoReferencePurpose;
}

export interface VideoReferenceAsset {
  assetId: string;
  status: 'UPLOADING' | 'UPLOADED' | 'PROBING' | 'TRANSCODING' | 'READY' | 'REJECTED' | 'EXPIRED' | 'DELETED' | string;
  progress: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  error: { code?: string | null; message?: string | null } | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  previewUrl?: string;
  thumbnailUrl?: string;
}

export interface VideoTaskEvent {
  task_id?: string;
  status?: VideoTask['status'];
  progress?: number;
  message?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

function videoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith('http') ? url : `${API_BASE_URL}${url}`;
}

export async function getVideoModels(): Promise<VideoModelCapability[]> {
  const response = await fetch(`${API_BASE_URL}/api/video/models`);
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { models?: VideoModelCapability[] };
  return payload.models ?? [];
}

export async function createVideoTask(input: {
  mode?: 'text_to_video' | 'image_to_video' | 'start_end_video' | 'reference_to_video' | 'multi_image_to_video';
  prompt: string;
  model: string;
  ratio: string;
  duration: number;
  resolution: string;
  prompt_extend?: boolean;
  watermark?: boolean;
  audio?: boolean | null;
  audio_url?: string;
  first_frame_url?: string;
  last_frame_url?: string;
  negative_prompt?: string;
  seed?: number;
  shot_type?: 'single' | 'multi';
  quality?: string;
  fps?: number;
  references?: VideoReference[];
}): Promise<VideoTask> {
  const clientRequestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `video-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const response = await fetch(`${API_BASE_URL}/api/video/create_task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, client_request_id: clientRequestId }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  const task = await response.json() as VideoTask;
  return { ...task, result: task.result ? { ...task.result, video_url: videoUrl(task.result.video_url) } : task.result };
}

export async function createReferenceAssetUpload(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{ assetId: string; uploadUrl: string; expiresAt: number; headers: Record<string, string> }> {
  const response = await fetch(`${API_BASE_URL}/api/video/reference-assets/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: input.filename, content_type: input.contentType, size_bytes: input.sizeBytes }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function uploadReferenceVideo(file: File): Promise<VideoReferenceAsset> {
  const plan = await createReferenceAssetUpload({ filename: file.name, contentType: file.type || 'video/mp4', sizeBytes: file.size });
  let upload: Response;
  try {
    upload = await fetch(plan.uploadUrl, { method: 'PUT', headers: plan.headers, body: file });
  } catch (cause) {
    if (cause instanceof TypeError) {
      throw new Error('OSS 上传被浏览器拦截，请在 OSS 桶 CORS 中允许当前前端地址和 PUT/Content-Type');
    }
    throw cause;
  }
  if (!upload.ok) throw new Error(`OSS 上传失败（HTTP ${upload.status}）`);
  const complete = await fetch(`${API_BASE_URL}/api/video/reference-assets/${encodeURIComponent(plan.assetId)}/complete`, { method: 'POST' });
  if (!complete.ok) throw new Error(await parseApiError(complete));
  const asset = await complete.json() as VideoReferenceAsset;
  const previewUrl = URL.createObjectURL(file);
  const thumbnailUrl = await createVideoThumbnail(file);
  return { ...asset, previewUrl, thumbnailUrl };
}

async function createVideoThumbnail(file: File): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined;
  const sourceUrl = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const video = document.createElement('video');
    let captured = false;
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(sourceUrl);
    };
    const captureFrame = () => {
      if (captured) return;
      captured = true;
      const canvas = document.createElement('canvas');
      const width = video.videoWidth || 320;
      const height = video.videoHeight || 180;
      const scale = Math.min(1, 320 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) { cleanup(); resolve(undefined); return; }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        cleanup();
        resolve(blob ? URL.createObjectURL(blob) : undefined);
      }, 'image/jpeg', 0.82);
    };
    video.onloadedmetadata = () => {
      // Avoid a common black opening frame by sampling shortly after the
      // beginning instead of drawing at timestamp 0.
      const duration = Number.isFinite(video.duration) ? video.duration : 1;
      const target = Math.min(Math.max(0.1, duration * 0.15), Math.max(0, duration - 0.05));
      if (target > 0) video.currentTime = target;
      else captureFrame();
    };
    video.onseeked = captureFrame;
    video.onerror = () => { cleanup(); resolve(undefined); };
    video.src = sourceUrl;
  });
}

export async function getReferenceAsset(assetId: string): Promise<VideoReferenceAsset> {
  const response = await fetch(`${API_BASE_URL}/api/video/reference-assets/${encodeURIComponent(assetId)}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function deleteReferenceAsset(assetId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/video/reference-assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function getVideoTaskStatus(taskId: string): Promise<VideoTask> {
  const response = await fetch(`${API_BASE_URL}/api/video/status/${encodeURIComponent(taskId)}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  const task = await response.json() as VideoTask;
  return { ...task, result: task.result ? { ...task.result, video_url: videoUrl(task.result.video_url) } : task.result };
}

export async function listVideoTasks(page = 1, pageSize = 20, taskStatus?: string): Promise<{ tasks: VideoTask[]; page: number; pageSize: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (taskStatus) params.set('status', taskStatus);
  const response = await fetch(`${API_BASE_URL}/api/video/tasks?${params.toString()}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { tasks: VideoTask[]; page: number; pageSize: number };
  return { ...payload, tasks: payload.tasks.map((task) => ({ ...task, result: task.result ? { ...task.result, video_url: videoUrl(task.result.video_url) } : task.result })) };
}

export async function deleteVideoTask(taskId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/video/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await parseApiError(response));
}

export function openVideoTaskStream(
  taskId: string,
  onEvent: (eventName: string, event: VideoTaskEvent, lastEventId: string) => void,
  onError: () => void,
): EventSource {
  const source = new EventSource(`${API_BASE_URL}/api/video/stream/${encodeURIComponent(taskId)}`);
  for (const eventName of ['snapshot', 'status', 'progress', 'result', 'error', 'heartbeat']) {
    source.addEventListener(eventName, (event) => {
      try {
        const message = event as MessageEvent<string>;
        onEvent(eventName, JSON.parse(message.data) as VideoTaskEvent, message.lastEventId || '0');
      } catch {
        onError();
      }
    });
  }
  source.onerror = onError;
  return source;
}

export interface PublishedCodeProject {
  project_id: string;
  source_session_id: string | null;
  title: string;
  category: 'utility' | 'web' | 'interactive' | 'education';
  prompt: string;
  optimized_prompt: string | null;
  cover_image: string;
  project_kind: 'frontend' | 'fullstack';
  published_run_id: string;
  draft_run_id: string;
  has_unpublished_changes: boolean;
  created_at: number;
  updated_at: number;
  published_at: number;
  vfs?: Record<string, string>;
}

export async function listCodeProjects(category?: PublishedCodeProject['category']): Promise<{ projects: PublishedCodeProject[]; count: number }> {
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  const response = await fetch(`${API_BASE_URL}/api/code-projects${query}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function getCodeProject(projectId: string): Promise<PublishedCodeProject> {
  const response = await fetch(`${API_BASE_URL}/api/code-projects/${encodeURIComponent(projectId)}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function deleteCodeProject(projectId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/code-projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function publishCodeProject(input: {
  source_session_id: string;
  title: string;
  category: PublishedCodeProject['category'];
  prompt: string;
  cover_image: string;
  vfs: Record<string, string>;
  project_kind: PublishedCodeProject['project_kind'];
  published_run_id: string;
}): Promise<PublishedCodeProject> {
  const response = await fetch(`${API_BASE_URL}/api/code-projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export type HookLifecycle =
  | 'on_session_start'
  | 'on_conversation_start'
  | 'on_conversation_end'
  | 'before_llm_call'
  | 'after_llm_call'
  | 'before_tool_call'
  | 'after_tool_call'
  | 'on_error';

export interface HookRecord {
  id: string;
  name: string;
  lifecycle: HookLifecycle;
  enabled: boolean;
  priority: number;
  policy: 'allow' | 'transform' | 'block' | 'observe' | string;
  source_kind?: 'builtin' | 'uploaded_draft' | string;
  editable?: boolean;
  executable?: boolean;
  has_source_draft?: boolean;
}

export interface HookSourceDocument {
  id: string;
  name: string;
  source_kind: string;
  source_path: string;
  content: string;
  editable: boolean;
  executable: boolean;
  is_draft: boolean;
}

export interface HookDraftResult {
  filename: string;
  parsed: {
    name: string;
    description: string;
    lifecycle: HookLifecycle;
    policy: 'allow' | 'transform' | 'block' | 'observe' | string;
    priority?: number;
  };
  warnings: string[];
  executable: false;
  source_kind: string;
}

export async function getHooks(): Promise<{ hooks: HookRecord[]; count: number }> {
  const response = await fetch(`${API_BASE_URL}/api/hooks`);
  if (!response.ok) throw new Error('无法读取 HOOK 列表');
  return response.json();
}

export async function toggleHook(hookId: string, enabled: boolean): Promise<HookRecord> {
  const response = await fetch(`${API_BASE_URL}/api/hooks/${encodeURIComponent(hookId)}/toggle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error('HOOK 状态更新失败');
  const payload = await response.json() as { hook: HookRecord };
  return payload.hook;
}

export async function getHookSource(hookId: string): Promise<HookSourceDocument> {
  const response = await fetch(`${API_BASE_URL}/api/hooks/${encodeURIComponent(hookId)}/source`);
  if (!response.ok) throw new Error('无法读取 HOOK 源文件');
  return response.json();
}

export async function saveHookSource(hookId: string, content: string): Promise<{ saved: boolean; executable: false; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/hooks/${encodeURIComponent(hookId)}/source`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new Error('HOOK 源文件草稿保存失败');
  return response.json();
}

export async function parseHookFile(filename: string, content: string): Promise<HookDraftResult> {
  const response = await fetch(`${API_BASE_URL}/api/hooks/parse`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename, content }),
  });
  if (!response.ok) throw new Error('HOOK 文件解析失败');
  return response.json();
}

export async function createHookDraft(prompt: string): Promise<HookDraftResult> {
  const response = await fetch(`${API_BASE_URL}/api/hooks/draft`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
  });
  if (!response.ok) throw new Error('AI HOOK 草稿生成失败');
  return response.json();
}

export interface ModelSettings {
  provider: 'deepseek' | 'glm' | 'qwen' | 'minimax' | 'custom';
  api_format: 'openai_chat_completions' | 'anthropic_messages';
  base_url: string;
  model_id: string;
  api_key?: string;
  has_api_key?: boolean;
  minimax_plan_api_key?: string;
  has_minimax_plan_key?: boolean;
  display_name: string;
  model_family: string;
  input_context: number;
  output_context: number;
  tool_call_rounds: number;
  full_url: boolean;
  multimodal: boolean;
  text_model_id: string;
  vision_model_id: string;
  thinking_enabled: boolean;
  reasoning_effort: string;
  thinking_budget?: number | null;
  temperature: number;
  max_tokens: number;
}

// Why: 模型目录以后端 GET /api/settings/model-catalog 为单一数据源，
// 避免 QuickSwitcher 与 SettingsDialog 双份硬编码腐化。
export interface ModelVariant {
  value: string;            // 'qwen:qwen3.7-plus' 复合值编码
  label: string;
  model_id: string;
  supports_vision: boolean;
  // Why: 对齐后端 MODEL_CATALOG 的 thinking_control 值，收口前端字面量。
  // glm=GLM 协议(extra_body.thinking)，qwen_budget=千问协议(enable_thinking+thinking_budget)，
  // deepseek=DeepSeek 协议(extra_body.thinking.type + 顶层 reasoning_effort)，
  // minimax=Anthropic Messages 协议(thinking 块)，none=不支持思考。
  thinking_control: 'glm' | 'qwen_budget' | 'deepseek' | 'minimax' | 'none';
  supports_active_cache?: boolean;
  input_context: number;
  output_context: number;
}

export async function getModelCatalog(): Promise<Record<string, ModelVariant[]>> {
  const response = await fetch(`${API_BASE_URL}/api/settings/model-catalog`);
  if (!response.ok) throw new Error('无法读取模型目录');
  const data = await response.json();
  return data.providers ?? {};
}

export interface ChatAttachment {
  type: 'image_url' | 'video_url' | 'file_url';
  url: string;
  name?: string;
}

export async function getModelSettings(provider?: ModelSettings['provider']): Promise<ModelSettings> {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  const response = await fetch(`${API_BASE_URL}/api/settings/model${query}`);
  if (!response.ok) throw new Error('无法读取模型配置');
  return response.json();
}

export async function saveModelSettings(settings: ModelSettings): Promise<ModelSettings> {
  const response = await fetch(`${API_BASE_URL}/api/settings/model`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error('保存模型配置失败');
  return response.json();
}

// ==========================================
// 全局联网服务：搜索提供商选择 + Tavily/Firecrawl/Reranker/Suno Key
// 注意：GET 不会回传 key 明文（只传 has_*_key 状态）；PUT 才明文发送并持久化。
// ==========================================
export type SearchProvider = "tavily" | "firecrawl";
export type DeepResearchEngine = "firecrawl" | "native";

export interface ServiceSettings {
  proxy_enabled: boolean;
  has_proxy: boolean;
  proxy_host: string;
  search_provider: SearchProvider;
  tavily_api_key: string;
  firecrawl_api_key: string;
  rerank_api_key: string;
  // GET 永远为空字符串；仅用于 PUT 类型契约，防止前端误以为可读取旧 Key。
  suno_api_key: string;
  has_tavily_key: boolean;
  has_firecrawl_key: boolean;
  has_rerank_key: boolean;
  has_suno_key: boolean;
  suno_base_url: string;
  suno_callback_base_url: string;
  has_suno_callback: boolean;
  // Firecrawl 高级参数（非敏感，GET / PUT 都显式传输）
  firecrawl_enable_highlights: boolean;
  firecrawl_scrape_top_n: number;
  firecrawl_markdown_max_chars: number;
  deep_research_engine: DeepResearchEngine;
}

export async function getServiceSettings(): Promise<ServiceSettings> {
  const response = await fetch(`${API_BASE_URL}/api/settings/services`);
  if (!response.ok) throw new Error('无法读取服务配置');
  return response.json();
}

export interface SaveServiceSettingsPayload
  extends Partial<
    Pick<
      ServiceSettings,
      | "search_provider"
      | "tavily_api_key"
      | "firecrawl_api_key"
      | "rerank_api_key"
      | "suno_api_key"
      | "suno_base_url"
      | "suno_callback_base_url"
      | "firecrawl_enable_highlights"
      | "firecrawl_scrape_top_n"
      | "firecrawl_markdown_max_chars"
      | "deep_research_engine"
      | "proxy_enabled"
    >
  > {
  clear_proxy?: boolean;
  proxy_url?: string;
  clearTavily?: boolean;
  clearFirecrawl?: boolean;
  clearRerank?: boolean;
  clearSuno?: boolean;
  clearSunoCallback?: boolean;
}

export async function saveServiceSettings(settings: SaveServiceSettingsPayload): Promise<ServiceSettings> {
  // 字段语义：缺失 / undefined → 保留原值；空串 '' / clear*=true → 显式清空；非空串 → 更新。
  const response = await fetch(`${API_BASE_URL}/api/settings/services`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error('保存服务配置失败');
  return response.json();
}

// ==========================================
// 模型记忆设置（两套画像：global 聊天 / code 代码）
// ==========================================

export interface MemoryProfile {
  summary_turn_threshold: number;
  summary_token_threshold: number;
  window_k: number;
  event_keep: number;
  summary_keep: number;
  keep_recent_events: number;
  fallback_chars: number;
  scan_limit: number;
  profile_inactive_ttl_days: number;
}

export interface MemorySettings {
  global_memory: MemoryProfile;
  code_memory: MemoryProfile;
  profile_token_budget: number;
  summary_token_budget: number;
  window_token_budget: number;
  vfs_min_save_interval: number;
  vfs_max_keep: number;
}

export async function getMemorySettings(): Promise<MemorySettings> {
  const response = await fetch(`${API_BASE_URL}/api/memory/settings`);
  if (!response.ok) throw new Error('无法读取模型记忆配置');
  return response.json();
}

export async function saveMemorySettings(settings: MemorySettings): Promise<MemorySettings> {
  const response = await fetch(`${API_BASE_URL}/api/memory/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) throw new Error('保存模型记忆配置失败');
  return response.json();
}

export async function getMemoryTracesMarkdown(scope: 'global' | 'code'): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/memory/traces/md?scope=${scope}`);
  if (!response.ok) throw new Error('无法读取记忆痕迹');
  const data = await response.json();
  return data.content ?? '';
}

// ==========================================
// 类型定义
// ==========================================

export interface ChatMessage {
  /** Stable identity used by artifact/version links; legacy snapshots are normalized on restore. */
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  /** AI 写作论文正文生成的可持久化文档卡片状态。 */
  writingArtifact?: {
    type: 'word';
    title: string;
    status: 'generating' | 'complete' | 'failed';
    generatedAt?: number;
  };
  /** Persisted async video task marker; pending tasks resume polling after refresh. */
  videoTask?: {
    taskId: string;
    status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  };
  /** Persisted async PPT run marker; exact run resumes after refresh. */
  pptRun?: {
    runId: string;
    presentationId: string;
    status: 'QUEUED' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  };
  reasoning?: string;
  reasoning_time?: number;
  // Why: Code 模式历史消息需要回显用户上传的图片缩略图，便于复看每次提问的视觉上下文。
  attachments?: ChatAttachment[];
  // Why 每轮对话独立状态：webDocs / researchChunks / nodeProgress 随单条 assistant 消息绑定，
  //   不是全局单例——否则多轮搜索/调研后，之前的搜索结果被新轮覆盖，点历史对话找不到来源。
  //   刷新后随 SessionSnapshot.messages 整体持久化恢复。
  nodeProgress?: NodeEvent[];
  webDocs?: WebDoc[];
  researchChunks?: ResearchChunk[];
  researchReasoning?: string;
  researchReasoningTime?: number;
  /** 研究报告异步配图任务结果；随 assistant 消息写入会话快照。 */
  researchFigures?: ResearchFigure[];
  // Plan-and-Execute progress belongs to the assistant turn that produced it.
  // Keeping it on the message preserves chronological order across rounds.
  planProgress?: PlanProgressEvent;
  /** 自主规划最终报告的异步配图结果；与任务进度绑定持久化。 */
  planFigures?: PlanFigure[];
  /** Incremental final report text received before the terminal done event. */
  streamingReport?: string;
  /** MCP tool calls belong to the assistant turn that triggered them. */
  mcpTrace?: McpTraceItem[];
  // Why: 千问深度调研反问卡片——type='qwen_feedback' 时渲染为带输入框的内嵌卡片，
  //   feedbackQuestion 存储模型反问内容，feedbackAnswer 存储用户回答（提交后填充）。
  type?: 'qwen_feedback';
  feedbackQuestion?: string;
  feedbackAnswer?: string;
  tokenUsage?: TokenUsage;
  /** Read-only Code workbench answers are persisted as ordinary assistant turns. */
  codeResponseKind?: 'conversation' | 'clarify' | 'routing_error';
  /** The bounded read-only Agent process and full read_file results for this turn. */
  codeReadOnlyTimeline?: CodeAgentTimelineEvent[];
}

export type AgentLoopStageKind = 'think' | 'search' | 'observe' | 'final';

export interface NodeEvent {
  id?: number;
  node_name: string;
  status: 'processing' | 'completed';
  message?: string;
  timestamp_ms?: number;
  provider?: string;
  hit_count?: number;
  kept_count?: number;
  scrape_count?: number;
  fatal_error?: string;
  use_fallback?: boolean;
  fallback_reason?: string;
  answer_len?: number;
  reasoning_len?: number;
  docs_count?: number;
  native_search?: boolean;
  thinking?: boolean;
  wants_web?: boolean;
  use_deep?: boolean;
  extras?: Record<string, unknown>;
  // Why: Agent Loop 模式下事件归属的迭代轮次（从 stage `iteration_N_xxx` 解析得到）。
  //   旧 fanout/fetch/chunk/rerank/reason 链路无此字段，前端按"无迭代"分组渲染以保兼容。
  iteration?: number;
  // Why: Agent Loop 阶段语义（think/search/observe/final），便于面板按子节点样式区分。
  //   旧链路事件无此字段。
  stageKind?: AgentLoopStageKind;
}

export interface ReasoningEvent {
  reasoning: string;
}

export interface WebDoc {
  id: number | string;
  title: string;
  content: string;
  url: string;
  score: number;
}

export interface WebDocsEvent {
  docs: WebDoc[];
  count: number;
}

export interface DoneEvent {
  answer: string;
  reasoning_steps: number;
  mode: string;
  web_docs?: WebDoc[];
  usage?: TokenUsage;
}

export interface TokenUsageModel {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens?: number;
  cache_creation_input_tokens?: number;
  reasoning_tokens?: number;
  calls?: number;
}

export interface TokenUsage {
  model?: string;
  mode?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens: number;
  cached_tokens?: number;
  cache_creation_input_tokens?: number;
  reasoning_tokens?: number;
  calls?: number;
  models?: Record<string, TokenUsageModel>;
}

export interface ErrorEvent {
  message: string;
}

export interface PlanFigure {
  id: string;
  job_id?: string;
  ordinal?: number;
  image_url?: string;
  caption?: string;
  alt?: string;
  status?: 'queued' | 'processing' | 'generating' | 'completed' | 'succeeded' | 'failed';
  error_message?: string | null;
  task_id?: string;
  section_title?: string;
  source_url?: string | null;
  source_image_url?: string | null;
  image_origin?: 'source' | 'generated' | string;
}

export interface PlanFigureJob {
  id: string;
  status: 'queued' | 'generating' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  figures: PlanFigure[];
  error_message?: string | null;
}

export async function createPlanFigureJob(input: {
  session_id?: string;
  report_version: string;
  report: string;
  max_images?: number;
  policy?: 'economy' | 'balanced' | 'quality';
  context_mode?: 'preceding' | 'mixed';
  source_urls?: string[];
}): Promise<PlanFigureJob> {
  const response = await fetch(`${API_BASE_URL}/api/plan/figures/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<PlanFigureJob>;
}

export async function getPlanFigureJob(jobId: string): Promise<PlanFigureJob> {
  const response = await fetch(`${API_BASE_URL}/api/plan/figures/jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<PlanFigureJob>;
}

export async function retryPlanFigure(figureId: string): Promise<PlanFigureJob> {
  const response = await fetch(`${API_BASE_URL}/api/plan/figures/${encodeURIComponent(figureId)}/retry`, { method: 'POST' });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<PlanFigureJob>;
}

export type McpTraceItem = {
  tool_name: string;
  status: 'calling' | 'ok' | 'error';
  preview?: string;
};

export type McpPhase = 'start' | 'tool_call' | 'tool_result' | 'done' | 'error';

export interface McpToolCallEvent {
  phase: 'tool_call';
  tool_name: string;
  args: Record<string, unknown>;
}

export interface McpToolResultEvent {
  phase: 'tool_result';
  tool_name: string;
  ok: boolean;
  preview: string;
}

export interface McpPhaseEvent {
  phase: 'start' | 'done' | 'error';
  available?: number;
  tool_count?: number;
}

export type McpEvent = McpPhaseEvent | McpToolCallEvent | McpToolResultEvent;

export type ChatMode =
  | 'omni'
  | 'standard'
  | 'deep'
  | 'web'
  | 'research'
  | 'agent'
  | 'plan'
  | 'distributed_plan'
  | 'code'
  | 'writing'
  | 'music';

export interface CodeUpdateEvent {
  type: 'code_update';
  code: string;
  done: boolean;
  /** True when code is a runtime-fix candidate awaiting browser verification. */
  candidate?: boolean;
}

export interface CodeAgentEventEnvelope {
  run_id?: string;
  event_id?: string;
  sequence?: number;
  timestamp_ms?: number;
  source_event_id?: string;
  source_sequence?: number;
}

export interface CodeErrorEvent {
  type: 'error';
  message: string;
  done: true;
}

export interface CodeAgentActivityEvent {
  type: 'agent_activity';
  channel: 'status' | 'output' | 'answer';
  phase: 'preflight' | 'analyzing' | 'diagnosing' | 'thinking' | 'generating' | 'patching' | 'validating' | 'planning' | 'tool_calling' | 'tool_result' | 'done';
  content: string;
  /** Provider chunks are deltas; summary/status events may omit this field. */
  content_mode?: 'delta' | 'summary' | string;
  done: boolean;
  // AgentLoop 轮次边界：同一个 run 内的每个模型回合必须单独渲染，
  // 不能把工具前后的 reasoning 增量合并到同一张卡片。
  turn_id?: string;
  iteration?: number;
  boundary?: 'turn_completed' | string;
  run_id?: string;
  actor_id?: string;
  event_id?: string;
  sequence?: number;
  timestamp_ms?: number;
  resume_eligible?: boolean;
  status?: string;
  active_scope?: CodeTaskScope;
  scope_version?: number;
  scope_source?: 'orchestrator' | 'inherited' | 'explicit';
  allowed_next_action?: string;
  runtime_evidence?: RuntimeVerificationEvidence;
  metadata?: Record<string, unknown>;
}

export interface TestAgentCheckpointEvent {
  type: 'test_agent_checkpoint';
  channel: 'verification';
  phase: 'lifecycle_start' | 'module_verify' | string;
  status: string;
  content: string;
  done: boolean;
  run_id?: string;
  verification_session_id?: string;
  candidate_revision?: string;
  affected_obligations?: string[];
  metadata?: Record<string, unknown>;
}

export interface TestAgentExecutionEvent {
  type: 'test_agent_execution';
  channel: 'verification';
  phase: 'test_agent' | string;
  status: 'scheduled' | 'running' | 'blocked' | string;
  content: string;
  done: boolean;
  run_id?: string;
  verification_session_id?: string;
  candidate_revision?: string;
  metadata?: Record<string, unknown>;
}

export interface TestAgentResultEvent {
  type: 'test_agent_result';
  channel: 'verification';
  phase: 'precheck' | 'module_verify' | string;
  status: 'passed' | 'failed' | 'blocked' | 'skipped' | string;
  content: string;
  done: boolean;
  run_id?: string;
  verification_session_id?: string;
  candidate_revision?: string;
  affected_obligations?: string[];
  metadata?: Record<string, unknown>;
}

export interface TestAgentContractReplanEvent {
  type: 'test_agent_contract_replan';
  channel: 'verification';
  phase: 'contract_replan' | string;
  status: 'scheduled' | 'completed' | 'failed' | string;
  content: string;
  done: boolean;
  run_id?: string;
  verification_session_id?: string;
  candidate_revision?: string;
  affected_obligations?: string[];
  acceptance_goal?: AcceptanceGoalContract;
  metadata?: Record<string, unknown>;
}

export interface HookEvent {
  type: 'hook_event';
  event: 'started' | 'completed' | 'blocked' | 'errored' | string;
  hook_id: string;
  hook_name: string;
  lifecycle: HookLifecycle;
  session_id?: string;
  agent_run_id?: string;
  sequence: number;
  timestamp_ms: number;
  duration_ms?: number | null;
  status: 'running' | 'passed' | 'changed' | 'blocked' | 'failed' | string;
  summary?: string;
  diff?: Record<string, unknown> | null;
  cancel_reason?: string | null;
  error?: string | null;
}

export interface TokenUsageEvent {
  type: 'token_usage';
  run_id?: string;
  event_id?: string;
  usage: TokenUsage;
}

// Why: 三字段契约中"总结汇报"专用 SSE 事件。summary 内容来自模型或后端 delta 自动总结。
// 前端必须渲染在消息气泡正文区（白底/正常 Markdown），禁止缩进进"完整模型输出"大黑框。
export interface RuntimeSummaryEvent {
  type: 'runtime_summary';
  intent: 'patch' | 'fullstack_bootstrap' | 'answer' | 'ask_clarification';
  content: string;
  done: boolean;
  resume_eligible?: boolean;
  status?: string;
  run_id?: string;
  base_revision?: string;
  candidate_revision?: string;
  active_scope?: CodeTaskScope;
  scope_version?: number;
  scope_source?: 'orchestrator' | 'inherited' | 'explicit';
  allowed_next_action?: string;
  runtime_evidence?: RuntimeVerificationEvidence;
  /** Runtime-owned acceptance contract compiled from the current candidate evidence. */
  acceptance_goal?: AcceptanceGoalContract;
  acceptance_validation?: string;
  verification_status?: string;
  validation_errors?: Array<Record<string, unknown>>;
  reason?: string;
  verification_session_id?: string;
}

export interface RuntimeVerificationResponse {
  run_id: string;
  status: 'completed' | 'needs_attention' | string;
  verified: boolean;
  committed: boolean;
  reason: string;
  console_errors?: string[];
  runtime_evidence?: RuntimeVerificationEvidence;
}

// Why: 预留——终端命令提案事件。先走审批链（已在 terminal_service.filter_command 黑白名单），
// 等前端 UI 渲染"执行/拒绝/编辑后执行"横幅后再消费。
export interface TerminalProposalEvent {
  type: 'terminal_proposal';
  proposition_id?: string;
  id?: string;
  workspace_id?: string;
  command: string;
  reason?: string;
  expected_output_hint?: string;
  run_id?: string;
  timeout_seconds?: number;
}

/** Agent-requested evaluation in the current Code preview iframe. */
export interface SandboxCommandRequestEvent {
  type: 'sandbox_command_request';
  run_id: string;
  request_id: string;
  source: string;
  timeout_ms?: number;
}

// Why: 全栈修改模式任务拆解——后端把复杂指令拆成子任务列表推给前端，
// 前端用浮层卡片展示进度（待办/进行中/完成/失败/跳过）。
export type CodeTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'needs_attention';

export type CodeTaskPlanStatus = 'running' | 'completed' | 'needs_attention';

export interface TaskItem {
  id: number | string;
  task_key?: string;
  title: string;
  target_files: string[];
  description: string;
  status: CodeTaskStatus;
  reason?: string;
}

export interface TaskListEvent {
  type: 'task_list';
  tasks: TaskItem[];
  done: boolean;
  run_id?: string;
  plan_id?: string;
  plan_path?: string;
  todo_path?: string;
  event_id?: string;
  sequence?: number;
  timestamp_ms?: number;
  completed_count?: number;
  total_count?: number;
  status?: CodeTaskPlanStatus;
}

export interface TaskUpdateEvent {
  type: 'task_update';
  task_id: number | string;
  task_key?: string;
  status: CodeTaskStatus;
  plan_status?: CodeTaskPlanStatus;
  task?: TaskItem;
  reason?: string;
  done: boolean;
  run_id?: string;
  plan_id?: string;
  plan_path?: string;
  todo_path?: string;
  event_id?: string;
  sequence?: number;
  timestamp_ms?: number;
  completed_count?: number;
  total_count?: number;
  // Why: 兼容旧版 task_update 的子任务级 diff；当前实现用 file_written
  // 作为唯一文件变更事件，避免同一修改在任务完成时重复渲染。
  delta?: Record<string, { add: number; del: number }>;
}

export interface CodeTaskPlanState {
  runId: string;
  planId: string;
  planPath: string;
  todoPath: string;
  tasks: TaskItem[];
  status: CodeTaskPlanStatus;
  completedCount: number;
  totalCount: number;
  lastSequence: number;
  seenEventIds?: string[];
}

// Why: Agent Loop 工具循环中 write_file 等工具每落盘一个文件即推送该事件，
// 前端据此在文件树实时高亮刚写入的文件，体现"边写边做"。
export interface FileWrittenEvent {
  type: 'file_written';
  path: string;
  done: boolean;
  additions?: number;
  deletions?: number;
  line_count?: number;
  operation?: 'create' | 'modify' | 'delete';
}

// Why: AgentLoop 每轮结束后推送的运行指标不是代码内容，不能落入
// CodeUpdateEvent 分支，否则前端会把缺失的 event.code 写进 code state。
export interface AgentLoopRoundEvent {
  type: 'agent_loop_round';
  run_id?: string;
  loop_id?: string;
  turn_id?: string;
  iteration?: number;
  state_hash_before?: string;
  state_hash_after?: string;
  previous_state_hash?: string;
  same_as_previous_state?: boolean;
  tool_calls_count?: number;
  files_changed?: string[];
  tests_changed?: string[];
  diff_additions?: number;
  diff_deletions?: number;
  diff_size?: number;
  stdout_hash?: string;
  error_signature?: string;
  mutation_attempted?: boolean;
  semantic_progress?: boolean;
  progress_score?: number;
  progress_facts?: string[];
  consecutive_no_progress_rounds?: number;
  consecutive_error_rounds?: number;
}

export interface ContextUsageEvent {
  type: 'context_usage';
  run_id?: string;
  loop_id?: string;
  turn_id?: string;
  iteration?: number;
  event_id?: string;
  timestamp_ms?: number;
  phase: 'measured' | 'compressing' | 'compressed' | 'skipped' | 'failed' | string;
  context_tokens: number;
  message_tokens?: number;
  tool_tokens?: number;
  context_limit_tokens: number;
  usage_ratio: number;
  message_count: number;
  trigger_ratio?: number;
  target_ratio?: number;
  status?: 'running' | 'completed' | 'failed' | string;
  tokens_before?: number;
  tokens_after?: number;
  messages_removed?: number;
}

export type CodeGenerationEvent = (
  | CodeUpdateEvent
  | CodeErrorEvent
  | CodeAgentActivityEvent
  | TestAgentCheckpointEvent
  | TestAgentExecutionEvent
  | TestAgentResultEvent
  | TestAgentContractReplanEvent
  | HookEvent
  | TokenUsageEvent
  | RuntimeSummaryEvent
  | TerminalProposalEvent
  | SandboxCommandRequestEvent
  | TaskListEvent
  | TaskUpdateEvent
  | FileWrittenEvent
  | AgentLoopRoundEvent
  | ContextUsageEvent
  | MemoryUpdateEvent
  | SkillMatchedEvent
) & CodeAgentEventEnvelope;

export type PlanTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface PlanSearchResult {
  title: string;
  url: string;
  content?: string;
}

export interface PlanTask {
  id: number;
  title: string;
  description: string;
  status: PlanTaskStatus;
  requires_web: boolean;
  assigned_agent?: string;
  result?: string | null;
  error?: string | null;
  source_urls?: string[];
  search_results?: PlanSearchResult[];
  streaming_result?: string | null;
  search_status?: 'idle' | 'searching' | 'completed' | 'failed';
}

export type PlanRuntimeEvent =
  | { type: 'search_started'; query: string; provider?: string }
  | { type: 'search_completed'; query: string; cached?: boolean; result_count: number; results?: PlanSearchResult[]; error?: string }
  | { type: 'task_started'; task_id: number; title?: string; requires_web?: boolean }
  | { type: 'task_delta'; task_id: number; delta: string }
  | { type: 'task_completed'; task_id: number; status: PlanTaskStatus; result?: string | null; error?: string | null }
  | { type: 'report_delta'; delta: string }
  | { type: 'reasoning_delta'; delta: string; task_id?: number };

export interface PlanProgressEvent {
  phase: 'planning' | 'executing' | 'replanning' | 'completed';
  tasks: PlanTask[];
  current_task_id?: number | null;
  iteration: number;
  message?: string;
  active_task_ids?: number[];
}

// 多智能体协同事件
export interface AgentTalkEvent {
  from_agent: string;
  to_agent: string;
  action: string;
  content?: string;
  timestamp: number;
}

export interface AgentDeltaEvent {
  stream_id: string;
  actor: string;
  kind: 'reasoning' | 'token';
  delta: string;
  status?: 'started' | 'completed';
}

export interface AgentFinalAnswerEvent {
  answer: string;
  handled_by: string;
}

export interface SystemStatusEvent {
  message: string;
}

export type AgentTool = 'read' | 'edit' | 'terminal' | 'web_search';

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  is_callable: boolean;
  when_to_use: string;
  tools: AgentTool[];
  created_at?: number;
  updated_at?: number;
}

export type AgentDraft = Omit<AgentConfig, 'created_at' | 'updated_at'>;

export interface AgentListResponse {
  agents: AgentConfig[];
  count: number;
}

export type DiscussionLength = 'brief' | 'balanced' | 'detailed';
export type CapabilityMode = 'off' | 'auto' | 'on';
// Why: MCP 会话级注入是三态语义（off/auto/custom），与 CapabilityMode 的 on 不同，单独定义。
export type McpMode = 'off' | 'auto' | 'custom';

// 会话级 Firecrawl 搜索高级选项：DeepSeek 聊天联网与 Plan-and-Execute 搜索执行器共用。
export interface WebSearchOptions {
  limit: number;           // [1, 20]
  timeRange: '' | 'd' | 'w' | 'm' | 'y';  // "" 不限 / d=24h / w=1周 / m=1月 / y=1年
  location: string;        // 空串=全球无偏
  scrapeTopN: number;      // [0, 10] 0=只用 snippet
  highlights: boolean;
}

export const DEFAULT_WEB_SEARCH_OPTIONS: WebSearchOptions = {
  limit: 10,
  timeRange: '',
  location: '',
  scrapeTopN: 2,
  highlights: true,
};

// 会话级千问原生搜索参数（仅 Qwen 走原生联网时生效）
// Why: 千问走 OpenAI 兼容协议，参数通过 extra_body.search_options 注入，
// 与 DeepSeek 的 WebSearchOptions 完全独立。官方文档明确 OpenAI 兼容协议
// 不支持 enable_source/enable_citation/citation_format，故不包含这些字段。
export interface QwenNativeSearchOptions {
  searchStrategy: 'turbo' | 'max' | 'agent' | 'agent_max';
  forcedSearch: boolean;
  enableSearchExtension: boolean;
  freshness: 0 | 7 | 30 | 180 | 365;  // 0=不限，仅 turbo 生效
  assignedSiteList: string[];           // 限定站点，仅 turbo 生效，最多 25 个
  promptIntervene: string;              // 自然语言检索引导，仅 turbo 生效，最多 200 字
}

export const DEFAULT_QWEN_NATIVE_SEARCH_OPTIONS: QwenNativeSearchOptions = {
  searchStrategy: 'turbo',
  forcedSearch: false,
  enableSearchExtension: false,
  freshness: 0,
  assignedSiteList: [],
  promptIntervene: '',
};

export interface RuntimeSettings {
  responseLength: DiscussionLength;
  webSearch: CapabilityMode;
  deepThinking: CapabilityMode;
  discussionRounds: number;
  mcpMode: McpMode;
  mcpServerIds: string[];
  // 会话级 Skill 挂载三态（决策 2）：off 不注入 / auto 全部已上架 / custom 仅白名单。
  skillMode: McpMode;
  skillIds: number[];
  // 会话级 Firecrawl 搜索高级选项
  webSearchOptions: WebSearchOptions;
  // 会话级千问原生搜索参数（仅 Qwen + 直连/chat_node 路径生效）
  qwenNativeSearchOptions: QwenNativeSearchOptions;
}

export interface CodeAgentTrace {
  steps: string[];
  output: string;
  // 思考增量与可执行模型输出分栏保存，避免 reasoning 混入代码/JSON 黑框。
  reasoning?: string;
  phase: string;
  isRunning: boolean;
  fileChanges?: CodeFileChange[];
  // Why: 问答分支下后端返回 Markdown 文本，前端用 MarkdownMessage 渲染而非 <pre>。
  answer?: string;
  // Why: Day59 三字段契约——总结汇报，渲染在“消息气泡正文”区（正常白底 Markdown），
  //   禁止缩进进“完整模型输出”大黑框。summary 为空表示本次 run 没有独立汇报内容。
  summary?: string;
  summaryIntent?: 'patch' | 'fullstack_bootstrap' | 'answer' | 'ask_clarification';
  /** Candidate identity used by the browser-verification commit handshake. */
  runtimeVerification?: {
    /** Backend AgentLoop identity that owns the candidate VFS. */
    runId: string;
    /** Browser code revision that must be used for verification. */
    browserRunId?: string;
    baseRevision: string;
    candidateRevision: string;
  };
  /** Terminal outcome of the orchestrated run, including a resumable checkpoint. */
  status?: 'running' | 'awaiting_runtime_verification' | 'completed' | 'needs_attention' | 'failed' | 'superseded';
  /** The orchestrator left durable unfinished work that a later turn may resume. */
  resumeEligible?: boolean;
  // Why: 预留——终端命令提案缓存列表，等后续 UI 渲染“执行/拒绝/编辑后执行”横幅。
  terminalProposals?: Array<{
    proposition_id?: string;
    run_id?: string;
    command: string;
    reason?: string;
    expected_output_hint?: string;
  }>;
  hookEvents?: HookEvent[];
  tokenUsage?: TokenUsage;
  contextUsage?: ContextUsageEvent;
  taskPlan?: CodeTaskPlanState;
  timeline?: CodeAgentTimelineEvent[];
  /** Orchestrator-owned sticky scope; restored with the run. */
  activeScope?: CodeTaskScope;
  scopeVersion?: number;
  scopeSource?: 'orchestrator' | 'inherited' | 'explicit';
  allowedNextAction?: string;
  /** Structured browser evidence passed into the next repair/resume turn. */
  runtimeEvidence?: RuntimeVerificationEvidence;
  /** Version-bound source snippets that a later runtime repair may reuse. */
  runtimeReadEvidence?: Record<string, RuntimeReadEvidence>;
  /** Semantic browser-acceptance contract selected by the intent router. */
  acceptanceGoal?: AcceptanceGoalContract;
  /** Resident Test Agent identity shared by initial and repair runs. */
  verificationSessionId?: string;
}

export type CodeTaskScope =
  | 'frontend_runtime'
  | 'frontend_patch'
  | 'fullstack_patch'
  | 'fullstack_bootstrap';

export interface RuntimeTargetError {
  type: string;
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
}

export interface RuntimeVerificationEvidence {
  status: 'verified' | 'runtime_verification_failed' | 'blocked' | 'needs_attention' | string;
  run_id: string;
  base_revision: string;
  candidate_revision: string;
  target_error?: RuntimeTargetError;
  changed_files: string[];
  diff_summary: string;
  new_errors: string[];
  same_error_persisted: boolean;
  boot_completed: boolean;
  deterministic_verifier_passed?: boolean;
  goal_verified?: boolean;
  proof_outcome?: string;
  goal_assertion_ids?: string[];
  console_errors: string[];
  deterministic_findings?: DeterministicBrowserFinding[];
  repair_obligations?: Array<Record<string, unknown>>;
  failure_fingerprint?: string;
  failure_occurrence?: number;
  same_failure_persisted?: boolean;
  required_inspection_paths?: string[];
  blocked_patch_paths?: string[];
  page_errors?: string[];
  diagnostic: string;
}

export interface RuntimeReadEvidence {
  content: string;
  revision: string;
  source_run_id?: string;
}

export type AcceptanceGoalType =
  | 'page_health'
  | 'primary_interaction'
  | 'game_start'
  | 'entity_presence'
  | 'entity_presence_and_motion'
  | 'game_growth_over_time'
  | 'custom_measurement'
  | 'unknown';

export interface AcceptanceGoalContract {
  goal_type: AcceptanceGoalType;
  entity?: string;
  interaction_target?: 'primary' | 'start' | 'submit' | 'save';
  minimum_count?: number;
  requires_position_change?: boolean;
  interaction_required?: boolean;
  growth_ticks?: number;
  user_goal?: string;
  success_criteria?: string[];
  required_assertion_ids?: string[];
  confidence?: number;
  source?: string;
  adapter_id?: string;
  measurement_contract?: Record<string, unknown> | null;
  valid?: boolean;
}

export type CodeAgentActorKind = 'main' | 'test' | 'ops' | 'system' | 'readonly';

export type CodeAgentRunKind = 'main' | 'runtime_repair';

export type CodeAgentTimelineStage =
  | 'status'
  | 'preflight'
  | 'thinking'
  | 'output'
  | 'tool_call'
  | 'observation'
  | 'file_change'
  | 'validation'
  | 'verification'
  | 'summary'
  | 'error';

export interface CodeAgentTimelineEvent {
  eventId: string;
  runId: string;
  actorId: string;
  actorKind: CodeAgentActorKind;
  stage: CodeAgentTimelineStage;
  content: string;
  done: boolean;
  timestampMs: number;
  sequence: number;
  iteration?: number;
  mergeKey?: string;
  status?: string;
  metrics?: {
    charCount?: number;
    tokenCount?: number;
    durationMs?: number;
  };
  file?: CodeFileChange & { operation?: 'create' | 'modify' | 'delete' };
  metadata?: Record<string, unknown>;
}

export interface CodeFileChange {
  path: string;
  additions: number;
  deletions: number;
}

export interface CodeAgentRun {
  id: string;
  parentRunId?: string;
  resumedFromRunId?: string;
  runKind?: CodeAgentRunKind;
  supersededByRunId?: string;
  request: string;
  projectKind: 'frontend' | 'fullstack';
  createdAt: string;
  trace: CodeAgentTrace;
}

export interface AcceptanceAssertionResult {
  assertion: {
    kind: 'visible' | 'hidden' | 'text_contains' | 'count_gte' | 'console_contains'
      | 'forbidden_visible_text' | 'console_error' | 'page_error' | 'dom_unreadable'
      | 'enemy_snake_count_gte' | 'enemy_snake_position_changed'
      | 'player_body_length_growth' | 'enemy_body_segment_length_growth'
      | 'canvas_non_empty' | 'control_enabled' | 'observable_state_changed'
      | 'canvas_changed_after_tick';
    selector: string;
    expected: string;
    minimum: number;
  };
  passed: boolean;
  actual: unknown;
}

export interface AcceptanceVerificationAttempt {
  attempt: number;
  phase: 'planning' | 'browser';
  status: 'passed' | 'failed' | 'blocked' | 'retrying' | string;
  plan?: {
    summary: string;
    steps: Array<Record<string, unknown>>;
    assertions: Array<Record<string, unknown>>;
  };
  diagnostic?: string;
  passed?: boolean;
  blocked?: boolean;
  assertions?: AcceptanceAssertionResult[];
  deterministic_findings?: DeterministicBrowserFinding[];
}

export interface DeterministicBrowserFinding {
  kind: string;
  selector: string;
  expected: string;
  actual: unknown;
  message: string;
  repair_domain?: string;
  required_postconditions?: Array<Record<string, unknown>>;
  temporal_contract?: Record<string, unknown>;
}

export interface CodeAcceptanceReport {
  passed: boolean;
  blocked: boolean;
  /** AgentLoop lane that owns this verification report. */
  run_id?: string;
  verification_run_id?: string;
  verification_session_id?: string;
  verification_attempts?: AcceptanceVerificationAttempt[];
  attempt_count?: number;
  stage?: 'planning' | 'browser';
  diagnostic?: string;
  plan?: {
    summary: string;
    steps: Array<Record<string, unknown>>;
    assertions: Array<Record<string, unknown>>;
  };
  assertions?: AcceptanceAssertionResult[];
  console?: Array<{ level: string; text: string }>;
  network_failures?: Array<{ url: string; error: string }>;
  page_text?: string;
  runner_stderr?: string;
  // Why: runner_stdout 与 returncode 只在“结果标记未被写入或解析失败”的兜底分支中填充，
  // 方便前端 UI 展示给用户 Playwright 的实际 stderr/stdout，不必每次都翻后端日志。
  runner_stdout?: string;
  returncode?: number;
  model_output?: string;
  artifacts?: CodeFileChange[];
  deterministic?: boolean;
  deterministic_findings?: DeterministicBrowserFinding[];
  page_errors?: Array<{ type: string; text: string }>;
  acceptance_goal?: AcceptanceGoalContract;
  interaction_scenario?: Record<string, unknown>;
  goal_verified?: boolean;
  inconclusive?: boolean;
  proof_outcome?: 'verified' | 'contradicted' | 'inconclusive' | 'unverifiable' | 'invalid_test' | 'infra_failure' | string;
  outcome?: string;
  verification_status?: 'passed' | 'failed' | 'blocked' | 'inconclusive';
  goal_assertion_ids?: string[];
  /** Evidence produced by the autonomous, isolated Test Agent child. */
  test_agent_runs?: TestAgentRun[];
  test_agent?: TestAgentRun;
}

export interface TestAgentRun {
  status: 'passed' | 'failed' | 'blocked' | 'skipped';
  phase: 'precheck' | 'targeted_reproduction' | 'final_replay' | 'none' | string;
  should_run?: boolean;
  reason?: string;
  diagnostic?: string;
  idempotency_key?: string;
  artifact?: string;
  findings?: Array<Record<string, unknown>>;
  cached?: boolean;
  command?: string[] | string;
  stdout?: string;
  stderr?: string;
  returncode?: number;
  duration_ms?: number;
  timeout_seconds?: number;
  script_line_count?: number;
  artifact_revisions?: Array<{
    revision: number;
    parent_revision?: number | null;
    acceptance_id: string;
    reason: string;
    contract_changed: boolean;
    artifact: string;
  }>;
  duration_ms?: number;
  verification_session_id?: string;
  verification_session?: {
    verification_session_id: string;
    run_id: string;
    checkpoint_count: number;
    last_candidate_revision: string;
    obligations: Record<string, Record<string, unknown>>;
    test_runs: Array<Record<string, unknown>>;
  };
}

export interface ChatOptions {
  customAgents?: unknown[];
  discussionLength?: DiscussionLength;
  discussionAgentIds?: string[];
  discussionRounds?: number;
  sessionId?: string;
  runtimeSettings?: RuntimeSettings;
  attachments?: ChatAttachment[];
  omniTurnContext?: OmniTurnContext;
  providerOverride?: 'deepseek' | 'qwen' | 'glm' | 'minimax';
  maxTokensOverride?: number;
  thinkingBudgetOverride?: number;
}

export type CodeWorkbenchIntent = 'conversation' | 'action' | 'runtime_fix' | 'resume' | 'clarify';

export interface CodeIntentTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CodeIntentActiveRun {
  run_id: string;
  request?: string;
  phase?: string;
  status?: string;
  summary?: string;
  resume_eligible?: boolean;
  runtime_verification?: boolean;
  active_scope?: CodeTaskScope;
  scope_version?: number;
  allowed_next_action?: string;
  target_files?: string[];
  last_verification?: RuntimeVerificationEvidence;
  runtime_read_evidence?: Record<string, RuntimeReadEvidence>;
  acceptance_goal?: AcceptanceGoalContract;
  verification_session_id?: string;
}

export interface CodeWorkbenchIntentDecision {
  intent: CodeWorkbenchIntent;
  confidence: number;
  reason: string;
  can_mutate: boolean;
  route_id?: string | null;
  recommended_scope?: CodeTaskScope | 'inherit';
  active_scope?: CodeTaskScope;
  scope_version?: number;
  scope_source?: 'orchestrator' | 'inherited' | 'explicit';
  allowed_next_action?: string;
  resume_run_id?: string | null;
  acceptance_goal?: AcceptanceGoalContract | null;
  /** The router produced a trustworthy decision; false must not fall back to read-only. */
  route_available?: boolean;
}

/** Classify a Code workbench turn before dispatching any write-capable call. */
export async function classifyCodeWorkbenchIntent(
  message: string,
  input: {
    hasProject: boolean;
    hasUnfinishedRun: boolean;
    /** UI submission context only; the server still decides intent. */
    entrypoint?: 'rewrite';
    recentTurns?: CodeIntentTurn[];
    assistantReferences?: CodeIntentTurn[];
    activeRun?: CodeIntentActiveRun;
    resumeCandidates?: CodeIntentActiveRun[];
    projectKind?: 'frontend' | 'fullstack';
    activeScope?: CodeTaskScope;
    acceptanceGoal?: AcceptanceGoalContract;
    sessionId?: string;
  },
  signal?: AbortSignal,
): Promise<CodeWorkbenchIntentDecision> {
  const response = await fetch(`${API_BASE_URL}/api/code/intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      has_project: input.hasProject,
      has_unfinished_run: input.hasUnfinishedRun,
      entrypoint: input.entrypoint,
      recent_turns: input.recentTurns ?? [],
      assistant_references: input.assistantReferences ?? [],
      active_run: input.activeRun,
      resume_candidates: input.resumeCandidates ?? [],
      project_kind: input.projectKind ?? 'frontend',
      active_scope: input.activeScope,
      acceptance_goal: input.acceptanceGoal,
      session_id: input.sessionId,
    }),
    signal,
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<CodeWorkbenchIntentDecision>;
}

export interface SessionSummary {
  session_id: string;
  title: string;
  mode: ChatMode;
  created_at: number;
  updated_at: number;
}

export interface SessionSnapshot {
  messages: ChatMessage[];
  reasoningSteps: string[];
  webDocs: WebDoc[];
  researchChunks: ResearchChunk[];
  agentTalks: AgentTalkEvent[];
  planProgress: PlanProgressEvent | null;
  nodeProgress?: NodeEvent[];
  currentNode?: string | null;
  discussionLength: DiscussionLength;
  discussionAgentIds: string[];
  discussionRounds: number;
  webSearch?: CapabilityMode;
  deepThinking?: CapabilityMode;
  mcpMode?: McpMode;
  mcpServerIds?: string[];
  skillMode?: McpMode;
  skillIds?: number[];
  webSearchOptions?: WebSearchOptions;
  researchEngine?: ResearchEngine;
  researchOptions?: ResearchOptions;
  qwenNativeSearchOptions?: QwenNativeSearchOptions;
  generatedCode?: string;
  codeVersions?: Array<{
    versionId: string;
    timestamp: string;
    summary: string;
    vfs: Record<string, string>;
    fileCount: number;
  }>;
  activeCodeVersionId?: string;
  codeProjectKind?: 'frontend' | 'fullstack';
  codeAgentRuns?: CodeAgentRun[];
  writingDraft?: import('../features/ai-writing/writingTypes').WritingDraft;
  writingDocument?: import('../features/ai-writing/writingDocumentTypes').WritingDocumentState;
  thesisOutline?: import('../features/ai-writing/thesis/thesisTypes').ThesisOutlineState;
  musicDocument?: {
    title: string;
    lyrics: string;
    provider: 'deepseek' | 'qwen' | 'glm' | 'minimax';
    status: 'generating' | 'ready' | 'error';
  };
}

export interface SessionHistoryResponse {
  session: SessionSummary;
  snapshot: Partial<SessionSnapshot>;
}

// 深度调研专用事件
// Why: stage 字段扩展为字符串联合——Agent Loop 模式发射 `iteration_N_think/search/observe/final`，
//   旧链路仍发 `fanout/fetch/chunk/rerank/reason`，千问原生链路发 `planning/searching/analyzing/writing/complete`。
//   前端用 `parseIterationStage` 区分两种格式，千问阶段走 ResearchProgressPanel 的 QWEN_STAGE_CONFIG。
export type ResearchStage =
  | 'fanout'
  | 'fetch'
  | 'chunk'
  | 'rerank'
  | 'reason'
  | 'planning'      // 千问：反问确认/研究规划
  | 'searching'     // 千问：深度搜索
  | 'analyzing'     // 千问：分析整合
  | 'writing'       // 千问：撰写报告
  | 'complete'      // 千问：研究完成
  | `iteration_${number}_${AgentLoopStageKind}`;

export interface ResearchProcessEvent {
  stage: ResearchStage | string;
  status: 'running' | 'done';
  count?: number;
  message?: string;
  message_detail?: string | string[];
  // 各阶段数据
  queries?: string[];          // fanout: 生成的搜索词
  pages?: Array<{ title: string; url: string }>;  // fetch: 抓取的页面
  chunk_count?: number;        // chunk: 切片数量
  top_chunks?: ResearchChunk[]; // rerank: 精选片段
}

// Why: 解析 Agent Loop 模式的 `iteration_N_xxx` stage 字符串，
//   返回 { iteration, kind }；非该格式返回 null（旧 fanout/fetch/... 链路走兜底）。
const ITERATION_STAGE_RE = /^iteration_(\d+)_(think|search|observe|final)$/;

export function parseIterationStage(stage: string): { iteration: number; kind: AgentLoopStageKind } | null {
  const m = ITERATION_STAGE_RE.exec(stage);
  if (!m) return null;
  return { iteration: Number(m[1]), kind: m[2] as AgentLoopStageKind };
}

// Why: Agent Loop stage kind → 面板 node_name 映射，与旧 STAGE_NODE_MAP 共存。
//   旧链路用 fanout/fetch/chunk/rerank/reason 直接映射，新链路按 kind 映射。
const STAGE_NODE_MAP: Record<string, string> = {
  fanout: 'Fanout',
  fetch: 'WebSearch',
  chunk: 'Chunker',
  rerank: 'Reranker',
  reason: 'DeepThinker',
  think: 'Think',
  search: 'Search',
  observe: 'Observe',
  final: 'FinalAnswer',
};

export interface ResearchDoneEvent {
  total_pages: number;
  total_chunks: number;
  top_chunks: unknown[];
  report?: string;
  reasoning?: string;
}

// R1 推理完成事件（流式内容）
export interface ResearchReasonDoneEvent {
  reasoning: string;
  report: string;
  reasoning_time: number;
}

// 深度调研精选片段类型
export interface ResearchChunk {
  id: number;
  title: string;
  url: string;
  score: number;
  text: string;
}

export type ResearchFigureStatus = 'queued' | 'generating' | 'succeeded' | 'failed';
export type ResearchFigurePolicy = 'economy' | 'balanced' | 'quality';

export interface ResearchFigure {
  id: string;
  job_id: string;
  ordinal: number;
  batch_index?: number;
  batch_title?: string | null;
  section_title: string;
  figure_type: string;
  caption: string;
  context_before?: string;
  context_after?: string | null;
  status: ResearchFigureStatus;
  model?: string | null;
  asset_id?: string | null;
  image_url?: string | null;
  error_message?: string | null;
}

export interface ResearchFigureBatch {
  batch_index: number;
  title: string;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  status: 'queued' | 'generating' | 'succeeded' | 'failed';
}

export interface ResearchFigureJob {
  id: string;
  session_id?: string | null;
  report_version: string;
  policy: ResearchFigurePolicy;
  max_images: number;
  context_mode: 'preceding' | 'mixed';
  status: 'queued' | 'generating' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  completed_batches?: number;
  total_batches?: number;
  batches?: ResearchFigureBatch[];
  error_message?: string | null;
  figures: ResearchFigure[];
}

export async function createResearchFigureJob(input: {
  session_id?: string;
  report_version: string;
  report: string;
  max_images?: number;
  policy?: ResearchFigurePolicy;
  context_mode?: 'preceding' | 'mixed';
}): Promise<ResearchFigureJob> {
  const response = await fetch(`${API_BASE_URL}/api/research/figures/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<ResearchFigureJob>;
}

export async function getResearchFigureJob(jobId: string): Promise<ResearchFigureJob> {
  const response = await fetch(`${API_BASE_URL}/api/research/figures/jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<ResearchFigureJob>;
}

export async function cancelResearchFigureJob(jobId: string): Promise<ResearchFigureJob> {
  const response = await fetch(`${API_BASE_URL}/api/research/figures/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<ResearchFigureJob>;
}

export async function retryResearchFigure(figureId: string): Promise<ResearchFigureJob> {
  const response = await fetch(`${API_BASE_URL}/api/research/figures/${encodeURIComponent(figureId)}/retry`, { method: 'POST' });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<ResearchFigureJob>;
}

// ==========================================
// 回调类型
// ==========================================

type ChatHandlers = {
  onStreamStarted?: (event: { mode?: string; message?: string }) => void;
  onNode?: (event: NodeEvent) => void;
  onReasoning?: (event: ReasoningEvent) => void;
  onWebDocs?: (event: WebDocsEvent) => void;
  onDone?: (event: DoneEvent) => void;
  onUsage?: (usage: TokenUsage) => void;
  onError?: (event: ErrorEvent) => void;
  // 多智能体专用
  onAgentTalk?: (event: AgentTalkEvent) => void;
  onAgentDelta?: (event: AgentDeltaEvent) => void;
  onAgentPhase?: (event: { stream_id: string; actor: string; status: 'started' | 'completed' }) => void;
  onAgentFinalAnswer?: (event: AgentFinalAnswerEvent) => void;
  onSystemStatus?: (event: SystemStatusEvent) => void;
  onPlanProgress?: (event: PlanProgressEvent) => void;
  onPlanEvent?: (event: PlanRuntimeEvent) => void;
  onToken?: (token: string) => void;
  onReasoningDelta?: (token: string) => void;
  // MCP 工具调用可观测性
  onMcpEvent?: (event: McpEvent) => void;
  // Why: Skill 命中注入反馈——UI 显示"🧠 已加载技能：xxx"提示条
  onSkillMatched?: (event: SkillMatchedEvent) => void;
};

type ResearchHandlers = {
  onUsage?: (usage: TokenUsage) => void;
  // Why: 千问原生调研 answer 阶段后端逐 chunk 推 token，此前解析层无分支静默丢弃。
  onToken?: (token: string) => void;
  // All research engines may expose reasoning before the final report. Keep
  // it on the same live pacing channel as ordinary chat.
  onReasoningDelta?: (token: string) => void;
  onResearchProcess?: (event: ResearchProcessEvent) => void;
  onResearchReasonDone?: (event: ResearchReasonDoneEvent) => void;
  onResearchDone?: (event: ResearchDoneEvent) => void;
  onWebDocs?: (event: WebDocsEvent) => void;
  onError?: (event: ErrorEvent) => void;
  // Why: 调研模式复用 NodeProgressPanel 链路面板，把 research_process 翻译成 NodeEvent 推入同一栈，
  //   不再单独渲染 ResearchProgressPanel；刷新/重启后从 SessionSnapshot.nodeProgress 恢复。
  onNode?: (event: NodeEvent) => void;
  // Why: 千问深度调研反问确认事件——模型提出澄清问题，等待用户回答后继续研究
  onQwenFeedback?: (event: { question: string; status: string }) => void;
};

// ==========================================
// 普通聊天（standard / deep / web）
// ==========================================

export async function sendChatMessage(
  message: string,
  mode: ChatMode,
  handlers: ChatHandlers,
  options: ChatOptions = {},
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      mode,
      custom_agents: options.customAgents,
      discussion_length: options.discussionLength,
      discussion_agent_ids: options.discussionAgentIds,
      discussion_rounds: options.discussionRounds,
      session_id: options.sessionId,
      runtime_settings: options.runtimeSettings
        ? {
            response_length: options.runtimeSettings.responseLength,
            web_search: options.runtimeSettings.webSearch,
            deep_thinking: options.runtimeSettings.deepThinking,
            discussion_rounds: options.runtimeSettings.discussionRounds,
            mcp_mode: options.runtimeSettings.mcpMode,
            mcp_server_ids: options.runtimeSettings.mcpServerIds,
            skill_mode: options.runtimeSettings.skillMode,
            skill_ids: options.runtimeSettings.skillIds,
            web_search_options: {
              limit: options.runtimeSettings.webSearchOptions.limit,
              time_range: options.runtimeSettings.webSearchOptions.timeRange,
              location: options.runtimeSettings.webSearchOptions.location,
              scrape_top_n: options.runtimeSettings.webSearchOptions.scrapeTopN,
              highlights: options.runtimeSettings.webSearchOptions.highlights,
            },
            qwen_native_search_options: {
              search_strategy: options.runtimeSettings.qwenNativeSearchOptions.searchStrategy,
              forced_search: options.runtimeSettings.qwenNativeSearchOptions.forcedSearch,
              enable_search_extension: options.runtimeSettings.qwenNativeSearchOptions.enableSearchExtension,
              freshness: options.runtimeSettings.qwenNativeSearchOptions.freshness,
              assigned_site_list: options.runtimeSettings.qwenNativeSearchOptions.assignedSiteList,
              prompt_intervene: options.runtimeSettings.qwenNativeSearchOptions.promptIntervene,
            },
          }
        : undefined,
      attachments: options.attachments,
      omni_context: options.omniTurnContext,
      provider_override: options.providerOverride,
      max_tokens_override: options.maxTokensOverride,
      thinking_budget_override: options.thinkingBudgetOverride,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEventName = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (!data) continue;

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;

          // Why: usage 消费统一由下方第二个 usage 块负责（其 continue 条件为
          // parsed.answer === undefined，不会吞掉携带答案的 done 事件）。
          // 此处曾有一个重复的 usage 守卫，条件 stage === undefined 会把
          // DeepSeek 链路带 usage 的 done 事件整个跳过，导致答案不渲染。

          // Why: skill_matched 事件字段（命中 + 摘要注入边界）
          // 不与聊天流其它事件字段冲突，但放最前用 type 显式判断更清晰、防误匹配。
          if (parsed.type === 'skill_matched') {
            handlers.onSkillMatched?.({
              type: 'skill_matched',
              skill_id: parsed.skill_id != null ? Number(parsed.skill_id) : undefined,
              skill_name: String(parsed.skill_name ?? ''),
              skill_type: String(parsed.skill_type ?? 'instruction') as SkillMatchedEvent['skill_type'],
              confidence: Number(parsed.confidence) || 0,
              injected: parsed.injected === true,
              injection_mode: parsed.injection_mode === 'full' || parsed.injection_mode === 'on_demand'
                ? parsed.injection_mode
                : 'summary',
              injected_step_count: parsed.injected_step_count != null
                ? Number(parsed.injected_step_count)
                : undefined,
              injected_validation_count: parsed.injected_validation_count != null
                ? Number(parsed.injected_validation_count)
                : undefined,
              standard_steps: Array.isArray(parsed.standard_steps)
                ? (parsed.standard_steps as string[]).map(String)
                : [],
              done: true,
            });
            continue;
          }

          if (currentEventName === 'stream_started' || parsed.type === 'stream_started') {
            handlers.onStreamStarted?.({
              mode: parsed.mode != null ? String(parsed.mode) : undefined,
              message: parsed.message != null ? String(parsed.message) : undefined,
            });
            continue;
          }

          if (currentEventName === 'reasoning_delta' || parsed.type === 'reasoning_delta') {
            const delta = parsed.reasoning_delta ?? parsed.delta;
            if (delta !== undefined) handlers.onReasoningDelta?.(String(delta));
            continue;
          }

          if (currentEventName === 'agent_delta' || parsed.type === 'agent_delta') {
            if (parsed.stream_id != null && parsed.delta != null) {
              handlers.onAgentDelta?.({
                stream_id: String(parsed.stream_id),
                actor: String(parsed.actor ?? ''),
                kind: parsed.kind === 'reasoning' ? 'reasoning' : 'token',
                delta: String(parsed.delta),
              });
            }
            continue;
          }

          if (currentEventName === 'agent_phase' || parsed.type === 'agent_phase') {
            if (parsed.stream_id != null) {
              handlers.onAgentPhase?.({
                stream_id: String(parsed.stream_id),
                actor: String(parsed.actor ?? ''),
                status: parsed.status === 'completed' ? 'completed' : 'started',
              });
            }
            continue;
          }

          const planRuntimeTypes = new Set([
            'search_started',
            'search_completed',
            'task_started',
            'task_delta',
            'task_completed',
            'report_delta',
          ]);
          if (typeof parsed.type === 'string' && planRuntimeTypes.has(parsed.type)) {
            handlers.onPlanEvent?.(parsed as unknown as PlanRuntimeEvent);
            continue;
          }

          if (parsed.usage && typeof parsed.usage === 'object') {
            handlers.onUsage?.(parsed.usage as TokenUsage);
            // Usage is also included in done events where available; do not let it
            // fall through to the generic status handlers.
            if (parsed.type === 'token_usage' || parsed.answer === undefined) continue;
          }

          if (parsed.token !== undefined) {
            handlers.onToken?.(String(parsed.token));
          } else if (parsed.reasoning_delta !== undefined) {
            handlers.onReasoningDelta?.(String(parsed.reasoning_delta));
          } else if (
            (currentEventName === 'plan_update' || parsed.type === 'plan_update' || parsed.event === 'plan_update' || Boolean(parsed.phase))
            && Array.isArray(parsed.tasks)
          ) {
            handlers.onPlanProgress?.({
              phase: String(parsed.phase) as PlanProgressEvent['phase'],
              tasks: parsed.tasks as PlanTask[],
              current_task_id: parsed.current_task_id == null
                ? null
                : Number(parsed.current_task_id),
              iteration: Number(parsed.iteration) || 0,
              message: parsed.message ? String(parsed.message) : undefined,
              active_task_ids: Array.isArray(parsed.active_task_ids)
                ? parsed.active_task_ids.map((value) => Number(value))
                : undefined,
            });
          } else if (parsed.node_name) {
            const knownKeys = new Set([
              'node_name',
              'status',
              'message',
              'timestamp_ms',
              'provider',
              'hit_count',
              'kept_count',
              'scrape_count',
              'fatal_error',
              'use_fallback',
              'fallback_reason',
              'answer_len',
              'reasoning_len',
              'docs_count',
              'native_search',
              'thinking',
              'wants_web',
              'use_deep',
            ]);
            const extras: Record<string, unknown> = {};
            for (const key of Object.keys(parsed)) {
              if (!knownKeys.has(key)) extras[key] = parsed[key];
            }
            handlers.onNode?.({
              node_name: String(parsed.node_name),
              status: String(parsed.status) as 'processing' | 'completed',
              message: parsed.message ? String(parsed.message) : undefined,
              timestamp_ms: parsed.timestamp_ms != null ? Number(parsed.timestamp_ms) : undefined,
              provider: parsed.provider != null ? String(parsed.provider) : undefined,
              hit_count: parsed.hit_count != null ? Number(parsed.hit_count) : undefined,
              kept_count: parsed.kept_count != null ? Number(parsed.kept_count) : undefined,
              scrape_count: parsed.scrape_count != null ? Number(parsed.scrape_count) : undefined,
              fatal_error: parsed.fatal_error != null ? String(parsed.fatal_error) : undefined,
              use_fallback: parsed.use_fallback == null ? undefined : Boolean(parsed.use_fallback),
              fallback_reason: parsed.fallback_reason != null ? String(parsed.fallback_reason) : undefined,
              answer_len: parsed.answer_len != null ? Number(parsed.answer_len) : undefined,
              reasoning_len: parsed.reasoning_len != null ? Number(parsed.reasoning_len) : undefined,
              docs_count: parsed.docs_count != null ? Number(parsed.docs_count) : undefined,
              native_search: parsed.native_search == null ? undefined : Boolean(parsed.native_search),
              thinking: parsed.thinking == null ? undefined : Boolean(parsed.thinking),
              wants_web: parsed.wants_web == null ? undefined : Boolean(parsed.wants_web),
              use_deep: parsed.use_deep == null ? undefined : Boolean(parsed.use_deep),
              extras: Object.keys(extras).length ? extras : undefined,
            });
            // Why：同一个 HTTP chunk 里可能塞了多个 node 事件，React 18 会在同步循环里
            // 把所有 setState 批量提交成一次渲染，导致"一下子全蹦出来"。
            // 每次 node 事件之间强制让出 50ms，确保浏览器有机会逐帧绘制。
            await new Promise((resolve) => setTimeout(resolve, 50));
          } else if (parsed.reasoning !== undefined) {
            handlers.onReasoning?.({ reasoning: String(parsed.reasoning) });
          } else if (parsed.docs !== undefined && parsed.count !== undefined) {
            handlers.onWebDocs?.({
              docs: parsed.docs as WebDoc[],
              count: Number(parsed.count),
            });
          } else if (parsed.mcp_phase !== undefined || parsed.mcp_tool_call !== undefined || parsed.mcp_tool_result !== undefined) {
            // MCP 预检轮事件
            if (parsed.mcp_tool_call !== undefined) {
              handlers.onMcpEvent?.({
                phase: 'tool_call',
                tool_name: String(parsed.mcp_tool_call),
                args: (parsed.args ?? {}) as Record<string, unknown>,
              });
            } else if (parsed.mcp_tool_result !== undefined) {
              handlers.onMcpEvent?.({
                phase: 'tool_result',
                tool_name: String(parsed.mcp_tool_result),
                ok: Boolean(parsed.ok),
                preview: String(parsed.preview ?? ''),
              });
            } else {
              handlers.onMcpEvent?.({
                phase: String(parsed.mcp_phase) as McpPhaseEvent['phase'],
                available: parsed.available != null ? Number(parsed.available) : undefined,
                tool_count: parsed.tool_count != null ? Number(parsed.tool_count) : undefined,
              });
            }
          } else if (parsed.answer !== undefined && parsed.handled_by !== undefined) {
            handlers.onAgentFinalAnswer?.({
              answer: String(parsed.answer),
              handled_by: String(parsed.handled_by),
            });
          } else if (parsed.answer !== undefined) {
            handlers.onDone?.({
              answer: String(parsed.answer),
              reasoning_steps: Number(parsed.reasoning_steps) || 0,
              mode: String(parsed.mode) || 'standard',
              web_docs: parsed.web_docs as WebDoc[] | undefined,
              usage: parsed.usage as TokenUsage | undefined,
            });
          } else if (parsed.from_agent && parsed.to_agent && parsed.action) {
            // 多智能体 agent_talk 事件
            handlers.onAgentTalk?.({
              from_agent: String(parsed.from_agent),
              to_agent: String(parsed.to_agent),
              action: String(parsed.action),
              content: parsed.content ? String(parsed.content) : undefined,
              timestamp: Number(parsed.timestamp) || 0,
            });
          } else if (parsed.answer !== undefined && parsed.handled_by !== undefined) {
            // 多智能体 final_answer 事件
            handlers.onAgentFinalAnswer?.({
              answer: String(parsed.answer),
              handled_by: String(parsed.handled_by),
            });
          } else if (parsed.status === 'success' && parsed.mode === 'agent') {
            handlers.onDone?.({
              answer: '',
              reasoning_steps: 0,
              mode: 'agent',
              usage: parsed.usage as TokenUsage | undefined,
            });
          } else if (currentEventName === 'error' || parsed.error) {
            // Provider failures use `event: error` with a top-level
            // message/code payload. Check the SSE event name before the
            // generic status branch so a 401 cannot be silently ignored.
            handlers.onError?.({ message: String(parsed.message || parsed.error || '请求失败') });
          } else if (parsed.message) {
            handlers.onSystemStatus?.({ message: String(parsed.message) });
          }
        } catch (e) {
          console.error('Failed to parse SSE data:', e);
        }
      }
    }
  }
}

// ==========================================
// 深度调研（Query Fan-out → 抓取 → 切片 → Rerank）
// ==========================================

// 调研引擎选择：firecrawl（Deep Research API 异步任务）/ self-built（自研 day32+day33）/ qwen（千问原生深度研究）
export type ResearchEngine = 'firecrawl' | 'self-built' | 'qwen' | 'minimax';

// Firecrawl Deep Research 参数（用户可控）
export interface ResearchOptions {
  maxDepth: number;    // 1-12，研究迭代深度
  timeLimit: number;   // 30-600，时间限制（秒）
  maxUrls: number;     // 1-1000，最大分析 URL 数
  enable_feedback?: boolean;  // 千问深度调研：是否启用反问确认
  feedback_question?: string; // 千问深度调研 Step 2：模型反问内容（由 Step 1 回传）
  feedback_answer?: string;   // 千问深度调研 Step 2：用户回答
}

export const DEFAULT_RESEARCH_OPTIONS: ResearchOptions = {
  maxDepth: 7,
  timeLimit: 300,
  maxUrls: 20,
  enable_feedback: false,
};

export async function sendDeepResearch(
  query: string,
  handlers: ResearchHandlers,
  sessionId?: string,
  runtimeSettings?: RuntimeSettings,
  researchEngine: ResearchEngine = 'firecrawl',
  researchOptions?: ResearchOptions,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/deep_research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: query,
      mode: 'research',
      session_id: sessionId,
      research_engine: researchEngine,
      research_options: researchOptions
        ? {
            maxDepth: researchOptions.maxDepth,
            timeLimit: researchOptions.timeLimit,
            maxUrls: researchOptions.maxUrls,
            enable_feedback: researchOptions.enable_feedback,
            feedback_question: researchOptions.feedback_question,
            feedback_answer: researchOptions.feedback_answer,
          }
        : undefined,
      runtime_settings: runtimeSettings
        ? {
            response_length: runtimeSettings.responseLength,
            web_search: runtimeSettings.webSearch,
            deep_thinking: runtimeSettings.deepThinking,
            discussion_rounds: runtimeSettings.discussionRounds,
            mcp_mode: runtimeSettings.mcpMode,
            mcp_server_ids: runtimeSettings.mcpServerIds,
            skill_mode: runtimeSettings.skillMode,
            skill_ids: runtimeSettings.skillIds,
            web_search_options: {
              limit: runtimeSettings.webSearchOptions.limit,
              time_range: runtimeSettings.webSearchOptions.timeRange,
              location: runtimeSettings.webSearchOptions.location,
              scrape_top_n: runtimeSettings.webSearchOptions.scrapeTopN,
              highlights: runtimeSettings.webSearchOptions.highlights,
            },
            qwen_native_search_options: {
              search_strategy: runtimeSettings.qwenNativeSearchOptions.searchStrategy,
              forced_search: runtimeSettings.qwenNativeSearchOptions.forcedSearch,
              enable_search_extension: runtimeSettings.qwenNativeSearchOptions.enableSearchExtension,
              freshness: runtimeSettings.qwenNativeSearchOptions.freshness,
              assigned_site_list: runtimeSettings.qwenNativeSearchOptions.assignedSiteList,
              prompt_intervene: runtimeSettings.qwenNativeSearchOptions.promptIntervene,
            },
          }
        : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) continue;
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim();
        if (!data) continue;

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;

          // 各阶段进度事件
          if (parsed.stage && parsed.status) {
            const stage = String(parsed.stage) as ResearchProcessEvent['stage'];
            const status = String(parsed.status) as 'running' | 'done';
            handlers.onResearchProcess?.({
              stage,
              status,
              message: parsed.message ? String(parsed.message) : undefined,
              message_detail: parsed.message_detail as string | string[] | undefined,
              queries: parsed.queries as string[] | undefined,
              pages: parsed.pages as Array<{ title: string; url: string }> | undefined,
              chunk_count: parsed.chunk_count !== undefined ? Number(parsed.chunk_count) : undefined,
              top_chunks: parsed.top_chunks as ResearchProcessEvent['top_chunks'],
            });
            // Why: 把 research_process 翻译成 NodeEvent 推入同一 nodeProgress 栈，
            //   让调研模式复用 NodeProgressPanel 链路面板（可伸缩、紧挨头像下方、持久化）。
            //   stage → node_name 映射对齐后端调研阶段语义，让面板显示"[Node: Fanout]"等可读标签。
            //   Agent Loop 模式 stage 为 `iteration_N_think/search/observe/final`，解析出 iteration+kind
            //   并写入 NodeEvent.iteration/stageKind，让面板按轮次分组渲染。
            const parsedIter = parseIterationStage(stage);
            let nodeName: string;
            let iteration: number | undefined;
            let stageKind: AgentLoopStageKind | undefined;
            if (parsedIter) {
              nodeName = STAGE_NODE_MAP[parsedIter.kind] ?? parsedIter.kind;
              iteration = parsedIter.iteration;
              stageKind = parsedIter.kind;
            } else {
              nodeName = STAGE_NODE_MAP[stage] ?? stage;
            }
            const isDone = status === 'done';
            // Why: hit_count/kept_count 从 fetch/rerank 阶段抽出，让面板标题显示"阅读了 X 个网页"
            //   Agent Loop 模式下 search/observe 也可能携带 count，按 stageKind 兜底。
            const hitCount =
              stage === 'fetch' && parsed.count != null ? Number(parsed.count) :
              stage === 'rerank' && parsed.count != null ? Number(parsed.count) :
              (stageKind === 'search' || stageKind === 'observe') && parsed.count != null ? Number(parsed.count) : undefined;
            const keptCount =
              stage === 'rerank' && parsed.top_chunks != null
                ? Array.isArray(parsed.top_chunks) ? parsed.top_chunks.length : undefined
                : undefined;
            const extras: Record<string, unknown> = {
              stage,
              queries: parsed.queries,
              pages: parsed.pages,
              chunk_count: parsed.chunk_count,
              top_chunks: parsed.top_chunks,
              message_detail: parsed.message_detail,
            };
            // Why: Agent Loop extras 字段透传——iteration/tool_name/tool_input/observation_summary/thought_snippet
            //   全部下沉到 extras，面板按需读取展示工具调用细节与可展开的思考片段。
            if (parsed.tool_name !== undefined) extras.tool_name = String(parsed.tool_name);
            if (parsed.tool_input !== undefined) extras.tool_input = parsed.tool_input;
            if (parsed.observation_summary !== undefined) extras.observation_summary = String(parsed.observation_summary);
            if (parsed.thought_snippet !== undefined) extras.thought_snippet = String(parsed.thought_snippet);
            if (parsed.hit_count !== undefined) extras.hit_count = Number(parsed.hit_count);
            if (parsed.kept_count !== undefined) extras.kept_count = Number(parsed.kept_count);
            if (parsed.iteration !== undefined) extras.iteration = Number(parsed.iteration);
            if (stage === 'reason' && isDone) {
              // Why: 后端把 reasoning 全文直接塞在 research_process stage=reason done 同一条 payload 里，
              //   避免 research_reason_done 再追加一条重复的 completed 事件导致"有 reasoning 的那条被淹没、界面看到的是后面那条没内容的"。
              if (parsed.reasoning_full !== undefined) extras.reasoning_full = parsed.reasoning_full;
              if (parsed.reasoning_time !== undefined) extras.reasoning_time = parsed.reasoning_time;
            }
            // Why: Agent Loop 终止阶段——把 final_answer 全文塞进 extras，让面板可展开查看。
            if (stageKind === 'final' && isDone) {
              if (parsed.answer !== undefined) extras.answer = String(parsed.answer);
              if (parsed.reasoning !== undefined) extras.reasoning_full = String(parsed.reasoning);
            }
            handlers.onNode?.({
              node_name: nodeName,
              status: isDone ? 'completed' : 'processing',
              message: parsed.message ? String(parsed.message) : undefined,
              timestamp_ms: Date.now(),
              hit_count: hitCount,
              kept_count: keptCount,
              reasoning_len: parsed.reasoning_len !== undefined ? Number(parsed.reasoning_len) : undefined,
              answer_len: parsed.answer_len !== undefined ? Number(parsed.answer_len) : undefined,
              iteration,
              stageKind,
              extras: Object.keys(extras).length ? extras : undefined,
            });
            // Why: 同一个 HTTP chunk 可能塞多个事件，强制让出 50ms 让浏览器逐帧绘制
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          // 千问原生调研搜索结果。count 对旧后端为可选，避免来源因协议小差异被丢弃。
          else if (Array.isArray(parsed.docs)) {
            handlers.onWebDocs?.({
              docs: parsed.docs as WebDoc[],
              count: parsed.count !== undefined ? Number(parsed.count) : parsed.docs.length,
            });
          }
          // Agent Loop / self-built engines expose reasoning as independent
          // SSE deltas while the final report is still being generated.
          else if (parsed.reasoning_delta !== undefined) {
            handlers.onReasoningDelta?.(String(parsed.reasoning_delta));
          }
          // 千问原生调研报告流式 token（answer 阶段逐 chunk）。
          else if (typeof parsed.token === 'string') {
            handlers.onToken?.(parsed.token);
          }
          // R1 推理完成事件
          else if (parsed.reasoning !== undefined) {
            const reasoningText = String(parsed.reasoning);
            const reportText = String(parsed.report);
            const reasoningTime = Number(parsed.reasoning_time) || 0;
            handlers.onResearchReasonDone?.({
              reasoning: reasoningText,
              report: reportText,
              reasoning_time: reasoningTime,
            });
            // Why: 千问 qwen-deep-research 不暴露 reasoning 字段（reasoning="" + time=0），
            //   此时跳过 DeepThinker 节点创建，避免面板显示"R1 深度思考完成（0字, 0s）"。
            //   GLM/DeepSeek 自研链路有真实 reasoning 内容，正常创建节点。
            if (reasoningText.length > 0 || reasoningTime > 0) {
              const reasoningLen = reasoningText.length;
              const answerLen = reportText.length;
              handlers.onNode?.({
                node_name: 'DeepThinker',
                status: 'completed',
                message: `🧠 R1 深度思考完成（${reasoningLen}字, ${reasoningTime}s）`,
                timestamp_ms: Date.now(),
                reasoning_len: reasoningLen,
                answer_len: answerLen,
                extras: {
                  reasoning_time: reasoningTime,
                  reasoning_full: reasoningText,
                },
              });
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          // 调研完成事件
          else if (parsed.total_pages !== undefined) {
            handlers.onResearchDone?.({
              total_pages: Number(parsed.total_pages) || 0,
              total_chunks: Number(parsed.total_chunks) || 0,
              top_chunks: (parsed.top_chunks as unknown[]) || [],
              report: parsed.report ? String(parsed.report) : undefined,
              reasoning: parsed.reasoning ? String(parsed.reasoning) : undefined,
            });
          }
          // 千问反问确认事件
          else if (parsed.question !== undefined && parsed.status !== undefined) {
            handlers.onQwenFeedback?.({
              question: String(parsed.question),
              status: String(parsed.status),
            });
          }
          // 错误事件
          else if (parsed.message) {
            handlers.onError?.({ message: String(parsed.message) });
          }
        } catch (e) {
          console.error('Failed to parse SSE data:', e);
        }
      }
    }
  }
}

// Why: code 系列请求共享的 meta。Fullstack 的各个 AgentLoop 入口都显式携带
// MCP 会话策略，避免 generate/modify/fix 在后端走出不同的工具边界。
export interface CodeRequestMeta {
  workspace_id?: string;
  run_id?: string;
  session_id?: string;
  mcp_mode?: McpMode;
  mcp_server_ids?: string[];
  intent?: 'action' | 'runtime_fix' | 'resume';
  resume?: boolean;
  intent_route_id?: string;
  recent_turns?: CodeIntentTurn[];
  assistant_references?: CodeIntentTurn[];
  active_run?: CodeIntentActiveRun;
  active_scope?: CodeTaskScope;
  runtime_evidence?: RuntimeVerificationEvidence;
  acceptance_goal?: AcceptanceGoalContract;
  verification_session_id?: string;
}

export async function postSandboxCommandResult(input: {
  runId: string;
  requestId: string;
  ok: boolean;
  value?: string;
  error?: string;
}): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/code/sandbox/command-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      run_id: input.runId,
      request_id: input.requestId,
      ok: input.ok,
      value: input.value ?? '',
      error: input.error ?? '',
    }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function readCodeWorkbench(
  body: {
    message: string;
    vfs: Record<string, string>;
    project_kind: 'frontend' | 'fullstack';
    recent_turns?: CodeIntentTurn[];
    assistant_references?: CodeIntentTurn[];
    session_id?: string;
  },
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamCodeRequest('/api/code/read-only', body, onEvent, signal);
}

function applyCodeRequestMeta(base: Record<string, unknown>, meta?: CodeRequestMeta): void {
  if (meta?.workspace_id) base.workspace_id = meta.workspace_id;
  if (meta?.run_id) base.run_id = meta.run_id;
  if (meta?.session_id) base.session_id = meta.session_id;
  if (meta?.mcp_mode) base.mcp_mode = meta.mcp_mode;
  if (meta?.mcp_server_ids) base.mcp_server_ids = meta.mcp_server_ids;
  if (meta?.intent) base.intent = meta.intent;
  if (meta?.resume !== undefined) base.resume = meta.resume;
  if (meta?.intent_route_id) base.intent_route_id = meta.intent_route_id;
  if (meta?.recent_turns) base.recent_turns = meta.recent_turns;
  if (meta?.assistant_references) base.assistant_references = meta.assistant_references;
  if (meta?.active_run) base.active_run = meta.active_run;
  if (meta?.active_scope) base.active_scope = meta.active_scope;
  if (meta?.runtime_evidence) base.runtime_evidence = meta.runtime_evidence;
  if (meta?.acceptance_goal) base.acceptance_goal = meta.acceptance_goal;
  if (meta?.verification_session_id) base.verification_session_id = meta.verification_session_id;
}

export async function generateWebCode(
  prompt: string,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  attachments: ChatAttachment[] = [],
  meta?: CodeRequestMeta,
): Promise<void> {
  const base: Record<string, unknown> = { prompt };
  if (attachments.length) base.attachments = attachments;
  applyCodeRequestMeta(base, meta);
  return streamCodeRequest('/api/code/generate', base, onEvent, signal);
}

export async function fixWebCode(
  code: string,
  error: string,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  meta?: CodeRequestMeta,
): Promise<void> {
  const base: Record<string, unknown> = { code, error };
  applyCodeRequestMeta(base, meta);
  return streamCodeRequest('/api/code/fix', base, onEvent, signal);
}

export async function modifyWebCode(
  code: string,
  instruction: string,
  targetElement: {
    selector: string;
    tag_name: string;
    class_name: string;
    element_id: string;
    outer_html: string;
  } | null,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  diagnostics = '',
  attachments: ChatAttachment[] = [],
  meta?: CodeRequestMeta,
): Promise<void> {
  const base: Record<string, unknown> = targetElement
    ? { code, instruction, target_element: targetElement, diagnostics }
    : { code, instruction, diagnostics };
  if (attachments.length) base.attachments = attachments;
  applyCodeRequestMeta(base, meta);
  return streamCodeRequest('/api/code/modify', base, onEvent, signal);
}

export async function generateFullstackCode(
  prompt: string,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  attachments: ChatAttachment[] = [],
  meta?: CodeRequestMeta,
): Promise<void> {
  const base: Record<string, unknown> = { prompt };
  if (attachments.length) base.attachments = attachments;
  applyCodeRequestMeta(base, meta);
  return streamCodeRequest('/api/code/fullstack/generate', base, onEvent, signal);
}

export async function modifyFullstackCode(
  vfs: Record<string, string>,
  instruction: string,
  targetElement: {
    selector: string;
    tag_name: string;
    class_name: string;
    element_id: string;
    outer_html: string;
  } | null,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  diagnostics = '',
  attachments: ChatAttachment[] = [],
  meta?: CodeRequestMeta,
  // Why: Day57 @file 剪枝——前端把用户 @ 的文件清单传给后端,
  // 后端仅向模型注入这些文件的全量源码,其余文件用路径占位符替换以降低 Token。
  mentionedFiles: string[] = [],
): Promise<void> {
  const base: Record<string, unknown> = targetElement
    ? { vfs, instruction, target_element: targetElement, diagnostics }
    : { vfs, instruction, diagnostics };
  if (attachments.length) base.attachments = attachments;
  if (mentionedFiles.length) base.mentioned_files = mentionedFiles;
  applyCodeRequestMeta(base, meta);
  return streamCodeRequest('/api/code/fullstack/modify', base, onEvent, signal);
}

export async function verifyFullstackRuntime(
  body: {
    run_id: string;
    base_revision: string;
    candidate_revision: string;
    boot_completed: boolean;
    deterministic_verifier_passed: boolean;
    goal_verified?: boolean;
    verification_inconclusive?: boolean;
    proof_outcome?: string;
    goal_assertion_ids?: string[];
    deterministic_findings?: DeterministicBrowserFinding[];
    console_entries: Array<{
      level: 'log' | 'info' | 'warn' | 'error';
      text: string;
      source?: string;
      line?: number;
      column?: number;
      stack?: string;
    }>;
    target_error?: RuntimeTargetError;
    changed_files?: string[];
    diff_summary?: string;
  },
  signal?: AbortSignal,
): Promise<RuntimeVerificationResponse> {
  const response = await fetch(`${API_BASE_URL}/api/code/fullstack/runtime-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<RuntimeVerificationResponse>;
}

/**
 * Recover only the missing durable events for a run. This endpoint is
 * read-only: reconnecting never resubmits the mutation-producing POST.
 */
export async function replayCodeEvents(
  runId: string,
  afterSequence: number,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
): Promise<number> {
  const query = new URLSearchParams({ after: String(Math.max(0, afterSequence)) });
  const response = await fetch(
    `${API_BASE_URL}/api/code/events/${encodeURIComponent(runId)}?${query.toString()}`,
    { headers: { Accept: 'text/event-stream' }, signal },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  const reader = response.body?.getReader();
  if (!reader) throw new Error('代码事件重放响应为空。');

  const decoder = new TextDecoder();
  let buffer = '';
  let delivered = 0;
  const eventBuffer = new CodeAgentEventBuffer(runId);
  const handleFrame = (frame: string) => {
    const data = frame
      .split('\n')
      .find((line) => line.startsWith('data:'))
      ?.slice(5)
      .trim();
    if (!data) return;
    const parsed = JSON.parse(data) as CodeGenerationEvent;
    for (const event of eventBuffer.accept(parsed)) {
      delivered += 1;
      onEvent(event);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) handleFrame(frame);
    if (done) {
      if (buffer.trim()) handleFrame(buffer);
      break;
    }
  }
  return delivered;
}

export async function fixFullstackCode(
  vfs: Record<string, string>,
  error: string,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
  meta?: CodeRequestMeta,
): Promise<void> {
  const base: Record<string, unknown> = { vfs, error };
  applyCodeRequestMeta(base, meta);
  return streamCodeRequest('/api/code/fullstack/fix', base, onEvent, signal);
}

export interface AcceptanceProgressEvent {
  type: 'acceptance_progress';
  event: 'started' | 'running' | 'completed' | 'error';
  run_id?: string;
  verification_run_id: string;
  sequence: number;
  timestamp_ms: number;
  message: string;
  elapsed_seconds?: number;
  detail?: string;
  report?: CodeAcceptanceReport;
}

async function replayAcceptanceProgress(
  runId: string,
  afterSequence: number,
  onEvent: (event: AcceptanceProgressEvent) => void,
  signal?: AbortSignal,
): Promise<number> {
  const query = new URLSearchParams({ after: String(Math.max(0, afterSequence)) });
  const response = await fetch(
    `${API_BASE_URL}/api/code/events/${encodeURIComponent(runId)}?${query.toString()}`,
    { headers: { Accept: 'text/event-stream' }, signal },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  const reader = response.body?.getReader();
  if (!reader) throw new Error('验收事件重放响应为空。');

  const decoder = new TextDecoder();
  let buffer = '';
  let delivered = 0;
  const seen = new Set<string>();
  const handleFrame = (frame: string) => {
    const data = frame
      .split('\n')
      .find((line) => line.startsWith('data:'))
      ?.slice(5)
      .trim();
    if (!data) return;
    const event = JSON.parse(data) as AcceptanceProgressEvent & { event_id?: string };
    if (event.event_id && seen.has(event.event_id)) return;
    if (event.event_id) seen.add(event.event_id);
    delivered += 1;
    onEvent(event);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) handleFrame(frame);
    if (done) {
      if (buffer.trim()) handleFrame(buffer);
      break;
    }
  }
  return delivered;
}

export async function runCodeAcceptanceTest(
  body: {
    user_request: string;
    preview_html: string;
    console_entries: Array<{ level: 'log' | 'info' | 'warn' | 'error'; text: string }>;
    run_id?: string;
    verification_run_id: string;
    verification_session_id?: string;
    acceptance_goal?: AcceptanceGoalContract;
    candidate_revision?: string;
    changed_files?: string[];
  },
  onProgress?: (event: AcceptanceProgressEvent) => void,
  signal?: AbortSignal,
): Promise<CodeAcceptanceReport> {
  const timeoutController = new AbortController();
  let didTimeout = false;
  const handleExternalAbort = () => timeoutController.abort(signal?.reason);
  signal?.addEventListener('abort', handleExternalAbort, { once: true });
  if (signal?.aborted) handleExternalAbort();
  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    timeoutController.abort();
  }, ACCEPTANCE_REQUEST_TIMEOUT_MS);
  let report: CodeAcceptanceReport | null = null;
  let lastSequence = 0;
  let receivedTerminalError = false;

  try {
    const response = await fetch(`${API_BASE_URL}/api/code/test/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeoutController.signal,
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const reader = response.body?.getReader();
    if (!reader) throw new Error('浏览器验证响应为空。');
    const decoder = new TextDecoder();
    let buffer = '';
    const handleFrame = (frame: string) => {
      const data = frame.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
      if (!data) return;
      const event = JSON.parse(data) as AcceptanceProgressEvent;
      if (typeof event.sequence === 'number') {
        lastSequence = Math.max(lastSequence, event.sequence);
      }
      onProgress?.(event);
      if (event.event === 'completed' && event.report) report = event.report;
      if (event.event === 'error') {
        receivedTerminalError = true;
        throw new Error(event.detail || event.message);
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) handleFrame(frame);
      if (done) {
        if (buffer.trim()) handleFrame(buffer);
        break;
      }
    }
    if (!report) throw new Error('浏览器验证流在返回最终报告前结束。');
    return report;
  } catch (error) {
    if (didTimeout) {
      throw new Error(`测试请求超过 ${ACCEPTANCE_REQUEST_TIMEOUT_MS / 1000} 秒，已自动终止。`);
    }
    if (!signal?.aborted && !receivedTerminalError) {
      try {
        const recovered = await replayAcceptanceProgress(
          body.run_id?.trim() || body.verification_run_id,
          lastSequence,
          (event) => {
            if (typeof event.sequence === 'number') {
              lastSequence = Math.max(lastSequence, event.sequence);
            }
            onProgress?.(event);
            if (event.event === 'completed' && event.report) report = event.report;
            if (event.event === 'error') {
              receivedTerminalError = true;
              throw new Error(event.detail || event.message);
            }
          },
          signal,
        );
        if (recovered > 0 && report) return report;
      } catch (replayError) {
        console.log('[sse-diag] acceptance durable replay unavailable:', replayError);
      }
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', handleExternalAbort);
  }
}

async function streamCodeRequest(
  path: string,
  body: Record<string, unknown>,
  onEvent: (event: CodeGenerationEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('代码生成响应为空。');

  const decoder = new TextDecoder();
  let buffer = '';
  const eventBuffer = new CodeAgentEventBuffer(
    typeof body.run_id === 'string' ? body.run_id : undefined,
  );
  // Why: 诊断"前端瞬间已结束但后端仍在流式传输"——记录首个/终止性事件与断流方式。
  let frameCount = 0;
  console.log('[sse-diag] stream start', path);

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      const handleFrame = (frame: string) => {
        const data = frame
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
          .trim();
        if (!data) return;
        const parsed = JSON.parse(data) as CodeGenerationEvent;
        for (const deliverable of eventBuffer.accept(parsed)) {
          frameCount += 1;
          const diag = deliverable as { type: string; done?: boolean; channel?: string };
          if (diag.done || diag.type === 'error' || diag.type === 'code_update' || diag.type === 'runtime_summary') {
            console.log('[sse-diag] terminal-ish event #%d type=%s channel=%s done=%s', frameCount, diag.type, diag.channel, diag.done);
          }
          onEvent(deliverable);
        }
      };

      for (const frame of frames) handleFrame(frame);

      if (done) {
        if (buffer.trim()) {
          const finalFrame = buffer;
          buffer = '';
          handleFrame(finalFrame);
        }
        console.log('[sse-diag] reader done (server closed stream) frames=%d', frameCount);
        break;
      }
    }
  } catch (error) {
    console.log('[sse-diag] stream error at frames=%d:', frameCount, error);
    // The POST is never retried: it may have already executed tools or
    // written a candidate. Ask the durable read-only ledger for only events
    // after the last accepted cursor, then let the event buffer deduplicate.
    if (!signal?.aborted && typeof body.run_id === 'string' && body.run_id.trim()) {
      try {
        const recovered = await replayCodeEvents(
          body.run_id,
          eventBuffer.lastAcceptedSequence,
          (event) => {
            frameCount += 1;
            onEvent(event);
          },
          signal,
        );
        if (recovered > 0) {
          console.log('[sse-diag] recovered events=%d after=%d', recovered, eventBuffer.lastAcceptedSequence);
          return;
        }
      } catch (replayError) {
        console.log('[sse-diag] durable replay unavailable:', replayError);
      }
    }
    throw error;
  }
}

// ==========================================
// 健康检查
// ==========================================

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function parseApiError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: unknown; error?: { message?: unknown } };
    const detail = payload.detail;
    const normalizedDetail = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((item) => {
            if (typeof item === 'string') return item;
            if (item && typeof item === 'object' && 'msg' in item) return String((item as { msg?: unknown }).msg ?? '请求参数无效');
            return JSON.stringify(item);
          }).join('；')
        : detail && typeof detail === 'object'
          ? JSON.stringify(detail)
          : '';
    const errorMessage = payload.error?.message;
    return typeof errorMessage === 'string' ? errorMessage : normalizedDetail || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

export async function listAgents(): Promise<AgentListResponse> {
  const response = await fetch(`${API_BASE_URL}/api/agents`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<AgentListResponse>;
}

export async function generateAgent(userIdea: string): Promise<AgentConfig> {
  const response = await fetch(`${API_BASE_URL}/api/agents/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_idea: userIdea }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<AgentConfig>;
}

export async function saveAgent(agent: AgentDraft): Promise<AgentConfig> {
  const response = await fetch(`${API_BASE_URL}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agent),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { agent: AgentConfig };
  return payload.agent;
}

export async function deleteAgent(agentId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/agents/${encodeURIComponent(agentId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function listSessions(): Promise<{
  sessions: SessionSummary[];
  count: number;
}> {
  const response = await fetch(`${API_BASE_URL}/api/sessions`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function createSession(
  mode: ChatMode,
  title = '新会话',
): Promise<SessionSummary> {
  const response = await fetch(`${API_BASE_URL}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, title }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function getSessionHistory(
  sessionId: string,
): Promise<SessionHistoryResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/history`,
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function saveSessionSnapshot(
  sessionId: string,
  snapshot: SessionSnapshot,
  generateTitle = false,
): Promise<SessionSummary> {
  const response = await fetch(
    `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/history`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshot,
        generate_title: generateTitle,
      }),
    },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { session: SessionSummary };
  return payload.session;
}

/** Replace the durable memory branch after a rewrite/delete operation. */
export async function replaceSessionChatMemory(
  sessionId: string,
  messages: Array<Pick<ChatMessage, 'role' | 'content'>>,
): Promise<{ session_id: string; changed: boolean; revision: number }> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/chat-history/${encodeURIComponent(sessionId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

/** Persist live Code Agent usage independently of the debounced full snapshot. */
export async function persistCodeAgentTelemetry(
  sessionId: string,
  runId: string,
  telemetry: {
    tokenUsage?: TokenUsage;
    contextUsage?: ContextUsageEvent;
  },
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/code-agent-runs/${encodeURIComponent(runId)}/telemetry`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        run_id: runId,
        ...(telemetry.tokenUsage ? { token_usage: telemetry.tokenUsage } : {}),
        ...(telemetry.contextUsage ? { context_usage: telemetry.contextUsage } : {}),
      }),
    },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function renameSession(sessionId: string, title: string): Promise<SessionSummary> {
  const response = await fetch(
    `${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  const payload = await response.json() as { session: SessionSummary };
  return payload.session;
}

export async function clearSessions(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/sessions`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await parseApiError(response));
}

// ==========================================
// 记忆系统（Phase 3 前端展示层）
// ==========================================

// Why: 后端 → 前端的记忆系统更新通知（SSE），四层记忆任一变更时推送。
export interface MemoryUpdateEvent {
  type: 'memory_update';
  layer: 'profile' | 'summary' | 'vfs' | 'skill';
  action: 'created' | 'updated' | 'interrupted' | 'restored';
  detail: string;
  done: true;
}

// Why: Skill 匹配命中通知（SSE），供前端展示"已命中 Skill"的实时反馈。
export interface SkillMatchedEvent {
  type: 'skill_matched';
  skill_id?: number;
  skill_name: string;
  skill_type: 'code_pattern' | 'task_flow' | 'fix_template' | 'instruction';
  confidence: number;
  injected?: boolean;
  injection_mode?: 'summary' | 'full' | 'on_demand';
  injected_step_count?: number;
  injected_validation_count?: number;
  standard_steps: string[];
  done: true;
}

export interface ProfileCard {
  card_id: number;
  field_key: string;
  field_value: unknown;
  valid_start: number;
  valid_end: number;
  source: string;
}

export interface MemorySummary {
  summary_id: number;
  session_id: string;
  turn_start: number;
  turn_end: number;
  summary_text: string;
  topics: string[];
  created_at: number;
}

export interface VFSCheckpointMeta {
  checkpoint_id: number;
  session_id: string;
  run_id: string;
  is_compressed: boolean;
  trigger_reason: string;
  created_at: number;
}

export interface MemoryEvent {
  event_id: number;
  session_id: string;
  event_type: string;
  event_data: unknown;
  created_at: number;
}

export interface SkillCapsule {
  skill_id: number;
  skill_name: string;
  skill_type: 'code_pattern' | 'task_flow' | 'fix_template' | 'instruction';
  description: string | null;
  trigger_condition: string;
  trigger_keywords: string[];
  standard_steps: string[];
  required_params: string[];
  validation_rules: string[];
  success_count: number;
  failure_count: number;
  sample_envelope: string | null;
  content_md: string | null;
  // Why: Skills 页签启停标志——停用后不参与匹配注入，但保留数据供再启用。
  enabled: boolean;
  // Why: 生命周期状态（决策 1 人工确认上架）——pending 待确认（不参与匹配）/
  //   published 已上架（参与匹配注入）。与 enabled 正交。
  status: 'pending' | 'published';
  // Why: 来源标记——catalog 安装='Anthropic'，手动/上传='我'，code 沉淀='agent'。
  author: string;
  // Why: catalog_id 回溯，用于市场安装幂等判重。
  source: string | null;
  created_at: number;
  updated_at: number;
}

export type GoldenTraceCaseStatus = 'draft' | 'golden' | 'retired';
export type GoldenTraceQualityState = 'candidate' | 'verified' | 'invalidated';
export type GoldenTraceEvaluationStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export interface GoldenTraceOutcomeContract {
  schema_version?: number;
  required_scope: string;
  allowed_path_prefixes?: string[];
  forbidden_path_prefixes?: string[];
  final_state_assertions?: string[];
  require_browser_verification?: boolean;
  require_interaction_verification?: boolean;
  max_console_errors?: number;
  max_page_errors?: number;
  require_no_vfs_pollution?: boolean;
  require_no_commit_before_browser_pass?: boolean;
  require_no_regressions?: boolean;
  require_static_verification?: boolean;
}

export interface GoldenTraceSemanticTrace {
  schema_version?: number;
  user_goal?: string;
  task_scope: string;
  root_cause_category: string;
  allowed_tools: string[];
  verification_strategy: string[];
  success_criteria: string[];
  applicability_conditions?: string[];
  provenance?: Record<string, unknown>;
}

export interface GoldenTraceConcreteTrace {
  schema_version?: number;
  read_count?: number;
  read_order: string[];
  tool_order: string[];
  patch: Record<string, unknown>;
  browser_evidence: Record<string, unknown>;
  revisions: Record<string, string>;
  final_result: Record<string, unknown>;
}

export interface GoldenTraceCase {
  case_id: string;
  title: string;
  schema_version: number;
  status: GoldenTraceCaseStatus;
  quality_state: GoldenTraceQualityState;
  invalidated_reason?: string;
  invalidated_at?: number | null;
  source_session_id: string;
  source_run_id: string;
  request_text: string;
  contract: GoldenTraceOutcomeContract;
  semantic_trace?: GoldenTraceSemanticTrace;
  concrete_trace?: GoldenTraceConcreteTrace;
  fixture_checkpoint_id: number | null;
  browser_evidence: Record<string, unknown>;
  source_trace_hash: string;
  source_quality: 'complete' | 'summary_only';
  skill_id: number | null;
  created_at: number;
  updated_at: number;
  latest_evaluation?: GoldenTraceEvaluation | null;
}

export interface GoldenTraceGateResult {
  passed: boolean;
  actual?: unknown;
  expected?: unknown;
  reason: string;
}

export interface GoldenTraceEvaluationReport {
  status: GoldenTraceEvaluationStatus;
  passed: boolean;
  gates: Record<string, GoldenTraceGateResult>;
  metrics: Record<string, unknown>;
  details: Record<string, unknown>;
}

export interface GoldenTraceEvaluation {
  evaluation_run_id: string;
  case_id: string;
  client_request_id: string;
  mode: 'replay' | 'live';
  status: GoldenTraceEvaluationStatus;
  run_id: string | null;
  browser_run_id: string | null;
  report: GoldenTraceEvaluationReport | null;
  created_at: number;
  finished_at: number | null;
}

export interface GoldenTraceListResponse {
  data: GoldenTraceCase[];
  pagination: { page: number; page_size: number; total: number };
}

export interface GoldenTraceDetailResponse {
  case: GoldenTraceCase;
  recent_evaluations: GoldenTraceEvaluation[];
  evaluation_count: number;
}

export type GoldenTraceSemanticTraceInput = Partial<GoldenTraceSemanticTrace> &
  Pick<GoldenTraceSemanticTrace, 'task_scope' | 'root_cause_category' | 'allowed_tools' | 'verification_strategy' | 'success_criteria'>;

export interface GoldenTraceCreateInput {
  sessionId: string;
  sourceRunId: string;
  title: string;
  contract?: GoldenTraceOutcomeContract;
  semanticTrace?: GoldenTraceSemanticTraceInput;
}

export interface GoldenTraceEvaluationCreateInput {
  clientRequestId: string;
  mode?: 'replay' | 'live';
}

export interface GoldenTraceEvaluationResponse {
  created: boolean;
  existing: boolean;
  evaluation: GoldenTraceEvaluation;
}

// Why: Skill 市场目录项（GET /api/skills/catalog），含已安装标记。
export interface SkillCatalogItem {
  catalog_id: string;
  name: string;
  author: string;
  downloads: number;
  category: string;
  updated_at: string;
  description: string;
  trigger_condition: string;
  standard_steps: string[];
  validation_rules: string[];
  is_installed: boolean;
  installed_skill_id: number | null;
}

// Why: 一次拉取当前会话档案卡（当前画像 + 全历史），供 MemoryPanel 展示。
export async function getProfileCards(
  sessionId: string,
): Promise<{ profile: Record<string, unknown>; cards: ProfileCard[] }> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/profile/${encodeURIComponent(sessionId)}`,
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function getMemorySummaries(sessionId: string): Promise<{ summaries: MemorySummary[] }> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/summary/${encodeURIComponent(sessionId)}`,
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export interface CodeContextCompactionResult {
  status: 'requested' | 'completed' | 'skipped' | 'unavailable' | string;
  scope: 'active_loop' | 'session_memory' | 'none' | string;
  run_id?: string;
  session_id?: string;
  message: string;
}

/** 请求活动 Code AgentLoop 在下一轮边界压缩，空闲时压缩已保存的会话记忆。 */
export async function requestCodeContextCompaction(
  input: { runId?: string | null; sessionId?: string | null },
): Promise<CodeContextCompactionResult> {
  const response = await fetch(`${API_BASE_URL}/api/code/context/compact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      run_id: input.runId || undefined,
      session_id: input.sessionId || undefined,
    }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function restoreMemoryVfs(
  sessionId: string,
): Promise<{ vfs: Record<string, string>; checkpoint_id: number | null }> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/vfs/restore/${encodeURIComponent(sessionId)}`,
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function listVfsCheckpoints(
  sessionId: string,
  limit = 10,
): Promise<{ checkpoints: VFSCheckpointMeta[] }> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/vfs/checkpoints/${encodeURIComponent(sessionId)}?limit=${limit}`,
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function saveMemoryVfsCheckpoint(
  sessionId: string,
  req: { vfs: Record<string, string>; run_id: string; trigger_reason?: string },
): Promise<{ checkpoint_id: number }> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/vfs/checkpoint/${encodeURIComponent(sessionId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...req, trigger_reason: req.trigger_reason ?? 'manual' }),
    },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function getSkills(
  skillType?: SkillCapsule['skill_type'],
  status?: SkillCapsule['status'],
): Promise<{ skills: SkillCapsule[]; count: number }> {
  const params = new URLSearchParams();
  if (skillType) params.set('skill_type', skillType);
  if (status) params.set('status', status);
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE_URL}/api/memory/skills${query}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function listGoldenTraces(options: {
  page?: number;
  pageSize?: number;
  status?: GoldenTraceCaseStatus;
} = {}): Promise<GoldenTraceListResponse> {
  const params = new URLSearchParams({
    page: String(Math.max(1, options.page ?? 1)),
    page_size: String(Math.max(1, options.pageSize ?? 20)),
  });
  if (options.status) params.set('status', options.status);
  const response = await fetch(`${API_BASE_URL}/api/memory/golden-traces?${params.toString()}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<GoldenTraceListResponse>;
}

export async function createGoldenTrace(
  input: GoldenTraceCreateInput,
): Promise<{ created: boolean; existing: boolean; reactivated: boolean; case: GoldenTraceCase }> {
  const response = await fetch(`${API_BASE_URL}/api/memory/golden-traces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: input.sessionId,
      source_run_id: input.sourceRunId,
      title: input.title,
      ...(input.contract ? { contract: input.contract } : {}),
      ...(input.semanticTrace ? { semantic_trace: input.semanticTrace } : {}),
    }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<{ created: boolean; existing: boolean; reactivated: boolean; case: GoldenTraceCase }>;
}

export async function updateGoldenTraceSemantic(
  caseId: string,
  semanticTrace: GoldenTraceSemanticTraceInput,
): Promise<{ case: GoldenTraceCase }> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/golden-traces/${encodeURIComponent(caseId)}/semantic-trace`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(semanticTrace),
    },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<{ case: GoldenTraceCase }>;
}

export async function getGoldenTrace(caseId: string): Promise<GoldenTraceDetailResponse> {
  const response = await fetch(`${API_BASE_URL}/api/memory/golden-traces/${encodeURIComponent(caseId)}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<GoldenTraceDetailResponse>;
}

export async function setGoldenTraceStatus(
  caseId: string,
  status: GoldenTraceCaseStatus,
): Promise<{ case: GoldenTraceCase }> {
  const response = await fetch(`${API_BASE_URL}/api/memory/golden-traces/${encodeURIComponent(caseId)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<{ case: GoldenTraceCase }>;
}

export async function invalidateGoldenTrace(
  caseId: string,
  reason: string,
): Promise<{ updated: boolean; invalidated: boolean; case: GoldenTraceCase }> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/golden-traces/${encodeURIComponent(caseId)}/dispute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<{ updated: boolean; invalidated: boolean; case: GoldenTraceCase }>;
}

export async function enqueueGoldenTraceEvaluation(
  caseId: string,
  input: GoldenTraceEvaluationCreateInput,
): Promise<GoldenTraceEvaluationResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/golden-traces/${encodeURIComponent(caseId)}/runs`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_request_id: input.clientRequestId,
        mode: input.mode ?? 'replay',
      }),
    },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<GoldenTraceEvaluationResponse>;
}

// Why: 人工确认上架（决策 1）——pending ↔ published 状态流转的唯一前端入口。
export async function setSkillStatus(
  skillId: number,
  status: SkillCapsule['status'],
): Promise<SkillCapsule> {
  const response = await fetch(`${API_BASE_URL}/api/memory/skills/${skillId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  const data = await response.json();
  return data.skill;
}

export async function getSkill(skillId: number): Promise<SkillCapsule> {
  const response = await fetch(`${API_BASE_URL}/api/memory/skills/${skillId}`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function matchSkills(userInput: string): Promise<{ matched_skills: SkillCapsule[] }> {
  const response = await fetch(`${API_BASE_URL}/api/memory/skills/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_input: userInput }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function getMemoryEvents(
  sessionId: string,
  limit = 50,
): Promise<{ events: MemoryEvent[] }> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/events/${encodeURIComponent(sessionId)}?limit=${limit}`,
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

// ==========================================
// 记忆删除端点（手动纠偏 + 会话清空）
// Why: 事件账本 append-only 不提供行级删除，仅 clearSessionMemory 整体清空；
// 档案卡后端强约束仅失效卡可删（生效卡返回 409）。
// ==========================================

export async function deleteMemorySummary(summaryId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/memory/summary/${summaryId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function deleteProfileCard(cardId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/memory/profile/card/${cardId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function deleteVfsCheckpoint(checkpointId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/memory/vfs/checkpoint/${checkpointId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function deleteSkill(skillId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/memory/skills/${skillId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function getSkillContent(skillId: number): Promise<{ skill_id: number; content_md: string; generated: boolean }> {
  const response = await fetch(`${API_BASE_URL}/api/memory/skills/${skillId}/content`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function updateSkillContent(skillId: number, content_md: string): Promise<SkillCapsule> {
  const response = await fetch(`${API_BASE_URL}/api/memory/skills/${skillId}/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_md }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function downloadSkill(skillId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/memory/skills/${skillId}/download`);
  if (!response.ok) throw new Error(await parseApiError(response));
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const contentDisposition = response.headers.get('Content-Disposition');
  const filename = contentDisposition?.match(/filename="?(.+)"?/)?.[1] || `skill-${skillId}.md`;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export async function clearSessionMemory(
  sessionId: string,
): Promise<{ cleared: boolean; deleted: Record<string, number> }> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/clear/${encodeURIComponent(sessionId)}`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

// ==========================================
// MCP 市场 / Skills 管理 / 内置 Plugins（DirectoryModal 数据源）
// ==========================================

export type McpServerStatus = 'pending' | 'ready' | 'error' | 'stopped';

export interface EnvSchemaField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  description: string;
}

export interface McpRuntimeState {
  status: McpServerStatus;
  tool_count: number;
  last_error: string | null;
  restart_count: number;
}

export interface McpPluginItem {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  transport?: string;
  provider?: string;
  tags?: string[];
  homepage?: string;
  command?: string;
  args?: string[];
  env_schema: EnvSchemaField[];
  is_installed: boolean;
  is_enabled: boolean;
  runtime: McpRuntimeState | null;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  installed_at?: string;
}

export interface McpConfigPayload {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpToolInfo {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface McpServerToolsResponse {
  server_id: string;
  status: McpServerStatus;
  tool_count: number;
  tools: McpToolInfo[];
  restart_count: number;
  last_error: string | null;
  stderr_tail: string[];
}

export interface SkillUpdatePayload {
  skill_name?: string;
  trigger_condition?: string;
  trigger_keywords?: string[];
  standard_steps?: string[];
}

export interface BuiltinPlugin {
  id: string;
  name: string;
  icon: string;
  tool_name: string;
  modes: string[];
  description: string;
  enabled: boolean;
}

export async function getMcpMarketplace(): Promise<McpPluginItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/mcp/marketplace`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<McpPluginItem[]>;
}

export async function installMcp(
  pluginId: string,
  envValues: Record<string, string>,
): Promise<{ status: string; message: string }> {
  const response = await fetch(`${API_BASE_URL}/api/mcp/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plugin_id: pluginId, env_values: envValues }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function toggleMcp(
  pluginId: string,
): Promise<{ status: string; enabled: boolean }> {
  const response = await fetch(
    `${API_BASE_URL}/api/mcp/toggle/${encodeURIComponent(pluginId)}`,
    { method: 'POST' },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function uninstallMcp(pluginId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/mcp/uninstall/${encodeURIComponent(pluginId)}`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
}

export async function getMcpConfig(): Promise<McpConfigPayload> {
  const response = await fetch(`${API_BASE_URL}/api/mcp/config`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<McpConfigPayload>;
}

export async function saveMcpConfig(
  content: McpConfigPayload,
): Promise<{ status: string; servers: string[] }> {
  const response = await fetch(`${API_BASE_URL}/api/mcp/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function getMcpServerTools(
  serverId: string,
): Promise<McpServerToolsResponse> {
  const response = await fetch(
    `${API_BASE_URL}/api/mcp/servers/${encodeURIComponent(serverId)}/tools`,
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<McpServerToolsResponse>;
}

export async function updateSkill(
  skillId: number,
  payload: SkillUpdatePayload,
): Promise<SkillCapsule> {
  const response = await fetch(`${API_BASE_URL}/api/memory/skills/${skillId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<SkillCapsule>;
}

export async function toggleSkill(
  skillId: number,
  enabled: boolean,
): Promise<{ status: string; skill_id: number; enabled: boolean }> {
  const response = await fetch(
    `${API_BASE_URL}/api/memory/skills/${skillId}/toggle`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function getPlugins(): Promise<{ plugins: BuiltinPlugin[] }> {
  const response = await fetch(`${API_BASE_URL}/api/plugins`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json() as Promise<{ plugins: BuiltinPlugin[] }>;
}

export async function togglePlugin(
  pluginId: string,
  enabled: boolean,
): Promise<{ status: string; plugin_id: string; enabled: boolean }> {
  const response = await fetch(
    `${API_BASE_URL}/api/plugins/${encodeURIComponent(pluginId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    },
  );
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

// ==========================================
// Skill 市场目录 & 创建（计划书 §2 §3）
// ==========================================

export async function getSkillCatalog(): Promise<{ skills: SkillCatalogItem[]; count: number }> {
  const response = await fetch(`${API_BASE_URL}/api/skills/catalog`);
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function installSkillFromCatalog(
  catalogId: string,
): Promise<{ installed: boolean; existing: boolean; skill: SkillCapsule }> {
  const response = await fetch(`${API_BASE_URL}/api/skills/catalog/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ catalog_id: catalogId }),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}

export async function createSkill(req: {
  skill_name: string;
  description: string;
  instructions: string;
}): Promise<{ created: boolean; skill: SkillCapsule }> {
  const response = await fetch(`${API_BASE_URL}/api/memory/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!response.ok) throw new Error(await parseApiError(response));
  return response.json();
}
