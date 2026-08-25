'use client';

import { ArrowLeft, ChevronDown, FileText, Mic, Play, Search, Sparkles, Upload, Video, X } from 'lucide-react';
import Image from 'next/image';
import type { OmniComposerCapability } from './composerCapabilities';

type ShowcaseCapability = Exclude<OmniComposerCapability, 'omni' | 'music'>;

type PptTemplate = { title: string; sub?: string; image?: string; special?: boolean };
const pptTemplates: PptTemplate[] = [
  { title: '智能推荐', special: true }, { title: '黄白商业汇报', sub: '高级商业汇报', image: '/omni/covers/business.jpg' },
  { title: '通用森林光影风', sub: '重塑绿色未来', image: '/omni/covers/forest.jpg' }, { title: '高级几何空间商务…', sub: '2025年终高颜', image: '/omni/covers/geometric.jpg' },
  { title: '高级商务风格', sub: '专属商务春夏日', image: '/omni/covers/business.jpg' }, { title: '唯美油画风', sub: '印象派光影艺术', image: '/omni/covers/oil-painting.jpg' },
  { title: '创意多色插画', sub: '年度品牌创意', image: '/omni/covers/hand-drawn.jpg' }, { title: '超现实主义插画风', sub: '超现实主义集锦', image: '/omni/covers/geometric.jpg' },
  { title: '波普艺术风格', sub: 'CREATIVE PORTFOLIO', image: '/omni/covers/hand-drawn.jpg' }, { title: '传统新中式', sub: '空山新雨', image: '/omni/covers/new-chinese.jpg' },
  { title: '水墨风格', sub: '谷雨', image: '/omni/covers/ink-wash.jpg' }, { title: '农业科技质感风', sub: '2026冬小麦', image: '/omni/covers/forest.jpg' },
  { title: '插画手绘风', sub: 'LUMINA', image: '/omni/covers/hand-drawn.jpg' }, { title: '轻奢深绿莫兰迪配色风', sub: '雅境·私享运动俱乐部', image: '/omni/covers/forest.jpg' },
  { title: '通用极简风', sub: 'NexusAI 展板', image: '/omni/covers/geometric.jpg' }, { title: '高级质感摄影风', image: '/omni/covers/geometric.jpg' },
  { title: '乡村油画风', sub: '云栖谷·乡村生态艺术聚落', image: '/omni/covers/oil-painting.jpg' }, { title: '森系自然风', sub: '森系·生态环境保护', image: '/omni/covers/forest.jpg' },
  { title: '艺术研究风', sub: '现代艺术馆策划', image: '/omni/covers/oil-painting.jpg' }, { title: '植物美学风', sub: '毕业答辩汇报', image: '/omni/covers/forest.jpg' },
  { title: '暗黑高级建筑风', sub: '2026年商务年度', image: '/omni/covers/vintage-black-gold.jpg' }, { title: '红调城市商务风', sub: '城脉文创', image: '/omni/covers/new-chinese.jpg' },
  { title: '轻奢奶油风', sub: '2026年商务', image: '/omni/covers/oil-painting.jpg' }, { title: '赛博朋克科技风', sub: 'AI发展趋势', image: '/omni/covers/cyberpunk.jpg' },
  { title: '山野冷调摄影风', sub: '山野考察', image: '/omni/covers/ink-wash.jpg' }, { title: '传统中式水墨风', sub: '氤氲', image: '/omni/covers/ink-wash.jpg' },
  { title: '小清新油画风', sub: '晨露农场', image: '/omni/covers/hand-drawn.jpg' }, { title: '高饱和水彩风', sub: '中国传统文化建设', image: '/omni/covers/hand-drawn.jpg' },
  { title: '复古黑金轻奢风', sub: '匠人记忆', image: '/omni/covers/vintage-black-gold.jpg' }, { title: '黑白线性插画', sub: '2026年文化活动', image: '/omni/covers/geometric.jpg' },
  { title: '蓝白卡片', sub: '新能源汽车市场数据分析', image: '/omni/covers/blue-card.jpg' },
];

