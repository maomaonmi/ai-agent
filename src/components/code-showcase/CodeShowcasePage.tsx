'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUp, Code2, Sparkles, Trash2, WandSparkles } from 'lucide-react';
import { CODE_PROJECT_CATEGORIES, CODE_SHOWCASE_PROJECTS, CodeProjectCategory, optimizeCodePrompt } from './projects';
import { deleteCodeProject, listCodeProjects, PublishedCodeProject } from '../../lib/api';

type CategoryFilter = 'all' | CodeProjectCategory;

interface CodeShowcasePageProps {
  onBack: () => void;
  onUsePrompt: (prompt: string) => void;
  onOpenCode: (project?: PublishedCodeProject) => void;
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
    // Fetch the complete independent showcase once, then filter locally. This keeps a newly published
    // project visible in both “全部” and its category even when a stale server cache ignores a query.
    void listCodeProjects()
      .then((result) => { if (active) setPublishedProjects(result.projects); })
      .catch(() => { if (active) setPublishedProjects([]); });
    return () => { active = false; };
  }, []);

  const visiblePublishedProjects = category === 'all'
    ? publishedProjects
    : publishedProjects.filter((project) => project.category === category);

  const applyPrompt = (value: string) => {
    setPrompt(value);
    window.requestAnimationFrame(() => document.getElementById('code-showcase-prompt')?.focus());
  };

  const optimizePrompt = () => setPrompt((value) => optimizeCodePrompt(value));

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

  const coverPosition: Record<CodeProjectCategory, string> = {
    education: '0% 0%', utility: '100% 0%', web: '0% 100%', interactive: '100% 100%',
  };

  return (
    <main className="h-full overflow-y-auto bg-[#fafafa] text-slate-950">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-xl sm:px-7">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950"><ArrowLeft size={17}/> 返回对话</button>
        <span className="inline-flex items-center gap-2 text-sm font-semibold"><Code2 size={17}/> Code 作品</span>
        <span className="w-20" aria-hidden="true" />
      </header>

      <section className="mx-auto max-w-[1500px] px-4 pb-16 pt-12 sm:px-7 sm:pt-16">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm"><Code2 size={21}/></div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">来和我一起 Coding 吧</h1>
          <p className="mt-3 text-sm text-slate-500 sm:text-base">从一个好点子出发，生成网页、工具和互动作品</p>
          <div className="mt-8 rounded-[24px] border border-slate-200 bg-white p-2.5 text-left shadow-[0_18px_55px_rgba(15,23,42,0.08)]">
            <textarea id="code-showcase-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} placeholder="描述你想创建的网页，或从下方选择一个同款指令" className="min-h-24 w-full resize-y rounded-2xl border-0 bg-transparent px-4 py-3 text-[15px] leading-6 text-slate-900 outline-none placeholder:text-slate-400" />
            <div className="flex items-center justify-between gap-3 px-2 pb-1">
              <div className="flex items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"><Code2 size={14}/> 代码</span><button type="button" disabled={!prompt.trim()} onClick={optimizePrompt} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"><WandSparkles size={14}/> 优化指令</button></div>
              <button type="button" disabled={!prompt.trim()} onClick={() => onUsePrompt(prompt)} aria-label="使用当前指令进入 Code 模式" className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-white transition hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400"><ArrowUp size={18}/></button>
            </div>
          </div>
        </div>

        <nav aria-label="作品分类" className="mt-12 flex items-center justify-center gap-1 overflow-x-auto border-b border-slate-200 sm:gap-4">
          {CODE_PROJECT_CATEGORIES.map((item) => <button key={item.id} type="button" onClick={() => setCategory(item.id)} className={`relative shrink-0 px-3 py-3 text-sm transition ${category === item.id ? 'font-semibold text-slate-950' : 'text-slate-500 hover:text-slate-800'}`}>{item.label}{category === item.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-slate-950"/>}</button>)}
        </nav>

        {visiblePublishedProjects.length > 0 && <section className="mt-8"><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-600">Your work</p><h2 className="mt-1 text-xl font-semibold tracking-tight">我的作品</h2></div><span className="text-xs text-slate-400">{visiblePublishedProjects.length} 个已发布作品</span></div><div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{visiblePublishedProjects.map((project) => <article key={project.project_id} className="group overflow-hidden rounded-2xl border border-blue-200 bg-white transition hover:-translate-y-1 hover:shadow-lg"><div className="flex items-center justify-between gap-3 px-4 py-3"><h3 className="truncate text-[15px] font-medium">{project.title}</h3><button type="button" onClick={() => void retractProject(project)} disabled={removingProjectId === project.project_id} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label={`撤回${project.title}`}><Trash2 size={13}/> 撤回</button></div><button type="button" onClick={() => onOpenCode(project)} className="relative block aspect-[16/9] w-full overflow-hidden bg-slate-100 text-left"><span role="img" aria-label={`${project.title}作品封面`} className="absolute inset-0 bg-cover bg-center transition duration-500 group-hover:scale-[1.025]" style={{ backgroundImage: `url(${project.cover_image})` }}/><span className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-blue-600 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100">打开 Code</span></button><div className="flex items-center justify-between px-4 py-2 text-xs text-slate-400"><span>{project.category}</span><button type="button" onClick={() => applyPrompt(project.optimized_prompt || project.prompt)} className="font-medium text-blue-600 hover:text-blue-800">同款指令</button></div></article>)}</div></section>}

        <section className="mt-8"><div className="mb-4"><p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Inspiration</p><h2 className="mt-1 text-xl font-semibold tracking-tight">灵感作品</h2></div><div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visiblePublishedProjects.map((project) => <article key={`inspiration-${project.project_id}`} className="group overflow-hidden rounded-2xl border border-blue-100 bg-white transition duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-[0_18px_45px_rgba(15,23,42,0.10)]"><div className="flex items-center justify-between gap-3 px-4 py-3"><h2 className="truncate text-[15px] font-medium">{project.title}</h2><span className="text-[11px] text-blue-600">我的作品</span></div><button type="button" onClick={() => onOpenCode(project)} aria-label={`打开${project.title}的 Code 页面`} className="relative block aspect-[16/9] w-full overflow-hidden bg-slate-100 text-left"><span role="img" aria-label={`${project.title}作品封面`} className="absolute inset-0 bg-cover bg-center transition duration-500 group-hover:scale-[1.025]" style={{ backgroundImage: `url(${project.cover_image})` }}/><span className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-blue-600 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100">打开 Code</span></button><div className="flex items-center justify-end px-4 py-2"><button type="button" onClick={() => applyPrompt(project.optimized_prompt || project.prompt)} className="text-xs font-medium text-blue-600 hover:text-blue-800">同款指令</button></div></article>)}
          {seedProjects.map((project) => <article key={project.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white transition duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-[0_18px_45px_rgba(15,23,42,0.10)] focus-within:-translate-y-1 focus-within:border-slate-400"><div className="flex items-center justify-between gap-3 px-4 py-3"><h2 className="truncate text-[15px] font-medium">{project.title}</h2><button type="button" onClick={() => applyPrompt(project.prompt)} className="shrink-0 text-xs font-medium text-blue-600 opacity-0 transition hover:text-blue-800 focus:opacity-100 group-hover:opacity-100">同款指令</button></div><button type="button" onClick={() => onOpenCode()} aria-label={`打开${project.title}的 Code 页面`} className="relative block aspect-[16/9] w-full overflow-hidden bg-slate-100 text-left"><span role="img" aria-label={`${project.title}作品封面`} className="absolute inset-0 bg-cover transition duration-500 group-hover:scale-[1.025]" style={{ backgroundImage: 'url(/code-showcase/covers-contact-sheet.png)', backgroundSize: '200% 200%', backgroundPosition: coverPosition[project.category] }}/><span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/20 to-transparent opacity-0 transition group-hover:opacity-100"/></button></article>)}
        </div></section>
        <div className="mt-10 flex items-center justify-center gap-2 text-xs text-slate-400"><Sparkles size={14}/> 更多作品与发布功能正在逐步开放</div>
      </section>
    </main>
  );
}
