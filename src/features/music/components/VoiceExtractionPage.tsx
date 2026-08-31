'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Upload, Music2, Mic, Play, Download, Trash2, Pause,
  Search, Sparkles, Zap, Crown, AudioWaveform,
  Check, X, Clock, AlertCircle, Loader2, RefreshCw,
  Volume2, VolumeX, ChevronRight, ChevronDown,
  Layers, Wand2, ArrowRight, Coins, Activity, Timer,
  FileAudio, CheckCircle2, Circle, Copy, ExternalLink,
  Library, ListMusic, Disc3, FileDown, Sliders, Settings2,
  Guitar, Drum, Piano, AudioLines, Radio, Music3, Music4,
  Plus, Minus, Hash, Server, Link2, FileMusic, Info,
} from 'lucide-react';

type MusicTab = string;

interface VoiceExtractionPageProps {
  activeTab: MusicTab;
  onTabChange: (tab: MusicTab) => void;
  onBack: () => void;
}

/* =================== 类型 =================== */

type SeparationMode = 'separate_vocal' | 'split_stem' | 'split_stem_advanced';
type AudioSource = 'existing' | 'upload' | 'library';
type TaskStatus = 'PENDING' | 'SUCCESS' | 'CREATE_TASK_FAILED' | 'GENERATE_AUDIO_FAILED' | 'CALLBACK_EXCEPTION';
type ExtractionStatus = 'idle' | 'uploading' | 'processing' | 'success' | 'error';

interface VocalSeparationTaskDto {
  id: string;
  taskId?: string;
  sourceTaskId?: string;
  audioUrl?: string;
  type: SeparationMode;
  stemName?: string;
  originalName: string;
  callBackUrl: string;
  status: TaskStatus | 'FAILED';
  progress: number;
  stems: Array<{ key: string; label: string; url: string | null }>;
  error?: { code?: string; message?: string } | null;
  createdAt: number;
  completedAt?: number;
}

interface StemInfo {
  key: string;
  label: string;
  url: string | null;
  duration?: number;
  icon: React.ReactNode;
  gradient: string;
}

interface SeparationResult {
  id: string;
  taskId: string;
  stemName: string;
  originalName: string;
  mode: SeparationMode;
  status: TaskStatus;
  progress: number;
  duration: string;
  durationSec: number;
  createdAt: Date;
  completedAt?: Date;
  credits: number;
  audioSource: AudioSource;
  audioUrl?: string;
  callBackUrl: string;
  errorMessage?: string;
  stems: StemInfo[];
}

interface LibraryTrack {
  id: string;
  title: string;
  artist: string;
  duration: string;
  cover: string;
  taskId: string;
  audioId: string;
  audioUrl?: string;
}

/* =================== 官方文档：分离模式定义 =================== */

const MODE_CONFIG: Record<SeparationMode, {
  title: string;
  subtitle: string;
  credits: number;
  icon: React.ReactNode;
  gradient: string;
  ring: string;
  badge: string;
  features: string[];
  description: string;
  recommended?: boolean;
}> = {
  separate_vocal: {
    title: '2-Stem 分离',
    subtitle: '人声 + 伴奏',
    credits: 10,
    icon: <Mic className="w-5 h-5" />,
    gradient: 'from-violet-500 via-fuchsia-500 to-pink-500',
    ring: 'ring-violet-500/40',
    badge: '快速',
    features: ['人声轨道', '伴奏轨道', '卡拉 OK / 翻唱', '最快速度'],
    description: '分离人声和伴奏，生成人声轨道和伴奏轨道。适合快速去人声或提取清唱。',
  },
  split_stem: {
    title: '12-Stem 全分离',
    subtitle: '专业级多轨混音',
    credits: 50,
    icon: <Layers className="w-5 h-5" />,
    gradient: 'from-amber-500 via-orange-500 to-rose-500',
    ring: 'ring-amber-500/40',
    badge: '专业',
    features: ['12 个独立音轨', '鼓/贝斯/吉他/键盘…', 'Remix / 混音', '声音设计'],
    description: '分离各种乐器声音，生成多个乐器轨道。返回 Vocals / Backing Vocals / Drums / Bass / Guitar / Keyboard / Percussion / Strings / Synth / FX / Brass / Woodwinds。',
    recommended: true,
  },
  split_stem_advanced: {
    title: 'Advanced 精准提取',
    subtitle: '指定特定乐器',
    credits: 20,
    icon: <Wand2 className="w-5 h-5" />,
    gradient: 'from-cyan-500 via-sky-500 to-blue-500',
    ring: 'ring-cyan-500/40',
    badge: '精准',
    features: ['指定乐器提取', '100+ 种乐器可选', '后期制作', '采样提取'],
    description: '高级多音轨分离，支持指定特定乐器音轨，生成更精细的乐器轨道。需指定 stemName。',
  },
};

/* =================== 官方文档：12-Stem 返回字段 =================== */

const STEM_12_RETURN: Array<{ key: string; label: string; icon: React.ReactNode; gradient: string }> = [
  { key: 'vocals', label: 'Vocals', icon: <Mic className="w-4 h-4" />, gradient: 'from-violet-500 to-fuchsia-500' },
  { key: 'backingVocals', label: 'Backing Vocals', icon: <Mic className="w-4 h-4" />, gradient: 'from-pink-500 to-rose-500' },
  { key: 'drums', label: 'Drums', icon: <Drum className="w-4 h-4" />, gradient: 'from-orange-500 to-red-500' },
  { key: 'bass', label: 'Bass', icon: <AudioLines className="w-4 h-4" />, gradient: 'from-amber-500 to-yellow-500' },
  { key: 'guitar', label: 'Guitar', icon: <Guitar className="w-4 h-4" />, gradient: 'from-emerald-500 to-green-500' },
  { key: 'keyboard', label: 'Keyboard', icon: <Piano className="w-4 h-4" />, gradient: 'from-teal-500 to-cyan-500' },
  { key: 'percussion', label: 'Percussion', icon: <Disc3 className="w-4 h-4" />, gradient: 'from-lime-500 to-green-500' },
  { key: 'strings', label: 'Strings', icon: <Music4 className="w-4 h-4" />, gradient: 'from-indigo-500 to-purple-500' },
  { key: 'synth', label: 'Synth', icon: <Radio className="w-4 h-4" />, gradient: 'from-blue-500 to-indigo-500' },
  { key: 'fx', label: 'FX / Other', icon: <Sparkles className="w-4 h-4" />, gradient: 'from-fuchsia-500 to-pink-500' },
  { key: 'brass', label: 'Brass', icon: <Music3 className="w-4 h-4" />, gradient: 'from-yellow-500 to-orange-500' },
  { key: 'woodwinds', label: 'Woodwinds', icon: <Music2 className="w-4 h-4" />, gradient: 'from-cyan-500 to-blue-500' },
];

/* =================== 官方文档：Advanced 模式 stemName 枚举（完整 100+ 项） =================== */

