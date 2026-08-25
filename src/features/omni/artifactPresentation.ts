import type { Artifact, ArtifactKind, ArtifactVersion, ArtifactVersionId } from './types';

const KIND_LABELS: Record<ArtifactKind, string> = {
  image: '图片',
  video: '视频',
  document: '文章',
  thesis: '论文',
  research_report: '研究报告',
  presentation: 'PPT',
};

const STATUS_LABELS: Record<Artifact['status'], string> = {
  draft: '草稿',
  queued: '排队中',
  generating: '生成中',
  ready: '已完成',
  failed: '生成失败',
  archived: '已归档',
};

export interface ArtifactCardViewModel {
  title: string;
  summary: string;
  kindLabel: string;
  statusLabel: string;
  versionId: ArtifactVersionId;
  versionLabel: string;
  isHistoricalVersion: boolean;
}

export function buildArtifactCardViewModel(
  artifact: Artifact,
  version: ArtifactVersion,
): ArtifactCardViewModel {
  const isHistoricalVersion = artifact.currentVersionId !== version.id;
  return {
    title: artifact.title,
    summary: version.summary || artifact.summary,
    kindLabel: KIND_LABELS[artifact.kind],
    statusLabel: STATUS_LABELS[artifact.status],
    versionId: version.id,
    versionLabel: `版本 ${version.versionNumber}${isHistoricalVersion ? ' · 非最新版' : ''}`,
    isHistoricalVersion,
  };
}

export function artifactKindLabel(kind: ArtifactKind): string {
  return KIND_LABELS[kind];
}
