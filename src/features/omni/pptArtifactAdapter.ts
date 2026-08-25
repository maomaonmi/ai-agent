import type { PptPresentationResponse, PptRunResponse } from '../ppt/api';
import type { CreateArtifactInput } from './api';

export interface PptArtifactPayload {
  presentation: PptPresentationResponse;
  run: PptRunResponse;
}

export function createPptArtifactInput(input: {
  messageId: string;
  presentation: PptPresentationResponse;
  run: PptRunResponse;
}): CreateArtifactInput {
  const ready = input.run.status === 'COMPLETED';
  const failed = input.run.status === 'FAILED' || input.run.status === 'CANCELLED';
  return {
    messageId: input.messageId,
    kind: 'presentation',
    title: input.presentation.title.slice(0, 200),
    summary: ready ? `${input.presentation.document.slides.length} 页演示文稿` : failed ? 'PPT 生成未完成' : `PPT 生成中 · ${input.run.phase}`,
    status: ready ? 'ready' : failed ? 'failed' : 'generating',
    sourceRef: {
      type: 'presentation',
      presentationId: input.presentation.presentationId,
      revision: Math.max(1, input.presentation.revision),
      runId: input.run.runId,
    },
    payload: { presentation: input.presentation, run: input.run } satisfies PptArtifactPayload,
    metadata: {
      adapter: 'ppt',
      slideCount: input.presentation.document.slides.length,
      templateId: input.presentation.templateId,
    },
  };
}

export function readPptArtifactPayload(payload: unknown): PptArtifactPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Partial<PptArtifactPayload>;
  return candidate.presentation?.document && candidate.run?.runId ? candidate as PptArtifactPayload : null;
}