const STEM_NAMES_ADVANCED: Array<{ name: string; category: string; gradient: string; icon: React.ReactNode }> = [
  // Vocals
  { name: 'Lead Vocal', category: '人声', gradient: 'from-violet-500 to-fuchsia-500', icon: <Mic className="w-3.5 h-3.5" /> },
  { name: 'Backing Vocals', category: '人声', gradient: 'from-pink-500 to-rose-500', icon: <Mic className="w-3.5 h-3.5" /> },
  { name: 'Choir', category: '人声', gradient: 'from-fuchsia-500 to-pink-500', icon: <Mic className="w-3.5 h-3.5" /> },
  { name: 'Synth Voice', category: '人声', gradient: 'from-purple-500 to-violet-500', icon: <Mic className="w-3.5 h-3.5" /> },
  // Drums
  { name: 'Drum Kit', category: '鼓/打击', gradient: 'from-orange-500 to-red-500', icon: <Drum className="w-3.5 h-3.5" /> },
  { name: 'Electronic Drum Kit', category: '鼓/打击', gradient: 'from-orange-500 to-red-500', icon: <Drum className="w-3.5 h-3.5" /> },
  { name: 'Kick', category: '鼓/打击', gradient: 'from-red-500 to-rose-500', icon: <Drum className="w-3.5 h-3.5" /> },
  { name: 'Snare', category: '鼓/打击', gradient: 'from-red-500 to-rose-500', icon: <Drum className="w-3.5 h-3.5" /> },
  { name: 'Hi-Hat', category: '鼓/打击', gradient: 'from-yellow-500 to-orange-500', icon: <Drum className="w-3.5 h-3.5" /> },
  { name: 'Cymbals', category: '鼓/打击', gradient: 'from-yellow-500 to-orange-500', icon: <Drum className="w-3.5 h-3.5" /> },
  { name: 'Hand Clap', category: '鼓/打击', gradient: 'from-yellow-500 to-orange-500', icon: <Drum className="w-3.5 h-3.5" /> },
  { name: 'Percussion', category: '鼓/打击', gradient: 'from-lime-500 to-green-500', icon: <Disc3 className="w-3.5 h-3.5" /> },
  { name: 'Tambourine', category: '鼓/打击', gradient: 'from-lime-500 to-green-500', icon: <Disc3 className="w-3.5 h-3.5" /> },
  { name: 'Shaker', category: '鼓/打击', gradient: 'from-lime-500 to-green-500', icon: <Disc3 className="w-3.5 h-3.5" /> },
  { name: 'Cowbell', category: '鼓/打击', gradient: 'from-lime-500 to-green-500', icon: <Disc3 className="w-3.5 h-3.5" /> },
  { name: 'Bongos', category: '鼓/打击', gradient: 'from-lime-500 to-green-500', icon: <Disc3 className="w-3.5 h-3.5" /> },
  { name: 'Congas', category: '鼓/打击', gradient: 'from-lime-500 to-green-500', icon: <Disc3 className="w-3.5 h-3.5" /> },
  { name: 'Djembe', category: '鼓/打击', gradient: 'from-lime-500 to-green-500', icon: <Disc3 className="w-3.5 h-3.5" /> },
  { name: 'Taiko', category: '鼓/打击', gradient: 'from-lime-500 to-green-500', icon: <Disc3 className="w-3.5 h-3.5" /> },
  { name: 'Timpani', category: '鼓/打击', gradient: 'from-lime-500 to-green-500', icon: <Disc3 className="w-3.5 h-3.5" /> },
  { name: 'Tabla', category: '鼓/打击', gradient: 'from-lime-500 to-green-500', icon: <Disc3 className="w-3.5 h-3.5" /> },
  { name: 'Steel Drums', category: '鼓/打击', gradient: 'from-lime-500 to-green-500', icon: <Disc3 className="w-3.5 h-3.5" /> },
  { name: '808', category: '鼓/打击', gradient: 'from-rose-600 to-red-600', icon: <Drum className="w-3.5 h-3.5" /> },
  // Bass
  { name: 'Bass', category: '贝斯', gradient: 'from-amber-500 to-yellow-500', icon: <AudioLines className="w-3.5 h-3.5" /> },
  { name: 'Electric Bass', category: '贝斯', gradient: 'from-amber-500 to-yellow-500', icon: <AudioLines className="w-3.5 h-3.5" /> },
  { name: 'Bass Guitar', category: '贝斯', gradient: 'from-amber-500 to-yellow-500', icon: <AudioLines className="w-3.5 h-3.5" /> },
  { name: 'Upright Bass', category: '贝斯', gradient: 'from-amber-500 to-yellow-500', icon: <AudioLines className="w-3.5 h-3.5" /> },
  { name: 'Double Bass', category: '贝斯', gradient: 'from-amber-500 to-yellow-500', icon: <AudioLines className="w-3.5 h-3.5" /> },
  { name: 'Synth Bass', category: '贝斯', gradient: 'from-amber-500 to-yellow-500', icon: <AudioLines className="w-3.5 h-3.5" /> },
  // Guitar
  { name: 'Guitar', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Electric Guitar', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Acoustic Guitar', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Rhythm Electric Guitar', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Rhythm Acoustic Guitar', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Lead Electric Guitar', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Lead Guitar', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Distorted Electric Guitar', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Lap Steel Guitar', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Pedal Steel Guitar', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Ukulele', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Banjo', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Mandolin', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  { name: 'Sitar', category: '吉他', gradient: 'from-emerald-500 to-green-500', icon: <Guitar className="w-3.5 h-3.5" /> },
  // Keyboards
  { name: 'Piano', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  { name: 'Electric Piano', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  { name: 'Rhodes', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  { name: 'Digital Piano', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  { name: 'Keyboards', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  { name: 'Organ', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  { name: 'Harpsichord', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  { name: 'Celesta', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  { name: 'Synth Keys', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  { name: 'Melodica', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  { name: 'Music Box', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  { name: 'Accordion', category: '键盘', gradient: 'from-teal-500 to-cyan-500', icon: <Piano className="w-3.5 h-3.5" /> },
  // Synth
  { name: 'Synth', category: '合成器', gradient: 'from-blue-500 to-indigo-500', icon: <Radio className="w-3.5 h-3.5" /> },
  { name: 'Synth Pad', category: '合成器', gradient: 'from-blue-500 to-indigo-500', icon: <Radio className="w-3.5 h-3.5" /> },
  { name: 'Synth Lead', category: '合成器', gradient: 'from-blue-500 to-indigo-500', icon: <Radio className="w-3.5 h-3.5" /> },
  { name: 'Synth Strings', category: '合成器', gradient: 'from-blue-500 to-indigo-500', icon: <Radio className="w-3.5 h-3.5" /> },
  { name: 'Synth Brass', category: '合成器', gradient: 'from-blue-500 to-indigo-500', icon: <Radio className="w-3.5 h-3.5" /> },
  { name: 'Arpeggiator', category: '合成器', gradient: 'from-blue-500 to-indigo-500', icon: <Radio className="w-3.5 h-3.5" /> },
  { name: 'Risers', category: '合成器', gradient: 'from-blue-500 to-indigo-500', icon: <Radio className="w-3.5 h-3.5" /> },
  { name: 'Drone', category: '合成器', gradient: 'from-blue-500 to-indigo-500', icon: <Radio className="w-3.5 h-3.5" /> },
  { name: 'Theremin', category: '合成器', gradient: 'from-blue-500 to-indigo-500', icon: <Radio className="w-3.5 h-3.5" /> },
  // Strings
  { name: 'String Section', category: '弦乐', gradient: 'from-indigo-500 to-purple-500', icon: <Music4 className="w-3.5 h-3.5" /> },
  { name: 'Violin', category: '弦乐', gradient: 'from-indigo-500 to-purple-500', icon: <Music4 className="w-3.5 h-3.5" /> },
  { name: 'Viola', category: '弦乐', gradient: 'from-indigo-500 to-purple-500', icon: <Music4 className="w-3.5 h-3.5" /> },
  { name: 'Cello', category: '弦乐', gradient: 'from-indigo-500 to-purple-500', icon: <Music4 className="w-3.5 h-3.5" /> },
  { name: 'Harp', category: '弦乐', gradient: 'from-indigo-500 to-purple-500', icon: <Music4 className="w-3.5 h-3.5" /> },
  { name: 'Fiddle', category: '弦乐', gradient: 'from-indigo-500 to-purple-500', icon: <Music4 className="w-3.5 h-3.5" /> },
  // Brass
  { name: 'Brass Section', category: '铜管', gradient: 'from-yellow-500 to-orange-500', icon: <Music3 className="w-3.5 h-3.5" /> },
  { name: 'Trumpet', category: '铜管', gradient: 'from-yellow-500 to-orange-500', icon: <Music3 className="w-3.5 h-3.5" /> },
  { name: 'Trombone', category: '铜管', gradient: 'from-yellow-500 to-orange-500', icon: <Music3 className="w-3.5 h-3.5" /> },
  { name: 'French Horn', category: '铜管', gradient: 'from-yellow-500 to-orange-500', icon: <Music3 className="w-3.5 h-3.5" /> },
  { name: 'Tuba', category: '铜管', gradient: 'from-yellow-500 to-orange-500', icon: <Music3 className="w-3.5 h-3.5" /> },
  { name: 'Horns', category: '铜管', gradient: 'from-yellow-500 to-orange-500', icon: <Music3 className="w-3.5 h-3.5" /> },
  // Woodwinds
  { name: 'Woodwinds', category: '木管', gradient: 'from-cyan-500 to-blue-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Flute', category: '木管', gradient: 'from-cyan-500 to-blue-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Saxophone', category: '木管', gradient: 'from-cyan-500 to-blue-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Alto Saxophone', category: '木管', gradient: 'from-cyan-500 to-blue-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Tenor Saxophone', category: '木管', gradient: 'from-cyan-500 to-blue-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Baritone Saxophone', category: '木管', gradient: 'from-cyan-500 to-blue-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Clarinet', category: '木管', gradient: 'from-cyan-500 to-blue-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Oboe', category: '木管', gradient: 'from-cyan-500 to-blue-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Bassoon', category: '木管', gradient: 'from-cyan-500 to-blue-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Piccolo', category: '木管', gradient: 'from-cyan-500 to-blue-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  // FX
  { name: 'Sound Effects', category: '音效', gradient: 'from-fuchsia-500 to-pink-500', icon: <Sparkles className="w-3.5 h-3.5" /> },
  { name: 'Whistle', category: '音效', gradient: 'from-fuchsia-500 to-pink-500', icon: <Sparkles className="w-3.5 h-3.5" /> },
  // Misc
  { name: 'Orchestra', category: '其他', gradient: 'from-slate-500 to-gray-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Harmonica', category: '其他', gradient: 'from-slate-500 to-gray-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Marimba', category: '其他', gradient: 'from-slate-500 to-gray-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Vibraphone', category: '其他', gradient: 'from-slate-500 to-gray-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Glockenspiel', category: '其他', gradient: 'from-slate-500 to-gray-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Xylophone', category: '其他', gradient: 'from-slate-500 to-gray-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Bells', category: '其他', gradient: 'from-slate-500 to-gray-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Koto', category: '其他', gradient: 'from-slate-500 to-gray-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Bagpipes', category: '其他', gradient: 'from-slate-500 to-gray-500', icon: <Music2 className="w-3.5 h-3.5" /> },
  { name: 'Didgeridoo', category: '其他', gradient: 'from-slate-500 to-gray-500', icon: <Music2 className="w-3.5 h-3.5" /> },
];

const MAX_UPLOAD_SIZE_MB = 20;

/* =================== 子组件：波形 =================== */

function Waveform({ active = false, bars = 64 }: { active?: boolean; bars?: number }) {
  const heights = useMemo(() => Array.from({ length: bars }, (_, i) => {
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const r = seed - Math.floor(seed);
    return 12 + Math.floor(r * 88);
  }), [bars]);
  return (
    <div className="flex items-center gap-[2px] h-12">
      {heights.map((h, i) => (
        <div key={i}
          className={`w-[2px] rounded-full transition-all duration-300 ${active ? 'bg-violet-500' : 'bg-slate-300 dark:bg-neutral-600'}`}
          style={{ height: `${active ? h : Math.min(h, 30)}%`, opacity: active ? 0.5 + (i / bars) * 0.5 : 0.6 }} />
      ))}
    </div>
  );
}

/* =================== 子组件：模式卡片 =================== */

function ModeCard({ mode, selected, onSelect }: { mode: SeparationMode; selected: boolean; onSelect: () => void }) {
  const cfg = MODE_CONFIG[mode];
  return (
    <button onClick={onSelect}
      className={`relative text-left p-5 rounded-2xl border-2 transition-all duration-200 group ${
        selected
          ? `border-transparent bg-gradient-to-br ${cfg.gradient} text-white shadow-2xl ${cfg.ring} ring-4 scale-[1.02]`
          : 'border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-slate-300 hover:shadow-lg'
      }`}>
      {cfg.recommended && (
        <div className="absolute -top-2.5 left-5 px-2.5 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-[10px] font-bold text-white shadow-md flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> 推荐
        </div>
      )}
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selected ? 'bg-white/20 backdrop-blur' : `bg-gradient-to-br ${cfg.gradient} text-white`}`}>
          {cfg.icon}
        </div>
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${selected ? 'bg-white/25' : 'bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-slate-300'}`}>
          <Coins className="w-3 h-3" /> {cfg.credits}
        </div>
      </div>
      <h3 className={`font-bold text-base mb-1 ${selected ? 'text-white' : 'text-slate-900 dark:text-white'}`}>{cfg.title}</h3>
      <p className={`text-xs mb-3 ${selected ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>{cfg.subtitle}</p>
      <p className={`text-[11px] leading-relaxed mb-3 ${selected ? 'text-white/85' : 'text-slate-600 dark:text-slate-400'}`}>
        {cfg.description}
      </p>
      <ul className="space-y-1">
        {cfg.features.map((f, i) => (
          <li key={i} className={`flex items-center gap-1.5 text-[11px] ${selected ? 'text-white/90' : 'text-slate-600 dark:text-slate-400'}`}>
            <Check className={`w-3 h-3 ${selected ? 'text-white' : 'text-emerald-500'}`} />{f}
          </li>
        ))}
      </ul>
    </button>
  );
}

/* =================== 子组件：Stem 卡片 =================== */

function StemCard({ stem, isPlaying, isMuted, isSolo, onPlay, onDownload, onMute, onSolo, onUse, showUseButton }: {
  stem: StemInfo; isPlaying: boolean; isMuted: boolean; isSolo: boolean;
  onPlay: () => void; onDownload: () => void; onMute: () => void; onSolo: () => void;
  onUse?: () => void; showUseButton?: boolean;
}) {
  return (
    <div className={`group relative rounded-2xl border bg-white dark:bg-neutral-900 overflow-hidden transition-all ${
      isPlaying ? 'border-violet-500 shadow-2xl' : 'border-slate-200 dark:border-neutral-800 hover:border-slate-300 hover:shadow-lg'
    }`}>
      <div className={`h-1.5 bg-gradient-to-r ${stem.gradient}`} />
      <div className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stem.gradient} flex items-center justify-center text-white shadow-md`}>
            {stem.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-slate-900 dark:text-white text-sm truncate">{stem.label}</h4>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{stem.url ? stem.url.slice(-24) : '未生成'}</p>
          </div>
        </div>
        <div className="mb-3 -mx-1"><Waveform active={isPlaying} bars={48} /></div>
        <div className="flex items-center gap-1">
          <button onClick={onPlay}
            className={`flex-1 h-8 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
              isPlaying ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
            }`}>
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isPlaying ? '暂停' : '试听'}
          </button>
          <button onClick={onMute}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
              isMuted ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600' : 'bg-slate-100 dark:bg-neutral-800 text-slate-500 hover:bg-slate-200'
            }`}>
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onSolo}
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold transition-all ${
              isSolo ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700' : 'bg-slate-100 dark:bg-neutral-800 text-slate-500 hover:bg-slate-200'
            }`}>S</button>
          <button onClick={onDownload}
            className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-neutral-800 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-all">
            <Download className="w-3.5 h-3.5" />
          </button>
          {showUseButton && onUse && (
            <button onClick={onUse}
              className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 hover:bg-violet-200 flex items-center justify-center transition-all">
              <Wand2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* =================== 子组件：状态徽章 =================== */

function StatusBadge({ status }: { status: TaskStatus | ExtractionStatus }) {
  const map: Record<string, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
    PENDING: { label: '处理中', bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    SUCCESS: { label: '已完成', bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', icon: <CheckCircle2 className="w-3 h-3" /> },
    CREATE_TASK_FAILED: { label: '创建失败', bg: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-700 dark:text-rose-300', icon: <X className="w-3 h-3" /> },
    GENERATE_AUDIO_FAILED: { label: '分离失败', bg: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-700 dark:text-rose-300', icon: <AlertCircle className="w-3 h-3" /> },
    CALLBACK_EXCEPTION: { label: '回调异常', bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', icon: <AlertCircle className="w-3 h-3" /> },
    idle: { label: '空闲', bg: 'bg-slate-100 dark:bg-neutral-800', text: 'text-slate-600 dark:text-slate-400', icon: <Circle className="w-3 h-3" /> },
    uploading: { label: '上传中', bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', icon: <Upload className="w-3 h-3 animate-pulse" /> },
    processing: { label: '分离中', bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-700 dark:text-violet-300', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    success: { label: '完成', bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', icon: <CheckCircle2 className="w-3 h-3" /> },
    error: { label: '失败', bg: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-700 dark:text-rose-300', icon: <X className="w-3 h-3" /> },
  };
  const cfg = map[status] || map.idle;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.bg} ${cfg.text}`}>{cfg.icon}{cfg.label}</span>;
}

/* =================== 主组件 =================== */

export default function VoiceExtractionPage({ activeTab, onTabChange, onBack }: VoiceExtractionPageProps) {
  // 基础状态
  const [mode, setMode] = useState<SeparationMode>('split_stem');
  const [audioSource, setAudioSource] = useState<AudioSource>('existing');
  const [extractionStatus, setExtractionStatus] = useState<ExtractionStatus>('idle');
  const [progress, setProgress] = useState(0);

  // 表单
  const [taskId, setTaskId] = useState('');
  const [audioId, setAudioId] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [callBackUrl, setCallBackUrl] = useState('由后端根据“音乐模型 API”设置自动生成');
  const [uploadFile, setUploadFile] = useState<{ name: string; size: number; file: File; url?: string } | null>(null);
  const [apiError, setApiError] = useState('');

  // Advanced 模式：批量 stemName 任务
  const [batchStems, setBatchStems] = useState<string[]>([]);
  const [stemSearch, setStemSearch] = useState('');
  const [stemCategory, setStemCategory] = useState<string>('全部');

  // 试听
  const [playingStem, setPlayingStem] = useState<{ resultId: string; stemKey: string } | null>(null);

  // UI
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // 服务端任务与积分展示
  const [credits, setCredits] = useState(2480);
  const [results, setResults] = useState<SeparationResult[]>([]);
  const [libraryTracks, setLibraryTracks] = useState<LibraryTrack[]>([]);

  const taskToResult = (task: VocalSeparationTaskDto): SeparationResult => {
    const modeMeta = MODE_CONFIG[task.type];
    return {
      id: task.id,
      taskId: task.taskId || task.sourceTaskId || task.id,
      stemName: task.stemName || task.type,
      originalName: task.originalName,
      mode: task.type,
      status: task.status === 'FAILED' ? 'GENERATE_AUDIO_FAILED' : task.status,
      progress: task.progress,
      duration: '--:--', durationSec: 0,
      createdAt: new Date(task.createdAt * 1000),
      completedAt: task.completedAt ? new Date(task.completedAt * 1000) : undefined,
      credits: modeMeta.credits,
      audioSource: task.audioUrl ? 'upload' : 'existing',
      audioUrl: task.audioUrl,
      callBackUrl: task.callBackUrl,
      errorMessage: task.error?.message,
      stems: task.stems.map((stem, index) => {
        const known = STEM_12_RETURN.find(item => item.key === stem.key);
        return {
          ...stem,
          icon: known?.icon || <AudioLines className="w-4 h-4" />,
          gradient: known?.gradient || ['from-violet-500 to-fuchsia-500', 'from-emerald-500 to-teal-500'][index % 2],
        };
      }),
    };
  };

  const refreshTasks = async () => {
    const response = await fetch('/api/suno/vocal-separations?pageSize=50');
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || '读取音轨分离任务失败');
    setResults((body.tasks || []).map(taskToResult));
    const first = body.tasks?.[0] as VocalSeparationTaskDto | undefined;
    if (first?.callBackUrl) setCallBackUrl(first.callBackUrl);
  };

  useEffect(() => { refreshTasks().catch(error => setApiError(error.message)); }, []);

  useEffect(() => {
    fetch('/api/suno/tasks?pageSize=100')
      .then(response => response.ok ? response.json() : Promise.reject(new Error('音乐库加载失败')))
      .then((body: { tasks?: Array<{ id: string; provider_task_id?: string; clips?: Array<{ id: string; title?: string; duration?: number; image_url?: string; audio_url?: string; status?: string }> }> }) => {
        const tracks = (body.tasks || []).flatMap(task => (task.clips || []).filter(clip => clip.status === 'SUCCESS' && clip.audio_url).map(clip => ({
          id: clip.id,
          title: clip.title || '未命名歌曲',
          artist: 'Suno',
          duration: clip.duration ? `${Math.floor(clip.duration / 60)}:${String(Math.floor(clip.duration % 60)).padStart(2, '0')}` : '--:--',
          cover: 'from-violet-500 to-fuchsia-500',
          taskId: task.provider_task_id || task.id,
          audioId: clip.id,
          audioUrl: clip.audio_url,
        })));
        setLibraryTracks(tracks);
      })
      .catch(error => setApiError(error instanceof Error ? error.message : '音乐库加载失败'));
  }, []);

  // 分类列表
  const categories = useMemo(() => {
    const set = new Set(STEM_NAMES_ADVANCED.map(s => s.category));
    return ['全部', ...Array.from(set)];
  }, []);

  // 过滤后的 stem 列表
  const filteredStems = useMemo(() => {
    return STEM_NAMES_ADVANCED.filter(s => {
      if (stemCategory !== '全部' && s.category !== stemCategory) return false;
      if (stemSearch && !s.name.toLowerCase().includes(stemSearch.toLowerCase())) return false;
      return true;
    });
  }, [stemSearch, stemCategory]);

  // 表单验证
  const formValid = useMemo(() => {
    if (mode === 'split_stem_advanced' && batchStems.length === 0) return { ok: false, msg: 'Advanced 模式需要至少选择一个 stemName' };
    if (audioSource === 'existing' && !audioId.trim() && !audioUrl.trim()) return { ok: false, msg: '使用已有音频需要 audioId 或 audioUrl 至少一个' };
    if (audioSource === 'existing' && audioId.trim() && !taskId.trim()) return { ok: false, msg: '使用 audioId 时还需要原音乐的 taskId' };
    if (audioSource === 'existing' && audioId.trim() && audioUrl.trim()) return { ok: false, msg: 'audioId 和 audioUrl 不能同时使用' };
    if (audioSource === 'upload' && !uploadFile) return { ok: false, msg: '请上传音频文件' };
    if (audioSource === 'library' && (!taskId.trim() || !audioId.trim())) return { ok: false, msg: '请先从音乐库选择一首已生成歌曲' };
    return { ok: true, msg: '' };
  }, [mode, batchStems, audioSource, taskId, audioId, audioUrl, uploadFile]);

  // 预计消耗
  const estimatedCost = useMemo(() => {
    if (mode === 'split_stem_advanced') return MODE_CONFIG[mode].credits * Math.max(1, batchStems.length);
    return MODE_CONFIG[mode].credits;
  }, [mode, batchStems]);

  /* =================== 行为 =================== */

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const sizeMB = file.size / 1024 / 1024;
    if (sizeMB > MAX_UPLOAD_SIZE_MB) {
      alert(`文件大小 ${sizeMB.toFixed(2)}MB 超过 ${MAX_UPLOAD_SIZE_MB}MB 限制`);
      return;
    }
    setUploadFile({ name: file.name, size: file.size, file });
  };

  const handleSelectFromLibrary = (track: LibraryTrack) => {
    setTaskId(track.taskId);
    setAudioId(track.audioId);
    setShowLibrary(false);
  };

  const waitForTask = async (localId: string) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await fetch(`/api/suno/vocal-separations/${encodeURIComponent(localId)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || '查询分离任务失败');
      const task = body as VocalSeparationTaskDto;
      setProgress(task.progress || 5);
      setResults(current => [taskToResult(task), ...current.filter(item => item.id !== task.id)]);
      if (task.status === 'SUCCESS') return task;
      if (task.status === 'FAILED' || task.status.endsWith('_FAILED') || task.status === 'CALLBACK_EXCEPTION') {
        throw new Error(task.error?.message || '音轨分离失败');
      }
      await new Promise(resolve => window.setTimeout(resolve, 3000));
    }
    throw new Error('音轨分离等待超时，请稍后在历史结果中查看');
  };

  const handleStart = async () => {
    if (!formValid.ok) return;
    setApiError('');
    setExtractionStatus(audioSource === 'upload' ? 'uploading' : 'processing');
    setProgress(10);
    try {
      let submittedAudioUrl = audioUrl.trim() || undefined;
      if (audioSource === 'upload' && uploadFile) {
        const form = new FormData();
        form.append('file', uploadFile.file);
        const upload = await fetch('/api/suno/vocal-separations/upload', { method: 'POST', body: form });
        const uploaded = await upload.json().catch(() => ({}));
        if (!upload.ok) throw new Error(uploaded.error?.message || '音频上传失败');
        submittedAudioUrl = uploaded.url;
        setUploadFile(current => current ? { ...current, url: uploaded.url } : current);
      }
      setExtractionStatus('processing');
      const stems = mode === 'split_stem_advanced' ? batchStems : [undefined];
      const ids: string[] = [];
      for (const stemName of stems) {
        const payload = {
          taskId: submittedAudioUrl ? undefined : taskId.trim(),
          audioId: submittedAudioUrl ? undefined : audioId.trim(),
          audioUrl: submittedAudioUrl,
          type: mode,
          stemName,
          originalName: uploadFile?.name || 'Suno 音频',
          clientRequestId: crypto.randomUUID(),
        };
        const response = await fetch('/api/suno/vocal-separations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error?.message || body.error?.message || '提交音轨分离失败');
        ids.push(body.id);
        setResults(current => [taskToResult(body), ...current.filter(item => item.id !== body.id)]);
      }
      await Promise.all(ids.map(waitForTask));
      setExtractionStatus('success');
      setCredits(c => c - estimatedCost);
      await refreshTasks();
      window.setTimeout(() => { setExtractionStatus('idle'); setProgress(0); }, 1200);
    } catch (error) {
      setExtractionStatus('error');
      setApiError(error instanceof Error ? error.message : '音轨分离失败');
      window.setTimeout(() => setExtractionStatus('idle'), 1500);
    }
  };

  const handlePlay = (resultId: string, stemKey: string) => {
    if (playingStem?.resultId === resultId && playingStem?.stemKey === stemKey) {
      audioPlayerRef.current?.pause();
      setPlayingStem(null);
      return;
    }
    const url = results.find(result => result.id === resultId)?.stems.find(stem => stem.key === stemKey)?.url;
    if (!url) return;
    audioPlayerRef.current?.pause();
    const player = new Audio(url);
    player.onended = () => setPlayingStem(null);
    player.onerror = () => { setPlayingStem(null); setApiError('音轨试听加载失败'); };
    audioPlayerRef.current = player;
    player.play().then(() => setPlayingStem({ resultId, stemKey })).catch(() => setApiError('浏览器阻止了音轨播放'));
  };

  const handleDownload = (url: string | null) => {
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const addStem = (name: string) => {
    if (!batchStems.includes(name)) setBatchStems(prev => [...prev, name]);
  };

  const removeStem = (name: string) => {
    setBatchStems(prev => prev.filter(n => n !== name));
  };

  const handleDelete = async (id: string) => {
    setApiError('');
    const response = await fetch(`/api/suno/vocal-separations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setApiError(body.error?.message || '删除音轨分离记录失败');
      return;
    }
    setResults(prev => prev.filter(r => r.id !== id));
  };

  const handleUseForClone = () => onTabChange('voice-clone');

  const filteredResults = useMemo(() => {
    return results.filter(r => {
      if (searchQuery && !r.originalName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [results, searchQuery]);

  const stats = useMemo(() => ({
    total: results.length,
    success: results.filter(r => r.status === 'SUCCESS').length,
    totalCredits: results.reduce((sum, r) => sum + r.credits, 0),
  }), [results]);

  return (
    <div className="mx-auto w-full max-w-7xl px-6 lg:px-8 py-8">
      {/* =================== Hero =================== */}
      <div className="relative mb-8 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-violet-900 to-fuchsia-900 p-8 lg:p-10 text-white">
        <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-fuchsia-500/30 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full bg-violet-500/30 blur-3xl" />
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur border border-white/20 text-xs font-medium mb-4">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              Powered by Suno API · POST /api/v1/vocal-removal/generate
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold mb-2 flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center border border-white/20">
                <AudioWaveform className="w-6 h-6" />
              </div>
              人声 & 乐器分离
            </h1>
            <p className="text-white/70 text-sm lg:text-base max-w-xl">
              基于 Suno 官方 AI 模型，3 种分离模式、12 轨精细拆分、指定 100+ 种乐器精准提取，A/B 对比试听，一键导出用于克隆 / Remix / 混音。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 lg:min-w-[420px]">
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4">
              <div className="flex items-center gap-1.5 text-xs text-white/70 mb-1.5"><Coins className="w-3.5 h-3.5 text-amber-300" /> 积分余额</div>
              <div className="text-2xl font-bold">{credits.toLocaleString()}</div>
              <div className="text-[10px] text-white/50 mt-0.5">credits</div>
            </div>
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4">
              <div className="flex items-center gap-1.5 text-xs text-white/70 mb-1.5"><Activity className="w-3.5 h-3.5 text-emerald-300" /> 本月分离</div>
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-[10px] text-emerald-300 mt-0.5">↑ 成功率 {stats.total ? Math.round(stats.success / stats.total * 100) : 0}%</div>
            </div>
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4">
              <div className="flex items-center gap-1.5 text-xs text-white/70 mb-1.5"><Timer className="w-3.5 h-3.5 text-cyan-300" /> 累计消耗</div>
              <div className="text-2xl font-bold">{stats.totalCredits}</div>
              <div className="text-[10px] text-white/50 mt-0.5">credits</div>
            </div>
          </div>
        </div>
      </div>

      {/* =================== 模式选择 =================== */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-1 h-5 bg-gradient-to-b from-violet-500 to-fuchsia-500 rounded-full" />
              选择分离模式 <code className="text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-slate-300 font-mono ml-1">type</code>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 ml-3">不同的 mode 走不同的服务路径，输出不同数量的音轨</p>
          </div>
          <a href="https://docs.sunoapi.org/cn/suno-api/separate-vocals-from-music" target="_blank" rel="noreferrer"
            className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1">查看 API 文档 <ExternalLink className="w-3 h-3" /></a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(Object.keys(MODE_CONFIG) as SeparationMode[]).map(m => (
            <ModeCard key={m} mode={m} selected={mode === m} onSelect={() => setMode(m)} />
          ))}
        </div>
      </div>

      {/* =================== 任务配置 =================== */}
      <div className="mb-6 rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-neutral-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-violet-500" /> 任务配置
              <span className="text-xs text-slate-500 font-normal ml-1">POST /api/v1/vocal-removal/generate</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              预计消耗 <span className="text-amber-600 dark:text-amber-400 font-bold">{estimatedCost} 积分</span>
              {mode === 'split_stem_advanced' && batchStems.length > 1 && (
                <span className="text-slate-500"> · {MODE_CONFIG[mode].credits} × {batchStems.length} 个任务</span>
              )}
            </p>
          </div>
          <button onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center gap-1">
            <Settings2 className="w-3.5 h-3.5" />{showAdvanced ? '收起' : '高级选项'}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* 必填：callBackUrl */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-rose-500" />
              <code className="text-[10px] px-1 py-0.5 rounded bg-slate-100 dark:bg-neutral-800 font-mono">callBackUrl</code>
              <span className="text-rose-500">*必填</span>
              <span className="text-[10px] font-normal text-slate-400 ml-auto">用于接收分离完成通知</span>
            </label>
            <input value={callBackUrl} readOnly
              className="w-full h-10 px-3 rounded-lg border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-950 text-sm font-mono text-slate-600 dark:text-slate-300" />
          </div>

          {/* 音频源：三种互斥模式 */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
              <FileAudio className="w-3.5 h-3.5" /> 音频源（三选一，互斥）
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'existing' as AudioSource, title: '已有任务', desc: 'taskId + audioId', icon: <Link2 className="w-4 h-4" />, color: 'violet' },
                { key: 'upload' as AudioSource, title: '上传音频', desc: 'audioUrl（≤20MB）', icon: <Upload className="w-4 h-4" />, color: 'emerald' },
                { key: 'library' as AudioSource, title: '我的音乐库', desc: '从已生成歌曲选', icon: <Library className="w-4 h-4" />, color: 'cyan' },
              ].map(opt => {
                const sel = audioSource === opt.key;
                return (
                  <button key={opt.key} onClick={() => setAudioSource(opt.key)}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      sel ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20' : 'border-slate-200 dark:border-neutral-700 hover:border-slate-300'
                    }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`${sel ? 'text-violet-600' : 'text-slate-500'}`}>{opt.icon}</div>
                      <span className="text-sm font-medium text-slate-900 dark:text-white">{opt.title}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 互斥逻辑：3 种音频源 */}
          {audioSource === 'existing' && (
            <div className="rounded-xl border border-violet-200 dark:border-violet-800/50 bg-violet-50/50 dark:bg-violet-900/10 p-4 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                <Info className="w-3.5 h-3.5" /> 已有音频 · taskId 必填，audioId / audioUrl 二选一
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
                  <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-neutral-800 font-mono">taskId</code>
                  <span className="text-rose-500">*</span>
                  <span className="text-slate-400 ml-auto">音乐生成任务的唯一标识符</span>
                </label>
                <input value={taskId} onChange={e => setTaskId(e.target.value)} placeholder="5c79****be8e"
                  className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
                    <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-neutral-800 font-mono">audioId</code>
                    <span className="text-slate-400 ml-1">从回调数据中返回</span>
                  </label>
                  <input value={audioId} onChange={e => setAudioId(e.target.value)} placeholder="e231****-****-****-****-****8cadc7dc"
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
                    <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-neutral-800 font-mono">audioUrl</code>
                    <span className="text-slate-400 ml-1">≤20MB</span>
                  </label>
                  <input value={audioUrl} onChange={e => setAudioUrl(e.target.value)} placeholder="https://..."
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-sm font-mono text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500" />
                </div>
              </div>
              <div className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> audioId 和 audioUrl 不可同时使用
              </div>
            </div>
          )}

          {audioSource === 'upload' && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-900/10 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-3">
                <Info className="w-3.5 h-3.5" /> 上传音频 · 最大 {MAX_UPLOAD_SIZE_MB}MB · 不可与 audioId 同时使用
              </div>
              {!uploadFile ? (
                <div onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-emerald-300 dark:border-emerald-800 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors">
                  <Upload className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">点击选择音频文件</p>
                  <p className="text-[10px] text-slate-500 mt-1">MP3 / WAV / FLAC · ≤{MAX_UPLOAD_SIZE_MB}MB</p>
                  <input ref={fileInputRef} type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 p-3 flex items-center gap-3 bg-white dark:bg-neutral-900">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white">
                    <FileMusic className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{uploadFile.name}</div>
                    <div className="text-[10px] text-slate-500">{(uploadFile.size / 1024 / 1024).toFixed(2)}MB · {uploadFile.url}</div>
                  </div>
                  <button onClick={() => setUploadFile(null)} className="p-1.5 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {audioSource === 'library' && (
            <div className="rounded-xl border border-cyan-200 dark:border-cyan-800/50 bg-cyan-50/50 dark:bg-cyan-900/10 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-700 dark:text-cyan-300 mb-3">
                <Info className="w-3.5 h-3.5" /> 我的音乐库 · 自动填入 taskId + audioId
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {libraryTracks.map(t => (
                  <button key={t.id} onClick={() => handleSelectFromLibrary(t)}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-white dark:bg-neutral-900 hover:ring-2 hover:ring-cyan-500/40 text-left border border-slate-200 dark:border-neutral-700">
                    <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${t.cover} flex items-center justify-center text-white flex-shrink-0`}>
                      <Disc3 className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-slate-900 dark:text-white truncate">{t.title}</div>
                      <div className="text-[9px] text-slate-500 font-mono truncate">task: {t.taskId}</div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Advanced 模式专属：stemName 批量选择 */}
          {mode === 'split_stem_advanced' && (
            <div className="rounded-xl border border-cyan-200 dark:border-cyan-800/50 bg-gradient-to-br from-cyan-50/50 to-blue-50/50 dark:from-cyan-900/10 dark:to-blue-900/10 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                  <Wand2 className="w-3.5 h-3.5" />
                  <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-neutral-800 font-mono">stemName</code>
                  <span className="text-rose-500">*</span>
                  <span>选择要提取的乐器（可批量提交，每个生成独立任务）</span>
                </div>
                <span className="text-[10px] text-slate-500">已选 {batchStems.length} / {STEM_NAMES_ADVANCED.length}</span>
              </div>

              {/* 已选列表 */}
              {batchStems.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3 p-2 rounded-lg bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 min-h-[40px]">
                  {batchStems.map(name => {
                    const stem = STEM_NAMES_ADVANCED.find(s => s.name === name)!;
                    return (
                      <span key={name} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-white bg-gradient-to-r ${stem.gradient}`}>
                        {stem.icon}{name}
                        <button onClick={() => removeStem(name)} className="hover:bg-white/20 rounded">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* 搜索 + 分类 */}
              <div className="flex items-center gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input value={stemSearch} onChange={e => setStemSearch(e.target.value)}
                    placeholder="搜索乐器名（Lead Vocal / Drum Kit / Piano...）"
                    className="w-full h-8 pl-8 pr-3 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500" />
                </div>
                <select value={stemCategory} onChange={e => setStemCategory(e.target.value)}
                  className="h-8 px-2 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-500/40">
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* 乐器列表 */}
              <div className="grid grid-cols-3 md:grid-cols-5 gap-1.5 max-h-64 overflow-y-auto">
                {filteredStems.map(s => {
                  const selected = batchStems.includes(s.name);
                  return (
                    <button key={s.name} onClick={() => selected ? removeStem(s.name) : addStem(s.name)}
                      className={`p-2 rounded-lg text-left transition-all ${
                        selected
                          ? `bg-gradient-to-r ${s.gradient} text-white shadow-md`
                          : 'bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 hover:border-cyan-400'
                      }`}>
                      <div className="flex items-center gap-1.5">
                        {s.icon}
                        <span className="text-[11px] font-medium truncate">{s.name}</span>
                        {selected && <Check className="w-3 h-3 ml-auto flex-shrink-0" />}
                      </div>
                    </button>
                  );
                })}
              </div>
              {filteredStems.length === 0 && (
                <div className="text-center py-4 text-xs text-slate-400">没有匹配的乐器</div>
              )}
            </div>
          )}

          {/* 高级选项 */}
          {showAdvanced && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-neutral-800">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">输出格式</label>
                <div className="flex gap-1.5">
                  {['MP3', 'WAV', 'FLAC'].map(f => (
                    <button key={f} className="flex-1 h-9 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-violet-500 hover:text-violet-600 transition-colors">{f}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">采样率</label>
                <select className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-500/40">
                  <option>44100 Hz (CD 质量)</option>
                  <option>48000 Hz (Studio)</option>
                  <option>22050 Hz (节省空间)</option>
                </select>
              </div>
            </div>
          )}

          {/* 启动按钮 */}
          <div className="flex items-center justify-between pt-2 gap-3">
            <div className="text-xs flex-1 min-w-0">
              {formValid.ok ? (
                <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  URL 具有时效性，建议及时下载保存
                </span>
              ) : (
                <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> {formValid.msg}
                </span>
              )}
            </div>
            <button onClick={handleStart} disabled={!formValid.ok || extractionStatus !== 'idle'}
              className="px-6 h-11 rounded-xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 hover:from-violet-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-violet-500/30 transition-all whitespace-nowrap">
              {extractionStatus === 'idle' && <><Zap className="w-4 h-4" />开始分离</>}
              {(extractionStatus === 'uploading' || extractionStatus === 'processing') && <><Loader2 className="w-4 h-4 animate-spin" />处理中</>}
              {extractionStatus === 'success' && <><CheckCircle2 className="w-4 h-4" />完成</>}
              <span className="px-1.5 py-0.5 rounded-md bg-white/20 text-[10px]">-{estimatedCost} credits</span>
            </button>
          </div>
          {apiError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
              {apiError}
            </div>
          )}

          {/* 进度条 */}
          {extractionStatus !== 'idle' && extractionStatus !== 'success' && (
            <div className="rounded-xl border border-slate-200 dark:border-neutral-700 p-4 bg-slate-50 dark:bg-neutral-800/50">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <StatusBadge status={extractionStatus} />
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {extractionStatus === 'uploading' && '正在上传音频到云端...'}
                    {extractionStatus === 'processing' && `AI 模型正在${mode === 'separate_vocal' ? '分离人声/伴奏' : mode === 'split_stem' ? '分离 12 个音轨' : `提取 ${batchStems.length} 个乐器音轨`}...`}
                  </span>
                </div>
                <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-slate-200 dark:bg-neutral-700 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 transition-all duration-300 rounded-full" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* =================== 结果列表 =================== */}
      <div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-1 h-5 bg-gradient-to-b from-emerald-500 to-teal-500 rounded-full" />
              分离结果 <span className="text-xs text-slate-500 font-normal">({filteredResults.length} 条)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 ml-3">
              所有分离任务的历史记录 · GET /api/v1/vocal-removal/record-info?taskId=xxx
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索文件名…"
              className="h-9 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs text-slate-900 dark:text-white placeholder-slate-400 w-48 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500" />
          </div>
        </div>

        {filteredResults.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-neutral-800 p-12 text-center">
            <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-slate-100 dark:bg-neutral-800 flex items-center justify-center">
              <Music2 className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">还没有分离记录</h3>
            <p className="text-xs text-slate-500">完成第一次分离后，结果会显示在这里</p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredResults.map(result => {
              const cfg = MODE_CONFIG[result.mode];
              const isPlayingThis = playingStem?.resultId === result.id;
              return (
                <div key={result.id} className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 dark:border-neutral-800 bg-gradient-to-r from-slate-50 to-transparent dark:from-neutral-800/30">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${cfg.gradient} flex items-center justify-center text-white shadow-md`}>{cfg.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-slate-900 dark:text-white truncate">{result.originalName}</h3>
                          <StatusBadge status={result.status} />
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-neutral-800 text-slate-600 dark:text-slate-300 font-medium font-mono">{cfg.title}</span>
                          {result.stemName && result.stemName !== result.mode && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 font-medium font-mono">{result.stemName}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-1 flex-wrap">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{result.duration}</span>
                          <span className="flex items-center gap-1"><Coins className="w-3 h-3" />{result.credits} credits</span>
                          <span className="font-mono">task: {result.taskId}</span>
                          <span>· {result.createdAt.toLocaleString('zh-CN')}</span>
                          {result.completedAt && <span className="text-emerald-600 dark:text-emerald-400">耗时 {Math.round((result.completedAt.getTime() - result.createdAt.getTime()) / 1000)}s</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800 text-slate-500" title="复制 Task ID">
                          <Copy className="w-4 h-4" />
                        </button>
                        <button className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-neutral-800 text-slate-500" title="批量下载">
                          <FileDown className="w-4 h-4" />
                        </button>
                        {result.status === 'SUCCESS' && (
                          <button onClick={handleUseForClone}
                            className="px-3 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200 text-xs font-medium flex items-center gap-1.5">
                            <Wand2 className="w-3.5 h-3.5" />用于克隆
                          </button>
                        )}
                        <button onClick={() => handleDelete(result.id)} className="p-2 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 text-slate-400 hover:text-rose-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {result.status === 'SUCCESS' && (
                    <div className="p-5">
                      {result.mode === 'separate_vocal' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {result.stems.map(stem => {
                            const playing = isPlayingThis && playingStem?.stemKey === stem.key;
                            return (
                              <div key={stem.key} className={`relative rounded-2xl border-2 overflow-hidden transition-all ${playing ? 'border-violet-500 shadow-2xl shadow-violet-500/20' : 'border-slate-200 dark:border-neutral-800'}`}>
                                <div className={`h-2 bg-gradient-to-r ${stem.gradient}`} />
                                <div className="p-5">
                                  <div className="flex items-center gap-3 mb-4">
                                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${stem.gradient} flex items-center justify-center text-white shadow-lg`}>{stem.icon}</div>
                                    <div>
                                      <h4 className="font-bold text-slate-900 dark:text-white">{stem.label}</h4>
                                      <p className="text-[10px] text-slate-500 font-mono">{stem.url}</p>
                                    </div>
                                  </div>
                                  <Waveform active={playing} bars={64} />
                                  <div className="flex items-center gap-2 mt-4">
                                    <button onClick={() => handlePlay(result.id, stem.key)}
                                      className={`flex-1 h-10 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all ${playing ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900' : 'bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'}`}>
                                      {playing ? <><Pause className="w-4 h-4" />暂停</> : <><Play className="w-4 h-4" />试听</>}
                                    </button>
                                    <button onClick={() => handleDownload(stem.url)} className="h-10 px-4 rounded-xl bg-slate-100 dark:bg-neutral-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 text-sm font-medium flex items-center gap-2">
                                      <Download className="w-4 h-4" />下载
                                    </button>
                                    {stem.key === 'vocals' && (
                                      <button onClick={handleUseForClone} className="h-10 px-4 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium flex items-center gap-2">
                                        <Wand2 className="w-4 h-4" />克隆
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs text-slate-500">共 {result.stems.length} 个独立音轨</span>
                            <button className="text-[10px] px-2 h-6 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 hover:bg-violet-200 flex items-center gap-1">
                              <FileDown className="w-3 h-3" />全部下载
                            </button>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {result.stems.map(stem => {
                              const playing = isPlayingThis && playingStem?.stemKey === stem.key;
                              return (
                                <StemCard key={stem.key} stem={stem} isPlaying={playing} isMuted={false} isSolo={false}
                                  onPlay={() => handlePlay(result.id, stem.key)}
                                  onDownload={() => handleDownload(stem.url)}
                                  onMute={() => {}}
                                  onSolo={() => {}}
                                  onUse={stem.key === 'vocals' ? handleUseForClone : undefined}
                                  showUseButton={stem.key === 'vocals'} />
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* =================== API 字段对照表 =================== */}
      <div className="mt-8 rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-neutral-800 flex items-center gap-2">
          <Hash className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">API 参数对照（参考官方文档）</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-neutral-800/50">
              <tr>
                <th className="text-left px-4 py-2 font-semibold text-slate-700 dark:text-slate-300">字段</th>
                <th className="text-left px-4 py-2 font-semibold text-slate-700 dark:text-slate-300">类型</th>
                <th className="text-left px-4 py-2 font-semibold text-slate-700 dark:text-slate-300">是否必填</th>
                <th className="text-left px-4 py-2 font-semibold text-slate-700 dark:text-slate-300">说明</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['taskId', 'string', '条件必填', '音乐生成任务的唯一标识符（"生成音乐"或"延长音乐"返回）。使用已有音频时必填。'],
                ['audioUrl', 'string', '条件必填', '用户上传音频文件的 URL 地址。最大 20MB。不可与 audioId 同时使用。'],
                ['audioId', 'string', '条件必填', '特定音频轨道的唯一标识符（从音乐生成回调返回）。不可与 audioUrl 同时使用。'],
                ['type', 'enum', '选填', '分离类型：separate_vocal（默认） / split_stem / split_stem_advanced'],
                ['stemName', 'enum', '条件必填', '仅 type=split_stem_advanced 时使用。100+ 种乐器可选：Lead Vocal、Drum Kit、Piano、Bass、Synth、Percussion…'],
                ['callBackUrl', 'string', '必填', '用于接收人声分离任务完成更新的 URL 地址'],
              ].map(([field, type, required, desc], i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-neutral-800">
                  <td className="px-4 py-2 font-mono text-violet-600 dark:text-violet-400 font-bold">{field}</td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400 font-mono">{type}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      required === '必填' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' :
                      required === '条件必填' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                      'bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-slate-400'
                    }`}>{required}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
