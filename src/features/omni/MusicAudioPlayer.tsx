'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface MusicAudioPlayerProps {
  src: string;
  title: string;
  dark?: boolean;
  compact?: boolean;
}

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const wholeSeconds = Math.floor(seconds);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
};

export default function MusicAudioPlayer({ src, title, dark = false, compact = false }: MusicAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
  }, [src]);

  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const trackColor = dark ? 'rgba(255,255,255,0.18)' : 'rgba(148,163,184,0.22)';
  const fillColor = dark ? '#67e8f9' : '#0284c7';

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  return (
    <div className={`music-audio-player flex items-center gap-3 ${compact ? 'py-0.5' : 'py-1'}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="sr-only"
        aria-label={title}
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(event) => { event.currentTarget.currentTime = 0; setPlaying(false); setCurrentTime(0); }}
      />
      <button
        type="button"
        onClick={togglePlayback}
        aria-label={playing ? `暂停${title}` : `播放${title}`}
        className={`flex shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${compact ? 'h-8 w-8' : 'h-9 w-9'} ${dark ? 'bg-white text-slate-950 hover:bg-sky-100' : 'bg-sky-600 text-white hover:bg-sky-700'}`}
      >
        {playing ? <Pause size={compact ? 14 : 15} fill="currentColor" aria-hidden="true" /> : <Play size={compact ? 14 : 15} fill="currentColor" className="translate-x-px" aria-hidden="true" />}
      </button>
      <span className={`shrink-0 font-mono text-[11px] tabular-nums ${dark ? 'text-white/70' : 'text-slate-500'}`} aria-label="播放时间">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
      <input
        type="range"
        min="0"
        max={duration || 0}
        step="0.01"
        value={Math.min(currentTime, duration || 0)}
        disabled={!duration}
        onChange={(event) => {
          const nextTime = Number(event.target.value);
          if (audioRef.current) audioRef.current.currentTime = nextTime;
          setCurrentTime(nextTime);
        }}
        aria-label={`调整${title}播放进度`}
        className={`music-player-range min-w-0 flex-1 ${dark ? 'music-player-range-dark' : 'music-player-range-light'}`}
        style={{ background: `linear-gradient(to right, ${fillColor} ${progress}%, ${trackColor} ${progress}%)` }}
      />
    </div>
  );
}
