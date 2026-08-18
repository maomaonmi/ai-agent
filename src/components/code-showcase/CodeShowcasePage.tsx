'use client';

import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUp, Code2, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import {
  CODE_PROJECT_CATEGORIES,
  CODE_SHOWCASE_PROJECTS,
  CodeProjectCategory,
  CodeShowcaseProject,
  optimizeCodePrompt,
} from './projects';
import { deleteCodeProject, listCodeProjects, PublishedCodeProject } from '../../lib/api';

type CategoryFilter = 'all' | CodeProjectCategory;
type InspirationItem =
  | { kind: 'published'; id: string; project: PublishedCodeProject }
  | { kind: 'seed'; id: string; project: CodeShowcaseProject };

interface CodeShowcasePageProps {
  onBack: () => void;
  onUsePrompt: (prompt: string) => void;
  onOpenCode: (project?: PublishedCodeProject) => void;
}

const COVER_POSITION: Record<CodeProjectCategory, string> = {
  education: '0% 0%',
  utility: '100% 0%',
  web: '0% 100%',
  interactive: '100% 100%',
};

function PublishedWorkCard({
  project,
  removing,
  onOpen,
  onUsePrompt,
  onRetract,
}: {
  project: PublishedCodeProject;
  removing: boolean;
  onOpen: () => void;
  onUsePrompt: () => void;
  onRetract: () => void;
}) {
  return (
    <article className="group overflow-hidden rounded-2xl border border-blue-200 bg-white transition hover:-translate-y-1 hover:shadow-lg">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h3 className="truncate text-[15px] font-medium">{project.title}</h3>
        <button type="button" onClick={onRetract} disabled={removing} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label={`撤回${project.title}`}>
          <Trash2 size={13} /> 撤回
        </button>
      </div>
      <button type="button" onClick={onOpen} className="relative block aspect-[16/9] w-full overflow-hidden bg-slate-100 text-left">
        <span role="img" aria-label={`${project.title}作品封面`} className="absolute inset-0 bg-cover bg-center transition duration-500 group-hover:scale-[1.025]" style={{ backgroundImage: `url(${project.cover_image})` }} />
        <span className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-blue-600 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100">打开 Code</span>
      </button>
      <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-400">
        <span>{project.category}</span>
        <button type="button" onClick={onUsePrompt} className="font-medium text-blue-600 hover:text-blue-800">同款指令</button>
      </div>
    </article>
  );
}

