'use client';

import { useState } from 'react';
import MusicSidebar, { type MusicTab } from './components/MusicSidebar';
import MusicInspirationComposer from './components/MusicInspirationComposer';
import MusicShowcaseGrid from './components/MusicShowcaseGrid';
import VoiceSynthesisPage from './components/VoiceSynthesisPage';
import MusicCreationPage from './components/MusicCreationPage';
import VoiceLibraryPage from './components/VoiceLibraryPage';

export default function MusicWorkshopHome() {
  const [activeTab, setActiveTab] = useState<MusicTab>('compose');

  const handleBack = () => {
    // Why: 与 ppt 页一致的整页跳转范式（design D1），返回聊天主页。
    window.location.assign('/');
  };

  // 语音合成页面使用完全独立的样式（白色背景）
  if (activeTab === 'voice-synthesis') {
    return <VoiceSynthesisPage activeTab={activeTab} onTabChange={setActiveTab} onBack={handleBack} />;
  }
  // 音乐创作页面
  if (activeTab === 'music-creation') {
    return <MusicCreationPage activeTab={activeTab} onTabChange={setActiveTab} onBack={handleBack} />;
  }
  // 音色库页面
  if (activeTab === 'voice-library') {
    return <VoiceLibraryPage activeTab={activeTab} onTabChange={setActiveTab} onBack={handleBack} />;
  }

  return (
    // Why: 页面跟随全局主题（浅色默认 + dark 变体），与主页面 appearance 设置同步。
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/* 左侧专属侧边栏 */}
      <MusicSidebar activeTab={activeTab} onTabChange={setActiveTab} onBack={handleBack} />

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'compose' ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-6 py-8">
            <MusicInspirationComposer />
            {/* compose 页也展示精选网格 */}
            <MusicShowcaseGrid />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-6xl px-6 py-8">
            <MusicShowcaseGrid initialTab={activeTab === 'accompaniment' ? 'accompaniment' : 'featured'} />
          </div>
        )}
      </main>
    </div>
  );
}
