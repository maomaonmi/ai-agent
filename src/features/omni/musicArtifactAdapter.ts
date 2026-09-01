import type { SunoTask } from '../music/api';
import type { CreateArtifactInput } from './api';

export interface MusicArtifactPayload {
  schemaVersion: 1;
  stage: 'lyrics' | 'music';
  title: string;
  lyrics: string;
  instruction: string;
  style: string;
  task: SunoTask | null;
}

export function isMusicGenerationCommand(value: string): boolean {
  return /(?:生成|开始|制作|创作|谱|作)(?:这首|一首|歌曲|音乐|曲|伴奏)|(?:生成|开始)作曲|开始生成/.test(value.replace(/\s+/g, ''));
}

export function readMusicArtifactPayload(value: unknown): MusicArtifactPayload | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<MusicArtifactPayload>;
  if (item.schemaVersion !== 1 || (item.stage !== 'lyrics' && item.stage !== 'music')) return null;
  if (typeof item.title !== 'string' || typeof item.lyrics !== 'string' || typeof item.instruction !== 'string' || typeof item.style !== 'string') return null;
  if (item.task !== null && (typeof item.task !== 'object' || !item.task)) return null;
  return item as MusicArtifactPayload;
}

export function createMusicArtifactInput({
  messageId,
  title,
  lyrics,
  instruction,
}: {
  messageId: string;
  title: string;
  lyrics: string;
  instruction: string;
}): CreateArtifactInput {
  const draftId = `lyrics-${crypto.randomUUID()}`;
  return {
    messageId,
    kind: 'music',
    title: title.trim() || '未命名歌曲',
    summary: '歌词初稿已完成，可继续编辑并生成音乐。',
    sourceRef: { type: 'music_task', musicTaskId: draftId },
    payload: {
      schemaVersion: 1,
      stage: 'lyrics',
      title: title.trim() || '未命名歌曲',
      lyrics,
      instruction,
      style: '',
      task: null,
    } satisfies MusicArtifactPayload,
    status: 'draft',
  };
}
