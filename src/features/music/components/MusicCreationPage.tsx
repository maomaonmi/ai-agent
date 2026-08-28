'use client';

import { useState } from 'react';
import {
  Mic,
  Music,
  Video,
  ChevronDown,
  Settings,
  Sparkles,
  Upload,
  Plus,
  Trash2,
  GripVertical,
  Music2,
  Palette,
  Volume2,
  Mic2,
  ArrowUpRight,
} from 'lucide-react';
import MusicSidebar, { type MusicTab } from './MusicSidebar';

interface MusicCreationPageProps {
  activeTab: MusicTab;
  onTabChange: (tab: MusicTab) => void;
  onBack: () => void;
}

const STYLE_TAGS = ['中国风', '管弦乐团', '键盘乐器', '蓝调', '古典', '世界音乐'];

export default function MusicCreationPage({ activeTab, onTabChange, onBack }: MusicCreationPageProps) {
  const [lyrics, setLyrics] = useState('');
  const [style, setStyle] = useState('');
  const [title, setTitle] = useState('');
  const [count, setCount] = useState(2);
  const [activeRightTab, setActiveRightTab] = useState<'works' | 'favorites'>('works');

  return (
    <div className="flex h-screen w-full bg-white text-slate-800">
      {/* 左侧专属侧边栏 */}
      <MusicSidebar activeTab={activeTab} onTabChange={onTabChange} onBack={onBack} />

      {/* 主内容区 */}
      <div className="flex flex-1 flex-col">
        {/* 顶部导航 */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-sky-600 px-6 py-3 text-white">
          <div className="flex items-center gap-8">
            <span className="text-xl font-bold">MINIMAX</span>
            <nav className="flex items-center gap-1">
              <button className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-white/80 hover:text-white">
                <Mic size={16} aria-hidden="true" />
                语音
              </button>
              <button className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-white">
                <Music size={16} aria-hidden="true" />
                音乐
              </button>
              <button className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-white/80 hover:text-white">
                <Video size={16} aria-hidden="true" />
                视频
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm">
              <span className="font-semibold">Music 3.0</span>
              创作者内测开启，限时免费活动继续
            </span>
            <button className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50">
              开始创作
            </button>
            <div className="flex items-center gap-2">
              <button className="rounded-full p-1 text-white/80 hover:text-white hover:bg-white/10">
                <Settings size={18} aria-hidden="true" />
              </button>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm font-medium">
                S
              </div>
            </div>
          </div>
        </header>

        {/* 主工作区 */}
        <main className="flex flex-1 overflow-hidden">
          {/* 左侧创作区 */}
          <div className="flex flex-1 flex-col p-6 overflow-y-auto">
            {/* 标题 + 模型 */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">音乐创作</h1>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                  <span className="text-xs text-slate-500">模型</span>
                  <button className="flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900">
                    Music 3.0
                    <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                      New
                    </span>
                    <ChevronDown size={12} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            {/* 参考音乐卡片 */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-sky-100">
                    <Music2 size={14} className="text-sky-700" aria-hidden="true" />
                  </div>
                  <span className="text-sm font-medium text-slate-700">参考音乐（可选）</span>
                </div>
                <span className="text-[11px] text-slate-500">点击添加参考上传，生成音乐更像（上传参考音服务量）</span>
              </div>
            </div>

            {/* 歌词输入 */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">歌词</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">上传歌词</span>
                  <div className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1">
                    <span className="text-[10px] text-slate-400">纯音乐</span>
                  </div>
                </div>
              </div>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="在此添加你的歌词，也可以输入 / 查看快捷输入规则结构
你可以在 [Intro]、[Verse]、[Chorus] 等标签后补充人声、人声、情绪等说明
如果未填写歌词，我们将根据风格为你自动生成"
                className="w-full h-40 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-slate-400">0 / 3,500 字符</span>
                <button className="text-xs text-slate-500 hover:text-slate-700">
                  <GripVertical size={14} className="inline-block mr-1" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* 风格输入 */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">风格</span>
                <button className="text-xs text-slate-500 hover:text-slate-700">
                  <Palette size={14} className="inline-block mr-1" aria-hidden="true" />
                </button>
              </div>
              <textarea
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder="描述音乐风格与制作要求，例如国风、伤感、欢快、乐段人声采集等"
                className="w-full h-24 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-slate-400">0 / 2,000 字符</span>
              </div>
            </div>

            {/* 风格标签 */}
            <div className="flex flex-wrap gap-2 mb-6">
              {STYLE_TAGS.map((tag) => (
                <button
                  key={tag}
                  className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-violet-300 hover:text-violet-700"
                >
                  <span className="text-[12px]">✕</span>
                  {tag}
                </button>
              ))}
            </div>

            {/* 歌曲名称 + 数量 */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="歌曲名称（可选）"
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">数量:</span>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1">
                    <button
                      onClick={() => setCount(Math.max(1, count - 1))}
                      className="w-6 h-6 rounded bg-slate-100 text-slate-600 hover:bg-slate-200"
                    >
                      —
                    </button>
                    <span className="w-6 text-center text-sm font-medium text-slate-700">{count}</span>
                    <button
                      onClick={() => setCount(Math.min(10, count + 1))}
                      className="w-6 h-6 rounded bg-slate-100 text-slate-600 hover:bg-slate-200"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1">
                  <Sparkles size={12} className="text-sky-600" aria-hidden="true" />
                  <span className="text-[11px] text-sky-700 font-medium">限时免费</span>
                </div>
              </div>
            </div>

            {/* 底部按钮 */}
            <button className="w-full rounded-xl bg-sky-600 py-3 text-sm font-medium text-white shadow-md shadow-sky-500/20 hover:bg-sky-700 transition">
              立即生成
            </button>
          </div>

          {/* 右侧面板 */}
          <aside className="flex w-96 flex-col border-l border-slate-200 bg-white">
            {/* 顶部标签页 */}
            <div className="flex border-b border-slate-200 px-6 pt-3">
              <button
                onClick={() => setActiveRightTab('works')}
                className={`flex-1 pb-2 text-sm font-medium transition ${
                  activeRightTab === 'works' ? 'border-b-2 border-sky-600 text-sky-700' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                作品
              </button>
              <button
                onClick={() => setActiveRightTab('favorites')}
                className={`flex-1 pb-2 text-sm font-medium transition ${
                  activeRightTab === 'favorites' ? 'border-b-2 border-sky-600 text-sky-700' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                收藏
              </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeRightTab === 'works' ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-24 h-24 mb-4 rounded-xl bg-slate-50 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                      <Music2 size={24} className="text-slate-300" aria-hidden="true" />
                    </div>
                  </div>
                  <p className="text-sm text-slate-500">
                    暂时没有作品，在此次文本中输入信息进行音乐创作
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-24 h-24 mb-4 rounded-xl bg-slate-50 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                      <Music2 size={24} className="text-slate-300" aria-hidden="true" />
                    </div>
                  </div>
                  <p className="text-sm text-slate-500">
                    收藏夹是空的
                  </p>
                </div>
              )}
            </div>
          </aside>
        </main>

        {/* 底部 */}
        <div className="border-t border-slate-200 px-6 py-2 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-slate-400">相关免责</span>
            <span className="text-[10px] text-slate-400">API</span>
            <span className="text-[10px] text-slate-400">用户协议</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">隐私政策</span>
            <span className="text-[10px] text-slate-400">•</span>
            <span className="text-[10px] text-slate-400">©MinMax 2024</span>
          </div>
        </div>

        {/* 右下角图标 */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
          <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-white">
            <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-xs">
              秒
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-sky-600 flex items-center justify-center text-white">
            <ArrowUpRight size={18} aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