function InspirationCard({
  item,
  duplicate = false,
  onOpenCode,
  onUsePrompt,
}: {
  item: InspirationItem;
  duplicate?: boolean;
  onOpenCode: (project?: PublishedCodeProject) => void;
  onUsePrompt: (prompt: string) => void;
}) {
  const project = item.project;
  const published = item.kind === 'published';
  const prompt = published ? (item.project.optimized_prompt || item.project.prompt) : item.project.prompt;
  const coverStyle = published
    ? { backgroundImage: `url(${item.project.cover_image})` }
    : {
        backgroundImage: 'url(/code-showcase/covers-contact-sheet.png)',
        backgroundSize: '200% 200%',
        backgroundPosition: COVER_POSITION[item.project.category],
      };

  return (
    <article
      aria-hidden={duplicate || undefined}
      className={`group w-[19rem] shrink-0 overflow-hidden rounded-2xl border bg-white transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_45px_rgba(15,23,42,0.10)] sm:w-[22rem] lg:w-[24rem] ${published ? 'border-blue-200' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h3 className="truncate text-[15px] font-medium">{project.title}</h3>
        {published ? <span className="shrink-0 text-[11px] font-medium text-blue-600">我的作品</span> : (
          <button type="button" tabIndex={duplicate ? -1 : undefined} onClick={() => onUsePrompt(prompt)} className="shrink-0 text-xs font-medium text-blue-600 opacity-0 transition hover:text-blue-800 focus:opacity-100 group-hover:opacity-100">同款指令</button>
        )}
      </div>
      <button type="button" tabIndex={duplicate ? -1 : undefined} onClick={() => onOpenCode(published ? item.project : undefined)} aria-label={`打开${project.title}的 Code 工作台`} className="relative block aspect-[16/9] w-full overflow-hidden bg-slate-100 text-left">
        <span role="img" aria-label={`${project.title}作品封面`} className="absolute inset-0 bg-cover bg-center transition duration-500 group-hover:scale-[1.025]" style={coverStyle} />
        <span className="absolute right-3 top-3 rounded-full bg-white/92 px-3 py-1.5 text-xs font-medium text-blue-600 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100">打开 Code</span>
        <span className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/15 to-transparent opacity-0 transition group-hover:opacity-100" />
      </button>
      {published && (
        <div className="flex justify-end px-4 py-2">
          <button type="button" tabIndex={duplicate ? -1 : undefined} onClick={() => onUsePrompt(prompt)} className="text-xs font-medium text-blue-600 hover:text-blue-800">同款指令</button>
        </div>
      )}
    </article>
  );
}

function MarqueeRow({
  items,
  direction,
  rowIndex,
  onOpenCode,
  onUsePrompt,
}: {
  items: InspirationItem[];
  direction: 'left' | 'right';
  rowIndex: number;
  onOpenCode: (project?: PublishedCodeProject) => void;
  onUsePrompt: (prompt: string) => void;
}) {
  const filledItems = items.length >= 4
    ? items
    : Array.from({ length: Math.ceil(4 / items.length) }, () => items).flat().slice(0, 4);

  return (
    <div className="code-showcase-marquee" data-direction={direction} style={{ '--marquee-duration': `${44 + rowIndex * 5}s` } as CSSProperties}>
      <div className="code-showcase-marquee-track">
        {[false, true].map((duplicate) => (
          <div key={duplicate ? 'duplicate' : 'primary'} className="code-showcase-marquee-group" aria-hidden={duplicate || undefined}>
            {filledItems.map((item, index) => (
              <InspirationCard key={`${duplicate ? 'copy' : 'main'}-${item.id}-${index}`} item={item} duplicate={duplicate} onOpenCode={onOpenCode} onUsePrompt={onUsePrompt} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CodeShowcasePage({ onBack, onUsePrompt, onOpenCode }: CodeShowcasePageProps) {
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [prompt, setPrompt] = useState('');
  const [publishedProjects, setPublishedProjects] = useState<PublishedCodeProject[]>([]);
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);

  const seedProjects = useMemo(
    () => category === 'all' ? CODE_SHOWCASE_PROJECTS : CODE_SHOWCASE_PROJECTS.filter((project) => project.category === category),
    [category],
  );

  useEffect(() => {
    let active = true;
    void listCodeProjects()
      .then((result) => { if (active) setPublishedProjects(result.projects); })
      .catch(() => { if (active) setPublishedProjects([]); });
    return () => { active = false; };
  }, []);

  const visiblePublishedProjects = category === 'all'
    ? publishedProjects
    : publishedProjects.filter((project) => project.category === category);

  const inspirationRows = useMemo(() => {
    const items: InspirationItem[] = [
      ...visiblePublishedProjects.map((project) => ({ kind: 'published' as const, id: `published-${project.project_id}`, project })),
      ...seedProjects.map((project) => ({ kind: 'seed' as const, id: `seed-${project.id}`, project })),
    ];
    if (items.length === 0) return [];
    const rowCount = Math.min(3, Math.max(1, Math.ceil(items.length / 4)));
    return Array.from({ length: rowCount }, (_, rowIndex) => items.filter((_, index) => index % rowCount === rowIndex));
  }, [seedProjects, visiblePublishedProjects]);

  const applyPrompt = (value: string) => {
    setPrompt(value);
    window.requestAnimationFrame(() => document.getElementById('code-showcase-prompt')?.focus());
  };

  const retractProject = async (project: PublishedCodeProject) => {
    if (!window.confirm(`确定撤回“${project.title}”吗？撤回后它会从作品广场隐藏，但不会删除原来的 Code 会话。`)) return;
    setRemovingProjectId(project.project_id);
    try {
      await deleteCodeProject(project.project_id);
      setPublishedProjects((items) => items.filter((item) => item.project_id !== project.project_id));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '撤回作品失败，请稍后重试');
    } finally {
      setRemovingProjectId(null);
    }
  };

  return (
    <main className="h-full overflow-y-auto bg-[#fafafa] text-slate-950">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-xl sm:px-7">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950"><ArrowLeft size={17} /> 返回对话</button>
        <span className="inline-flex items-center gap-2 text-sm font-semibold"><Code2 size={17} /> Code 作品</span>
        <span className="w-20" aria-hidden="true" />
      </header>

      <section className="mx-auto max-w-[1500px] px-4 pb-16 pt-12 sm:px-7 sm:pt-16">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm"><Code2 size={21} /></div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">来和我一起 Coding 吧</h1>
          <p className="mt-3 text-sm text-slate-500 sm:text-base">从一个好点子出发，生成网页、工具和互动作品</p>
          <div className="mt-8 rounded-[24px] border border-slate-200 bg-white p-2.5 text-left shadow-[0_18px_55px_rgba(15,23,42,0.08)]">
            <textarea id="code-showcase-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder="描述你想创建的网页，或从下方选择一个同款指令" className="min-h-24 w-full resize-y rounded-2xl border-0 bg-transparent px-4 py-3 text-[15px] leading-6 text-slate-900 outline-none placeholder:text-slate-400" />
            <div className="flex items-center justify-between gap-3 px-2 pb-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"><Code2 size={14} /> 代码</span>
                <button type="button" disabled={!prompt.trim()} onClick={() => setPrompt((value) => optimizeCodePrompt(value))} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"><WandSparkles size={14} /> 优化指令</button>
              </div>
              <button type="button" disabled={!prompt.trim()} onClick={() => onUsePrompt(prompt)} aria-label="使用当前指令进入 Code 模式" className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-white transition hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400"><ArrowUp size={18} /></button>
            </div>
          </div>
        </div>

        <nav aria-label="作品分类" className="mt-12 flex items-center justify-center gap-1 overflow-x-auto border-b border-slate-200 sm:gap-4">
          {CODE_PROJECT_CATEGORIES.map((item) => (
            <button key={item.id} type="button" onClick={() => setCategory(item.id)} className={`relative shrink-0 px-3 py-3 text-sm transition ${category === item.id ? 'font-semibold text-slate-950' : 'text-slate-500 hover:text-slate-800'}`}>
              {item.label}{category === item.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-slate-950" />}
            </button>
          ))}
        </nav>

        {visiblePublishedProjects.length > 0 && (
          <section className="mt-8">
            <div className="mb-4 flex items-end justify-between">
              <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-600">Your work</p><h2 className="mt-1 text-xl font-semibold tracking-tight">我的作品</h2></div>
              <span className="text-xs text-slate-400">{visiblePublishedProjects.length} 个已发布作品</span>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {visiblePublishedProjects.map((project) => (
                <PublishedWorkCard key={project.project_id} project={project} removing={removingProjectId === project.project_id} onOpen={() => onOpenCode(project)} onUsePrompt={() => applyPrompt(project.optimized_prompt || project.prompt)} onRetract={() => void retractProject(project)} />
              ))}
            </div>
          </section>
        )}

        <section className="mt-10 overflow-hidden">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Inspiration</p><h2 className="mt-1 text-xl font-semibold tracking-tight">灵感作品</h2></div>
            <span className="hidden text-xs text-slate-400 sm:inline">悬停即可暂停浏览</span>
          </div>
          <div className="-mx-4 space-y-5 sm:-mx-7">
            {inspirationRows.map((items, rowIndex) => (
              <MarqueeRow key={`${category}-${rowIndex}`} items={items} rowIndex={rowIndex} direction={rowIndex % 2 === 0 ? 'right' : 'left'} onOpenCode={onOpenCode} onUsePrompt={applyPrompt} />
            ))}
          </div>
        </section>

        <div className="mt-10 flex items-center justify-center gap-2 text-xs text-slate-400"><Sparkles size={14} /> 更多作品与发布功能正在逐步开放</div>
      </section>
    </main>
  );
}
