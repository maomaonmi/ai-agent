import MarkdownMessage from '../../../components/MarkdownMessage';

export default function RawResearchReport({ title, report }: { title: string; report: string }) {
  return <article className="mx-auto max-w-[900px] px-6 pb-20 pt-10 sm:px-10 lg:px-12"><header className="mb-9 border-b border-slate-200 pb-6"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">Text report</p><h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title || '文本调研报告'}</h1><p className="mt-3 text-sm text-slate-400">保留模型原始输出，仅进行阅读排版。</p></header><MarkdownMessage content={report} className="text-[15px] leading-8 text-slate-800 [&_h1]:mt-10 [&_h2]:mt-9 [&_h3]:mt-7 [&_p]:mb-5"/></article>;
}

