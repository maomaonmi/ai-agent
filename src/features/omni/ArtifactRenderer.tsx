import { FileText, Image as ImageIcon, Presentation, Search, Video } from 'lucide-react';
import MarkdownMessage from '../../components/MarkdownMessage';
import { stripWritingPreamble } from '../ai-writing/writingDocumentTypes';
import { artifactKindLabel } from './artifactPresentation';
import type { Artifact, ArtifactVersion } from './types';
import { readImageArtifactPayload } from './imageArtifactAdapter';
import { readPptArtifactPayload } from './pptArtifactAdapter';
import { readResearchArtifactPayload } from './researchArtifactAdapter';
import { readThesisArtifactPayload } from './thesisArtifactAdapter';
import { readVideoArtifactPayload } from './videoArtifactAdapter';

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function ArtifactRenderer({ artifact, version }: { artifact: Artifact; version: ArtifactVersion }) {
  const previewUrl = typeof artifact.metadata.previewUrl === 'string' ? artifact.metadata.previewUrl : null;
  const versionPayload = version.payload && typeof version.payload === 'object'
    ? version.payload as Record<string, unknown>
    : null;
  const thesisPayload = artifact.kind === 'thesis' ? readThesisArtifactPayload(version.payload) : null;
  const documentContent = thesisPayload?.markdown || (typeof versionPayload?.content === 'string' ? versionPayload.content : null);
  const imagePayload = artifact.kind === 'image' ? readImageArtifactPayload(version.payload) : null;
  const researchPayload = artifact.kind === 'research_report' ? readResearchArtifactPayload(version.payload) : null;
  const videoPayload = artifact.kind === 'video' ? readVideoArtifactPayload(version.payload) : null;
  const pptPayload = artifact.kind === 'presentation' ? readPptArtifactPayload(version.payload) : null;
  const Icon = artifact.kind === 'image' ? ImageIcon : artifact.kind === 'video' ? Video : artifact.kind === 'presentation' ? Presentation : artifact.kind === 'research_report' ? Search : FileText;
  if (artifact.kind === 'image' && (imagePayload?.images.length || previewUrl)) {
    const images = imagePayload?.images.length ? imagePayload.images : [{ id: 'preview', url: previewUrl! }];
    return <div className="h-full overflow-y-auto bg-slate-100 p-4 sm:p-6"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{images.map((item) => (
      // eslint-disable-next-line @next/next/no-img-element
      <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><img src={item.url} alt={imagePayload?.prompt || artifact.title} className="h-auto w-full object-contain" /></a>
    ))}</div></div>;
  }
  if (artifact.kind === 'video') {
    const videoUrl = videoPayload?.task.result?.video_url || previewUrl;
    if (videoUrl) return <div className="flex h-full items-center justify-center bg-slate-950 p-6"><video src={videoUrl} controls playsInline className="max-h-full max-w-full" aria-label={artifact.title} /></div>;
    return <div className="flex h-full flex-col items-center justify-center bg-slate-950 px-6 text-center text-white"><Video size={32} /><p className="mt-4 text-sm font-medium">{videoPayload?.task.status === 'FAILED' ? '视频生成失败' : `视频正在生成 · ${videoPayload?.task.progress ?? 0}%`}</p><p className="mt-2 text-xs text-white/50">任务 {videoPayload?.task.id || version.sourceRef.type === 'video_task' && version.sourceRef.videoTaskId}</p></div>;
  }
  if (artifact.kind === 'presentation' && pptPayload) {
    const { document } = pptPayload.presentation;
    if (document.slides.length > 0) return <div className="h-full overflow-y-auto bg-slate-100 p-4 sm:p-6"><div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-2">{document.slides.map((slide, index) => {
      const text = slide.elements.flatMap((element) => element.type === 'TEXT' && !element.isHidden && element.text.trim() ? [element.text.trim()] : []);
      const background = slide.background.type === 'SOLID' ? slide.background.color : document.theme.colors.background;
      return <section key={slide.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex aspect-video flex-col justify-center gap-3 overflow-hidden p-7" style={{ backgroundColor: background, color: document.theme.colors.text }}><h3 className="line-clamp-3 text-xl font-semibold leading-tight">{text[0] || `第 ${index + 1} 页`}</h3>{text.slice(1, 4).map((value, textIndex) => <p key={`${slide.id}-${textIndex}`} className="line-clamp-3 text-sm leading-6 opacity-75">{value}</p>)}</div><footer className="flex items-center justify-between px-3 py-2 text-xs text-slate-500"><span>{index + 1} / {document.slides.length}</span><span>{slide.notes ? '含演讲者备注' : document.theme.name}</span></footer></section>;
    })}</div></div>;
    return <div className="flex h-full flex-col items-center justify-center px-6 text-center"><Presentation size={32} className="text-slate-400" /><p className="mt-4 text-sm font-medium text-slate-700">{pptPayload.run.status === 'FAILED' || pptPayload.run.status === 'CANCELLED' ? 'PPT 生成未完成' : `PPT 正在生成 · ${pptPayload.run.phase}`}</p></div>;
  }
  if ((artifact.kind === 'document' || artifact.kind === 'thesis' || artifact.kind === 'research_report') && documentContent) {
    return <article className="h-full overflow-y-auto bg-white px-6 py-8 sm:px-10"><div className="mx-auto max-w-3xl"><MarkdownMessage content={stripWritingPreamble(documentContent)} density="compact" className="text-[15px] leading-6 text-slate-800" />{researchPayload && researchPayload.sources.length > 0 && <section className="mt-10 border-t border-slate-200 pt-6"><h4 className="text-sm font-semibold text-slate-900">研究来源</h4><div className="mt-3 space-y-2">{researchPayload.sources.map((source) => { const href = safeExternalUrl(source.url); const content = <><span className="block text-sm font-medium text-slate-800">{source.title}</span><span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-500">{source.text}</span></>; return href ? <a key={`${source.id}-${source.url}`} href={href} target="_blank" rel="noreferrer" className="block rounded-lg border border-slate-200 p-3 hover:bg-slate-50">{content}</a> : <div key={`${source.id}-${source.url}`} className="rounded-lg border border-slate-200 p-3">{content}</div>; })}</div></section>}</div></article>;
  }
  return <div className="flex h-full flex-col items-center justify-center px-8 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Icon size={26} /></span><h3 className="mt-4 text-base font-semibold text-slate-900">{artifactKindLabel(artifact.kind)}预览</h3><p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{version.summary || artifact.summary}</p><p className="mt-3 text-xs text-slate-400">专业编辑器将在对应作品适配器接入后显示在这里。</p></div>;
}