const imageGallery = [
  ['new-year-girl.jpg', '新春快乐'], ['desk-figure.jpg', 'AI 娃娃'], ['cat-illustration.jpg', '萌宠领养'], ['fantasy-unicorn.jpg', '梦幻独角兽'], ['dogs-grid.jpg', '比熊九宫格'],
  ['beach-sunset.jpg', '2026 天天开心'], ['meadow-girl.jpg', '自由与浪漫'], ['ice-cream.jpg', '冰淇淋三色'], ['fireworks.jpg', '烟花'], ['sparkler-girl.jpg', '仙女棒'],
  ['new-year-dinner.jpg', '年夜饭'], ['perfume-ad.jpg', '香水广告'], ['reading-dog.jpg', '读书柴犬'], ['tea-ceremony.jpg', '茶道'], ['cartoon-friends.jpg', '兔狐搭档'],
  ['dragon-dance.jpg', '舞龙'], ['ancient-scholars.jpg', '古风雅集'], ['tropical-girl.png', '绿植少女'], ['happy-pomeranian.png', '微笑博美'], ['pets-together.jpg', '萌宠合照'],
] as const;

const tabs: Record<ShowcaseCapability, string[]> = {
  ppt: ['热门模板', '课堂教育', '科研论文', '工作汇报'], image: ['精选', '海报', '电商', '人像'], video: ['文生视频', '图生视频', '视频延展'], research: ['深度研究', '资料综述', '竞品分析'], writing: ['文章', '论文', '报告', '宣传文案'],
};

const meta: Record<ShowcaseCapability, { title: string; subtitle: string; placeholder: string }> = {
  ppt: { title: '万物皆可PPT', subtitle: '帮你制作言之有物、设计精美的智能PPT', placeholder: '告诉我你想制作什么主题的PPT…' },
  image: { title: '创意生图 · 智能修图', subtitle: '支持图像生成与编辑，快速实现创意设计', placeholder: '描述你想生成或编辑的画面…' },
  video: { title: '灵感变成视频', subtitle: '文字、图片都可以成为一段有镜头感的作品', placeholder: '描述镜头、人物动作和视频氛围…' },
  research: { title: '深度研究', subtitle: '让复杂问题变成有来源、有结构的研究结论', placeholder: '输入你想研究的主题或问题…' },
  writing: { title: 'AI 写作', subtitle: '从一个想法开始，完成文章、论文和专业文案', placeholder: '告诉我你想写什么…' },
};

