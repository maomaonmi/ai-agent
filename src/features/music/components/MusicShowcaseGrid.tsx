'use client';

import { useMemo, useState } from 'react';
import { MUSIC_TAG_LABELS, filterTracks, type MusicTag, type MusicTrack } from '../musicCatalog';
import MusicCoverCard from './MusicCoverCard';

const TABS: readonly MusicTag[] = ['featured', 'remix', 'accompaniment'];

interface MusicShowcaseGridProps {
  readonly initialTab?: MusicTag;
  readonly onUseTemplate?: (track: MusicTrack) => void;
}

export default function MusicShowcaseGrid({ initialTab = 'featured', onUseTemplate }: MusicShowcaseGridProps) {
  const [activeTab, setActiveTab] = useState<MusicTag>(initialTab);
  const tracks = useMemo(() => filterTracks(activeTab), [activeTab]);

  return (
    <section aria-label="灵感作品" className="flex w-full flex-col gap-5">
      <div role="tablist" aria-label="作品分类" className="flex items-center gap-2">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              activeTab === tab
                ? 'bg-sky-500 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800/70 dark:text-neutral-300 dark:hover:bg-neutral-800'
            }`}
          >
            {MUSIC_TAG_LABELS[tab]}
          </button>
        ))}
      </div>

      {tracks.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400 dark:text-neutral-500">暂无内容</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {tracks.map((track, index) => (
            <MusicCoverCard key={track.id} track={track} eager={index < 5} onUseTemplate={onUseTemplate} />
          ))}
        </div>
      )}
    </section>
  );
}
