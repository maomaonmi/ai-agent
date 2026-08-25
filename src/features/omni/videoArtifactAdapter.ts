import type { VideoTask } from '../../lib/api';
import type { CreateArtifactInput } from './api';

export interface VideoArtifactPayload {
  task: VideoTask;
}

export function createVideoArtifactInput(input: { messageId: string; task: VideoTask }): CreateArtifactInput {
  const ready = input.task.status === 'SUCCEEDED' && Boolean(input.task.result?.video_url);
  const failed = input.task.status === 'FAILED' || input.task.status === 'CANCELLED';
  return {
    messageId: input.messageId,
    kind: 'video',
    title: (input.task.prompt.trim() || '未命名视频').slice(0, 100),
    summary: ready ? `${input.task.parameters.duration} 秒视频已生成` : failed ? '视频生成失败' : `视频生成中 · ${input.task.progress}%`,
    status: ready ? 'ready' : failed ? 'failed' : 'generating',
    sourceRef: { type: 'video_task', videoTaskId: input.task.id },
    payload: { task: input.task } satisfies VideoArtifactPayload,
    metadata: {
      adapter: 'video',
      previewUrl: input.task.result?.video_url,
      provider: input.task.provider,
      model: input.task.model,
    },
  };
}

export function readVideoArtifactPayload(payload: unknown): VideoArtifactPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Partial<VideoArtifactPayload>;
  return candidate.task && typeof candidate.task.id === 'string' ? candidate as VideoArtifactPayload : null;
}

/**
 * Guards refresh recovery from appending a task to an unrelated artifact.
 * Both the persisted source reference and payload are checked because older
 * versions may contain only one of those fields.
 */
export function matchesVideoArtifactTask(payload: unknown, sourceRef: unknown, taskId: string): boolean {
  const parsed = readVideoArtifactPayload(payload);
  if (!parsed || parsed.task.id !== taskId || !sourceRef || typeof sourceRef !== 'object') return false;
  const reference = sourceRef as { type?: unknown; videoTaskId?: unknown };
  return reference.type === 'video_task' && reference.videoTaskId === taskId;
}
