'use client';

import { ArrowRight, FileText, Image as ImageIcon, Presentation, Search, Video } from 'lucide-react';
import { buildArtifactCardViewModel } from './artifactPresentation';
import type { Artifact, ArtifactVersion } from './types';
import { readImageArtifactPayload } from './imageArtifactAdapter';
import { readVideoArtifactPayload } from './videoArtifactAdapter';

const icons = {
  image: ImageIcon,
  video: Video,
  document: FileText,
  thesis: FileText,
  research_report: Search,
  presentation: Presentation,
};

interface ArtifactMessageCardProps {
  artifact: Artifact;
  version: ArtifactVersion;
  onOpen: (artifact: Artifact, version: ArtifactVersion) => void;
  fromOtherProject?: boolean;
}

export default function ArtifactMessageCard({ artifact, version, onOpen, fromOtherProject = false }: ArtifactMessageCardProps) {
  const viewModel = buildArtifactCardViewModel(artifact, version);
  const Icon = icons[artifact.kind];
  const versionImagePayload = artifact.kind === 'image' ? readImageArtifactPayload(version.payload) : null;
  const videoPayload = artifact.kind === 'video' ? readVideoArtifactPayload(version.payload) : null;
  const previewUrl = versionImagePayload?.images[0]?.thumbnail_url || versionImagePayload?.images[0]?.url || (typeof artifact.metadata.previewUrl === 'string'
    ? artifact.metadata.previewUrl
    : null);

  return (
    <article className="mt-3 w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" aria-label={`${viewModel.kindLabel}作品：${viewModel.title}`}>
      {previewUrl && artifact.kind === 'image' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="" className="h-40 w-full object-cover" />
      )}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600" aria-hidden="true"><Icon size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-900">{viewModel.title}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{viewModel.kindLabel}</span>
              {fromOtherProject && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-600">来自其他项目</span>}
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{videoPayload?.task.status === 'FAILED' && videoPayload.task.error?.message ? `生成失败：${videoPayload.task.error.message}` : viewModel.summary}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span>{viewModel.statusLabel}</span><span aria-hidden="true">·</span>
              <span className={viewModel.isHistoricalVersion ? 'font-medium text-amber-600' : ''}>{viewModel.versionLabel}</span>
            </div>
          </div>
        </div>
        <button type="button" onClick={() => onOpen(artifact, version)} className="mt-4 flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <span>查看作品</span><ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
