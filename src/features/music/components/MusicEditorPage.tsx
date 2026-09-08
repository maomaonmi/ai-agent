'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
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
  ChevronRight,
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
  Loader2,
} from 'lucide-react';
import { type MusicTab } from './MusicSidebar';
import {
  buildEditorDocument,
  createEditorProject,
  createEditorOperation,
  createEditorAudioProcessing,
  exportEditorProject,
  getEditorAsset,
  getEditorProject,
  getEditorOperation,
  importEditorOperationResult,
  getSingerPresets,
  editorTrackHasAudio,
  selectGenerationAssetId,
  saveEditorProject,
  uploadEditorAsset,
  type EditorProject,
} from '../lib/musicEditorApi';
import { SINGER_PRESETS, type SingerPreset } from '../lib/singerPresets';
import { sendChatMessage } from '../../../lib/api';
import { buildLyricsPolishPrompt } from '../lib/musicEditorLyrics';
import { BEAT_PRESETS, type BeatPreset } from '../lib/musicEditorBeats';
import { calculatePeakDb, calculateRmsDb, meterColorFromDb, meterDisplayLevel, normalizeCountInBars, selectAudioInputDevices, visualMeterLevelFromDb, type AudioInputDeviceOption } from '../lib/musicEditorRecording';
import { buildWaveformValues, formatTransportTime, moveClipWithInsertion, resizeClip, splitClipAtPosition, timelineDurationSeconds, type ClipResizeEdge } from '../lib/musicEditorTransport';
import { buildVocalEffectParameters, clampVocalEffectIntensity, getVocalEffect, listVocalEffects, vocalEffectIntensityFromAngle, type VocalEffectCategory, type VocalEffectId } from '../lib/musicEditorVocalEffects';

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
  assetId?: string;
  sourceOffset?: number;
  sourceDuration?: number;
  muted?: boolean;
  pending?: boolean;
  pitchSemitones?: number;
  playbackRate?: number;
}

