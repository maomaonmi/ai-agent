'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Square,
  Circle,
  Timer,
  Undo2,
  Redo2,
  Save,
  Download,
  Plus,
  Settings,
  Volume2,
  Wand2,
  Sparkles,
  Music2,
  Sliders,
  ChevronDown,
  Bot,
  Trash2,
  FileMusic,
  Layers,
  Edit3,
  Mic,
  MicOff,
  AudioLines,
  X,
  MoreHorizontal,
  Minus,
  Headphones,
  Check,
  Music,
  Zap,
  Disc,
  Wind,
} from 'lucide-react';
import { type MusicTab } from './MusicSidebar';

interface MusicEditorPageProps {
  activeTab: MusicTab;
  onTabChange: (tab: MusicTab) => void;
  onBack: () => void;
}

type EditorTab = 'vocal' | 'lyrics' | 'smart' | 'harmony' | 'material' | 'favorite';

interface Track {
  id: string;
  name: string;
  type: 'vocal' | 'instrument' | 'drum' | 'bass';
  muted: boolean;
  solo: boolean;
  volume: number;
  clips: AudioClip[];
}

interface AudioClip {
  id: string;
  name: string;
  start: number; // 小节位置
  duration: number; // 小节长度
  waveform?: number[];
}

const EDITOR_TABS: { id: EditorTab; label: string }[] = [
  { id: 'vocal', label: '人声旋律' },
  { id: 'lyrics', label: '歌词' },
  { id: 'smart', label: '智能演唱' },
  { id: 'harmony', label: '和声' },
  { id: 'material', label: '素材' },
  { id: 'favorite', label: '收藏' },
];

const STYLE_PRESETS = ['流行抒情', '民谣吉他', '电子舞曲', 'R&B 慢板', '古风', '摇滚', '爵士', '嘻哈'];

function generateWaveform(seed: number, length = 80): number[] {
  const arr: number[] = [];
  for (let i = 0; i < length; i++) {
    const v = Math.abs(Math.sin((i + seed) * 0.4) * Math.cos((i + seed) * 0.15));
    arr.push(0.2 + v * 0.8);
  }
  return arr;
}

const TRACK_ACCENT: Record<Track['type'], { bar: string; wave: string; chip: string }> = {
  vocal: { bar: 'bg-violet-500', wave: 'bg-violet-500/80', chip: 'from-violet-500 to-fuchsia-500' },
  instrument: { bar: 'bg-sky-500', wave: 'bg-sky-500/80', chip: 'from-sky-500 to-cyan-500' },
  drum: { bar: 'bg-amber-500', wave: 'bg-amber-500/80', chip: 'from-amber-500 to-orange-500' },
  bass: { bar: 'bg-emerald-500', wave: 'bg-emerald-500/80', chip: 'from-emerald-500 to-teal-500' },
};

const TRACK_TYPE_OPTIONS: { type: Track['type']; label: string; desc: string; name: string; icon: typeof Mic; iconBg: string; }[] = [
  {
    type: 'vocal',
    label: '人声',
    desc: '适用于演唱录音、和声等只含人声的音频',
    name: '人声轨',
    icon: Mic,
    iconBg: 'bg-gradient-to-br from-emerald-400 to-green-600',
  },
  {
    type: 'instrument',
    label: '音频',
    desc: '适用于伴奏、歌曲、乐器、采样等音频',
    name: '音频轨',
    icon: AudioLines,
    iconBg: 'bg-gradient-to-br from-slate-700 to-slate-900',
  },
];