export default function OmniModeShowcase({ capability, initialPrompt, onBack, onUsePrompt, sidebarCollapsed = false, embedded = false, pageOnly = false, onCancel, onOpenWritingWorkspace }: { capability: ShowcaseCapability; initialPrompt?: string; onBack: () => void; onUsePrompt: (prompt: string) => void; sidebarCollapsed?: boolean; embedded?: boolean; pageOnly?: boolean; onCancel?: () => void; onOpenWritingWorkspace?: () => void }) {
  const info = meta[capability];
  const prompt = initialPrompt?.trim() || '';
  return (
    <div className={embedded ? 'max-h-[56vh] overflow-y-auto rounded-xl border border-slate-200 bg-[#f8faff] text-slate-800' : pageOnly ? 'mx-auto w-full overflow-y-auto bg-[#f6f8fb] text-slate-800' : `fixed inset-y-0 right-0 z-[120] overflow-y-auto bg-[#f6f8fb] text-slate-800 ${sidebarCollapsed ? 'lg:left-14' : 'lg:left-72'}`}>
      <div className={embedded ? 'mx-auto p-2 sm:p-3' : 'mx-auto min-h-full max-w-[1440px] px-5 pb-16 pt-7 sm:px-10 lg:px-16'}>
        {!embedded && !pageOnly && <div className="mb-8 flex items-center justify-between">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-500 transition hover:bg-white hover:text-slate-900"><ArrowLeft size={17} /> 回到全能对话</button>
          <span className="rounded-full border border-slate-200 bg-white/70 px-3 py-1 text-xs text-slate-400">全能模式 · 素材中心</span>
        </div>}
        {!embedded && <header className="text-center">
          <h1 className="text-[28px] font-bold tracking-tight text-slate-900 sm:text-[34px]">{info.title}</h1>
          <p className="mt-3 text-[15px] text-slate-500">{info.subtitle}</p>
        </header>}
        {!embedded && !pageOnly && <div className="mx-auto mt-7 max-w-[820px] rounded-2xl bg-white p-4 shadow-[0_10px_32px_rgba(15,23,42,0.08)] ring-1 ring-slate-100">
          <div className="min-h-12 px-2 text-[15px] leading-7 text-slate-500">{prompt || info.placeholder}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
            <button type="button" onClick={() => onUsePrompt(prompt || info.placeholder)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-50 px-3 font-medium text-indigo-600"><Sparkles size={15} /> {capability === 'ppt' ? 'PPT创作' : capability === 'image' ? 'AI生图' : capability === 'video' ? 'AI生视频' : capability === 'research' ? '深度研究' : 'AI写作'} <span className="text-indigo-300">×</span></button>
            <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-slate-500 hover:bg-slate-50">专家模式 <ChevronDown size={14} /></button>
            <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-slate-500 hover:bg-slate-50">参考资料 <ChevronDown size={14} /></button>
            <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-slate-500 hover:bg-slate-50">{capability === 'ppt' ? '页数' : capability === 'image' ? '比例 3:4' : capability === 'video' ? '16:9 · 720P' : '输出设置'} <ChevronDown size={14} /></button>
            <span className="ml-auto hidden items-center gap-2 text-slate-400 sm:flex"><Upload size={15} /> <Mic size={16} /><button type="button" onClick={() => onUsePrompt(prompt || info.placeholder)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white hover:bg-indigo-600"><ArrowLeft className="rotate-90" size={17} /></button></span>
          </div>
        </div>}
        {pageOnly && <div className="h-[270px]" aria-hidden="true" />}
        {embedded && <div className="mb-2 flex items-center justify-between px-1"><span className="text-xs font-medium text-slate-500">{info.title} · 选择内容格式</span><button type="button" onClick={onCancel ?? onBack} aria-label="取消当前模式" className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700"><X size={16} /></button></div>}
        <div className={`${embedded ? 'mt-1' : 'mt-8'} mx-auto flex max-w-[1120px] items-center justify-center gap-5 overflow-x-auto border-b border-slate-200/80`}>{tabs[capability].map((tab, index) => <button key={tab} type="button" className={`shrink-0 px-1 pb-3 text-sm ${index === 0 ? 'border-b-2 border-slate-800 font-medium text-slate-900' : 'text-slate-400 hover:text-slate-700'}`}>{tab}</button>)}</div>
        {capability === 'ppt' && <div className="mx-auto mt-7 grid max-w-[1280px] grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{pptTemplates.map((template) => <button type="button" key={template.title} onClick={() => onUsePrompt(`请使用“${template.title}”风格制作一份PPT${template.sub ? `，主题参考：${template.sub}` : ''}`)} className="group min-w-0 text-left"><div className="relative aspect-[1.34] overflow-hidden rounded-xl bg-gradient-to-br from-indigo-50 via-white to-slate-200 shadow-sm ring-1 ring-slate-200 transition group-hover:-translate-y-0.5 group-hover:shadow-lg">{template.image ? <Image src={template.image} alt={template.title} fill sizes="(max-width: 640px) 50vw, (max-width: 1280px) 25vw, 16vw" className="object-cover" /> : <><div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-slate-500/70 to-transparent" /><Sparkles className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-indigo-500" size={34} /></>}{template.sub && <span className="absolute bottom-2 left-2 right-2 truncate text-xs font-medium text-white drop-shadow">{template.sub}</span>}</div><span className="mt-2 block truncate text-sm text-slate-600">{template.title}</span></button>)}</div>}
        {capability === 'image' && <div className="mx-auto mt-7 grid max-w-[1120px] grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">{imageGallery.map(([src, label]) => <button type="button" key={src} onClick={() => onUsePrompt(`参考“${label}”的视觉风格生成一张图片`)} className="group text-left"><div className="relative aspect-square overflow-hidden rounded-xl bg-slate-100 shadow-sm ring-1 ring-slate-200"><Image src={`/omni/gallery/${src}`} alt={label} fill sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw" className="object-cover transition duration-300 group-hover:scale-105" /></div><span className="mt-2 block truncate text-sm text-slate-600">{label}</span></button>)}</div>}
        {capability === 'video' && <VideoLanding onUsePrompt={onUsePrompt} prompt={prompt} />}
        {capability === 'research' && <ResearchLanding onUsePrompt={onUsePrompt} />}
        {capability === 'writing' && <WritingLanding onUsePrompt={onUsePrompt} onOpenWorkspace={onOpenWritingWorkspace} />}
      </div>
    </div>
  );
}

function VideoLanding({ onUsePrompt, prompt }: { onUsePrompt: (prompt: string) => void; prompt: string }) {
  const cards = [['文生视频', '从一句话生成完整镜头', '生成一段电影感的城市夜景'], ['图生视频', '让静态图片动起来', '把这张图片制作成镜头运动视频'], ['视频延展', '延续原片的节奏与画面', '延续这段视频的氛围和运镜']];
  return <div className="mx-auto mt-8 grid max-w-[1120px] gap-5 md:grid-cols-3">{cards.map(([title, desc, sample]) => <button type="button" key={title} onClick={() => onUsePrompt(prompt || sample)} className="group rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg"><div className="mb-7 flex h-36 items-center justify-center rounded-xl bg-gradient-to-br from-slate-900 via-indigo-900 to-violet-700 text-white"><Play className="fill-white opacity-90" size={34} /></div><div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Video size={18} className="text-indigo-500" />{title}</div><p className="mt-2 text-sm text-slate-500">{desc}</p><span className="mt-5 inline-flex rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">开始创作 →</span></button>)}</div>;
}

function ResearchLanding({ onUsePrompt }: { onUsePrompt: (prompt: string) => void }) {
  const prompts = ['近三年新能源车竞争格局与趋势研究', '大语言模型当前的主要研究方向整理', '国际咨询公司 AI 战略服务与竞争策略', '生成式 AI 在教育行业的落地案例', '某行业头部公司的商业模式对比', '帮我查找一份可信的市场数据报告'];
  return <div className="mx-auto mt-8 max-w-[1040px]"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{prompts.map((prompt) => <button type="button" key={prompt} onClick={() => onUsePrompt(prompt)} className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-600 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700"><Search size={16} className="mb-3 text-indigo-500" />{prompt}</button>)}</div><div className="mt-8 grid gap-4 md:grid-cols-3">{[['全网检索', '聚合网页、论文、报告与最新动态'], ['多阶段分析', '自动拆解问题并交叉验证来源'], ['结构化结论', '输出带引用的研究报告与行动建议']].map(([title, desc]) => <div key={title} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200"><div className="text-base font-semibold text-slate-900">{title}</div><p className="mt-2 text-sm leading-6 text-slate-500">{desc}</p></div>)}</div></div>;
}

function WritingLanding({ onUsePrompt, onOpenWorkspace }: { onUsePrompt: (prompt: string) => void; onOpenWorkspace?: () => void }) {
  const formats = [['文章', '公众号、博客、长文内容'], ['论文', '学术论文与研究章节'], ['报告', '商业分析与项目汇报'], ['宣传文案', '品牌、产品与营销文案']];
  return <div className="mx-auto mt-8 max-w-[960px]"><div className="grid gap-4 sm:grid-cols-2">{formats.map(([title, desc]) => <button type="button" key={title} onClick={() => onUsePrompt(`请帮我写一份${title}，主题是`)} className="group rounded-2xl border border-slate-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"><div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><FileText size={22} /></div><div className="text-lg font-semibold text-slate-900">{title}</div><p className="mt-2 text-sm text-slate-500">{desc}</p><span className="mt-5 inline-block text-sm text-indigo-600">开始写作 →</span></button>)}</div>{onOpenWorkspace && <div className="mt-6 flex items-center justify-center"><button type="button" onClick={onOpenWorkspace} className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-5 py-3 text-sm font-medium text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100"><FileText size={16} />使用大纲工作流：先定结构，再生成正文</button></div>}</div>;
}
