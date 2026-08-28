'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import MusicSidebar, { type MusicTab } from './components/MusicSidebar';
import MusicInspirationComposer from './components/MusicInspirationComposer';
import MusicShowcaseGrid from './components/MusicShowcaseGrid';
import VoiceSynthesisPage from './components/VoiceSynthesisPage';
import MusicCreationPage from './components/MusicCreationPage';
import VoiceLibraryPage from './components/VoiceLibraryPage';
import VoiceDesignPage from './components/VoiceDesignPage';
import VoiceClonePage from './components/VoiceClonePage';
import VoiceExtractionPage from './components/VoiceExtractionPage';

const VALID_TABS: readonly MusicTab[] = [
  'compose',
  'music-creation',
  'voice-synthesis',
  'voice-library',
  'accompaniment',
  'voice-design',
  'voice-clone',
  'voice-extraction',
  'history',
  'favorites',
];

interface MusicWorkshopTabProps {
  initialTab: string;
}

export default function MusicWorkshopTab({ initialTab }: MusicWorkshopTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  
  // 从 URL 解析当前 tab，无效则默认 compose
  const [activeTab, setActiveTab] = useState<MusicTab>(() => {
    const tabFromUrl = pathname.split('/').pop() || 'compose';
    return VALID_TABS.includes(tabFromUrl as MusicTab) ? (tabFromUrl as MusicTab) : 'compose';
  });

  // Why: 同步 URL 路由与状态，确保刷新后保持当前页面
  const handleTabChange = (tab: MusicTab) => {
    setActiveTab(tab);
    router.push(`/music/${tab}`, { scroll: false });
  };

  const handleBack = () => {
    window.location.assign('/');
  };

  // 语音合成页面使用完全独立的样式（白色背景）
  if (activeTab === 'voice-synthesis') {
    return <VoiceSynthesisPage activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} />;
  }
  // 音乐创作页面
  if (activeTab === 'music-creation') {
    return <MusicCreationPage activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} />;
  }
  // 音色库页面
  if (activeTab === 'voice-library') {
    return <VoiceLibraryPage activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/* 左侧专属侧边栏 */}
      <MusicSidebar activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} />

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto bg-white dark:bg-neutral-900">
        {activeTab === 'compose' ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-12 px-6 py-8">
            <MusicInspirationComposer />
            <MusicShowcaseGrid />
          </div>
        ) : activeTab === 'voice-design' ? (
          <VoiceDesignPage activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} />
        ) : activeTab === 'voice-clone' ? (
          <VoiceClonePage activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} />
        ) : activeTab === 'voice-extraction' ? (
          <VoiceExtractionPage activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} />
        ) : (
          <div className="mx-auto w-full max-w-6xl px-6 py-8">
            <MusicShowcaseGrid 
              initialTab={activeTab === 'accompaniment' ? 'accompaniment' : 'featured'} 
            />
          </div>
        )}
      </main>
    </div>
  );
}