export default function MusicEditorPage({ activeTab, onTabChange, onBack }: MusicEditorPageProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [timeSignature, setTimeSignature] = useState('4/4');
  const [volume, setVolume] = useState(0.7);
  const [editorTab, setEditorTab] = useState<EditorTab>('vocal');
  const [creationPrompt, setCreationPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('流行抒情');
  const [lyrics, setLyrics] = useState('');
  const [voiceGender, setVoiceGender] = useState<'female' | 'male'>('female');
  // 人声旋律模式
  const [melodyMode, setMelodyMode] = useState<'vocal' | 'inspiration'>('vocal');
  // 歌词生成方式
  const [lyricsMode, setLyricsMode] = useState<'auto' | 'custom'>('auto');
  // 和声模式
  const [harmonyMode, setHarmonyMode] = useState<'accompany' | 'vocal'>('accompany');
  // 素材来源
  const [materialSource, setMaterialSource] = useState<'local' | 'beats' | 'sample'>('local');
  // 智能演唱子标签
  const [singSubTab, setSingSubTab] = useState<'voice' | 'harmony'>('voice');
  // AI歌手筛选
  const [singerFilter, setSingerFilter] = useState<'all' | 'male' | 'female'>('all');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [zoom, setZoom] = useState(1);
  const [bars] = useState(16);
  // 播放头位置（0-1 比例），可拖动
  const [playhead, setPlayhead] = useState(0);
  // 添加音轨弹窗
  const [showTrackTypeModal, setShowTrackTypeModal] = useState(false);
  // 「...」菜单：当前打开菜单的轨道 id（同时只允许一个菜单打开）
  const [openMenuTrackId, setOpenMenuTrackId] = useState<string | null>(null);
  // 菜单 fixed 坐标（相对于视口），避免被父容器 overflow 裁切
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  // 底部面板：录音设置 / 轨道效果 / 片段编辑
  const [activeBottomPanel, setActiveBottomPanel] = useState<'recording' | 'track' | 'clip' | null>(null);
  // 选中的片段（片段编辑按钮需要）
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  // 麦克风音量检测相关状态
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [micVolume, setMicVolume] = useState(0.52); // 0-1，初始值对应-31.7 dB
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationIdRef = useRef<number | null>(null);

  // 计算显示音量（-60dB 到 0dB）
  const displayDb = Math.max(-60, Math.min(0, micVolume * 60 - 60));
  // Autotune 调式选择弹窗
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [selectedKey, setSelectedKey] = useState('D小调');
  const [selectedScale, setSelectedScale] = useState<'major' | 'minor' | 'chromatic'>('minor');
  // 混响选项
  const [selectedReverb, setSelectedReverb] = useState('大厅');
  // 上滑面板状态：vocalEffect | key | reverb
  const [slideUpPanel, setSlideUpPanel] = useState<'vocalEffect' | 'key' | 'reverb' | null>(null);
  const [slideUpPosition, setSlideUpPosition] = useState({ top: 0, left: 0, width: 0 });
  // 人声效果器选中项
  const [selectedVocalEffect, setSelectedVocalEffect] = useState('说唱 Rap');
  const [vocalEffectTab, setVocalEffectTab] = useState<'recommend' | 'enhance' | 'special' | 'style'>('recommend');

  // 打开上滑面板
  const openSlideUpPanel = (panel: 'vocalEffect' | 'key' | 'reverb', e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setSlideUpPosition({
      top: rect.top - 8,
      left: rect.left,
      width: rect.width,
    });
    setSlideUpPanel(panel);
  };

  // 麦克风音量检测 useEffect
  useEffect(() => {
    let isActive = true;

    const startMic = async () => {
      if (!isMicEnabled || !isActive) return;

      try {
        // 申请麦克风权限
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        if (!isActive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        mediaStreamRef.current = stream;

        // 初始化 AudioContext
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();

        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const animate = () => {
          if (!isActive || !isMicEnabled) return;
          if (!analyser) {
            animationIdRef.current = requestAnimationFrame(animate);
            return;
          }

          analyser.getByteFrequencyData(dataArray);

          // 简单计算音量平均值
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const average = sum / dataArray.length / 255;

          setMicVolume(average);

          animationIdRef.current = requestAnimationFrame(animate);
        };

        animate();
      } catch (err) {
        console.error('麦克风权限申请失败', err);
        setIsMicEnabled(false);
      }
    };

    const stopMic = () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }

      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }

      analyserRef.current = null;

      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }

      setMicVolume(0.52); // 恢复初始值
    };

    if (isMicEnabled) startMic();
    else stopMic();

    return () => {
      isActive = false;
      stopMic();
    };
  }, [isMicEnabled]);

  // 时间轴右侧区域引用（不含左侧固定面板，用于计算播放头比例与点击定位）
  const timelineAreaRef = useRef<HTMLDivElement>(null);
  // 播放头竖线 DOM 引用 - 拖动期间绕过 React 直接更新 style.left，避免每次 mousemove 触发整树重渲染造成的卡顿
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const isDraggingPlayheadRef = useRef(false);
  // 拖动过程中累积的最终比例，仅在 mouseup 提交到 state
  const pendingPlayheadRef = useRef<number | null>(null);
  // RAF 句柄 - 拖动期间 mousemove 用 requestAnimationFrame 节流到 60fps
  const playheadRafRef = useRef<number | null>(null);

  const togglePlay = () => setIsPlaying((p) => !p);
  const toggleRecord = () => setIsRecording((r) => !r);

  // 点击时间轴空白处定位播放头 - 立即提交到 state
  const setPlayheadFromEvent = useCallback((clientX: number) => {
    const el = timelineAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setPlayhead(ratio);
  }, []);

  // 播放头拖动逻辑 - 关键：mousemove 期间只操作 ref.current.style.left，不触发任何 setState
  useEffect(() => {
    const flushPlayhead = (clientX: number) => {
      const el = timelineAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      pendingPlayheadRef.current = ratio;
      // 直接写入 DOM 样式，跳过 React reconciler
      if (playheadLineRef.current) {
        playheadLineRef.current.style.left = `calc(8rem + ${ratio} * (100% - 8rem))`;
      }
    };

    const onMove = (e: MouseEvent) => {
      if (!isDraggingPlayheadRef.current) return;
      // RAF 节流：每帧最多更新一次，避免高频 mousemove 抖动
      if (playheadRafRef.current !== null) return;
      playheadRafRef.current = requestAnimationFrame(() => {
        playheadRafRef.current = null;
        if (!isDraggingPlayheadRef.current) return;
        flushPlayhead(e.clientX);
      });
    };
    const onUp = () => {
      // 取消未触发的 RAF
      if (playheadRafRef.current !== null) {
        cancelAnimationFrame(playheadRafRef.current);
        playheadRafRef.current = null;
      }
      // 仅在 mouseup 提交最终位置到 state（用于触发后续依赖 playhead 的逻辑/渲染）
      if (isDraggingPlayheadRef.current && pendingPlayheadRef.current !== null) {
        setPlayhead(pendingPlayheadRef.current);
        pendingPlayheadRef.current = null;
      }
      isDraggingPlayheadRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (playheadRafRef.current !== null) {
        cancelAnimationFrame(playheadRafRef.current);
        playheadRafRef.current = null;
      }
    };
  }, []);

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isDraggingPlayheadRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // 起拖时立即定位一次（写入 ref+state），避免拖动起点错位
    setPlayheadFromEvent(e.clientX);
    if (timelineAreaRef.current) {
      const rect = timelineAreaRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      pendingPlayheadRef.current = ratio;
      if (playheadLineRef.current) {
        playheadLineRef.current.style.left = `calc(8rem + ${ratio} * (100% - 8rem))`;
      }
    }
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    // 点击时间刻度空白处也可定位播放头
    if (isDraggingPlayheadRef.current) return;
    setPlayheadFromEvent(e.clientX);
  };

  // 添加音轨（来自弹窗的 type）
  const handleAddTrack = (type: Track['type']) => {
    const opt = TRACK_TYPE_OPTIONS.find((o) => o.type === type);
    const namePrefix = opt?.name ?? '新轨道';
    const newTrack: Track = {
      id: `t${Date.now()}`,
      name: `${namePrefix} ${tracks.filter((t) => t.type === type).length + 1}`,
      type,
      muted: false,
      solo: false,
      volume: 0.7,
      clips: [],
    };
    setTracks((prev) => [...prev, newTrack]);
    setShowTrackTypeModal(false);
  };

  const toggleMute = (id: string) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, muted: !t.muted } : t)));
  };

  const toggleSolo = (id: string) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, solo: !t.solo } : t)));
  };

  const removeTrack = (id: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== id));
    closeMenuIfNeeded(id);
  };

  // 统一关闭菜单（避免到处写两行）
  const closeMenuIfNeeded = (id: string) => {
    if (openMenuTrackId === id) {
      setOpenMenuTrackId(null);
      setMenuPos(null);
    }
  };

  // 「...」菜单 - 重命名轨道（用 prompt 简单交互，避免额外 modal 噪音）
  const handleRenameTrack = (id: string) => {
    const target = tracks.find((t) => t.id === id);
    if (!target) return;
    // 默认名回填到输入框，用户可改可不改
    const currentName = target.name;
    const next = window.prompt('重命名轨道', currentName);
    if (next === null) return; // 取消
    const trimmed = next.trim();
    if (!trimmed || trimmed === currentName) return;
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, name: trimmed } : t)));
    closeMenuIfNeeded(id);
  };

  // 「...」菜单 - 切换轨道类型（人声 ↔ 音频）
  const handleChangeTrackType = (id: string, nextType: Track['type']) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.type === nextType) return t;
        // 同步刷新 displayName：根据新的类型用「人声/音频」前缀，编号保持
        const sameTypeCount = prev.filter((x) => x.type === nextType).length;
        const idxInType = prev.filter((x) => x.type === nextType).length + 1;
        const opt = TRACK_TYPE_OPTIONS.find((o) => o.type === nextType);
        const prefix = nextType === 'vocal' ? '人声' : '音频';
        const generatedName = `${opt?.name ?? '轨道'} ${idxInType}`;
        return { ...t, type: nextType, name: generatedName };
      }),
    );
    closeMenuIfNeeded(id);
  };

  // 「...」菜单 - 克隆轨道（深拷贝 clips 与所有设置，新 id 放在原轨道后）
  const handleCloneTrack = (id: string) => {
    setTracks((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const src = prev[idx];
      const sameTypeCount = prev.filter((t) => t.type === src.type).length + 1;
      const opt = TRACK_TYPE_OPTIONS.find((o) => o.type === src.type);
      const cloned: Track = {
        ...src,
        id: `t${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: `${opt?.name ?? '轨道'} ${sameTypeCount}`,
        clips: src.clips.map((c) => ({ ...c, id: `${c.id}_${Math.floor(Math.random() * 1000)}` })),
      };
      const out = [...prev];
      out.splice(idx + 1, 0, cloned);
      return out;
    });
    closeMenuIfNeeded(id);
  };

  // 点击「...」菜单外部任意位置，关闭菜单
  useEffect(() => {
    if (!openMenuTrackId) return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-track-menu]')) return;
      setOpenMenuTrackId(null);
      setMenuPos(null);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [openMenuTrackId]);

  const handleGenerate = () => {
    if (!creationPrompt.trim() && !lyrics.trim()) return;
    // 若没有任何轨道，自动添加一个人声轨再生成
    if (tracks.length === 0) {
      const newTrack: Track = {
        id: `t${Date.now()}`,
        name: '人声轨 1',
        type: 'vocal',
        muted: false,
        solo: false,
        volume: 0.7,
        clips: [],
      };
      const newClip: AudioClip = {
        id: `c${Date.now()}`,
        name: 'AI 生成片段',
        start: 0,
        duration: 4,
        waveform: generateWaveform(Math.random() * 10),
      };
      setTracks([{ ...newTrack, clips: [newClip] }]);
      return;
    }
    const newClip: AudioClip = {
      id: `c${Date.now()}`,
      name: 'AI 生成片段',
      start: 0,
      duration: 4,
      waveform: generateWaveform(Math.random() * 10),
    };
    setTracks((prev) =>
      prev.map((t, i) => (i === 0 ? { ...t, clips: [...t.clips, newClip] } : t)),
    );
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {/* 顶部工具栏 - 与全局一致的浅色主题 */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {/* 左侧播放控制 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPlaying(false)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            title="回到开头"
          >
            <Circle size={10} fill="currentColor" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-8 w-8 items-center justify-center rounded-md text-sky-600 transition hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-500/10"
            title={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          </button>
          <button
            type="button"
            onClick={toggleRecord}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition ${
              isRecording ? 'bg-rose-500 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-rose-500 dark:text-neutral-400 dark:hover:bg-neutral-800'
            }`}
            title="录制"
          >
            <Circle size={10} fill="currentColor" />
          </button>
          <div className="ml-2 flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
            <Timer size={12} className="text-slate-400" />
            <span>00:00.0</span>
          </div>
        </div>

        {/* 中间节拍器 / 拍号 / 音量 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 dark:border-neutral-700 dark:bg-neutral-800">
            <Timer size={13} className="text-slate-400" />
            <span className="text-[11px] text-slate-500 dark:text-neutral-400">BPM</span>
            <input
              type="number"
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value) || 60)}
              min={40}
              max={240}
              className="w-10 border-none bg-transparent text-sm font-semibold text-slate-900 outline-none dark:text-white"
            />
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 dark:border-neutral-700 dark:bg-neutral-800">
            <span className="text-[11px] text-slate-500 dark:text-neutral-400">拍号</span>
            <select
              value={timeSignature}
              onChange={(e) => setTimeSignature(e.target.value)}
              className="border-none bg-transparent text-sm font-semibold text-slate-900 outline-none dark:text-white"
            >
              <option className="text-slate-900">4/4</option>
              <option className="text-slate-900">3/4</option>
              <option className="text-slate-900">6/8</option>
              <option className="text-slate-900">2/4</option>
            </select>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 dark:border-neutral-700 dark:bg-neutral-800">
            <Volume2 size={13} className="text-slate-400" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="h-1 w-20 cursor-pointer accent-sky-500"
            />
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" title="撤销">
              <Undo2 size={14} />
            </button>
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" title="重做">
              <Redo2 size={14} />
            </button>
          </div>
        </div>

        {/* 右侧保存导出 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            <Save size={13} />
            <span>保存</span>
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-600"
          >
            <Download size={13} />
            <span>导出</span>
          </button>
        </div>
      </div>

      {/* 主体两栏布局：控制面板 + 编辑区 */}
      <div className="flex flex-1 gap-3 overflow-hidden">
        {/* 控制面板 */}
        <div className="flex w-[420px] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          {/* Tab 栏 */}
          <div className="flex border-b border-slate-200 px-1 pt-1 dark:border-neutral-800">
            {EDITOR_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setEditorTab(tab.id)}
                className={`relative flex-1 px-2 py-2 text-xs font-medium transition ${
                  editorTab === tab.id
                    ? 'text-sky-600 dark:text-sky-400'
                    : 'text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                }`}
              >
                {tab.label}
                {editorTab === tab.id && (
                  <span className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-sky-500" />
                )}
              </button>
            ))}
          </div>

          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
            {editorTab === 'vocal' && (
              <>
                {/* 旋律模式 */}
                <div className="mb-4">
                  <label className="mb-2 block text-xs font-medium text-slate-700 dark:text-neutral-200">旋律模式</label>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setMelodyMode('vocal')}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        melodyMode === 'vocal'
                          ? 'border-sky-500 bg-sky-50 dark:border-sky-400 dark:bg-sky-500/10'
                          : 'border-slate-200 hover:border-slate-300 dark:border-neutral-700 dark:hover:border-neutral-600'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-800 dark:text-neutral-200">伴奏配人声演唱</span>
                        <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">推荐</span>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500 dark:text-neutral-400">为伴奏生成人声词曲演唱示例 (TemPolor v4.1a)</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMelodyMode('inspiration')}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        melodyMode === 'inspiration'
                          ? 'border-sky-500 bg-sky-50 dark:border-sky-400 dark:bg-sky-500/10'
                          : 'border-slate-200 hover:border-slate-300 dark:border-neutral-700 dark:hover:border-neutral-600'
                      }`}
                    >
                      <div className="text-xs font-medium text-slate-800 dark:text-neutral-200">伴奏配旋律灵感</div>
                      <div className="mt-1 text-[10px] text-slate-500 dark:text-neutral-400">为伴奏配上哼唱旋律灵感</div>
                    </button>
                  </div>
                </div>

                {/* 主伴奏音轨 */}
                <div className="mb-4">
                  <label className="mb-2 block text-xs font-medium text-slate-700 dark:text-neutral-200">主伴奏音轨</label>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 transition hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    <span>选择音轨</span>
                    <ChevronDown size={14} className="text-slate-400" />
                  </button>
                </div>

                {/* 歌词 */}
                <div className="mb-4">
                  <label className="mb-2 block text-xs font-medium text-slate-700 dark:text-neutral-200">歌词</label>
                  <div className="mb-2 flex rounded-lg bg-slate-100 p-1 dark:bg-neutral-800">
                    <button
                      type="button"
                      onClick={() => setLyricsMode('auto')}
                      className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
                        lyricsMode === 'auto'
                          ? 'bg-white shadow text-slate-900 dark:bg-neutral-700 dark:text-neutral-100'
                          : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                      }`}
                    >
                      自动生成
                    </button>
                    <button
                      type="button"
                      onClick={() => setLyricsMode('custom')}
                      className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
                        lyricsMode === 'custom'
                          ? 'bg-white shadow text-slate-900 dark:bg-neutral-700 dark:text-neutral-100'
                          : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                      }`}
                    >
                      自定义歌词
                    </button>
                  </div>
                  <div className="relative">
                    <textarea
                      value={lyrics}
                      onChange={(e) => setLyrics(e.target.value)}
                      placeholder="输入你的歌词主题，例如：毕业的夏天"
                      className="min-h-[80px] w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200 dark:placeholder:text-neutral-500"
                    />
                    <button
                      type="button"
                      className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-slate-200 px-2 py-1 text-[10px] text-slate-600 transition hover:bg-slate-300 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600"
                    >
                      <Sparkles size={10} />
                      生成歌词
                    </button>
                  </div>
                </div>

                {/* 音色 */}
                <div className="mb-4">
                  <label className="mb-2 block text-xs font-medium text-slate-700 dark:text-neutral-200">音色</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setVoiceGender('male')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                        voiceGender === 'male'
                          ? 'bg-sky-500 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
                      }`}
                    >
                      男生
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoiceGender('female')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                        voiceGender === 'female'
                          ? 'bg-sky-500 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
                      }`}
                    >
                      女生
                    </button>
                  </div>
                </div>
              </>
            )}

            {editorTab === 'lyrics' && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500">
                  <Music2 size={20} />
                </div>
                <p className="text-sm text-slate-700 dark:text-neutral-200">歌词</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">该模块正在建设中</p>
              </div>
            )}

            {editorTab === 'smart' && (
              <>
                {/* 子标签 */}
                <div className="mb-4 flex rounded-lg bg-slate-100 p-1 dark:bg-neutral-800">
                  <button
                    type="button"
                    onClick={() => setSingSubTab('voice')}
                    className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
                      singSubTab === 'voice'
                        ? 'bg-white shadow text-slate-900 dark:bg-neutral-700 dark:text-neutral-100'
                        : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                    }`}
                  >
                    音色替换
                  </button>
                  <button
                    type="button"
                    onClick={() => setSingSubTab('harmony')}
                    className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
                      singSubTab === 'harmony'
                        ? 'bg-white shadow text-slate-900 dark:bg-neutral-700 dark:text-neutral-100'
                        : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                    }`}
                  >
                    智能和声
                  </button>
                </div>

                {/* 主唱音轨 */}
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-neutral-200">主唱音轨</label>
                  <p className="mb-2 text-[10px] text-slate-400 dark:text-neutral-500">需避免同一时间有多个人声演唱</p>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 transition hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    <span>选择音轨</span>
                    <ChevronDown size={14} className="text-slate-400" />
                  </button>
                </div>

                {/* AI歌手 */}
                <div className="mb-4">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700 dark:text-neutral-200">AI歌手</label>
                    <button type="button" className="flex items-center gap-1 text-[10px] text-sky-600 hover:text-sky-700 dark:text-sky-400">
                      <Sparkles size={10} />
                      帮我推荐
                    </button>
                  </div>
                  <div className="mb-3 flex gap-2">
                    {[
                      { key: 'all', label: '全部' },
                      { key: 'male', label: '男声' },
                      { key: 'female', label: '女声' },
                    ].map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setSingerFilter(f.key as any)}
                        className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                          singerFilter === f.key
                            ? 'bg-sky-500 text-white'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* 歌手列表 */}
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { name: '叶雪如', type: '女高音 流行', tags: '温柔 磁性', gender: 'female' },
                      { name: '哈森', type: '男高音 流行', tags: '明亮 磁性', gender: 'male' },
                      { name: 'Aimi芷', type: '女低音 流行', tags: '沙哑 醇厚 成熟', gender: 'female' },
                      { name: '陈笑之', type: '男高音 流行', tags: '温柔 慵懒', gender: 'male' },
                      { name: '太二', type: '男中音 R&B', tags: '二次元 醇厚 空灵 慵懒', gender: 'male' },
                      { name: 'Feeling储艺洁', type: '女高音 流行', tags: '明亮 空灵', gender: 'female' },
                      { name: '航仔', type: '男高音 流行', tags: '温柔 沙哑', gender: 'male' },
                      { name: '莎莎', type: '女中音 流行', tags: '性感 慵懒', gender: 'female' },
                      { name: '乐潮', type: '男高音 流行', tags: '旋律说唱 细腻 纯净', gender: 'male' },
                    ]
                      .filter((s) => singerFilter === 'all' || s.gender === singerFilter)
                      .map((singer) => (
                        <button
                          key={singer.name}
                          type="button"
                          className="flex flex-col items-center gap-1.5 rounded-lg p-2 transition hover:bg-slate-50 dark:hover:bg-neutral-800"
                        >
                          <div className="relative h-14 w-14 overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-700">
                            <div className="absolute inset-0 flex items-center justify-center text-slate-400">
                              <Mic size={20} />
                            </div>
                            <div className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow dark:bg-neutral-800">
                              <Play size={8} className="ml-0.5 text-slate-600 dark:text-neutral-300" />
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs font-medium text-slate-800 dark:text-neutral-200">{singer.name}</div>
                            <div className="text-[10px] text-slate-500 dark:text-neutral-400">{singer.type}</div>
                            <div className="text-[10px] text-slate-400 dark:text-neutral-500">{singer.tags}</div>
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              </>
            )}

            {editorTab === 'harmony' && (
              <>
                {/* 和声模式 */}
                <div className="mb-4">
                  <label className="mb-2 block text-xs font-medium text-slate-700 dark:text-neutral-200">和声模式</label>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setHarmonyMode('accompany')}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        harmonyMode === 'accompany'
                          ? 'border-sky-500 bg-sky-50 dark:border-sky-400 dark:bg-sky-500/10'
                          : 'border-slate-200 hover:border-slate-300 dark:border-neutral-700 dark:hover:border-neutral-600'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-800 dark:text-neutral-200">伴奏配和声</span>
                        <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">推荐</span>
                      </div>
                      <div className="mt-1 text-[10px] text-slate-500 dark:text-neutral-400">分析伴奏的和弦走向，生成的和声更和谐</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setHarmonyMode('vocal')}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        harmonyMode === 'vocal'
                          ? 'border-sky-500 bg-sky-50 dark:border-sky-400 dark:bg-sky-500/10'
                          : 'border-slate-200 hover:border-slate-300 dark:border-neutral-700 dark:hover:border-neutral-600'
                      }`}
                    >
                      <div className="text-xs font-medium text-slate-800 dark:text-neutral-200">主唱配和声</div>
                      <div className="mt-1 text-[10px] text-slate-500 dark:text-neutral-400">直接根据主唱生成和声，适合无伴奏场景</div>
                    </button>
                  </div>
                </div>

                {/* 主唱音轨 */}
                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-neutral-200">主唱音轨</label>
                  <p className="mb-2 text-[10px] text-slate-400 dark:text-neutral-500">需避免同一时间有多个人声演唱</p>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 transition hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    <span>选择音轨</span>
                    <ChevronDown size={14} className="text-slate-400" />
                  </button>
                </div>

                {/* 主伴奏音轨 */}
                <div className="mb-4">
                  <label className="mb-2 block text-xs font-medium text-slate-700 dark:text-neutral-200">主伴奏音轨</label>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 transition hover:bg-slate-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    <span>选择音轨</span>
                    <ChevronDown size={14} className="text-slate-400" />
                  </button>
                </div>
              </>
            )}

            {editorTab === 'material' && (
              <>
                {/* 素材来源 */}
                <div className="mb-4 flex rounded-lg bg-slate-100 p-1 dark:bg-neutral-800">
                  {[
                    { key: 'local', label: '本地' },
                    { key: 'beats', label: 'Beats' },
                    { key: 'sample', label: 'Sample' },
                  ].map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setMaterialSource(s.key as any)}
                      className={`flex-1 rounded-md py-1.5 text-xs font-medium transition ${
                        materialSource === s.key
                          ? 'bg-white shadow text-slate-900 dark:bg-neutral-700 dark:text-neutral-100'
                          : 'text-slate-500 hover:text-slate-700 dark:text-neutral-400 dark:hover:text-neutral-200'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                {/* 上传区域 */}
                <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center dark:border-neutral-700 dark:bg-neutral-800/50">
                  <Plus size={24} className="mx-auto mb-2 text-slate-400" />
                  <div className="text-xs font-medium text-slate-700 dark:text-neutral-200">上传音频文件</div>
                  <div className="mt-1 text-[10px] text-slate-400 dark:text-neutral-500">支持wav/mp3，不超过100MB，不超过10分钟</div>
                </div>
              </>
            )}

            {editorTab === 'favorite' && (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-neutral-800 dark:text-neutral-500">
                  <Music2 size={20} />
                </div>
                <p className="text-sm text-slate-700 dark:text-neutral-200">收藏</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-neutral-500">该模块正在建设中</p>
              </div>
            )}
          </div>

          {/* 底部生成按钮 */}
          <div className="border-t border-slate-200 p-3 dark:border-neutral-800">
            <button
              type="button"
              onClick={handleGenerate}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-600"
            >
              <Sparkles size={14} />
              <span>生成详情</span>
            </button>
          </div>
        </div>

        {/* 右侧主编辑区 */}
        <div className="relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          {/* 编辑区头部 */}
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-neutral-800">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-slate-700 dark:text-neutral-200">编辑器</span>
              <span className="text-xs text-slate-400 dark:text-neutral-500">2026.08.28 09:32:50:48</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 transition hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700">
                <Sliders size={12} />
                <span>速度</span>
              </button>
              <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800" title="缩放">
                <ChevronDown size={14} />
              </button>
              <button type="button" className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800" title="设置">
                <Settings size={14} />
              </button>
            </div>
          </div>

          {/* 内容区：时间刻度 + 轨道列表 + 拖拽占位 - 同一容器内承载全高播放头竖线 */}
          <div
            className="relative flex-1 overflow-y-auto scrollbar-thin"
            onClick={handleTimelineClick}
          >
            {/* 全高播放头竖线 - 跨越时间刻度、轨道列表、占位区
                关键设计：整条不可见的 16px 命中区 = 拖动手柄（覆盖整条高度，任意位置可抓）
                视觉细线 + 顶部圆手柄用 -translate-x-1/2 / -left-2 严格居中于同一位置点，避免错位
                left 通过 ref 在拖动期间直接写 DOM 避开 React 重渲染；React state 仅控制初始/最终位置 */}
            <div
              ref={playheadLineRef}
              className="pointer-events-none absolute top-0 z-30 h-full"
              style={{ left: `calc(8rem + ${playhead} * (100% - 8rem))` }}
            >
              {/* 全高抓取命中区：16px 宽 × 100% 高，居中于位置点；在竖线任何高度点击/拖动都生效 */}
              <div
                onMouseDown={handlePlayheadMouseDown}
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-auto absolute -left-2 top-0 h-full w-4 cursor-col-resize"
                title="拖动调节播放位置"
              />
              {/* 视觉细线：1px 居中于位置点，与顶部圆心共线 */}
              <div className="pointer-events-none absolute top-0 h-full w-px -translate-x-1/2 bg-sky-500" />
              {/* 顶部视觉手柄：16px 圆，居中于位置点 */}
              <div className="pointer-events-none absolute -left-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-sky-500 shadow-md">
                <span className="block h-1.5 w-px bg-white" />
              </div>
            </div>

            {/* 时间刻度条 - 左侧固定面板放「+ 添加音轨」按钮 + 弹窗，右侧为时间轴 */}
            <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-slate-50 dark:border-neutral-800 dark:bg-neutral-800/50">
              {/* 左侧固定面板：添加音轨按钮 + 选择类型弹窗 */}
              <div className="relative flex w-52 shrink-0 items-center justify-start border-r border-slate-200 px-3 py-2 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTrackTypeModal((v) => !v);
                  }}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-200 hover:text-slate-900 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white"
                  title="添加音轨"
                >
                  <Plus size={14} />
                  <span>添加音轨</span>
                </button>

                {/* 弹窗 - 锚定在「添加音轨」按钮正下方，覆盖到时间刻度区域，宽度 w-80 */}
                {showTrackTypeModal && (
                  <div
                    className="absolute top-full left-0 z-50 mt-1 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-neutral-700 dark:bg-neutral-800"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">选择新轨道类型</h3>
                      <button
                        type="button"
                        onClick={() => setShowTrackTypeModal(false)}
                        className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {TRACK_TYPE_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.type}
                            type="button"
                            onClick={() => handleAddTrack(opt.type)}
                            className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-neutral-700/60"
                          >
                            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${opt.iconBg}`}>
                              <Icon size={18} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-slate-900 dark:text-white">{opt.label}</p>
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-neutral-400">{opt.desc}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              {/* 右侧时间刻度 */}
              <div ref={timelineAreaRef} className="relative flex flex-1">
                {Array.from({ length: bars }).map((_, i) => (
                  <div
                    key={i}
                    className="relative flex-1 border-r border-slate-200 py-1.5 text-center last:border-r-0 dark:border-neutral-700"
                  >
                    <span className="text-[10px] font-medium text-slate-500 dark:text-neutral-400">{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 轨道列表 */}
            <div>
              {tracks.length === 0 ? (
                <div className="flex min-h-[88px]">
                  {/* 左侧固定面板占位（与轨道行对齐） */}
                  <div className="w-52 shrink-0 border-r border-slate-200 dark:border-neutral-800" />
                  {/* 右侧时间轴区域显示虚线占位框 */}
                  <div className="flex-1 p-2">
                    <div className="flex h-[200px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/40 text-slate-400 dark:border-neutral-700 dark:bg-neutral-800/30 dark:text-neutral-500">
                      <Plus size={20} className="text-slate-300 dark:text-neutral-600" />
                      <span className="text-xs">将音轨/音频文件直接拖拽到此处</span>
                    </div>
                  </div>
                </div>
              ) : (
                tracks.map((track, index) => {
                  const accent = TRACK_ACCENT[track.type];
                  // 轨道命名：优先用 track.name（用户可能已重命名），否则按类型生成默认
                  const fallbackName = track.type === 'vocal' ? `0${index + 1} 人声` : `0${index + 1} 音频`;
                  const displayName = track.name?.trim() ? track.name : fallbackName;
                  const isMenuOpen = openMenuTrackId === track.id;
                  return (
                    <div key={track.id} className="relative flex min-h-[120px] border-b border-slate-200 last:border-b-0 dark:border-neutral-800">
                      {/* 轨道控制面板（左侧固定列，宽 208px） */}
                      <div className="relative flex w-52 shrink-0 flex-col justify-center gap-1.5 border-r border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-neutral-800 dark:bg-neutral-800/50">
                        {/* 第一行：类型图标 + 名称 + 静音/监听/更多/效果 */}
                        <div className="flex items-center gap-1">
                          <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${accent.bar}`} title={track.type === 'vocal' ? '人声' : '音频'}>
                            {track.type === 'vocal' ? <Mic size={11} /> : <AudioLines size={11} />}
                          </div>
                          <span className="flex-1 truncate text-[11px] font-medium text-slate-700 dark:text-neutral-200" title={displayName}>{displayName}</span>
                          <button
                            type="button"
                            onClick={() => toggleMute(track.id)}
                            className={`flex h-5 w-5 items-center justify-center rounded transition ${
                              track.muted
                                ? 'bg-rose-500 text-white'
                                : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-white'
                            }`}
                            title="静音"
                          >
                            <MicOff size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleSolo(track.id)}
                            className={`flex h-5 w-5 items-center justify-center rounded transition ${
                              track.solo
                                ? 'bg-amber-500 text-white'
                                : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-white'
                            }`}
                            title="监听"
                          >
                            <Headphones size={11} />
                          </button>
                          <button
                            type="button"
                            ref={openMenuTrackId === track.id ? menuBtnRef : undefined}
                            data-track-menu
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isMenuOpen) {
                                setOpenMenuTrackId(null);
                                setMenuPos(null);
                                return;
                              }
                              const btn = e.currentTarget;
                              const rect = btn.getBoundingClientRect();
                              // 弹窗出现在按钮右下方（与设计图一致）
                              setMenuPos({ top: rect.bottom + 4, left: rect.left - 8 });
                              setOpenMenuTrackId(track.id);
                            }}
                            className={`flex h-5 w-5 items-center justify-center rounded transition ${
                              isMenuOpen
                                ? 'bg-slate-200 text-slate-800 dark:bg-neutral-700 dark:text-white'
                                : 'text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-white'
                            }`}
                            title="更多"
                            aria-expanded={isMenuOpen}
                          >
                            <MoreHorizontal size={11} />
                          </button>
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-white"
                            title="轨道效果"
                          >
                            <Sliders size={11} />
                          </button>
                        </div>
                        {/* 第二行：音量图标 + 音量条 + 删除 */}
                        <div className="flex items-center gap-1.5">
                          <Volume2 size={10} className="shrink-0 text-slate-400 dark:text-neutral-500" />
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={track.volume}
                            onChange={(e) =>
                              setTracks((prev) =>
                                prev.map((t) => (t.id === track.id ? { ...t, volume: Number(e.target.value) } : t)),
                              )
                            }
                            className="h-1 flex-1 cursor-pointer accent-sky-500"
                          />
                          <button
                            type="button"
                            onClick={() => removeTrack(track.id)}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-500 dark:text-neutral-500"
                            title="删除"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>

                        {/* 「...」菜单 - fixed 定位，不受任何父容器 overflow 裁切 */}
                        {isMenuOpen && menuPos && (
                          <div
                            data-track-menu
                            className="fixed z-[9999] w-56 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-100 shadow-2xl"
                            style={{ top: menuPos.top, left: menuPos.left }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* 重命名 */}
                            <button
                              type="button"
                              onClick={() => handleRenameTrack(track.id)}
                              className="flex w-full items-center px-3 py-2 text-left text-sm transition hover:bg-neutral-700/70"
                            >
                              <span>重命名</span>
                            </button>
                            <div className="mx-3 h-px bg-neutral-700" />
                            {/* 更改轨道类型 */}
                            <div className="px-3 py-2.5">
                              <p className="mb-1.5 text-xs text-neutral-400">更改轨道类型</p>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleChangeTrackType(track.id, 'vocal')}
                                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition ${
                                    track.type === 'vocal'
                                      ? 'border border-sky-500/60 bg-sky-500/10 text-sky-200'
                                      : 'border border-transparent bg-neutral-700/60 text-neutral-300 hover:bg-neutral-700'
                                  }`}
                                >
                                  <Mic size={12} /> 人声
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleChangeTrackType(track.id, 'instrument')}
                                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition ${
                                    track.type === 'instrument'
                                      ? 'border border-sky-500/60 bg-sky-500/10 text-sky-200'
                                      : 'border border-transparent bg-neutral-700/60 text-neutral-300 hover:bg-neutral-700'
                                  }`}
                                >
                                  <AudioLines size={12} /> 音频
                                </button>
                              </div>
                            </div>
                            <div className="mx-3 h-px bg-neutral-700" />
                            {/* 克隆 */}
                            <button
                              type="button"
                              onClick={() => handleCloneTrack(track.id)}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-neutral-700/70"
                            >
                              <span>克隆</span>
                              <kbd className="rounded border border-neutral-600 bg-neutral-700 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">Shift + D</kbd>
                            </button>
                            {/* 删除 */}
                            <button
                              type="button"
                              onClick={() => removeTrack(track.id)}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-rose-300 transition hover:bg-rose-500/10"
                            >
                              <span>删除</span>
                              <kbd className="rounded border border-neutral-600 bg-neutral-700 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">Shift + ⌫</kbd>
                            </button>
                          </div>
                        )}
                      </div>
                      {/* 轨道内容（与时间刻度对齐） */}
                      <div
                        className="relative flex-1 bg-white dark:bg-neutral-900"
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(90deg, rgba(148,163,184,0.2) 0px, rgba(148,163,184,0.2) 1px, transparent 1px, transparent ' +
                            `${(100 / bars) * zoom}%`,
                          backgroundSize: `${(100 / bars) * zoom}% 100%`,
                        }}
                      >
                        {track.clips.length === 0 ? (
                          <div className="flex h-full min-h-[80px] items-center px-3 text-[10px] text-slate-300 dark:text-neutral-600">空轨道</div>
                        ) : (
                          track.clips.map((clip) => (
                            <div
                              key={clip.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedClipId(selectedClipId === clip.id ? null : clip.id);
                              }}
                              className={`absolute top-2 bottom-2 flex items-center overflow-hidden rounded-md bg-gradient-to-br ${accent.chip} shadow-md transition cursor-pointer ${selectedClipId === clip.id ? 'ring-2 ring-sky-400 ring-offset-1' : ''}`}
                              style={{
                                left: `${(clip.start / bars) * 100}%`,
                                width: `${(clip.duration / bars) * 100}%`,
                              }}
                            >
                              <div className="flex h-full w-full items-center gap-0.5 px-2">
                                {clip.waveform?.slice(0, 30).map((v, i) => (
                                  <div
                                    key={i}
                                    className="flex-1 rounded-sm bg-white/70"
                                    style={{ height: `${v * 100}%` }}
                                  />
                                ))}
                              </div>
                              <span className="absolute left-2 top-0.5 truncate text-[9px] font-medium text-white drop-shadow">
                                {clip.name}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {/* 轨道下方始终显示一个拖拽占位区（与设计图一致） */}
              {tracks.length > 0 && (
                <div className="flex">
                  <div className="w-52 shrink-0 border-r border-slate-200 dark:border-neutral-800" />
                  <div className="flex-1 p-2">
                    <div className="flex h-[120px] flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/40 text-slate-400 dark:border-neutral-700 dark:bg-neutral-800/30 dark:text-neutral-500">
                      <Plus size={16} className="text-slate-300 dark:text-neutral-600" />
                      <span className="text-[11px]">将音轨/音频文件直接拖拽到此处</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 底部控制条 */}
          <div className="flex items-center justify-center border-t border-slate-200 bg-slate-50 px-4 py-2 dark:border-neutral-800 dark:bg-neutral-800/50">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveBottomPanel(activeBottomPanel === 'recording' ? null : 'recording')}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-medium transition ${
                  activeBottomPanel === 'recording'
                    ? 'border-sky-500 bg-sky-500 text-white dark:border-sky-400 dark:bg-sky-400'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                <Mic size={12} />
                <span>录音设置</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveBottomPanel(activeBottomPanel === 'track' ? null : 'track')}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-medium transition ${
                  activeBottomPanel === 'track'
                    ? 'border-sky-500 bg-sky-500 text-white dark:border-sky-400 dark:bg-sky-400'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                <Sliders size={12} />
                <span>轨道效果</span>
              </button>
              <button
                type="button"
                onClick={() => selectedClipId && setActiveBottomPanel(activeBottomPanel === 'clip' ? null : 'clip')}
                disabled={!selectedClipId}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-medium transition ${
                  !selectedClipId
                    ? 'cursor-not-allowed border-neutral-600 bg-neutral-800 text-neutral-500'
                    : activeBottomPanel === 'clip'
                    ? 'border-sky-500 bg-sky-500 text-white dark:border-sky-400 dark:bg-sky-400'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                <Edit3 size={12} />
                <span>片段编辑</span>
              </button>
            </div>
            <div className="absolute right-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveBottomPanel(null)}
                className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                title="收起"
              >
                <ChevronDown size={14} />
              </button>
            </div>
          </div>

          {/* 底部滑出面板 */}
          {activeBottomPanel && (
            <div className="z-50 flex max-h-[420px] flex-col border-t border-slate-200 bg-slate-50 text-slate-700 shadow-2xl">
              {activeBottomPanel === 'recording' && (
                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {/* 音量检测 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 text-sm font-semibold text-slate-900">音量检测</div>
                      <div className="mb-3 flex items-center gap-2">
                        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-green-500 transition-all duration-75"
                            style={{ width: `${Math.min(100, micVolume * 120)}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>{displayDb.toFixed(1)} dB</span>
                        <span className="text-green-600">音量正常</span>
                      </div>
                    </div>
                    {/* 录音设备 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 text-sm font-semibold text-slate-900">录音设备</div>
                      <div className="mb-4">
                        <select className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-sky-500">
                          <option>默认：麦克风阵列 (Realtek(R) Audio)</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-600">监听</span>
                        <button
                          type="button"
                          onClick={() => setIsMicEnabled(!isMicEnabled)}
                          className={`relative h-6 w-11 rounded-full transition-colors ${
                            isMicEnabled ? 'bg-sky-500' : 'bg-slate-200'
                          }`}
                        >
                          <div
                            className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow border border-slate-300 transition-transform ${
                              isMicEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                    {/* 节拍器 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 text-sm font-semibold text-slate-900">节拍器</div>
                      <div className="mb-4 flex items-center justify-between">
                        <span className="text-xs text-slate-600">开关</span>
                        <button type="button" className="relative h-6 w-11 rounded-full bg-sky-500">
                          <div className="absolute top-1 right-1 h-4 w-4 rounded-full bg-white shadow" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-600">预拍：关闭</span>
                        <select className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-500">
                          <option>关闭</option>
                          <option>1 小节</option>
                          <option>2 小节</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeBottomPanel === 'track' && (
                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {/* 人声效果器 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-2 text-sm font-semibold text-slate-900">人声效果器</div>
                      <div className="mb-3 text-xs text-slate-500">只适用于纯人声音频轨道</div>
                      <div className="mb-5">
                        <button
                          type="button"
                          onClick={(e) => slideUpPanel === 'vocalEffect' ? setSlideUpPanel(null) : openSlideUpPanel('vocalEffect', e)}
                          className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-left text-xs text-slate-700 outline-none focus:border-sky-500"
                        >
                          <span>{selectedVocalEffect}</span>
                          <ChevronDown size={14} className="text-slate-400" />
                        </button>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <div className="relative h-20 w-20">
                          <div className="absolute inset-0 rounded-full border-2 border-slate-200" />
                          <div className="absolute inset-2 rounded-full border border-slate-300" />
                          <div className="absolute left-1/2 top-1/2 h-1 w-12 -translate-x-1/2 -translate-y-1/2 origin-left rotate-[135deg] rounded-full bg-slate-400" />
                          <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300" />
                        </div>
                        <div className="text-xs text-slate-600">强度 100%</div>
                      </div>
                    </div>
                    {/* Autotune */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-900">Autotune</span>
                        <button type="button" className="relative h-5 w-10 rounded-full bg-sky-500">
                          <div className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-white shadow" />
                        </button>
                      </div>
                      <div className="mb-4 text-xs text-slate-500">修正音高和添加自动音效果</div>
                      <div className="space-y-4">
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                            <span>大调</span>
                            <span>20ms</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => slideUpPanel === 'key' ? setSlideUpPanel(null) : openSlideUpPanel('key', e)}
                              className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 outline-none focus:border-sky-500"
                            >
                              <span>{selectedKey}</span>
                              <ChevronDown size={14} className="text-slate-400" />
                            </button>
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                            <span>响应速度</span>
                            <span>20ms</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-200">
                            <div className="h-full w-[30%] rounded-full bg-pink-500" />
                          </div>
                          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                            <span>电音</span>
                            <span>柔和</span>
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                            <span>发音自然度</span>
                            <span>0%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-200">
                            <div className="h-full w-0 rounded-full bg-pink-500" />
                          </div>
                          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                            <span>机械</span>
                            <span>自然</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* 混响 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-slate-900">混响</span>
                        <button type="button" className="relative h-5 w-10 rounded-full bg-sky-500">
                          <div className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-white shadow" />
                        </button>
                      </div>
                      <div className="mb-4 text-xs text-slate-500">调节声音的空间范围</div>
                      <div className="mb-5">
                        <button
                          type="button"
                          onClick={(e) => slideUpPanel === 'reverb' ? setSlideUpPanel(null) : openSlideUpPanel('reverb', e)}
                          className="flex w-full items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-left text-xs text-slate-700 outline-none focus:border-sky-500"
                        >
                          <span>{selectedReverb}</span>
                          <ChevronDown size={14} className="text-slate-400" />
                        </button>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <div className="relative h-20 w-20">
                          <div className="absolute inset-0 rounded-full border-2 border-slate-200" />
                          <div className="absolute inset-2 rounded-full border border-slate-300" />
                          <div className="absolute left-1/2 top-1/2 h-1 w-12 -translate-x-1/2 -translate-y-1/2 origin-left rotate-[20deg] rounded-full bg-slate-400" />
                          <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300" />
                        </div>
                        <div className="text-xs text-slate-600">强度 0%</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeBottomPanel === 'clip' && (
                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {/* 变调变速 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 text-sm font-semibold text-slate-900">变调变速</div>
                      <div className="mb-4">
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                          <span>变调</span>
                          <span>0</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-slate-700 transition hover:bg-slate-100">
                            <Minus size={14} />
                          </button>
                          <input type="range" min="-12" max="12" step="1" value="0" className="h-1.5 flex-1 cursor-pointer accent-sky-500" />
                          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-slate-700 transition hover:bg-slate-100">
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="mb-4">
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                          <span>变速</span>
                          <span>1.00</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-slate-700 transition hover:bg-slate-100">
                            <Minus size={14} />
                          </button>
                          <input type="range" min="0.5" max="2" step="0.01" value="1" className="h-1.5 flex-1 cursor-pointer accent-sky-500" />
                          <button type="button" className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-slate-700 transition hover:bg-slate-100">
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                      <button type="button" className="w-full rounded-md border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100">
                        调回原调
                      </button>
                    </div>
                    {/* 增益 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 text-sm font-semibold text-slate-900">增益</div>
                      <div className="mb-5 flex flex-col items-center gap-2">
                        <div className="relative h-28 w-8">
                          <div className="absolute inset-0 rounded-md border border-slate-300 bg-slate-50" />
                          <div className="absolute bottom-2 left-1/2 h-16 w-3 -translate-x-1/2 rounded-sm bg-gradient-to-t from-red-500 via-yellow-400 to-green-500" />
                          <div className="absolute bottom-[65%] left-1/2 h-2 w-5 -translate-x-1/2 rounded-sm bg-white shadow border border-slate-200" />
                        </div>
                        <div className="text-xs text-slate-600">+0.0 dB</div>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-600">静音</span>
                        <button type="button" className="relative h-6 w-11 rounded-full bg-slate-200">
                          <div className="absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow border border-slate-300" />
                        </button>
                      </div>
                    </div>
                    {/* 人声优化 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-2 text-sm font-semibold text-slate-900">人声优化</div>
                      <div className="mb-3 text-xs text-slate-500">只适用于纯人声音轨</div>
                      <div className="mb-5 flex items-center justify-between">
                        <span className="text-xs text-slate-600">人声降噪</span>
                        <button type="button" className="relative h-5 w-10 rounded-full bg-sky-500">
                          <div className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-white shadow" />
                        </button>
                      </div>
                      <div className="mb-5 flex items-center justify-between">
                        <span className="text-xs text-slate-600">人声美化</span>
                        <button type="button" className="relative h-5 w-10 rounded-full bg-sky-500">
                          <div className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-white shadow" />
                        </button>
                      </div>
                      <div className="text-xs text-slate-500">
                        优化您的声音动态表现，补全高频缺失问题，使人声更加清晰明亮
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* 上滑面板：人声效果器 */}
      {slideUpPanel === 'vocalEffect' && (
        <div
          className="fixed z-50 rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
          style={{
            bottom: `${window.innerHeight - slideUpPosition.top + 8}px`,
            left: `${slideUpPosition.left}px`,
            width: `${slideUpPosition.width}px`,
          }}
        >
          <div className="mb-3 text-sm font-semibold text-slate-900">人声效果器</div>
          <div className="mb-3 flex rounded-lg bg-slate-100 p-1">
            {[
              { key: 'recommend', label: '推荐' },
              { key: 'enhance', label: '人声增强' },
              { key: 'special', label: '特殊效果' },
              { key: 'style', label: '音乐风格' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setVocalEffectTab(tab.key as any)}
                className={`flex-1 rounded-md py-1 text-xs font-medium transition ${
                  vocalEffectTab === tab.key ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="grid max-h-[300px] grid-cols-2 gap-2 overflow-y-auto">
            {[
              { name: '说唱 Rap', desc: '集中呈现说唱风格的人声，增强声线颗粒度', icon: Mic },
              { name: '流行', desc: '经典流行音乐风格，使人声更加明亮突出', icon: Music },
              { name: '朋克', desc: '增强朋克音乐特有的表现效果，强化失真以突出自由、亢奋的风格特征', icon: Zap },
              { name: '复古', desc: '拥有唱片与磁带效果，可以给人声增加复古感与年代感', icon: Disc },
              { name: '一键和声', desc: '一键增加人声整体的厚度及声场宽度，使人声更加饱满', icon: Layers },
              { name: '空气人声', desc: '增加人声通透度与空气感，增强个性化表，适用于各类曲风', icon: Wind },
            ].map((effect) => (
              <button
                key={effect.name}
                type="button"
                onClick={() => {
                  setSelectedVocalEffect(effect.name);
                  setSlideUpPanel(null);
                }}
                className={`flex items-start gap-2 rounded-lg border p-2 text-left transition ${
                  selectedVocalEffect === effect.name
                    ? 'border-sky-500 bg-sky-50'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                  <effect.icon size={14} className="text-slate-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-900">{effect.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{effect.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 上滑面板：调式选择 */}
      {slideUpPanel === 'key' && (
        <div
          className="fixed z-50 rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
          style={{
            bottom: `${window.innerHeight - slideUpPosition.top + 8}px`,
            left: `${slideUpPosition.left}px`,
            width: `${slideUpPosition.width}px`,
          }}
        >
          <div className="mb-3 flex rounded-lg bg-slate-100 p-1">
            {[
              { key: 'major', label: '大调' },
              { key: 'minor', label: '小调' },
              { key: 'chromatic', label: '半音阶' },
            ].map((scale) => (
              <button
                key={scale.key}
                type="button"
                onClick={() => setSelectedScale(scale.key as any)}
                className={`flex-1 rounded-md py-1 text-xs font-medium transition ${
                  selectedScale === scale.key ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {scale.label}
              </button>
            ))}
          </div>
          <div className="mb-3 grid grid-cols-5 gap-1.5">
            {['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C#', 'D#', 'F#', 'G#', 'A#'].map((note) => (
              <button
                key={note}
                type="button"
                onClick={() => {
                  setSelectedKey(note + (selectedScale === 'major' ? '大调' : selectedScale === 'minor' ? '小调' : ''));
                  setSlideUpPanel(null);
                }}
                className={`rounded-md border py-1.5 text-xs font-medium transition ${
                  selectedKey.startsWith(note)
                    ? 'border-sky-500 bg-sky-50 text-sky-700'
                    : 'border-slate-300 text-slate-700 hover:border-slate-400'
                }`}
              >
                {note}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mb-3 w-full rounded-md bg-slate-100 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
          >
            使用工程调式
          </button>
          <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
            {selectedKey || 'D小调'}
          </div>
        </div>
      )}

      {/* 上滑面板：混响选择 */}
      {slideUpPanel === 'reverb' && (
        <div
          className="fixed z-50 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"
          style={{
            bottom: `${window.innerHeight - slideUpPosition.top + 8}px`,
            left: `${slideUpPosition.left}px`,
            width: `${slideUpPosition.width}px`,
          }}
        >
          <div className="space-y-0.5">
            {[
              { name: '大厅', desc: '模拟音乐厅或礼堂的大空间，混响绵长、开阔' },
              { name: '房间', desc: '模拟普通房间的中等空间，自然适中的混响' },
              { name: '浴室', desc: '模拟小空间、高反射的瓷砖环境，混响短而明亮' },
              { name: '近距离', desc: '极近距离的混响效果，几乎无空间感，突出干声的清晰度' },
            ].map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() => {
                  setSelectedReverb(item.name);
                  setSlideUpPanel(null);
                }}
                className={`flex w-full items-start justify-between rounded-lg p-2.5 text-left transition ${
                  selectedReverb === item.name ? 'bg-sky-50' : 'hover:bg-slate-50'
                }`}
              >
                <div>
                  <div className="text-xs font-medium text-slate-900">{item.name}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">{item.desc}</div>
                </div>
                {selectedReverb === item.name && (
                  <Check size={14} className="mt-0.5 shrink-0 text-sky-500" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 右下角浮动 AI 助手按钮 */}
      <button
        type="button"
        className="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg shadow-sky-500/30 transition hover:bg-sky-600"
        title="AI 助手"
      >
        <Bot size={20} />
      </button>
    </div>
  );
}
