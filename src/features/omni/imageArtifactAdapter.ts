import type { ImageBatch } from '../../lib/api';
import type { CreateArtifactInput } from './api';

export interface ImageArtifactPayload {
  batchId: string;
  prompt: string;
  images: ImageBatch['images'];
  director?: ImageBatch['director'];
}

export function createImageArtifactInput(input: {
  messageId: string;
  batch: ImageBatch;
}): CreateArtifactInput {
  const { batch } = input;
  return {
    messageId: input.messageId,
    kind: 'image',
    title: (batch.raw_prompt.trim() || '未命名图片').slice(0, 80),
    summary: `生成了 ${batch.images.length} 张候选图片`,
    sourceRef: {
      type: 'image_batch',
      imageBatchId: batch.batch_id,
      imageAssetIds: batch.images.map((image) => image.id),
    },
    payload: {
      batchId: batch.batch_id,
      prompt: batch.raw_prompt,
      images: batch.images.map((image) => ({ ...image })),
      director: batch.director,
    } satisfies ImageArtifactPayload,
    metadata: {
      adapter: 'image',
      previewUrl: batch.images[0]?.thumbnail_url || batch.images[0]?.url,
      candidateCount: batch.images.length,
    },
  };
}

export function readImageArtifactPayload(payload: unknown): ImageArtifactPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Partial<ImageArtifactPayload>;
  if (typeof candidate.batchId !== 'string' || typeof candidate.prompt !== 'string' || !Array.isArray(candidate.images)) return null;
  return candidate as ImageArtifactPayload;
}
