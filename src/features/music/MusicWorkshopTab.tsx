'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import MusicSidebar, { type MusicTab } from './components/MusicSidebar';
import MusicShowcaseGrid from './components/MusicShowcaseGrid';
import VoiceSynthesisPage from './components/VoiceSynthesisPage';
import MusicCreationPage from './components/MusicCreationPage';
import VoiceLibraryPage from './components/VoiceLibraryPage';
import VoiceDesignPage from './components/VoiceDesignPage';
import VoiceClonePage from './components/VoiceClonePage';
import VoiceExtractionPage from './components/VoiceExtractionPage';
import MusicInspirationPage from './components/MusicInspirationPage';
import MusicEditorPage from './components/MusicEditorPage';
import { listSessions, type SessionSummary } from '../../lib/api';

const VALID_TABS: readonly MusicTab[] = [
  'compose',
  'music-creation',
  'music-editor',
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
  const searchParams = useSearchParams();
  
  // 从 URL 解析当前 tab，无效则默认 compose
  const [activeTab, setActiveTab] = useState<MusicTab>(() => {
    const tabFromUrl = pathname.split('/').pop() || initialTab || 'compose';
    return VALID_TABS.includes(tabFromUrl as MusicTab) ? (tabFromUrl as MusicTab) : 'compose';
  });
  const [musicSessions, setMusicSessions] = useState<SessionSummary[]>([]);
  const [activeMusicSessionId, setActiveMusicSessionId] = useState<string | null>(() => searchParams.get('session'));

  useEffect(() => {
    const sessionId = searchParams.get('session');
    if (sessionId) setActiveMusicSessionId(sessionId);
  }, [searchParams]);

  useEffect(() => {
    listSessions().then((result) => setMusicSessions(result.sessions.filter((item) => item.mode === 'music'))).catch(() => undefined);
  }, []);

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
      <MusicSidebar activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} musicSessions={musicSessions} activeMusicSessionId={activeMusicSessionId} onMusicSessionSelect={setActiveMusicSessionId} onNewMusicSession={() => setActiveMusicSessionId(null)} />

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto bg-slate-50 dark:bg-neutral-950">
        {activeTab === 'compose' ? (
          <MusicInspirationPage key={activeMusicSessionId ?? 'new'} activeSessionId={activeMusicSessionId} onSessionsChange={(sessions, activeId) => { setMusicSessions(sessions); if (activeId) setActiveMusicSessionId(activeId); }} />
        ) : activeTab === 'music-editor' ? (
          <div className="h-full p-2">
            <MusicEditorPage activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} />
          </div>
        ) : activeTab === 'voice-design' ? (
          <div className="h-full overflow-y-auto">
            <VoiceDesignPage activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} />
          </div>
        ) : activeTab === 'voice-clone' ? (
          <div className="h-full overflow-y-auto">
            <VoiceClonePage activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} />
          </div>
        ) : activeTab === 'voice-extraction' ? (
          <div className="h-full overflow-y-auto">
            <VoiceExtractionPage activeTab={activeTab} onTabChange={handleTabChange} onBack={handleBack} />
          </div>
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