interface EditorHistorySnapshot {
  bpm: number;
  timeSignature: string;
  volume: number;
  selectedKey: string;
  tracks: Track[];
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

const VOCAL_EFFECT_ICONS: Record<string, typeof Mic> = {
  mic: Mic,
  music: Music,
  zap: Zap,
  disc: Disc,
  layers: Layers,
  wind: Wind,
  clarity: AudioLines,
  texture: Sparkles,
  minion: Bot,
  monster: Wand2,
  surround: Circle,
  radio: Music2,
  disco: Disc,
};

const VOCAL_EFFECT_TABS: Array<{ key: VocalEffectCategory; label: string }> = [
  { key: 'recommend', label: '推荐' },
  { key: 'enhance', label: '人声增强' },
  { key: 'special', label: '特殊效果' },
  { key: 'style', label: '音乐风格' },
];

function WaveformCanvas({
  values,
  fill = 'rgba(255,255,255,0.82)',
  topFill = 'rgba(255,255,255,0.64)',
}: {
  values: number[];
  fill?: string;
  topFill?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      if (!values.length) return;

      const center = height / 2;
      const amplitude = Math.max(1, height / 2 - 6);
      const step = values.length / width;
      const safeValues = values.map((value) => Math.max(0, Math.min(1, Number(value) || 0)));
      for (let x = 0; x < width; x += 1) {
        const value = safeValues[Math.min(safeValues.length - 1, Math.floor(x * step))] ?? 0;
        const sampleHeight = value * amplitude;
        context.fillStyle = topFill;
        context.fillRect(x, center - sampleHeight, 1, sampleHeight);
        context.fillStyle = fill;
        context.fillRect(x, center, 1, sampleHeight);
      }
    };

    draw();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [values, fill, topFill]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" />;
}

function getClipPlaybackWindow(clip: AudioClip, secondsPerBar: number) {
  const timelineDuration = Math.max(0, clip.duration * secondsPerBar);
  const sourceStart = Math.max(0, clip.sourceOffset ?? 0);
  const sourceLimit = clip.sourceDuration ?? sourceStart + timelineDuration;
  const sourceEnd = Math.min(Math.max(sourceStart, sourceLimit), sourceStart + timelineDuration);
  return { timelineDuration: Math.max(0, sourceEnd - sourceStart), sourceStart, sourceEnd };
}

function getVisibleWaveform(clip: AudioClip, secondsPerBar: number) {
  const waveform = clip.waveform ?? [];
  if (!waveform.length || !clip.sourceDuration || clip.sourceDuration <= 0) return waveform;
  const sourceStart = Math.max(0, clip.sourceOffset ?? 0);
  const sourceEnd = Math.min(clip.sourceDuration, sourceStart + Math.max(0, clip.duration * secondsPerBar));
  const startIndex = Math.max(0, Math.floor((sourceStart / clip.sourceDuration) * waveform.length));
  const endIndex = Math.min(waveform.length, Math.ceil((sourceEnd / clip.sourceDuration) * waveform.length));
  return waveform.slice(startIndex, Math.max(startIndex + 1, endIndex));
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
  const [singerPresets, setSingerPresets] = useState<SingerPreset[]>(SINGER_PRESETS);
  const [selectedSingerId, setSelectedSingerId] = useState<string | null>(null);
  const [selectedVocalTrackId, setSelectedVocalTrackId] = useState('');
  const [selectedAccompanimentTrackId, setSelectedAccompanimentTrackId] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [project, setProject] = useState<EditorProject | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [exportState, setExportState] = useState<'idle' | 'exporting' | 'error'>('idle');
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [isTimelineDragActive, setIsTimelineDragActive] = useState(false);
  const [generationState, setGenerationState] = useState<'idle' | 'submitting' | 'processing' | 'error'>('idle');
  const [pendingClipId, setPendingClipId] = useState<string | null>(null);
  const [clipProcessing, setClipProcessing] = useState<{ clipId: string; operationId: string; label: string } | null>(null);
  const [lyricsGenerationState, setLyricsGenerationState] = useState<'idle' | 'generating' | 'error'>('idle');
  const [beatLoadingId, setBeatLoadingId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingBeatId, setPreviewingBeatId] = useState<string | null>(null);
  const beatAssetIdsRef = useRef<Record<string, string>>({});
  const [zoom, setZoom] = useState(1);
  const [bars] = useState(16);
  // 播放头位置（0-1 比例），可拖动
  const [playhead, setPlayhead] = useState(0);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
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
  const [clipContextMenu, setClipContextMenu] = useState<{
    trackId: string;
    clipId: string;
    top: number;
    left: number;
  } | null>(null);
  const [clipSubmenu, setClipSubmenu] = useState<'pitch' | 'separation' | null>(null);
  const [clipNotice, setClipNotice] = useState<string | null>(null);
  const clipClipboardRef = useRef<{ trackId: string; clip: AudioClip } | null>(null);
  // 麦克风音量检测相关状态
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [micPeakVolume, setMicPeakVolume] = useState(0);
  const [micDb, setMicDb] = useState(-60);
  const [audioInputDevices, setAudioInputDevices] = useState<AudioInputDeviceOption[]>([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [countInBars, setCountInBars] = useState<0 | 1 | 2>(0);
  const [recordingCountdownBeat, setRecordingCountdownBeat] = useState<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const metronomeTimerRef = useRef<number | null>(null);

  // 录音时显示真实 dBFS（-60dB 到 0dB），而不是固定的模拟数值。
  const micActive = isMicEnabled || isRecording;
  const displayDb = micDb;
  // 彩色填充直接由真实 dB 推导，避免独立的显示 state 与 dB 读数不同步。
  const micVolume = visualMeterLevelFromDb(micDb);
  const micDisplayLevel = meterDisplayLevel(micVolume, micPeakVolume);
  const micMeterColor = meterColorFromDb(displayDb);
  // Autotune 调式选择弹窗
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [selectedKey, setSelectedKey] = useState('D小调');
  const [selectedScale, setSelectedScale] = useState<'major' | 'minor' | 'chromatic'>('minor');
  // 混响选项
  const [selectedReverb, setSelectedReverb] = useState('大厅');
  // 上滑面板状态：vocalEffect | key | reverb
  const [slideUpPanel, setSlideUpPanel] = useState<'vocalEffect' | 'key' | 'reverb' | null>(null);
  const [slideUpPosition, setSlideUpPosition] = useState({ top: 0, left: 0, width: 0 });
  // 人声效果器选中项与强度（ID 是唯一真相，显示名由效果目录派生）
  const [selectedVocalEffectId, setSelectedVocalEffectId] = useState<VocalEffectId>('rap');
  const [vocalEffectIntensity, setVocalEffectIntensity] = useState(100);
  const [vocalEffectTab, setVocalEffectTab] = useState<VocalEffectCategory>('recommend');
  const historyRef = useRef<{ current: string | null; past: string[]; future: string[]; applying: boolean }>({ current: null, past: [], future: [], applying: false });

  useEffect(() => {
    const savedId = window.localStorage.getItem('music-editor-project-id');
    if (!savedId) return;
    let active = true;
    getEditorProject(savedId).then(async (loaded) => {
      if (!active) return;
      setProject(loaded);
      setBpm(loaded.document.tempo.bpm);
      setTimeSignature(loaded.document.tempo.timeSignature.join('/'));
      const secondsPerBar = (60 / loaded.document.tempo.bpm) * loaded.document.tempo.timeSignature[0];
      const loadedTracks = await Promise.all(loaded.document.tracks.map(async (track) => ({
        id: track.id,
        name: track.name,
        type: track.kind,
        muted: track.isMuted,
        solo: track.isSolo,
        volume: Math.pow(10, track.gainDb / 20),
        clips: await Promise.all(track.clips.map(async (clip) => {
          let sourceDuration = Math.max(clip.sourceOutSeconds, clip.sourceInSeconds);
          try {
            // sourceOut/sourceIn describe the visible window; fetch the asset
            // metadata so a later resize can still reach the full source end.
            sourceDuration = Math.max(sourceDuration, (await getEditorAsset(clip.assetId)).duration);
          } catch {
            // A missing asset is still rendered from the saved project window.
          }
          return {
            id: clip.id,
            name: clip.name,
            start: clip.startSeconds / secondsPerBar,
            duration: (clip.sourceOutSeconds - clip.sourceInSeconds) / secondsPerBar,
            assetId: clip.assetId,
            sourceOffset: clip.sourceInSeconds,
            sourceDuration,
            muted: Boolean(clip.isMuted),
            pitchSemitones: clip.pitchSemitones,
            playbackRate: clip.playbackRate,
            waveform: buildWaveformValues(clip.id.length),
          };
        })),
      })));
      if (!active) return;
      setTracks(loadedTracks);
    }).catch(() => window.localStorage.removeItem('music-editor-project-id'));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getSingerPresets().then(({ presets }) => {
      if (active && presets.length) setSingerPresets(presets);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (selectedVocalTrackId && !tracks.some((track) => track.id === selectedVocalTrackId && track.type === 'vocal' && editorTrackHasAudio(track))) {
      setSelectedVocalTrackId('');
    }
    if (selectedAccompanimentTrackId && !tracks.some((track) => track.id === selectedAccompanimentTrackId && track.type !== 'vocal' && editorTrackHasAudio(track))) {
      setSelectedAccompanimentTrackId('');
    }
  }, [tracks, selectedVocalTrackId, selectedAccompanimentTrackId]);

  useEffect(() => {
    const snapshot: EditorHistorySnapshot = {
      bpm,
      timeSignature,
      volume,
      selectedKey,
      tracks: tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => ({ ...clip, waveform: clip.waveform ? [...clip.waveform] : undefined })) })),
    };
    const serialized = JSON.stringify(snapshot);
    const history = historyRef.current;
    if (history.current === null) {
      history.current = serialized;
      return;
    }
    if (history.applying) {
      history.current = serialized;
      history.applying = false;
      return;
    }
    if (clipMoveRef.current) {
      history.current = serialized;
      return;
    }
    if (history.current !== serialized) {
      history.past.push(history.current);
      history.current = serialized;
      history.future = [];
    }
  }, [bpm, timeSignature, volume, selectedKey, tracks]);

  const currentDocument = () => buildEditorDocument({ bpm, timeSignature, selectedKey, volume, tracks });

  const restoreHistorySnapshot = (serialized: string) => {
    const snapshot = JSON.parse(serialized) as EditorHistorySnapshot;
    historyRef.current.applying = true;
    historyRef.current.current = serialized;
    setBpm(snapshot.bpm);
    setTimeSignature(snapshot.timeSignature);
    setVolume(snapshot.volume);
    setSelectedKey(snapshot.selectedKey);
    setTracks(snapshot.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => ({ ...clip, waveform: clip.waveform ? [...clip.waveform] : undefined })) })));
  };

  const handleUndo = () => {
    const history = historyRef.current;
    if (!history.current || history.past.length === 0) return;
    const previous = history.past.pop();
    if (!previous) return;
    history.future.push(history.current);
    restoreHistorySnapshot(previous);
  };

  const handleRedo = () => {
    const history = historyRef.current;
    if (!history.current || history.future.length === 0) return;
    const next = history.future.pop();
    if (!next) return;
    history.past.push(history.current);
    restoreHistorySnapshot(next);
  };

  const persistProject = async () => {
    const saved = project
        ? await saveEditorProject(project, currentDocument())
        : await createEditorProject('新项目', currentDocument());
    setProject(saved);
    window.localStorage.setItem('music-editor-project-id', saved.id);
    return saved;
  };

  const handleSave = async () => {
    setSaveState('saving');
    try {
      await persistProject();
      setSaveState('saved');
    } catch (error) {
      console.error('保存音乐编辑工程失败', error);
      setSaveState('error');
    }
  };

  const handleExport = async () => {
    if (exportState === 'exporting') return;
    if (clipProcessing) {
      setClipNotice('请等待音频处理完成后再导出');
      return;
    }
    setExportState('exporting');
    try {
      const saved = await persistProject();
      // WAV keeps the rendered mix lossless; the server also accepts MP3 for
      // callers that need a smaller file.
      const blob = await exportEditorProject(saved.id, 'wav');
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${saved.title || 'music-editor'}.wav`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportState('idle');
      setClipNotice('音频已导出');
    } catch (error) {
      console.error('导出音乐编辑工程失败', error);
      setExportState('error');
      setClipNotice(error instanceof Error ? error.message : '导出失败');
    }
  };

  const handleGenerateLyrics = async () => {
    const seed = lyrics.trim();
    if (!seed || lyricsGenerationState === 'generating') return;
    setLyricsGenerationState('generating');
    let generated = '';
    let streamError = '';
    try {
      await sendChatMessage(buildLyricsPolishPrompt(seed), 'standard', {
        onToken: (token) => { generated += token; },
        onDone: (event) => { if (!generated) generated = event.answer; },
        onError: (event) => { streamError = event.message; },
      }, {
        maxTokensOverride: 2_048,
        runtimeSettings: {
          responseLength: 'brief',
          webSearch: 'off',
          deepThinking: 'off',
          discussionRounds: 1,
          mcpMode: 'off',
          mcpServerIds: [],
          skillMode: 'off',
          skillIds: [],
          webSearchOptions: { limit: 5, timeRange: '', location: '', scrapeTopN: 0, highlights: false },
          qwenNativeSearchOptions: { searchStrategy: 'turbo', forcedSearch: false, enableSearchExtension: false, freshness: 0, assignedSiteList: [], promptIntervene: '' },
        },
      });
      if (streamError) throw new Error(streamError);
      const clean = generated.trim().replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
      if (!clean) throw new Error('模型没有返回歌词');
      setLyrics(clean);
      setLyricsGenerationState('idle');
    } catch (error) {
      console.error('歌词生成失败', error);
      setLyricsGenerationState('error');
    }
  };

  const appendAssetToTimeline = (asset: { id: string; displayName: string; duration: number }, trackName?: string) => {
    const numerator = Number(timeSignature.split('/')[0]) || 4;
    const secondsPerBar = (60 / bpm) * numerator;
    const clip: AudioClip = {
        id: `c${Date.now()}`,
        name: trackName || asset.displayName,
        start: 0,
        duration: asset.duration / secondsPerBar,
        sourceDuration: asset.duration,
        sourceOffset: 0,
        assetId: asset.id,
        waveform: buildWaveformValues(asset.id.length),
    };
    const audioTrack = tracks.find((track) => track.type === 'instrument');
    const targetTrackId = audioTrack?.id || `t${Date.now()}`;
    setTracks((previous) => {
      const target = previous.find((track) => track.id === targetTrackId);
      if (target) return previous.map((track) => track.id === target.id ? { ...track, clips: [...track.clips, clip] } : track);
      return [...previous, {
        id: targetTrackId,
        name: '音频轨 1',
        type: 'instrument',
        muted: false,
        solo: false,
        volume: 0.7,
        clips: [clip],
      }];
    });
    setSelectedAccompanimentTrackId(targetTrackId);
  };

  const handleAssetUpload = async (file: File) => {
    setUploadState('uploading');
    try {
      const asset = await uploadEditorAsset(file);
      appendAssetToTimeline(asset);
      setUploadState('idle');
    } catch (error) {
      console.error('上传音乐编辑素材失败', error);
      setUploadState('error');
    }
  };

  const handleBeatPreview = (beat: BeatPreset) => {
    if (previewAudioRef.current && previewingBeatId === beat.id) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
      setPreviewingBeatId(null);
      return;
    }
    previewAudioRef.current?.pause();
    const audio = new Audio(beat.audioUrl);
    previewAudioRef.current = audio;
    audio.onended = () => setPreviewingBeatId(null);
    void audio.play().then(() => setPreviewingBeatId(beat.id)).catch(() => setPreviewingBeatId(null));
  };

  const handleAddBeat = async (beat: BeatPreset) => {
    if (beatLoadingId) return;
    setBeatLoadingId(beat.id);
    try {
      let assetId = beatAssetIdsRef.current[beat.id];
      let asset = assetId ? { id: assetId, displayName: beat.name, duration: beat.durationSeconds } : null;
      if (!asset) {
        const response = await fetch(beat.audioUrl);
        if (!response.ok) throw new Error('Beats 音频读取失败');
        const blob = await response.blob();
        const uploaded = await uploadEditorAsset(new File([blob], beat.fileName, { type: 'audio/mpeg' }));
        assetId = uploaded.id;
        beatAssetIdsRef.current[beat.id] = assetId;
        asset = uploaded;
      }
      appendAssetToTimeline(asset, beat.name);
    } catch (error) {
      console.error('添加 Beats 素材失败', error);
      setUploadState('error');
    } finally {
      setBeatLoadingId(null);
    }
  };

  const handleBeatDragStart = (event: React.DragEvent<HTMLElement>, beat: BeatPreset) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-music-editor-beat', beat.id);
  };

  const handleTimelineDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes('application/x-music-editor-beat')) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setIsTimelineDragActive(true);
    }
  };

  const handleTimelineDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsTimelineDragActive(false);
    const beatId = event.dataTransfer.getData('application/x-music-editor-beat');
    const beat = BEAT_PRESETS.find((item) => item.id === beatId);
    if (beat) {
      void handleAddBeat(beat);
      return;
    }
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith('audio/'));
    if (file) void handleAssetUpload(file);
  };

  const handleTimelineFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleAssetUpload(file);
    event.currentTarget.value = '';
  };

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

  // 浏览器只会在获得麦克风权限后暴露设备名称；面板打开时先枚举一次，
  // 获得权限后再刷新，这样外接耳机麦克风会真实出现在下拉框里。
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    let active = true;
    const refreshAudioInputs = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!active) return;
        const inputs = selectAudioInputDevices(devices);
        setAudioInputDevices(inputs);
        setSelectedAudioInputId((current) => current && inputs.some((device) => device.deviceId === current) ? current : '');
      } catch (error) {
        console.warn('枚举录音设备失败', error);
      }
    };
    void refreshAudioInputs();
    navigator.mediaDevices.addEventListener?.('devicechange', refreshAudioInputs);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshAudioInputs);
    };
  }, [activeBottomPanel]);

  // 使用 MediaStream + AnalyserNode 读取实时 PCM RMS 与瞬时峰值。
  // 监听打开或正在录音时才申请权限，避免页面加载就弹出系统授权。
  useEffect(() => {
    let isActive = true;
    const micActive = isMicEnabled || isRecording;

    const stopMic = () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (animationIdRef.current !== null) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
      analyserRef.current = null;
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
      setMicPeakVolume(0);
      setMicDb(-60);
    };

    const startMic = async () => {
      if (!micActive || !isActive || !navigator.mediaDevices?.getUserMedia) return;
      try {
        const audio: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        if (selectedAudioInputId) audio.deviceId = { exact: selectedAudioInputId };
        const stream = await navigator.mediaDevices.getUserMedia({ audio });
        if (!isActive) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        mediaStreamRef.current = stream;
        setMicError(null);

        // 权限通过后重新枚举，设备 label 会从“未知”变成系统真实名称。
        if (navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (isActive) setAudioInputDevices(selectAudioInputDevices(devices));
        }

        if (!audioContextRef.current) {
          const AudioContextConstructor = window.AudioContext
            || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!AudioContextConstructor) throw new Error('当前浏览器不支持音频分析');
          audioContextRef.current = new AudioContextConstructor();
        }
        const context = audioContextRef.current;
        if (context.state === 'suspended') await context.resume();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        // Keep the analyser responsive so speech/transients are visible in the meter.
        analyser.smoothingTimeConstant = 0.2;
        analyserRef.current = analyser;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const animate = () => {
          if (!isActive || !micActive) return;
          analyser.getFloatTimeDomainData(samples);
          const db = calculateRmsDb(samples);
          const peakDb = calculatePeakDb(samples);
          setMicDb(db);
          // Hold the latest real peak briefly, then decay it so movement remains readable.
          setMicPeakVolume((currentPeak) => Math.max(visualMeterLevelFromDb(peakDb), currentPeak - 0.025));
          animationIdRef.current = requestAnimationFrame(animate);
        };
        animate();
      } catch (error) {
        console.error('麦克风权限申请失败', error);
        if (!isActive) return;
        const name = error instanceof DOMException ? error.name : '';
        setMicError(name === 'NotAllowedError' ? '请允许浏览器访问麦克风' : '无法访问所选录音设备');
        setIsMicEnabled(false);
        setIsRecording(false);
      }
    };

    if (micActive) void startMic();
    else stopMic();
    return () => {
      isActive = false;
      stopMic();
    };
  }, [isMicEnabled, isRecording, selectedAudioInputId]);

  // 时间轴右侧区域引用（不含左侧固定面板，用于计算播放头比例与点击定位）
  const timelineAreaRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  // 播放头竖线 DOM 引用 - 拖动期间绕过 React 直接更新 style.left，避免每次 mousemove 触发整树重渲染造成的卡顿
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const isDraggingPlayheadRef = useRef(false);
  // 拖动过程中累积的最终比例，仅在 mouseup 提交到 state
  const pendingPlayheadRef = useRef<number | null>(null);
  // RAF 句柄 - 拖动期间 mousemove 用 requestAnimationFrame 节流到 60fps
  const playheadRafRef = useRef<number | null>(null);
  const clipResizeRef = useRef<{
    trackId: string;
    clipId: string;
    edge: ClipResizeEdge;
    startClientX: number;
    initialStartBars: number;
    initialDurationBars: number;
    sourceOffset?: number;
    sourceDuration?: number;
  } | null>(null);
  const clipMoveRef = useRef<{
    sourceTrackId: string;
    clipId: string;
    startClientX: number;
    initialStartBars: number;
    baseTracks: Track[];
    moved: boolean;
    historyStart: string | null;
  } | null>(null);
  const audioPlayersRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const currentTimeSecondsRef = useRef(0);
  const playbackRafRef = useRef<number | null>(null);
  const playbackStartedAtRef = useRef(0);
  const playbackStartOffsetRef = useRef(0);
  const timelineClips = tracks.flatMap((track) => track.clips);
  const timelineLengthSeconds = timelineDurationSeconds(timelineClips, bpm, timeSignature, bars);
  const timelineLengthRef = useRef(timelineLengthSeconds);
  const timeSignatureNumerator = Number(timeSignature.split('/')[0]) || 4;
  const secondsPerBar = (60 / Math.max(1, bpm || 120)) * timeSignatureNumerator;

  const getOrCreateAudioPlayer = (clip: AudioClip) => {
    if (!clip.assetId) return null;
    const existing = audioPlayersRef.current.get(clip.id);
    if (existing) return existing;
    const player = new Audio(`/api/music/editor/assets/${encodeURIComponent(clip.assetId)}/stream`);
    player.preload = 'auto';
    player.playbackRate = Math.max(0.25, Math.min(4, clip.playbackRate ?? 1));
    audioPlayersRef.current.set(clip.id, player);
    return player;
  };

  const getTimelineMetrics = () => {
    const scroll = timelineScrollRef.current;
    const area = timelineAreaRef.current;
    if (!scroll || !area) return null;
    const scrollRect = scroll.getBoundingClientRect();
    const trackWidth = Math.max(area.clientWidth, scroll.scrollWidth - 208);
    return { scroll, trackWidth, origin: scrollRect.left + 208 };
  };

  const getPlayheadRatioFromClientX = (clientX: number) => {
    const metrics = getTimelineMetrics();
    if (!metrics || metrics.trackWidth <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - metrics.origin + metrics.scroll.scrollLeft) / metrics.trackWidth));
  };

  const ensurePlayheadVisible = (ratio: number) => {
    const metrics = getTimelineMetrics();
    if (!metrics) return;
    const absoluteLeft = 208 + Math.max(0, Math.min(1, ratio)) * metrics.trackWidth;
    const leftEdge = metrics.scroll.scrollLeft + 208;
    const rightEdge = metrics.scroll.scrollLeft + metrics.scroll.clientWidth - 24;
    const margin = 48;
    if (absoluteLeft > rightEdge - margin) {
      const targetScrollLeft = Math.min(metrics.scroll.scrollWidth - metrics.scroll.clientWidth, absoluteLeft - (metrics.scroll.clientWidth - 208) * 0.65);
      const delta = targetScrollLeft - metrics.scroll.scrollLeft;
      // 每次只前进一小段，避免到边缘时出现“整页翻动”的跳变。
      metrics.scroll.scrollLeft += Math.sign(delta) * Math.min(Math.abs(delta), Math.max(3, Math.abs(delta) * 0.18));
    } else if (absoluteLeft < leftEdge + margin) {
      const targetScrollLeft = Math.max(0, absoluteLeft - 208 - margin);
      const delta = targetScrollLeft - metrics.scroll.scrollLeft;
      metrics.scroll.scrollLeft += Math.sign(delta) * Math.min(Math.abs(delta), Math.max(3, Math.abs(delta) * 0.18));
    }
  };

  const positionPlayheadLine = (ratio: number) => {
    const metrics = getTimelineMetrics();
    if (metrics && playheadLineRef.current) {
      playheadLineRef.current.style.left = `${208 + Math.max(0, Math.min(1, ratio)) * metrics.trackWidth}px`;
    }
    ensurePlayheadVisible(ratio);
  };

  useEffect(() => {
    timelineLengthRef.current = timelineLengthSeconds;
  }, [timelineLengthSeconds]);

  useEffect(() => {
    positionPlayheadLine(playhead);
  }, [playhead, timelineLengthSeconds, tracks.length]);

  useEffect(() => {
    const handleResizeMove = (event: MouseEvent) => {
      const active = clipResizeRef.current;
      if (!active) return;
      const metrics = getTimelineMetrics();
      if (!metrics || metrics.trackWidth <= 0) return;
      const deltaBars = ((event.clientX - active.startClientX) / metrics.trackWidth) * bars;
      const result = resizeClip({
        edge: active.edge,
        startBars: active.initialStartBars,
        durationBars: active.initialDurationBars,
        deltaBars,
        maxDurationBars: active.sourceDuration !== undefined ? active.sourceDuration / secondsPerBar : undefined,
        sourceOffsetSeconds: active.sourceOffset,
        sourceDurationSeconds: active.sourceDuration,
        secondsPerBar,
      });
      setTracks((previous) => previous.map((track) => {
        if (track.id !== active.trackId) return track;
        return {
          ...track,
          clips: track.clips.map((clip) => clip.id === active.clipId
            ? {
                ...clip,
                start: result.startBars,
                duration: result.durationBars,
                sourceOffset: result.sourceOffsetSeconds ?? clip.sourceOffset,
              }
            : clip),
        };
      }));
    };

    const handleResizeEnd = () => {
      if (!clipResizeRef.current) return;
      clipResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [bars, secondsPerBar]);

  useEffect(() => {
    const handleClipMove = (event: MouseEvent) => {
      const active = clipMoveRef.current;
      if (!active) return;
      const metrics = getTimelineMetrics();
      if (!metrics || metrics.trackWidth <= 0) return;
      const deltaBars = ((event.clientX - active.startClientX) / metrics.trackWidth) * bars;
      const targetElement = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const targetTrackId = targetElement?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId || active.sourceTrackId;
      const nextStartBars = Math.max(0, active.initialStartBars + deltaBars);
      if (Math.abs(deltaBars) < 0.01 && targetTrackId === active.sourceTrackId) return;
      const movedTracks = moveClipWithInsertion(
        active.baseTracks,
        active.sourceTrackId,
        active.clipId,
        targetTrackId,
        nextStartBars,
        secondsPerBar,
      );
      if (!movedTracks) return;
      active.moved = true;
      setTracks(movedTracks);
    };

    const handleClipMoveEnd = () => {
      const active = clipMoveRef.current;
      if (!active) return;
      const history = historyRef.current;
      // 一次整段拖动只生成一个撤销点；拖动过程中的每帧状态更新不应污染撤销栈。
      if (active.moved && active.historyStart && history.current !== active.historyStart) {
        history.past.push(active.historyStart);
        history.future = [];
      }
      clipMoveRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleClipMove);
    window.addEventListener('mouseup', handleClipMoveEnd);
    return () => {
      window.removeEventListener('mousemove', handleClipMove);
      window.removeEventListener('mouseup', handleClipMoveEnd);
    };
  }, [bars, secondsPerBar]);

  const updatePlayerVolumes = useCallback(() => {
    const hasSolo = tracks.some((track) => track.solo);
    tracks.forEach((track) => {
      const enabled = !track.muted && (!hasSolo || track.solo);
      track.clips.forEach((clip) => {
        const player = audioPlayersRef.current.get(clip.id);
        if (player) {
          player.volume = enabled && !clip.muted ? Math.max(0, Math.min(1, track.volume * volume)) : 0;
          player.playbackRate = Math.max(0.25, Math.min(4, clip.playbackRate ?? 1));
        }
      });
    });
  }, [tracks, volume]);

  const stopPlayback = useCallback((reset = false) => {
    if (playbackRafRef.current !== null) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = null;
    }
    audioPlayersRef.current.forEach((player) => player.pause());
    setIsPlaying(false);
    if (reset) {
      setPlayhead(0);
      setCurrentTimeSeconds(0);
      currentTimeSecondsRef.current = 0;
    }
  }, []);

  const seekPlaybackToRatio = useCallback((ratio: number) => {
    const targetSeconds = Math.max(0, Math.min(1, ratio)) * timelineLengthSeconds;
    playbackStartOffsetRef.current = targetSeconds;
    playbackStartedAtRef.current = performance.now();
    currentTimeSecondsRef.current = targetSeconds;
    setCurrentTimeSeconds(targetSeconds);
    tracks.forEach((track) => track.clips.forEach((clip) => {
      const player = getOrCreateAudioPlayer(clip);
      if (!player) return;
      const clipStart = clip.start * secondsPerBar;
      const { timelineDuration: clipDuration, sourceStart, sourceEnd } = getClipPlaybackWindow(clip, secondsPerBar);
      const offset = targetSeconds - clipStart;
      try {
        player.currentTime = Math.max(sourceStart, Math.min(sourceEnd, sourceStart + offset));
      } catch {
        // 浏览器在音频元数据尚未加载时可能暂时拒绝设置 currentTime。
      }
      if (offset < 0 || offset >= clipDuration) player.pause();
      else if (isPlaying) void player.play().catch(() => undefined);
    }));
  }, [isPlaying, secondsPerBar, timelineLengthSeconds, tracks]);

  const togglePlay = useCallback(async () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    const playableClips = tracks.flatMap((track) => track.clips.filter((clip) => clip.assetId).map((clip) => ({ track, clip })));
    if (!playableClips.length) return;
    const targetSeconds = playhead * timelineLengthSeconds;
    const hasSolo = tracks.some((track) => track.solo);
    const playersToStart: HTMLAudioElement[] = [];
    playableClips.forEach(({ track, clip }) => {
      const player = getOrCreateAudioPlayer(clip);
      if (!player) return;
      player.volume = (!track.muted && !clip.muted && (!hasSolo || track.solo)) ? Math.max(0, Math.min(1, track.volume * volume)) : 0;
      const clipStart = clip.start * secondsPerBar;
      const { timelineDuration: clipDuration, sourceStart, sourceEnd } = getClipPlaybackWindow(clip, secondsPerBar);
      const offset = targetSeconds - clipStart;
      try {
        player.currentTime = Math.max(sourceStart, Math.min(sourceEnd, sourceStart + offset));
      } catch {
        // 浏览器在音频元数据尚未加载时可能暂时拒绝设置 currentTime。
      }
      if (offset >= 0 && offset < clipDuration) playersToStart.push(player);
      else player.pause();
    });
    playbackStartOffsetRef.current = targetSeconds;
    playbackStartedAtRef.current = performance.now();
    currentTimeSecondsRef.current = targetSeconds;
    setCurrentTimeSeconds(targetSeconds);
    setIsPlaying(true);
    await Promise.allSettled(playersToStart.map((player) => player.play()));
    const tick = () => {
      const elapsed = (performance.now() - playbackStartedAtRef.current) / 1000;
      const current = playbackStartOffsetRef.current + elapsed;
      const currentTimelineLength = Math.max(1, timelineLengthRef.current);
      if (current >= currentTimelineLength) {
        stopPlayback(true);
        return;
      }
      currentTimeSecondsRef.current = current;
      setCurrentTimeSeconds(current);
      setPlayhead(current / currentTimelineLength);
      positionPlayheadLine(current / currentTimelineLength);
      playbackRafRef.current = requestAnimationFrame(tick);
    };
    playbackRafRef.current = requestAnimationFrame(tick);
  }, [isPlaying, playhead, secondsPerBar, stopPlayback, timelineLengthSeconds, tracks, volume]);

  useEffect(() => {
    updatePlayerVolumes();
  }, [updatePlayerVolumes]);

  useEffect(() => {
    currentTimeSecondsRef.current = currentTimeSeconds;
  }, [currentTimeSeconds]);

  // 拖动片段时，正在播放的播放器要立即按照新的时间线位置重新对齐。
  useEffect(() => {
    if (!isPlaying) return;
    const current = currentTimeSecondsRef.current;
    const activeClipIds = new Set(
      tracks.flatMap((track) => track.clips).filter((clip) => clip.assetId).map((clip) => clip.id),
    );
    audioPlayersRef.current.forEach((player, clipId) => {
      if (activeClipIds.has(clipId)) return;
      player.pause();
      player.src = '';
      audioPlayersRef.current.delete(clipId);
    });
    const hasSolo = tracks.some((track) => track.solo);
    tracks.forEach((track) => track.clips.forEach((clip) => {
      const player = getOrCreateAudioPlayer(clip);
      if (!player) return;
      const enabled = !track.muted && !clip.muted && (!hasSolo || track.solo);
      player.volume = enabled ? Math.max(0, Math.min(1, track.volume * volume)) : 0;
      const clipStart = clip.start * secondsPerBar;
      const { timelineDuration: clipDuration, sourceStart, sourceEnd } = getClipPlaybackWindow(clip, secondsPerBar);
      const offset = current - clipStart;
      if (offset < 0 || offset >= clipDuration) {
        player.pause();
        return;
      }
      try {
        player.currentTime = Math.max(sourceStart, Math.min(sourceEnd, sourceStart + offset));
      } catch {
        // 浏览器在音频元数据尚未加载时可能拒绝设置 currentTime，下一帧会重试。
      }
      if (player.paused) void player.play().catch(() => undefined);
    }));
  }, [isPlaying, secondsPerBar, tracks, volume]);

  useEffect(() => () => {
    stopPlayback();
    audioPlayersRef.current.forEach((player) => player.src = '');
    audioPlayersRef.current.clear();
  }, [stopPlayback]);
  const clearRecordingCountdown = () => {
    if (metronomeTimerRef.current !== null) {
      window.clearInterval(metronomeTimerRef.current);
      metronomeTimerRef.current = null;
    }
    setRecordingCountdownBeat(null);
  };

  const playMetronomeClick = (isAccent: boolean) => {
    try {
      if (!audioContextRef.current) {
        const AudioContextConstructor = window.AudioContext
          || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextConstructor) return;
        audioContextRef.current = new AudioContextConstructor();
      }
      const context = audioContextRef.current;
      if (context.state === 'suspended') void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = isAccent ? 1_100 : 760;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.08);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.09);
    } catch {
      // A browser may block Web Audio until a user gesture; recording still works.
    }
  };

  const toggleRecord = () => {
    if (isRecording || recordingCountdownBeat !== null) {
      clearRecordingCountdown();
      setIsRecording(false);
      return;
    }
    const totalCountInBeats = countInBars * timeSignatureNumerator;
    if (totalCountInBeats <= 0) {
      setIsRecording(true);
      return;
    }
    let beat = 0;
    setRecordingCountdownBeat(1);
    if (metronomeEnabled) playMetronomeClick(true);
    metronomeTimerRef.current = window.setInterval(() => {
      beat += 1;
      if (beat >= totalCountInBeats) {
        clearRecordingCountdown();
        setIsRecording(true);
        return;
      }
      setRecordingCountdownBeat(beat + 1);
      if (metronomeEnabled) playMetronomeClick((beat + 1) % timeSignatureNumerator === 1);
    }, 60_000 / Math.max(20, bpm));
  };

  useEffect(() => () => {
    if (metronomeTimerRef.current !== null) window.clearInterval(metronomeTimerRef.current);
  }, []);

  // 点击时间轴空白处定位播放头 - 立即提交到 state
  const setPlayheadFromEvent = useCallback((clientX: number) => {
    const el = timelineAreaRef.current;
    if (!el) return;
    const ratio = getPlayheadRatioFromClientX(clientX);
    setPlayhead(ratio);
    seekPlaybackToRatio(ratio);
    positionPlayheadLine(ratio);
  }, [seekPlaybackToRatio]);

  // 播放头拖动逻辑 - 关键：mousemove 期间只操作 ref.current.style.left，不触发任何 setState
  useEffect(() => {
    const flushPlayhead = (clientX: number) => {
      const el = timelineAreaRef.current;
      if (!el) return;
      const ratio = getPlayheadRatioFromClientX(clientX);
      pendingPlayheadRef.current = ratio;
      // 直接写入 DOM 样式，跳过 React reconciler
      positionPlayheadLine(ratio);
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
        const finalRatio = pendingPlayheadRef.current;
        setPlayhead(finalRatio);
        seekPlaybackToRatio(finalRatio);
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
  }, [seekPlaybackToRatio]);

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isDraggingPlayheadRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    // 起拖时立即定位一次（写入 ref+state），避免拖动起点错位
    setPlayheadFromEvent(e.clientX);
    if (timelineAreaRef.current) {
      const ratio = getPlayheadRatioFromClientX(e.clientX);
      pendingPlayheadRef.current = ratio;
      positionPlayheadLine(ratio);
    }
  };

  const handleClipResizeMouseDown = (e: React.MouseEvent, trackId: string, clip: AudioClip, edge: ClipResizeEdge) => {
    e.stopPropagation();
    e.preventDefault();
    clipMoveRef.current = null;
    clipResizeRef.current = {
      trackId,
      clipId: clip.id,
      edge,
      startClientX: e.clientX,
      initialStartBars: clip.start,
      initialDurationBars: clip.duration,
      sourceOffset: clip.sourceOffset,
      sourceDuration: clip.sourceDuration,
    };
    setSelectedClipId(clip.id);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  const handleClipMoveMouseDown = (e: React.MouseEvent, trackId: string, clip: AudioClip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    clipResizeRef.current = null;
    clipMoveRef.current = {
      sourceTrackId: trackId,
      clipId: clip.id,
      startClientX: e.clientX,
      initialStartBars: clip.start,
      baseTracks: tracks.map((track) => ({
        ...track,
        clips: track.clips.map((item) => ({ ...item, waveform: item.waveform ? [...item.waveform] : undefined })),
      })),
      moved: false,
      historyStart: historyRef.current.current,
    };
    setSelectedClipId(clip.id);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  };

  const createClipId = (base: string) => {
    const entropy = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    return `${base}-copy-${entropy}`;
  };

  const findClipLocation = (clipId: string | null = selectedClipId) => {
    if (!clipId) return null;
    for (const track of tracks) {
      const clip = track.clips.find((item) => item.id === clipId);
      if (clip) return { track, clip };
    }
    return null;
  };

  const closeClipContextMenu = () => {
    setClipContextMenu(null);
    setClipSubmenu(null);
  };

  const handleClipContextMenu = (event: React.MouseEvent, trackId: string, clip: AudioClip) => {
    event.preventDefault();
    event.stopPropagation();
    setOpenMenuTrackId(null);
    setMenuPos(null);
    setClipSubmenu(null);
    const menuWidth = 240;
    const menuHeight = 460;
    const submenuWidth = 336;
    const hasRightRoom = event.clientX + menuWidth + submenuWidth + 16 <= window.innerWidth;
    setClipContextMenu({
      trackId,
      clipId: clip.id,
      left: hasRightRoom
        ? Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - submenuWidth - 16))
        : Math.max(8, Math.min(event.clientX - menuWidth - 8, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8)),
    });
    setSelectedClipId(clip.id);
  };

  const handleClipCopy = (trackId: string, clip: AudioClip) => {
    clipClipboardRef.current = {
      trackId,
      clip: { ...clip, waveform: clip.waveform ? [...clip.waveform] : undefined },
    };
    setSelectedClipId(clip.id);
    closeClipContextMenu();
    setClipNotice('片段已复制，可使用 Ctrl/Cmd + V 粘贴');
  };

  const handleClipPaste = (targetTrackId?: string) => {
    const clipboard = clipClipboardRef.current;
    if (!clipboard) {
      setClipNotice('剪贴板中没有音频片段');
      return;
    }
    const targetTrack = (targetTrackId && tracks.find((track) => track.id === targetTrackId))
      || tracks.find((track) => track.id === clipboard.trackId)
      || tracks[0];
    if (!targetTrack) {
      setClipNotice('请先添加一条音轨');
      return;
    }
    const startBars = Math.max(0, (playhead * timelineLengthSeconds) / secondsPerBar);
    const pastedClip: AudioClip = {
      ...clipboard.clip,
      id: createClipId(clipboard.clip.id),
      start: startBars,
      waveform: clipboard.clip.waveform ? [...clipboard.clip.waveform] : undefined,
    };
    setTracks((previous) => previous.map((track) => (
      track.id === targetTrack.id ? { ...track, clips: [...track.clips, pastedClip] } : track
    )));
    setSelectedClipId(pastedClip.id);
    closeClipContextMenu();
    setClipNotice(`已粘贴到「${targetTrack.name}」`);
  };

  const handleClipDelete = (trackId: string, clipId: string) => {
    const player = audioPlayersRef.current.get(clipId);
    if (player) {
      player.pause();
      player.src = '';
      audioPlayersRef.current.delete(clipId);
    }
    setTracks((previous) => previous.map((track) => (
      track.id === trackId ? { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) } : track
    )));
    if (selectedClipId === clipId) {
      setSelectedClipId(null);
      setActiveBottomPanel(null);
    }
    closeClipContextMenu();
    setClipNotice('片段已删除');
  };

  const handleClipSplit = (trackId: string, clip: AudioClip) => {
    const splitBars = (playhead * timelineLengthSeconds) / secondsPerBar;
    const pieces = splitClipAtPosition(clip, splitBars, secondsPerBar, `${clip.id}:left`, `${clip.id}:right`);
    if (pieces.length < 2) {
      setClipNotice('请把播放头放在片段中间再裁剪');
      return;
    }
    setTracks((previous) => previous.map((track) => (
      track.id === trackId
        ? { ...track, clips: track.clips.flatMap((item) => item.id === clip.id ? pieces : [item]) }
        : track
    )));
    setSelectedClipId(pieces[0].id);
    closeClipContextMenu();
    setClipNotice('片段已在播放头处分割');
  };

  const handleClipMute = (trackId: string, clipId: string) => {
    const current = tracks.find((track) => track.id === trackId)?.clips.find((clip) => clip.id === clipId);
    if (!current) return;
    const muted = !current.muted;
    setTracks((previous) => previous.map((track) => track.id === trackId
      ? {
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            return { ...clip, muted };
          }),
        }
      : track));
    closeClipContextMenu();
    setClipNotice(muted ? '片段已静音' : '片段已取消静音');
  };

  const startClipProcessing = async (
    trackId: string,
    clipId: string,
    operationType: 'denoise' | 'beautify' | 'pitch_shift' | 'stem_separation' | 'vocal_effect',
    label: string,
    options: { pitchSemitones?: number; stemCount?: 2 | 3 | 4; effectId?: VocalEffectId; intensity?: number } = {},
  ) => {
    if (clipProcessing || generationState === 'submitting' || generationState === 'processing') return;
    const current = tracks.find((track) => track.id === trackId)?.clips.find((clip) => clip.id === clipId);
    if (!current?.assetId || current.pending) {
      setClipNotice('当前片段没有可处理的音频');
      return;
    }
    closeClipContextMenu();
    setClipProcessing({ clipId, operationId: '', label });
    setClipNotice(`${label}处理中…`);
    try {
      const saved = await persistProject();
      const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
      let operation = await createEditorAudioProcessing(saved.id, {
        type: operationType,
        inputAssetId: current.assetId,
        clientRequestId: requestId,
        pitchSemitones: options.pitchSemitones,
        stemCount: options.stemCount,
        effectId: options.effectId,
        intensity: options.intensity,
      });
      setClipProcessing({ clipId, operationId: operation.id, label });
      for (let attempt = 0; attempt < 300 && !['SUCCESS', 'FAILED', 'TIMED_OUT'].includes(operation.status); attempt += 1) {
        if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 1000));
        operation = await getEditorOperation(operation.id);
      }
      if (operation.status !== 'SUCCESS' || !operation.results.length) {
        throw new Error(operation.error?.message || `${label}失败`);
      }

      const imported = [] as Awaited<ReturnType<typeof importEditorOperationResult>>[];
      for (const result of operation.results) {
        let asset: Awaited<ReturnType<typeof importEditorOperationResult>> | null = null;
        for (let attempt = 0; attempt < 10 && !asset; attempt += 1) {
          try {
            asset = await importEditorOperationResult(operation.id, result.id);
          } catch {
            if (attempt < 9) await new Promise((resolve) => window.setTimeout(resolve, 500));
          }
        }
        if (!asset) throw new Error('处理结果导入失败');
        imported.push(asset);
      }

      if (operationType === 'stem_separation') {
        const stemKinds: Array<{ match: string; type: Track['type']; name: string }> = [
          { match: '人声', type: 'vocal', name: '人声（分离）' },
          { match: '中声', type: 'vocal', name: '中声（分离）' },
          { match: '贝斯', type: 'bass', name: '贝斯（分离）' },
          { match: '鼓组', type: 'drum', name: '鼓组（分离）' },
          { match: '伴奏', type: 'instrument', name: '伴奏（分离）' },
        ];
        const createdAt = Date.now();
        setTracks((previous) => {
          const next = [...previous];
          imported.forEach((asset, index) => {
            const title = operation.results[index]?.title || asset.displayName;
            const stem = stemKinds.find((item) => title.includes(item.match)) || stemKinds[index] || stemKinds[0];
            const trackId = `stem-${createdAt}-${index}`;
            next.push({
              id: trackId,
              name: stem.name,
              type: stem.type,
              muted: false,
              solo: false,
              volume: 0.7,
              clips: [{
                id: `clip-${createdAt}-${index}`,
                name: asset.displayName,
                start: current.start,
                duration: asset.duration / secondsPerBar,
                sourceDuration: asset.duration,
                sourceOffset: 0,
                assetId: asset.id,
                waveform: buildWaveformValues(asset.id.length + index),
              }],
            });
          });
          return next;
        });
      } else {
        const asset = imported[0];
        audioPlayersRef.current.get(clipId)?.pause();
        const player = audioPlayersRef.current.get(clipId);
        if (player) {
          player.src = '';
          audioPlayersRef.current.delete(clipId);
        }
        setTracks((previous) => previous.map((track) => track.id === trackId
          ? {
              ...track,
              clips: track.clips.map((clip) => clip.id === clipId
                ? {
                    ...clip,
                    name: asset.displayName,
                    assetId: asset.id,
                    sourceDuration: asset.duration,
                    // Processing renders a new source file; keep the user's
                    // selected source window instead of resetting its offset.
                    sourceOffset: Math.min(clip.sourceOffset ?? 0, Math.max(0, asset.duration - 0.001)),
                    duration: Math.min(
                      clip.duration,
                      Math.max(0.05, (asset.duration - Math.min(clip.sourceOffset ?? 0, Math.max(0, asset.duration - 0.001))) / secondsPerBar),
                    ),
                    pitchSemitones: 0,
                    waveform: buildWaveformValues(asset.id.length + Math.round(asset.duration)),
                  }
                : clip),
            }
          : track));
      }
      setClipProcessing(null);
      setClipNotice(`${label}完成`);
    } catch (error) {
      console.error(`${label}失败`, error);
      setClipProcessing(null);
      setClipNotice(error instanceof Error ? error.message : `${label}失败`);
    }
  };

  const adjustVocalEffectIntensity = (delta: number) => {
    setVocalEffectIntensity((current) => clampVocalEffectIntensity(current + delta));
  };

  const updateVocalEffectIntensityFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const angle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * (180 / Math.PI);
    setVocalEffectIntensity(vocalEffectIntensityFromAngle(angle));
  };

  const handleVocalEffectDialKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      adjustVocalEffectIntensity(-1);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      adjustVocalEffectIntensity(1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setVocalEffectIntensity(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setVocalEffectIntensity(100);
    }
  };

  const handleApplyVocalEffect = () => {
    const location = findClipLocation();
    if (!location || location.track.type !== 'vocal') {
      setClipNotice('请选择人声音轨中的片段后再应用效果');
      return;
    }
    const effect = getVocalEffect(selectedVocalEffectId);
    const parameters = buildVocalEffectParameters(effect.id, vocalEffectIntensity);
    void startClipProcessing(
      location.track.id,
      location.clip.id,
      'vocal_effect',
      `${effect.name} ${parameters.intensity}%`,
      parameters,
    );
  };

  const handleClipPitch = (trackId: string, clipId: string, delta: number) => {
    const current = tracks.find((track) => track.id === trackId)?.clips.find((clip) => clip.id === clipId);
    if (!current || current.pending) return;
    const nextPitch = Math.max(-24, Math.min(24, (current.pitchSemitones ?? 0) + delta));
    void startClipProcessing(trackId, clipId, 'pitch_shift', `变调 ${nextPitch > 0 ? '+' : ''}${nextPitch} key`, { pitchSemitones: nextPitch });
  };

  const handleClipSpeed = (trackId: string, clipId: string, delta: number) => {
    const current = tracks.find((track) => track.id === trackId)?.clips.find((clip) => clip.id === clipId);
    if (!current || current.pending) return;
    const nextSpeed = Math.max(0.25, Math.min(4, (current.playbackRate ?? 1) + delta));
    setTracks((previous) => previous.map((track) => track.id === trackId
      ? { ...track, clips: track.clips.map((clip) => clip.id === clipId ? { ...clip, playbackRate: nextSpeed } : clip) }
      : track));
    closeClipContextMenu();
    setClipNotice(`速度 ${nextSpeed.toFixed(2)}x`);
  };

  useEffect(() => {
    if (!clipContextMenu) return;
    const onDocDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-clip-menu]')) return;
      closeClipContextMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeClipContextMenu();
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [clipContextMenu]);

  useEffect(() => {
    if (!clipNotice) return;
    const timer = window.setTimeout(() => setClipNotice(null), 1800);
    return () => window.clearTimeout(timer);
  }, [clipNotice]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return element?.tagName === 'INPUT'
        || element?.tagName === 'TEXTAREA'
        || element?.tagName === 'SELECT'
        || Boolean(element?.isContentEditable);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const commandKey = event.metaKey || event.ctrlKey;
      const location = findClipLocation();
      if (commandKey && event.key.toLowerCase() === 'c' && location) {
        event.preventDefault();
        handleClipCopy(location.track.id, location.clip);
      } else if (commandKey && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        handleClipPaste();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && location) {
        event.preventDefault();
        handleClipDelete(location.track.id, location.clip.id);
      } else if (!commandKey && event.key.toLowerCase() === 's' && location) {
        event.preventDefault();
        handleClipSplit(location.track.id, location.clip);
      } else if (commandKey && event.key.toLowerCase() === 'm' && location) {
        event.preventDefault();
        handleClipMute(location.track.id, location.clip.id);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedClipId, tracks, playhead, timelineLengthSeconds, secondsPerBar]);

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

  const handleGenerate = async () => {
    if (!creationPrompt.trim() && !lyrics.trim()) return;
    const sourceAssetId = selectGenerationAssetId(
      tracks,
      melodyMode === 'vocal' ? 'vocal' : 'instrumental',
      selectedVocalTrackId,
      selectedAccompanimentTrackId,
    );
    if (!sourceAssetId) {
      setGenerationState('error');
      return;
    }
    const sourceClip = tracks.flatMap((track) => track.clips).find((clip) => clip.assetId === sourceAssetId);
    const targetType: Track['type'] = melodyMode === 'vocal' ? 'vocal' : 'instrument';
    const targetTrack = tracks.find((track) => track.type === targetType);
    const targetTrackId = targetTrack?.id || `t${Date.now()}`;
    const placeholderId = `pending-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const placeholder: AudioClip = {
      id: placeholderId,
      name: melodyMode === 'vocal' ? 'AI 人声版本（生成中）' : 'AI 伴奏版本（生成中）',
      start: sourceClip?.start ?? 0,
      duration: Math.max(0.5, sourceClip?.duration ?? 4),
      pending: true,
      waveform: buildWaveformValues(placeholderId.length),
    };
    setTracks((previous) => {
      const hasTarget = previous.some((track) => track.id === targetTrackId);
      if (hasTarget) return previous.map((track) => track.id === targetTrackId ? { ...track, clips: [...track.clips, placeholder] } : track);
      return [...previous, {
        id: targetTrackId,
        name: melodyMode === 'vocal' ? 'AI 人声轨' : 'AI 伴奏轨',
        type: targetType,
        muted: false,
        solo: false,
        volume: 0.7,
        clips: [placeholder],
      }];
    });
    setPendingClipId(placeholderId);
    setSelectedClipId(placeholderId);
    setGenerationState('submitting');
    try {
      const saved = await persistProject();
      const common = {
        inputAssetId: sourceAssetId,
        clientRequestId: crypto.randomUUID(),
        model: 'V5',
      };
      const body = melodyMode === 'vocal'
        ? {
            ...common,
            type: 'add_vocals',
            prompt: lyrics.trim() || creationPrompt.trim(),
            title: 'AI 人声版本',
            style: selectedStyle,
            negativeTags: 'metal, noise',
            vocalGender: voiceGender === 'female' ? 'f' : 'm',
          }
        : {
            ...common,
            type: 'add_instrumental',
            title: 'AI 伴奏版本',
            tags: `${selectedStyle}, ${creationPrompt.trim()}`,
            negativeTags: 'spoken word, noise',
          };
      let operation = await createEditorOperation(saved.id, body);
      setGenerationState('processing');
      for (let attempt = 0; attempt < 200 && !['SUCCESS', 'FAILED', 'TIMED_OUT'].includes(operation.status); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
        operation = await getEditorOperation(operation.id);
      }
      if (operation.status !== 'SUCCESS' || !operation.results[0]) throw new Error(operation.error?.message || '生成失败');
      let imported: Awaited<ReturnType<typeof importEditorOperationResult>> | null = null;
      for (let attempt = 0; attempt < 10 && !imported; attempt += 1) {
        try {
          imported = await importEditorOperationResult(operation.id, operation.results[0].id);
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
      }
      if (!imported) throw new Error('生成结果本地化超时');
      const numerator = Number(timeSignature.split('/')[0]) || 4;
      const secondsPerBar = (60 / bpm) * numerator;
      const clip: AudioClip = {
        id: `c${Date.now()}`,
        name: imported.displayName,
        start: placeholder.start,
        duration: imported.duration / secondsPerBar,
        sourceDuration: imported.duration,
        sourceOffset: 0,
        assetId: imported.id,
        waveform: buildWaveformValues(imported.id.length),
      };
      setTracks((previous) => {
        let replaced = false;
        const next = previous.map((track) => {
          if (track.id !== targetTrackId) return track;
          const clips = track.clips.flatMap((item) => {
            if (item.id !== placeholderId) return [item];
            replaced = true;
            return [{ ...clip, start: item.start }];
          });
          return { ...track, clips };
        });
        if (replaced) return next;
        const target = next.find((track) => track.id === targetTrackId || track.type === targetType);
        if (target) return next.map((track) => track.id === target.id ? { ...track, clips: [...track.clips, clip] } : track);
        return [...next, { id: targetTrackId, name: melodyMode === 'vocal' ? 'AI 人声轨' : 'AI 伴奏轨', type: targetType, muted: false, solo: false, volume: 0.7, clips: [clip] }];
      });
      setGenerationState('idle');
      setPendingClipId(null);
      setSelectedClipId((current) => current === placeholderId ? clip.id : current);
    } catch (error) {
      console.error('音乐编辑生成失败', error);
      setGenerationState('error');
      setTracks((previous) => previous.map((track) => ({
        ...track,
        clips: track.clips.filter((item) => item.id !== placeholderId),
      })));
      setPendingClipId(null);
      setSelectedClipId((current) => current === placeholderId ? null : current);
    }
  };

  const contextMenuClip = clipContextMenu
    ? tracks.find((track) => track.id === clipContextMenu.trackId)?.clips.find((clip) => clip.id === clipContextMenu.clipId)
    : undefined;
  const contextMenuPlayheadBars = timelineLengthSeconds > 0
    ? (playhead * timelineLengthSeconds) / secondsPerBar
    : 0;
  const canSplitContextClip = Boolean(
    contextMenuClip
      && contextMenuPlayheadBars > contextMenuClip.start
      && contextMenuPlayheadBars < contextMenuClip.start + contextMenuClip.duration,
  );
  const selectedVocalEffect = getVocalEffect(selectedVocalEffectId);
  const selectedVocalClip = findClipLocation();
  const canApplyVocalEffect = Boolean(selectedVocalClip?.track.type === 'vocal' && selectedVocalClip.clip.assetId && !selectedVocalClip.clip.pending);
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const vocalEffectPanelWidth = Math.min(760, Math.max(280, viewportWidth - 24));
  const vocalEffectPanelLeft = Math.max(12, Math.min(slideUpPosition.left, viewportWidth - vocalEffectPanelWidth - 12));

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {/* 顶部工具栏 - 与全局一致的浅色主题 */}
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        {/* 左侧播放控制 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => stopPlayback(true)}
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
            title={recordingCountdownBeat !== null ? '取消预备拍' : isRecording ? '停止录制' : '录制'}
          >
            <Circle size={10} fill="currentColor" />
          </button>
          <div className="ml-2 flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-xs text-slate-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
            <Timer size={12} className="text-slate-400" />
            <span>{formatTransportTime(currentTimeSeconds)}</span>
          </div>
          {recordingCountdownBeat !== null && (
            <span className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-700" role="status">
              预备拍 {recordingCountdownBeat}
            </span>
          )}
        </div>

        {/* 中间节拍器 / 拍号 / 音量 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 dark:border-neutral-700 dark:bg-neutral-800">
            <Timer size={13} className="text-slate-400" />
            <span className="text-[11px] text-slate-500 dark:text-neutral-400">BPM</span>
            <input
              type="number"
              value={bpm}
              onChange={(e) => setBpm(Math.max(40, Math.min(240, Number(e.target.value) || 60)))}
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
            <button type="button" onClick={handleUndo} disabled={historyRef.current.past.length === 0} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" title="撤销">
              <Undo2 size={14} />
            </button>
            <button type="button" onClick={handleRedo} disabled={historyRef.current.future.length === 0} className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" title="重做">
              <Redo2 size={14} />
            </button>
          </div>
        </div>

        {/* 右侧保存导出 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            <Save size={13} />
            <span>{saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '已保存' : saveState === 'error' ? '重试保存' : '保存'}</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportState === 'exporting' || Boolean(clipProcessing)}
            className="flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exportState === 'exporting' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            <span>{exportState === 'exporting' ? '导出中…' : exportState === 'error' ? '重试导出' : '导出'}</span>
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
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-neutral-200">主伴奏音轨（可选）</label>
                  <p className="mb-2 text-[10px] text-slate-400 dark:text-neutral-500">先选择要配人声的伴奏；没有伴奏时保持空着</p>
                  <select
                    value={selectedAccompanimentTrackId}
                    onChange={(event) => setSelectedAccompanimentTrackId(event.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                  >
                    <option value="">无伴奏音轨</option>
                    {tracks.filter((track) => track.type !== 'vocal' && editorTrackHasAudio(track)).map((track) => (
                      <option key={track.id} value={track.id}>{track.name}</option>
                    ))}
                  </select>
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
                      onClick={() => void handleGenerateLyrics()}
                      disabled={!lyrics.trim() || lyricsGenerationState === 'generating'}
                      className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-slate-200 px-2 py-1 text-[10px] text-slate-600 transition hover:bg-slate-300 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-600"
                    >
                      <Sparkles size={10} />
                      {lyricsGenerationState === 'generating' ? '润色中…' : lyricsGenerationState === 'error' ? '重试生成' : '生成歌词'}
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
                  <select
                    value={selectedVocalTrackId}
                    onChange={(event) => setSelectedVocalTrackId(event.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                  >
                    <option value="">无人声音轨</option>
                    {tracks.filter((track) => track.type === 'vocal' && editorTrackHasAudio(track)).map((track) => (
                      <option key={track.id} value={track.id}>{track.name}</option>
                    ))}
                  </select>
                </div>

                <div className="mb-4">
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-neutral-200">添加的伴奏音轨（可选）</label>
                  <p className="mb-2 text-[10px] text-slate-400 dark:text-neutral-500">没有伴奏时保持“无伴奏音轨”即可</p>
                  <select
                    value={selectedAccompanimentTrackId}
                    onChange={(event) => setSelectedAccompanimentTrackId(event.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-sky-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                  >
                    <option value="">无伴奏音轨</option>
                    {tracks.filter((track) => track.type !== 'vocal' && editorTrackHasAudio(track)).map((track) => (
                      <option key={track.id} value={track.id}>{track.name}</option>
                    ))}
                  </select>
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
                    {singerPresets
                      .filter((s) => singerFilter === 'all' || s.gender === singerFilter)
                      .map((singer) => (
                        <button
                          key={singer.id}
                          type="button"
                          onClick={() => {
                            setSelectedSingerId(singer.id);
                            setSelectedStyle(`${singer.voiceType}, ${singer.tags}`);
                            void new Audio(singer.referenceAudioUrl).play();
                          }}
                          title={`${singer.name}（风格预设，点击试听）`}
                          className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 transition ${selectedSingerId === singer.id ? 'border-sky-500 bg-sky-50 dark:border-sky-400 dark:bg-sky-500/10' : 'border-transparent hover:bg-slate-50 dark:hover:bg-neutral-800'}`}
                        >
                          <div className="relative h-14 w-14 overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-700">
                            <Image src={singer.avatarUrl} alt="" fill sizes="56px" className="object-cover" />
                            <div className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow dark:bg-neutral-800">
                              <Play size={8} className="ml-0.5 text-slate-600 dark:text-neutral-300" />
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="text-xs font-medium text-slate-800 dark:text-neutral-200">{singer.name}</div>
                            <div className="text-[10px] text-slate-500 dark:text-neutral-400">{singer.voiceType}</div>
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

                {materialSource === 'local' && (
                  <label className="block cursor-pointer rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-6 text-center transition hover:border-sky-300 dark:border-neutral-700 dark:bg-neutral-800/50 dark:hover:border-sky-700">
                    <input
                      type="file"
                      accept="audio/mpeg,audio/wav,audio/mp4,audio/flac,audio/ogg"
                      className="sr-only"
                      disabled={uploadState === 'uploading'}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void handleAssetUpload(file);
                        event.currentTarget.value = '';
                      }}
                    />
                    <Plus size={24} className="mx-auto mb-2 text-slate-400" />
                    <div className="text-xs font-medium text-slate-700 dark:text-neutral-200">
                      {uploadState === 'uploading' ? '上传并分析中…' : uploadState === 'error' ? '上传失败，点击重试' : '上传音频文件'}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-400 dark:text-neutral-500">支持wav/mp3，不超过100MB，不超过10分钟</div>
                  </label>
                )}

                {materialSource === 'beats' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-neutral-500">
                      <span>20 首纯伴奏素材</span>
                      <span>点击试听 · 拖入时间线</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {BEAT_PRESETS.map((beat) => (
                        <div
                          key={beat.id}
                          draggable
                          onDragStart={(event) => handleBeatDragStart(event, beat)}
                          className="group overflow-hidden rounded-lg border border-slate-200 bg-white transition hover:border-sky-300 hover:shadow-sm dark:border-neutral-700 dark:bg-neutral-800/70 dark:hover:border-sky-700"
                        >
                          <div className="relative aspect-[2.8/1] overflow-hidden bg-slate-100 dark:bg-neutral-700">
                            <Image src={beat.coverUrl} alt="" fill sizes="160px" className="object-cover transition group-hover:scale-105" />
                            <button
                              type="button"
                              onClick={() => handleBeatPreview(beat)}
                              className="absolute inset-0 flex items-center justify-center bg-black/0 text-white transition group-hover:bg-black/20"
                              aria-label={`${previewingBeatId === beat.id ? '停止试听' : '试听'} ${beat.name}`}
                            >
                              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/55 shadow">
                                {previewingBeatId === beat.id ? <Square size={11} fill="currentColor" /> : <Play size={11} fill="currentColor" />}
                              </span>
                            </button>
                          </div>
                          <div className="p-2">
                            <div className="truncate text-[11px] font-medium text-slate-800 dark:text-neutral-100" title={beat.name}>{beat.name}</div>
                            <div className="mt-1 flex items-center gap-1 text-[9px] text-slate-400 dark:text-neutral-500">
                              <span className="truncate">{beat.style}</span><span>·</span><span>{beat.bpm}</span><span>·</span><span>{beat.key}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleAddBeat(beat)}
                              disabled={beatLoadingId !== null}
                              className="mt-2 flex w-full items-center justify-center gap-1 rounded-md bg-slate-100 py-1 text-[10px] text-slate-600 transition hover:bg-sky-100 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-neutral-700 dark:text-neutral-300 dark:hover:bg-sky-500/15 dark:hover:text-sky-300"
                            >
                              <Plus size={10} />
                              {beatLoadingId === beat.id ? '添加中…' : '添加到时间线'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {materialSource === 'sample' && (
                  <div className="flex min-h-[280px] flex-col items-center justify-center text-center text-slate-400 dark:text-neutral-500">
                    <Music2 size={30} className="mb-3 opacity-60" />
                    <p className="text-xs">Sample 素材即将开放</p>
                    <p className="mt-1 text-[10px]">当前版本先支持本地音频和 Beats 纯伴奏</p>
                  </div>
                )}
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
              onClick={() => void handleGenerate()}
              disabled={generationState === 'submitting' || generationState === 'processing'}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-sky-600"
            >
              <Sparkles size={14} />
              <span>{generationState === 'submitting' ? '正在提交…' : generationState === 'processing' ? '生成处理中…' : generationState === 'error' ? '生成失败，检查素材后重试' : '生成详情'}</span>
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
            ref={timelineScrollRef}
            className="relative flex-1 overflow-auto bg-slate-50 scrollbar-thin dark:bg-neutral-950"
            onClick={handleTimelineClick}
            onDragOver={handleTimelineDragOver}
            onDragLeave={() => setIsTimelineDragActive(false)}
            onDrop={handleTimelineDrop}
          >
            {/* 全高播放头竖线 - 跨越时间刻度、轨道列表、占位区
                关键设计：整条不可见的 16px 命中区 = 拖动手柄（覆盖整条高度，任意位置可抓）
                视觉细线 + 顶部圆手柄用 -translate-x-1/2 / -left-2 严格居中于同一位置点，避免错位
                left 通过 ref 在拖动期间直接写 DOM 避开 React 重渲染；React state 仅控制初始/最终位置 */}
            <div
              ref={playheadLineRef}
              className="pointer-events-none absolute top-0 z-30 h-full"
              style={{ left: `calc(13rem + ${playhead} * (100% - 13rem))` }}
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
            <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              {/* 左侧固定面板：添加音轨按钮 + 选择类型弹窗 */}
              <div className="relative flex w-52 shrink-0 items-center justify-start border-r border-slate-200 px-3 py-2 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTrackTypeModal((v) => !v);
                  }}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
                  title="添加音轨"
                >
                  <Plus size={14} />
                  <span>添加音轨</span>
                </button>

                {/* 弹窗 - 锚定在「添加音轨」按钮正下方，覆盖到时间刻度区域，宽度 w-80 */}
                {showTrackTypeModal && (
                  <div
                    className="absolute top-full left-0 z-50 mt-1 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
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
                            className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-neutral-800"
                          >
                            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${opt.iconBg}`}>
                              <Icon size={18} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-slate-800 dark:text-white">{opt.label}</p>
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
              <div ref={timelineAreaRef} className="relative flex flex-1 bg-white dark:bg-neutral-900">
                {Array.from({ length: bars }).map((_, i) => (
                  <div
                    key={i}
                    className="relative flex-1 border-r border-slate-200 py-1.5 text-center last:border-r-0 dark:border-neutral-800"
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
                  <div className="w-52 shrink-0 border-r border-slate-200 bg-slate-50 dark:border-neutral-800 dark:bg-neutral-900" />
                  {/* 右侧时间轴区域显示虚线占位框 */}
                  <div className="flex-1 p-2">
                    <label
                      onClick={(event) => event.stopPropagation()}
                      className={`flex h-[200px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition-colors ${isTimelineDragActive ? 'border-sky-500 bg-sky-500/10 text-sky-600' : 'border-slate-300 bg-white text-slate-500 hover:border-sky-400 hover:bg-sky-50 dark:border-neutral-700 dark:bg-neutral-900/40 dark:text-neutral-500 dark:hover:border-sky-700 dark:hover:bg-sky-500/5'}`}
                    >
                      <input
                        type="file"
                        accept="audio/mpeg,audio/wav,audio/mp4,audio/flac,audio/ogg"
                        className="sr-only"
                        disabled={uploadState === 'uploading'}
                        onChange={handleTimelineFileChange}
                      />
                      <Plus size={20} className="text-slate-400 dark:text-neutral-600" />
                      <span className="text-xs">{isTimelineDragActive ? '松开以上传音频并添加音轨' : '将音轨/音频文件直接拖拽到此处'}</span>
                      <span className="text-[10px] text-slate-400 dark:text-neutral-500">或点击选择音频文件</span>
                    </label>
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
                    <div key={track.id} data-track-id={track.id} className={`relative flex min-h-[136px] border-b border-slate-200 bg-slate-50 transition-[filter,opacity] last:border-b-0 dark:border-neutral-800 dark:bg-neutral-900 ${track.muted ? 'grayscale opacity-60' : ''}`}>
                      {/* 轨道控制面板（左侧固定列，宽 208px） */}
                      <div className="relative flex w-52 shrink-0 flex-col justify-center gap-2 border-r border-slate-200 bg-white px-2.5 py-2 dark:border-neutral-800 dark:bg-neutral-900/80">
                        {/* 第一行：类型图标 + 名称 + 静音/监听/更多/效果 */}
                        <div className="flex items-center gap-1">
                          <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${accent.bar}`} title={track.type === 'vocal' ? '人声' : '音频'}>
                            {track.type === 'vocal' ? <Mic size={11} /> : <AudioLines size={11} />}
                          </div>
                          <span className="flex-1 truncate text-[11px] font-medium text-slate-800 dark:text-neutral-100" title={displayName}>{displayName}</span>
                          <button
                            type="button"
                            onClick={() => toggleMute(track.id)}
                            className={`flex h-5 w-5 items-center justify-center rounded transition ${
                              track.muted
                                ? 'bg-rose-500 text-white'
                                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-white'
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
                                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-white'
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
                                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-white'
                            }`}
                            title="更多"
                            aria-expanded={isMenuOpen}
                          >
                            <MoreHorizontal size={11} />
                          </button>
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-white"
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
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 transition hover:bg-rose-500/15 hover:text-rose-500 dark:text-neutral-500 dark:hover:text-rose-400"
                            title="删除"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>

                        {/* 「...」菜单 - fixed 定位，不受任何父容器 overflow 裁切 */}
                        {isMenuOpen && menuPos && (
                          <div
                            data-track-menu
                            className="fixed z-[9999] w-56 overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-700 shadow-xl dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                            style={{ top: menuPos.top, left: menuPos.left }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* 重命名 */}
                            <button
                              type="button"
                              onClick={() => handleRenameTrack(track.id)}
                              className="flex w-full items-center px-3 py-2 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-neutral-700/70"
                            >
                              <span>重命名</span>
                            </button>
                            <div className="mx-3 h-px bg-slate-200 dark:bg-neutral-700" />
                            {/* 更改轨道类型 */}
                            <div className="px-3 py-2.5">
                              <p className="mb-1.5 text-xs text-slate-500 dark:text-neutral-400">更改轨道类型</p>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleChangeTrackType(track.id, 'vocal')}
                                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition ${
                                    track.type === 'vocal'
                                      ? 'border border-sky-500/60 bg-sky-500/10 text-sky-200'
                                      : 'border border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-700/60 dark:text-neutral-300 dark:hover:bg-neutral-700'
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
                                      : 'border border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-neutral-700/60 dark:text-neutral-300 dark:hover:bg-neutral-700'
                                  }`}
                                >
                                  <AudioLines size={12} /> 音频
                                </button>
                              </div>
                            </div>
                            <div className="mx-3 h-px bg-slate-200 dark:bg-neutral-700" />
                            {/* 克隆 */}
                            <button
                              type="button"
                              onClick={() => handleCloneTrack(track.id)}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-neutral-700/70"
                            >
                              <span>克隆</span>
                              <kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">Shift + D</kbd>
                            </button>
                            {/* 删除 */}
                            <button
                              type="button"
                              onClick={() => removeTrack(track.id)}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-rose-500 transition hover:bg-rose-500/10 dark:text-rose-300"
                            >
                              <span>删除</span>
                              <kbd className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">Shift + ⌫</kbd>
                            </button>
                          </div>
                        )}
                      </div>
                      {/* 轨道内容（与时间刻度对齐） */}
                      <div
                        className="relative flex-1 bg-white"
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(90deg, rgba(148,163,184,0.18) 0px, rgba(148,163,184,0.18) 1px, transparent 1px, transparent ' +
                            `${(100 / bars) * zoom}%`,
                          backgroundSize: `${(100 / bars) * zoom}% 100%`,
                        }}
                      >
                        {track.clips.length === 0 ? (
                          <div className="flex h-full min-h-[80px] items-center px-3 text-[10px] text-slate-300 dark:text-neutral-600">空轨道</div>
                        ) : (
                          track.clips.map((clip) => {
                            const isClipProcessing = (pendingClipId === clip.id
                              && (generationState === 'submitting' || generationState === 'processing'))
                              || clipProcessing?.clipId === clip.id;
                            return (
                              <div
                                key={clip.id}
                                onMouseDown={(event) => {
                                  if (!isClipProcessing) handleClipMoveMouseDown(event, track.id, clip);
                                }}
                                onContextMenu={(event) => {
                                  if (isClipProcessing) {
                                    event.preventDefault();
                                    return;
                                  }
                                  handleClipContextMenu(event, track.id, clip);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedClipId(selectedClipId === clip.id ? null : clip.id);
                                }}
                                className={`group absolute top-2 bottom-2 flex cursor-grab items-center overflow-hidden rounded-lg border border-white/70 bg-gradient-to-br ${accent.chip} shadow-sm transition-[box-shadow,transform,filter,opacity] duration-150 hover:shadow-md active:cursor-grabbing ${clip.muted ? 'grayscale opacity-60' : ''} ${selectedClipId === clip.id ? 'z-10 ring-2 ring-sky-400 ring-offset-1' : ''}`}
                                style={{
                                  left: `${(clip.start / bars) * 100}%`,
                                  width: `${(clip.duration / bars) * 100}%`,
                                }}
                              >
                              <div className="absolute inset-x-0 bottom-1 top-6 flex items-center overflow-hidden" aria-hidden="true">
                                <svg className="h-full w-2.5 shrink-0" viewBox="0 0 10 10" preserveAspectRatio="none">
                                  <path d="M 10 0 L 0 10 L 10 10 Z" fill="rgba(255,255,255,0.18)" />
                                </svg>
                                <div className="h-full min-w-0 flex-1">
                                  <WaveformCanvas values={getVisibleWaveform(clip, secondsPerBar)} />
                                </div>
                                <svg className="h-full w-2.5 shrink-0" viewBox="0 0 10 10" preserveAspectRatio="none">
                                  <path d="M 0 0 L 10 10 L 0 10 Z" fill="rgba(255,255,255,0.18)" />
                                </svg>
                              </div>
                              <div className="absolute inset-x-0 top-0 flex h-5 items-center bg-black/10 px-2">
                                <span className="truncate text-[9px] font-semibold text-white drop-shadow">
                                  {clip.name}
                                </span>
                              </div>
                              {!isClipProcessing && <span
                                role="slider"
                                aria-label={`调整 ${clip.name} 起点`}
                                aria-valuemin={0}
                                aria-valuemax={Math.max(0, clip.start + clip.duration)}
                                aria-valuenow={clip.start}
                                onMouseDown={(event) => handleClipResizeMouseDown(event, track.id, clip, 'start')}
                                onClick={(event) => event.stopPropagation()}
                                className={`pointer-events-auto absolute left-0 top-1/2 z-20 h-12 w-4 -translate-y-1/2 cursor-ew-resize rounded-r bg-transparent transition-opacity ${selectedClipId === clip.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                              >
                                <span className="absolute inset-y-1 left-0 w-1 rounded-r bg-white/95 shadow-sm" />
                              </span>}
                              {!isClipProcessing && <span
                                role="slider"
                                aria-label={`调整 ${clip.name} 终点`}
                                aria-valuemin={clip.start + 0.05}
                                aria-valuemax={clip.start + (clip.sourceDuration !== undefined
                                  ? Math.max(0.05, (clip.sourceDuration - (clip.sourceOffset ?? 0)) / secondsPerBar)
                                  : clip.duration)}
                                aria-valuenow={clip.start + clip.duration}
                                onMouseDown={(event) => handleClipResizeMouseDown(event, track.id, clip, 'end')}
                                onClick={(event) => event.stopPropagation()}
                                className={`pointer-events-auto absolute right-0 top-1/2 z-20 h-12 w-4 -translate-y-1/2 cursor-ew-resize rounded-l bg-transparent transition-opacity ${selectedClipId === clip.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                              >
                                <span className="absolute inset-y-1 right-0 w-1 rounded-l bg-white/95 shadow-sm" />
                              </span>}
                              {isClipProcessing && (
                                <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-700/90 text-white" role="status" aria-label="后端处理中">
                                  <span className="flex items-center gap-2 text-xs font-medium"><Loader2 size={18} className="animate-spin text-white/90" />{clipProcessing?.clipId === clip.id ? clipProcessing.label : '生成中…'}</span>
                                </div>
                              )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {/* 轨道下方始终显示一个拖拽占位区（与设计图一致） */}
              {tracks.length > 0 && (
                <div className="flex">
                  <div className="w-52 shrink-0 border-r border-slate-200 bg-slate-50 dark:border-neutral-800 dark:bg-neutral-900" />
                  <div className="flex-1 p-2">
                    <label
                      onClick={(event) => event.stopPropagation()}
                      className={`flex h-[120px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed transition-colors ${isTimelineDragActive ? 'border-sky-500 bg-sky-500/10 text-sky-600' : 'border-slate-300 bg-white text-slate-500 hover:border-sky-400 hover:bg-sky-50 dark:border-neutral-700 dark:bg-neutral-900/40 dark:text-neutral-500 dark:hover:border-sky-700 dark:hover:bg-sky-500/5'}`}
                    >
                      <input
                        type="file"
                        accept="audio/mpeg,audio/wav,audio/mp4,audio/flac,audio/ogg"
                        className="sr-only"
                        disabled={uploadState === 'uploading'}
                        onChange={handleTimelineFileChange}
                      />
                      <Plus size={16} className="text-slate-400 dark:text-neutral-600" />
                      <span className="text-[11px]">{isTimelineDragActive ? '松开以上传音频并添加音轨' : '将音轨/音频文件直接拖拽到此处'}</span>
                      <span className="text-[10px] text-slate-400 dark:text-neutral-500">或点击选择音频文件</span>
                    </label>
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
                        <div
                          className="relative h-3 flex-1 rounded-full bg-slate-200"
                          role="meter"
                          aria-label="麦克风输入电平"
                          aria-valuemin={-60}
                          aria-valuemax={0}
                          aria-valuenow={Number(displayDb.toFixed(1))}
                          style={{
                            backgroundImage: 'repeating-linear-gradient(90deg, transparent 0, transparent calc(10% - 1px), rgba(100, 116, 139, 0.2) calc(10% - 1px), rgba(100, 116, 139, 0.2) 10%)',
                          }}
                        >
                          <div className="absolute inset-0 overflow-hidden rounded-full">
                            <div
                              className="absolute inset-y-0 left-0 z-10 rounded-full transition-[width] duration-75"
                              style={{
                                width: `${micDisplayLevel * 100}%`,
                                backgroundColor: micMeterColor,
                                boxShadow: `0 0 10px ${micMeterColor}66`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-600">
                        <span>{displayDb.toFixed(1)} dB</span>
                        <span className={micError ? 'text-rose-500' : micActive ? 'text-emerald-600' : 'text-slate-400'}>
                          {micError || (micActive ? (micDb > -6 ? '音量偏高' : micDb > -48 ? '音量正常' : '等待输入') : '未检测')}
                        </span>
                      </div>
                    </div>
                    {/* 录音设备 */}
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 text-sm font-semibold text-slate-900">录音设备</div>
                      <div className="mb-4">
                        <select
                          aria-label="选择录音设备"
                          value={selectedAudioInputId}
                          onChange={(event) => setSelectedAudioInputId(event.target.value)}
                          className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-sky-500"
                        >
                          <option value="">默认录音设备</option>
                          {audioInputDevices.filter((device) => device.deviceId !== 'default').map((device) => (
                            <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-600">监听</span>
                        <button
                          type="button"
                          onClick={() => setIsMicEnabled(!isMicEnabled)}
                          aria-pressed={isMicEnabled}
                          aria-label={isMicEnabled ? '关闭麦克风监听' : '开启麦克风监听'}
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
                        <button
                          type="button"
                          onClick={() => setMetronomeEnabled((enabled) => !enabled)}
                          aria-pressed={metronomeEnabled}
                          aria-label={metronomeEnabled ? '关闭节拍器' : '开启节拍器'}
                          className={`relative h-6 w-11 rounded-full transition-colors ${metronomeEnabled ? 'bg-sky-500' : 'bg-slate-200'}`}
                        >
                          <div className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${metronomeEnabled ? 'right-1' : 'left-1'}`} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-600">预拍：{countInBars === 0 ? '关闭' : `${countInBars} 小节`}</span>
                        <select
                          aria-label="选择节拍器预备拍"
                          value={countInBars}
                          onChange={(event) => setCountInBars(normalizeCountInBars(Number(event.target.value)))}
                          className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-sky-500"
                        >
                          <option value={0}>关闭</option>
                          <option value={1}>1 小节</option>
                          <option value={2}>2 小节</option>
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
                          <span>{selectedVocalEffect.name}</span>
                          <ChevronDown size={14} className="text-slate-400" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => adjustVocalEffectIntensity(-1)}
                          disabled={vocalEffectIntensity <= 0}
                          aria-label="降低人声效果强度"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Minus size={14} />
                        </button>
                        <div className="flex flex-col items-center gap-1">
                          <div
                            className="relative h-20 w-20 cursor-pointer touch-none"
                            aria-label="人声效果强度"
                            role="slider"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={vocalEffectIntensity}
                            aria-valuetext={`${vocalEffectIntensity}%`}
                            tabIndex={0}
                            onKeyDown={handleVocalEffectDialKeyDown}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              event.currentTarget.setPointerCapture(event.pointerId);
                              updateVocalEffectIntensityFromPointer(event);
                            }}
                            onPointerMove={(event) => {
                              if (event.buttons === 1) updateVocalEffectIntensityFromPointer(event);
                            }}
                          >
                            <div className="absolute inset-0 rounded-full border-2 border-slate-200" />
                            <div className="absolute inset-2 rounded-full border border-slate-300" />
                            <div
                              className="absolute left-1/2 top-1/2 h-1 w-12 origin-left rounded-full bg-sky-500 transition-transform"
                              style={{ transform: `translate(-1px, -50%) rotate(${135 + (vocalEffectIntensity / 100) * 270}deg)` }}
                            />
                            <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300" />
                          </div>
                          <div className="text-xs font-medium text-slate-700">强度 {vocalEffectIntensity}%</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => adjustVocalEffectIntensity(1)}
                          disabled={vocalEffectIntensity >= 100}
                          aria-label="提高人声效果强度"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={handleApplyVocalEffect}
                        disabled={!canApplyVocalEffect || Boolean(clipProcessing)}
                        className="mt-4 w-full rounded-md bg-sky-500 px-3 py-2 text-xs font-medium text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                      >
                        {clipProcessing?.label.startsWith(selectedVocalEffect.name) ? '处理中…' : '应用到当前片段'}
                      </button>
                      {!canApplyVocalEffect && <div className="mt-2 text-center text-[10px] text-slate-400">先选择人声音轨片段</div>}
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

      {clipContextMenu && contextMenuClip && (
        <div
          data-clip-menu
          className="fixed z-[10000] w-[240px] overflow-visible text-slate-700"
          style={{ top: clipContextMenu.top, left: clipContextMenu.left }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="w-[240px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl shadow-slate-300/60">
            <button
              type="button"
              onMouseEnter={() => setClipSubmenu(null)}
              onClick={() => handleClipCopy(clipContextMenu.trackId, contextMenuClip)}
              className="flex h-12 w-full items-center justify-between whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
            >
              <span>复制</span>
              <kbd className="text-[12px] text-slate-400">⌘ + C</kbd>
            </button>
            <button
              type="button"
              onMouseEnter={() => setClipSubmenu(null)}
              onClick={() => handleClipDelete(clipContextMenu.trackId, clipContextMenu.clipId)}
              className="flex h-12 w-full items-center justify-between whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
            >
              <span>删除</span>
              <kbd className="text-[12px] text-slate-400">⌫</kbd>
            </button>
            <button
              type="button"
              disabled={!canSplitContextClip}
              onMouseEnter={() => setClipSubmenu(null)}
              onClick={() => handleClipSplit(clipContextMenu.trackId, contextMenuClip)}
              className={`flex h-12 w-full items-center justify-between whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition ${
                canSplitContextClip
                  ? 'hover:bg-slate-100'
                  : 'cursor-not-allowed text-slate-300'
              }`}
            >
              <span>裁剪</span>
              <kbd className={`text-[12px] ${canSplitContextClip ? 'text-slate-400' : 'text-slate-300'}`}>S</kbd>
            </button>
            <button
              type="button"
              onMouseEnter={() => setClipSubmenu(null)}
              onClick={() => handleClipMute(clipContextMenu.trackId, clipContextMenu.clipId)}
              className="flex h-12 w-full items-center justify-between whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
            >
              <span>{contextMenuClip.muted ? '取消静音' : '静音'}</span>
              <kbd className="text-[12px] text-slate-400">Ctrl + M</kbd>
            </button>

            <div className="mx-2 my-1.5 h-px bg-slate-200" />

            <button
              type="button"
              onMouseEnter={() => setClipSubmenu('pitch')}
              className="flex h-12 w-full items-center justify-between whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
            >
              <span>变调变速</span>
              <ChevronRight size={17} className="text-slate-400" />
            </button>
            <button
              type="button"
              onMouseEnter={() => setClipSubmenu(null)}
              onClick={() => void startClipProcessing(clipContextMenu.trackId, clipContextMenu.clipId, 'denoise', '人声降噪')}
              className="flex h-12 w-full items-center rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
            >
              <span>人声降噪</span>
            </button>
            <button
              type="button"
              onMouseEnter={() => setClipSubmenu(null)}
              onClick={() => void startClipProcessing(clipContextMenu.trackId, clipContextMenu.clipId, 'beautify', '人声美化')}
              className="flex h-12 w-full items-center rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
            >
              <span>人声美化</span>
            </button>

            <div className="mx-2 my-1.5 h-px bg-slate-200" />

            <button
              type="button"
              onMouseEnter={() => setClipSubmenu('separation')}
              className="flex h-12 w-full items-center justify-between whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
            >
              <span className="flex items-center gap-2">
                <span>音轨分离</span>
                <span className="rounded bg-[#39f5aa] px-1.5 py-0.5 text-[11px] font-bold text-[#07150f]">✦ AI</span>
              </span>
              <ChevronRight size={17} className="text-slate-400" />
            </button>
          </div>

          {clipSubmenu === 'pitch' && (
            <div className="absolute left-[calc(100%+8px)] top-[212px] w-[336px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-slate-700 shadow-2xl shadow-slate-300/60">
              <div className="px-3 pb-1.5 pt-2 text-[13px] text-slate-400">变调</div>
              <button
                type="button"
                onClick={() => handleClipPitch(clipContextMenu.trackId, clipContextMenu.clipId, 1)}
                className="flex h-12 w-full items-center whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
              >
                升半音（+1 key）
              </button>
              <button
                type="button"
                onClick={() => handleClipPitch(clipContextMenu.trackId, clipContextMenu.clipId, -1)}
                className="flex h-12 w-full items-center whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
              >
                降半音（-1 key）
              </button>
              <div className="mx-2 my-1.5 h-px bg-slate-200" />
              <div className="px-3 pb-1.5 pt-1 text-[13px] text-slate-400">变速</div>
              <button
                type="button"
                onClick={() => handleClipSpeed(clipContextMenu.trackId, clipContextMenu.clipId, 0.1)}
                className="flex h-12 w-full items-center whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
              >
                速度 +10%
              </button>
              <button
                type="button"
                onClick={() => handleClipSpeed(clipContextMenu.trackId, clipContextMenu.clipId, -0.1)}
                className="flex h-12 w-full items-center whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
              >
                速度 -10%
              </button>
            </div>
          )}

          {clipSubmenu === 'separation' && (
            <div className="absolute left-[calc(100%+8px)] top-[368px] w-[336px] overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 text-slate-700 shadow-2xl shadow-slate-300/60">
              <button
                type="button"
                onClick={() => void startClipProcessing(clipContextMenu.trackId, clipContextMenu.clipId, 'stem_separation', '2轨音轨分离', { stemCount: 2 })}
                className="flex min-h-12 w-full items-center whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
              >
                2轨（人声 + 伴奏）
              </button>
              <button
                type="button"
                onClick={() => void startClipProcessing(clipContextMenu.trackId, clipContextMenu.clipId, 'stem_separation', '3轨音轨分离', { stemCount: 3 })}
                className="flex min-h-12 w-full items-center whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
              >
                3轨（人声 + 中声 + 和声 + 伴奏）
              </button>
              <button
                type="button"
                onClick={() => void startClipProcessing(clipContextMenu.trackId, clipContextMenu.clipId, 'stem_separation', '4轨音轨分离', { stemCount: 4 })}
                className="flex min-h-12 w-full items-center whitespace-nowrap rounded-lg px-3 text-left text-[15px] transition hover:bg-slate-100"
              >
                4轨（人声 + 贝斯 + 鼓组 + 伴奏）
              </button>
            </div>
          )}
        </div>
      )}
      {clipNotice && (
        <div className="fixed bottom-6 left-1/2 z-[10001] -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs text-slate-700 shadow-xl dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">
          {clipNotice}
        </div>
      )}

      {/* 上滑面板：人声效果器 */}
      {slideUpPanel === 'vocalEffect' && (
        <div
          role="dialog"
          aria-label="人声效果器"
          className="fixed z-50 rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
          style={{
            bottom: `${window.innerHeight - slideUpPosition.top + 8}px`,
            left: `${vocalEffectPanelLeft}px`,
            width: `${vocalEffectPanelWidth}px`,
          }}
        >
          <div className="mb-3 text-sm font-semibold text-slate-900">人声效果器</div>
          <div className="mb-3 flex rounded-lg bg-slate-100 p-1">
            {VOCAL_EFFECT_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setVocalEffectTab(tab.key)}
                className={`flex-1 rounded-md py-1 text-xs font-medium transition ${
                  vocalEffectTab === tab.key ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="grid max-h-[300px] grid-cols-2 gap-2 overflow-y-auto">
            {listVocalEffects(vocalEffectTab).map((effect) => {
              const EffectIcon = VOCAL_EFFECT_ICONS[effect.iconKey] || Mic;
              return (
                <button
                  key={`${effect.category}:${effect.id}`}
                  type="button"
                  onClick={() => {
                    setSelectedVocalEffectId(effect.id);
                    setSlideUpPanel(null);
                  }}
                  className={`flex items-start gap-2 rounded-lg border p-2 text-left transition ${
                    selectedVocalEffectId === effect.id
                      ? 'border-sky-500 bg-sky-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                    <EffectIcon size={14} className="text-slate-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-900">{effect.name}</div>
                    <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-500">{effect.description}</div>
                  </div>
                </button>
              );
            })}
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
