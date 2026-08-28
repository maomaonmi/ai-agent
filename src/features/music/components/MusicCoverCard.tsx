'use client';

import { useState } from 'react';
import { Heart, Play } from 'lucide-react';
import { MUSIC_TAG_LABELS, type MusicTrack } from '../musicCatalog';

interface MusicCoverCardProps {
  readonly track: MusicTrack;
  readonly eager?: boolean;
}

export default function MusicCoverCard({ track, eager = false }: MusicCoverCardProps) {
  const [failed, setFailed] = useState(false);

  return (
    <article className="group flex flex-col gap-2">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-200 dark:bg-neutral-800">
        {failed ? (
          // Why: 封面 404/加载失败时以渐变占位块兜底，保持网格布局不塌（design 段8 异常表）。
          <div
            role="img"
            aria-label={`${track.title} 封面加载失败`}
            className="h-full w-full bg-gradient-to-br from-sky-900 via-slate-300 to-slate-400 dark:from-sky-900 dark:via-neutral-800 dark:to-neutral-900"
          />
        ) : (
          <img
            src={track.cover}
            alt={`${track.title} 封面`}
            loading={eager ? 'eager' : 'lazy'}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        )}
        <span className="absolute left-2 top-2 rounded-md bg-black/55 px-2 py-0.5 text-[11px] font-medium text-sky-300 backdrop-blur-sm">
          {MUSIC_TAG_LABELS[track.tag]}
        </span>
        {(track.plays ?? track.likes) && (
          <span className="absolute bottom-2 right-2 flex items-center gap-2 rounded-md bg-black/55 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm">
            {track.plays && (
              <span className="flex items-center gap-1">
                <Play size={10} aria-hidden="true" />{track.plays}
              </span>
            )}
            {track.likes && (
              <span className="flex items-center gap-1">
                <Heart size={10} aria-hidden="true" />{track.likes}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-medium text-slate-900 dark:text-neutral-100">{track.title}</h3>
        <p className="truncate text-xs text-slate-500 dark:text-neutral-400">
          {track.artist} · {track.duration}
        </p>
      </div>
    </article>
  );
}
