'use client';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Mic, MicOff, Play, Pause, Square, Upload, Volume2, Settings2,
  Activity, FileAudio, Sparkles, Zap, AlertCircle, CheckCircle2,
  ChevronRight, ChevronDown, Plus, X, Trash2, Copy, Download,
  Search, Clock, Coins, Wifi, WifiOff, Loader2,
  History, BookOpen, Tag, Brain, Shield, Terminal, FileText,
  Network, ArrowRight, Layers, Radio, BarChart3, Lightbulb, FileJson,
  AudioLines, Disc3, Cpu, Gauge, FileUp, GripVertical, Mic2,
  Hexagon, Triangle, Circle as CircleIcon, Sparkle, AudioWaveform,
  Wand2, ChevronsRight, ArrowUpRight, Activity as Pulse, MoreHorizontal,
} from 'lucide-react';

/* =================== 视觉常量 =================== */

const SHIMMER_KEYFRAMES = `
@keyframes shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
@keyframes pulse-glow { 0%, 100% { box-shadow: 0 0 20px rgba(14, 165, 233, 0.3) } 50% { box-shadow: 0 0 40px rgba(14, 165, 233, 0.6) } }
@keyframes float-slow { 0%, 100% { transform: translate(0, 0) } 50% { transform: translate(20px, -20px) } }
@keyframes gradient-x { 0%, 100% { background-position: 0% 50% } 50% { background-position: 100% 50% } }
@keyframes count-up { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
@keyframes scan-h { 0% { transform: translateX(-100%) } 100% { transform: translateX(100%) } }
@keyframes orb { 0%, 100% { transform: scale(1) translate(0, 0) } 33% { transform: scale(1.1) translate(20px, -20px) } 66% { transform: scale(0.95) translate(-20px, 20px) } }
@keyframes ring-pulse { 0% { transform: scale(0.8); opacity: 0.8 } 100% { transform: scale(2); opacity: 0 } }
.shimmer { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent); background-size: 200% 100%; animation: shimmer 2s linear infinite; }
.pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
.float-slow { animation: float-slow 6s ease-in-out infinite; }
.gradient-x { background-size: 200% 200%; animation: gradient-x 3s ease infinite; }
.count-up { animation: count-up 0.4s ease-out; }
.scan-h::before { content: ''; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(90deg, transparent, rgba(14, 165, 233, 0.2), transparent); animation: scan-h 2s linear infinite; }
.orb { animation: orb 12s ease-in-out infinite; }
.ring-pulse::after { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 2px solid currentColor; animation: ring-pulse 2s ease-out infinite; }
`;

/* =================== 数据模型 =================== */

interface ASRModel {
  id: string; name: string;
  family: 'Qwen-Audio' | 'Fun-ASR' | 'Qwen3-ASR' | 'Paraformer';
  mode: 'realtime' | 'filetrans' | 'flash'; protocol: 'WebSocket' | 'HTTP' | 'AOQ';
  supportsHotwords: boolean; supportsContext: boolean; supportsEmotion: boolean; supportsSpeaker: boolean;
  sampleRate: number[]; languages: string[]; maxDuration: string;
  recommended?: boolean; description: string; badge?: string;
}

interface TranscriptSegment {
  id: string; text: string; isFinal: boolean; timestamp: number; duration: number;
  words?: { word: string; start: number; end: number; confidence: number }[];
  emotion?: string; filteredText?: string; matchedFilter?: string[];
}

interface Hotword { id: string; word: string; weight: number; }
interface SensitiveWord { id: string; word: string; action: 'mask' | 'remove'; }
interface WSLogEntry { id: string; ts: number; direction: 'client' | 'server'; type: string; data: any; }
interface AppConfig {
  model: string; audioFormat: string; sampleRate: number; language: string;
  mode: 'vad' | 'manual'; vadThreshold: number; vadSilenceMs: number;
  heartbeat: boolean; maxRetries: number; enableEmotion: boolean;
  corpusText: string; hotwords: Hotword[]; filterEnabled: boolean;
  maskWords: SensitiveWord[]; removeWords: SensitiveWord[];
  autoScroll: boolean; showWordTimestamps: boolean;
}
type AudioSource = 'idle' | 'mic' | 'file';

/* =================== 常量 =================== */

const MODELS: ASRModel[] = [
  { id: 'qwen-audio-3.0-asr-flash-streaming', name: 'Qwen-Audio 3.0 ASR Flash', family: 'Qwen-Audio', mode: 'realtime', protocol: 'WebSocket', supportsHotwords: true, supportsContext: true, supportsEmotion: false, supportsSpeaker: false, sampleRate: [8000, 16000], languages: ['中文方言', '多语种'], maxDuration: '无限', description: '内联热词 + Prompt 上下文，适合多语种与方言', recommended: true, badge: '推荐' },
  { id: 'fun-asr-realtime', name: 'Fun-ASR Realtime', family: 'Fun-ASR', mode: 'realtime', protocol: 'WebSocket', supportsHotwords: true, supportsContext: true, supportsEmotion: false, supportsSpeaker: false, sampleRate: [16000], languages: ['中文方言', '多语种'], maxDuration: '无限', description: '16kHz 实时识别 · 上下文、预编译热词与敏感词过滤' },
  { id: 'qwen3-asr-flash-realtime', name: 'Qwen3-ASR Flash Realtime', family: 'Qwen3-ASR', mode: 'realtime', protocol: 'WebSocket', supportsHotwords: false, supportsContext: true, supportsEmotion: true, supportsSpeaker: false, sampleRate: [8000, 16000], languages: ['中文', '英/日/韩等'], maxDuration: '无限', description: '支持长上下文与情绪标记', badge: '新' },
  { id: 'fun-asr-flash-8k-realtime', name: 'Fun-ASR Flash 8K', family: 'Fun-ASR', mode: 'realtime', protocol: 'WebSocket', supportsHotwords: true, supportsContext: false, supportsEmotion: false, supportsSpeaker: false, sampleRate: [8000], languages: ['中文'], maxDuration: '无限', description: '8kHz 电话场景专用' },
  { id: 'paraformer-realtime-v2', name: 'Paraformer Realtime V2', family: 'Paraformer', mode: 'realtime', protocol: 'WebSocket', supportsHotwords: true, supportsContext: false, supportsEmotion: false, supportsSpeaker: false, sampleRate: [8000, 16000], languages: ['中文', '英语'], maxDuration: '无限', description: '兼容存量 Paraformer 实时识别场景' },
];

const AUDIO_FORMATS = ['pcm', 'wav', 'mp3', 'opus', 'speex', 'aac', 'amr'];
const LANGUAGES = [
  { code: 'zh', label: '中文（普通话）' }, { code: 'zh-cantonese', label: '粤语' },
  { code: 'en', label: '英语' }, { code: 'ja', label: '日语' }, { code: 'ko', label: '韩语' }, { code: 'auto', label: '自动检测' },
];
const CORPUS_TEMPLATES = [
  { name: '金融投行', text: 'Bulge Bracket, Boutique, Middle Market, domestic securities firms, Goldman Sachs, Morgan Stanley, Lazard, Evercore' },
  { name: '医疗', text: '冠状动脉, 心电图, 房颤, 心肌梗死, 肺栓塞, 糖尿病, 胰岛素, 抗生素, 青霉素, 头孢' },
  { name: '法律', text: '原告, 被告, 第三人, 诉讼代理人, 辩护人, 仲裁, 上诉, 再审, 抗诉, 管辖权' },
  { name: '技术', text: 'Kubernetes, Docker, 微服务, 服务网格, Serverless, WebSocket, gRPC, GraphQL' },
  { name: '教育', text: '高等教育, 职业教育, 继续教育, 终身学习, 教育部, 双一流, 985, 211' },
];

/* =================== 工具 =================== */

const cn = (...a: any[]) => a.filter(Boolean).join(' ');
const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`;
};
const countTokens = (t: string) => {
  const zh = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (t.match(/[a-zA-Z]+/g) || []).length;
  return Math.ceil(zh + en * 0.75);
};
const applyFilter = (text: string, mask: SensitiveWord[], remove: SensitiveWord[]) => {
  let r = text; const matched: string[] = [];
  mask.forEach(w => { if (w.word && r.includes(w.word)) { matched.push(w.word); r = r.replace(new RegExp(w.word, 'g'), '*'.repeat(w.word.length)); } });
  remove.forEach(w => { if (w.word && r.includes(w.word)) { matched.push(w.word); r = r.replace(new RegExp(w.word, 'g'), ''); } });
  return { text: r, matched };
};
const highlightHotwords = (text: string, hotwords: Hotword[]) => {
  if (!hotwords.length) return [{ word: text, isHot: false }];
  const sorted = [...hotwords].sort((a, b) => b.word.length - a.word.length);
  const pattern = new RegExp(`(${sorted.map(h => h.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return text.split(pattern).filter(p => p).map(p => ({ word: p, isHot: sorted.some(h => h.word === p) }));
};

/* =================== 数字滚动 Hook =================== */

function useAnimatedNumber(target: number, duration = 600) {
  const [val, setVal] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    const start = prev.current, change = target - start, startTime = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(start + change * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else prev.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

/* =================== Resizable Split =================== */

function ResizableSplit({ children, defaultRatio = 0.62, min = 400, max = 1100 }: {
  children: [React.ReactNode, React.ReactNode]; defaultRatio?: number; min?: number; max?: number;
}) {
  // 服务端和浏览器首次渲染必须使用同一宽度；本地记忆在挂载后恢复。
  const [leftWidth, setLeftWidth] = useState(800);
  const [splitReady, setSplitReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem('asr-split-width');
    const restored = saved ? Number(saved) : Math.round(window.innerWidth * defaultRatio);
    setLeftWidth(Math.max(min, Math.min(max, Number.isFinite(restored) ? restored : 800)));
    setSplitReady(true);
  }, [defaultRatio, min, max]);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const w = Math.max(min, Math.min(max, e.clientX - rect.left));
      setLeftWidth(w);
    };
    const onUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [min, max]);
  useEffect(() => {
    if (splitReady) localStorage.setItem('asr-split-width', String(leftWidth));
  }, [leftWidth, splitReady]);

  return (
    <div ref={containerRef} className="flex w-full h-full">
      <div style={{ width: leftWidth, flexShrink: 0 }} className="overflow-hidden">{children[0]}</div>
      <div
        onMouseDown={onMouseDown}
        className="relative w-1.5 flex-shrink-0 cursor-col-resize group transition-colors hover:bg-gradient-to-b hover:from-sky-500/0 hover:via-sky-500/40 hover:to-cyan-500/0"
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-slate-200 dark:bg-neutral-800" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-12 rounded-full bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 shadow-md flex items-center justify-center group-hover:border-sky-500 group-hover:scale-110 transition-all">
          <GripVertical className="w-3 h-3 text-slate-400 group-hover:text-sky-500" />
        </div>
        <div className="absolute inset-y-0 -left-2 -right-2" />
      </div>
      <div style={{ flex: 1, minWidth: min }} className="overflow-hidden">{children[1]}</div>
    </div>
  );
}

/* =================== 音频引擎 =================== */

function useAudioEngine() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const captureRef = useRef<{ processor: ScriptProcessorNode; source: MediaStreamAudioSourceNode; sink: GainNode } | null>(null);

  const ensureContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    if (!analyserRef.current) {
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      analyserRef.current.smoothingTimeConstant = 0.6;
    }
    return { ctx: audioCtxRef.current, analyser: analyserRef.current };
  }, []);

  const startMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
      mediaStreamRef.current = stream;
      const { ctx, analyser } = ensureContext();
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);
      sourceRef.current = src;
      return { ok: true, stream };
    } catch (e: any) { return { ok: false, error: e.message || '麦克风启动失败（需要 HTTPS 或 localhost）' }; }
  }, [ensureContext]);

  const stopMic = useCallback(() => {
    if (captureRef.current) {
      try { captureRef.current.processor.disconnect(); captureRef.current.source.disconnect(); captureRef.current.sink.disconnect(); } catch {}
      captureRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    mediaStreamRef.current = null;
    try { sourceRef.current?.disconnect(); } catch {}
    sourceRef.current = null;
  }, []);

  const startPcmCapture = useCallback((stream: MediaStream, targetRate: number, onChunk: (chunk: ArrayBuffer) => void) => {
    const { ctx } = ensureContext();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0);
      const ratio = ctx.sampleRate / targetRate;
      const length = Math.max(1, Math.floor(input.length / ratio));
      const pcm = new Int16Array(length);
      for (let i = 0; i < length; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(input.length, Math.floor((i + 1) * ratio));
        let sum = 0;
        for (let j = start; j < end; j++) sum += input[j];
        const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
        pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      onChunk(pcm.buffer);
    };
    source.connect(processor);
    processor.connect(sink);
    sink.connect(ctx.destination);
    captureRef.current = { processor, source, sink };
  }, [ensureContext]);

  const playFile = useCallback(async (file: File) => {
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current = null; }
    try { sourceRef.current?.disconnect(); } catch {}
    sourceRef.current = null;
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.crossOrigin = 'anonymous';
    audioElRef.current = audio;
    await new Promise((resolve, reject) => { audio.onloadedmetadata = resolve; audio.onerror = reject; });
    const { ctx, analyser } = ensureContext();
    const src = ctx.createMediaElementSource(audio);
    src.connect(analyser);
    analyser.connect(ctx.destination);
    sourceRef.current = src;
    return { audio, play: () => audio.play(), pause: () => audio.pause(), duration: audio.duration };
  }, [ensureContext]);

  const stopFile = useCallback(() => {
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.currentTime = 0; }
    try { sourceRef.current?.disconnect(); } catch {}
    sourceRef.current = null;
  }, []);

  const getTimeData = useCallback((): Uint8Array => {
    if (!analyserRef.current) return new Uint8Array(0);
    const data = new Uint8Array(analyserRef.current.fftSize);
    analyserRef.current.getByteTimeDomainData(data);
    return data;
  }, []);

  useEffect(() => () => { stopMic(); stopFile(); audioCtxRef.current?.close(); }, [stopMic, stopFile]);
  return { startMic, stopMic, startPcmCapture, playFile, stopFile, getTimeData, ensureContext };
}

/* =================== 主组件 =================== */

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [latency, setLatency] = useState(0);
  const [activeConfigTab, setActiveConfigTab] = useState<'model' | 'context' | 'hotwords' | 'filter' | 'fault'>('model');
  const [showRawJSON, setShowRawJSON] = useState(false);
  const [credits, setCredits] = useState(9850);
  const [tab, setTab] = useState<'workbench' | 'history' | 'docs'>('workbench');

  const [audioSource, setAudioSource] = useState<AudioSource>('idle');
  const [audioFile, setAudioFile] = useState<{ name: string; size: number; duration: number } | null>(null);
  const [filePlaying, setFilePlaying] = useState(false);
  const [fileProgress, setFileProgress] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [vadActive, setVadActive] = useState(false);
  const [volume, setVolume] = useState(0);
  const [logs, setLogs] = useState<WSLogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const historySavedRef = useRef(false);
  const historyMetaRef = useRef<{ title: string; source: 'mic' | 'file'; startedAt: number; durationMs?: number }>({ title: '', source: 'mic', startedAt: 0 });
  const wsRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(false);
  const fileSendCancelledRef = useRef(false);
  const lastAudioSentAtRef = useRef(0);

  const [config, setConfig] = useState<AppConfig>({
    model: 'qwen-audio-3.0-asr-flash-streaming', audioFormat: 'pcm', sampleRate: 16000, language: 'zh',
    mode: 'vad', vadThreshold: 0.0, vadSilenceMs: 400, heartbeat: true, maxRetries: 3, enableEmotion: false,
    corpusText: 'Bulge Bracket, Boutique, Middle Market, domestic securities firms\nGoldman Sachs, Morgan Stanley, Lazard, Evercore',
    hotwords: [
      { id: 'h1', word: 'Bulge Bracket', weight: 5 },
      { id: 'h2', word: '投行', weight: 5 },
      { id: 'h3', word: '九大外资投行', weight: 4 },
    ],
    filterEnabled: true,
    maskWords: [{ id: 's1', word: '测试', action: 'mask' }],
    removeWords: [{ id: 's2', word: '开始', action: 'remove' }],
    autoScroll: true, showWordTimestamps: true,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioEngine = useAudioEngine();

  const currentModel = useMemo(() => MODELS.find(m => m.id === config.model)!, [config.model]);
  const corpusTokens = useMemo(() => countTokens(config.corpusText), [config.corpusText]);
  const animatedTime = useAnimatedNumber(recordingTime);
  const animatedSegments = useAnimatedNumber(segments.length);
  const animatedLatency = useAnimatedNumber(latency);

  useEffect(() => { pausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { segmentsRef.current = segments; }, [segments]);
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = window.setInterval(() => {
        setRecordingTime(t => t + 50);
      }, 50);
    } else { if (timerRef.current) clearInterval(timerRef.current); }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording, isPaused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const getTimeData = audioEngine.getTimeData;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    let phase = 0;
    const draw = () => {
      phase += 0.08;
      // 渐变背景
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#0a0612'); bg.addColorStop(0.5, '#0c0a1f'); bg.addColorStop(1, '#080610');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // 网格点阵
      ctx.fillStyle = 'rgba(14, 165, 233, 0.08)';
      for (let x = 0; x < W; x += 24) for (let y = 0; y < H; y += 24) ctx.fillRect(x, y, 1, 1);
      // 网格线
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, (H/4)*i); ctx.lineTo(W, (H/4)*i); ctx.stroke(); }
      for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo((W/8)*i, 0); ctx.lineTo((W/8)*i, H); ctx.stroke(); }

      // 真实频谱
      const timeData = getTimeData();
      const bars = 96; const barW = W / bars;
      let volSum = 0;
      const isLive = isRecording && !isPaused && audioSource !== 'idle';
      if (isLive && timeData.length > 0) {
        const samplesPerBar = Math.floor(timeData.length / bars);
        for (let i = 0; i < bars; i++) {
          let sum = 0;
          for (let j = 0; j < samplesPerBar; j++) { const v = (timeData[i*samplesPerBar+j]-128)/128; sum += Math.abs(v); }
          const amp = Math.min(1, (sum/samplesPerBar) * 3);
          volSum += amp;
          const h = amp * H * 0.85;
          const x = i * barW;
          const isSpeaking = amp > 0.05;
          // 双色渐变
          const grad = ctx.createLinearGradient(0, H/2 - h/2, 0, H/2 + h/2);
          if (isSpeaking) { grad.addColorStop(0, '#0ea5e9'); grad.addColorStop(0.5, '#06b6d4'); grad.addColorStop(1, '#0284c7'); }
          else { grad.addColorStop(0, '#0c4a6e'); grad.addColorStop(1, '#0c4a6e'); }
          ctx.fillStyle = grad; ctx.fillRect(x + 1, H/2 - h/2, barW - 2, h);
          // 顶部亮点
          if (isSpeaking) { ctx.fillStyle = '#bae6fd'; ctx.fillRect(x+1, H/2-h/2-2, barW-2, 2); }
        }
        setVadActive(volSum/bars > 0.04);
        setVolume(Math.min(100, Math.round((volSum/bars)*200)));
      } else {
        for (let i = 0; i < bars; i++) {
          const h = 3;
          const x = i * barW;
          ctx.fillStyle = 'rgba(6, 182, 212, 0.3)'; ctx.fillRect(x + 1, H/2 - h/2, barW - 2, h);
        }
        setVadActive(false); setVolume(0);
      }
      // 顶部 VAD 流光
      const vadGrad = ctx.createLinearGradient(0, 0, W, 0);
      const liveVad = isLive && volSum / bars > 0.04;
      if (liveVad) {
        vadGrad.addColorStop(0, '#10b981'); vadGrad.addColorStop(0.5, '#34d399'); vadGrad.addColorStop(1, '#10b981');
        ctx.fillStyle = vadGrad; ctx.fillRect(0, 0, W, 3);
      } else { ctx.fillStyle = 'rgba(100, 116, 139, 0.3)'; ctx.fillRect(0, 0, W, 2); }
      // 扫描线
      if (liveVad) {
        const scanX = (phase * 60) % W;
        const sg = ctx.createLinearGradient(scanX-40, 0, scanX+40, 0);
        sg.addColorStop(0, 'rgba(14, 165, 233, 0)'); sg.addColorStop(0.5, 'rgba(14, 165, 233, 0.3)'); sg.addColorStop(1, 'rgba(14, 165, 233, 0)');
        ctx.fillStyle = sg; ctx.fillRect(scanX-40, 0, 80, H);
      }
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isRecording, isPaused, audioSource, audioEngine.getTimeData]);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  const addLog = useCallback((direction: 'client' | 'server', type: string, data: any) => {
    setLogs(prev => [...prev.slice(-200), { id: Date.now() + Math.random().toString(), ts: Date.now(), direction, type, data }]);
  }, []);

  const persistRecognitionHistory = useCallback(async () => {
    if (historySavedRef.current || !historyMetaRef.current.startedAt) return;
    historySavedRef.current = true;
    const rows = segmentsRef.current;
    const meta = historyMetaRef.current;
    const transcript = rows.map(segment => segment.filteredText || segment.text).join('\n');
    const durationMs = meta.durationMs ?? Math.max(0, Date.now() - meta.startedAt);
    try {
      const response = await fetch('/api/music/asr-history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: meta.title || '未命名识别', model: config.model, source: meta.source, language: config.language, duration_ms: durationMs, transcript, segments: rows }),
      });
      if (!response.ok) throw new Error(`history save failed: ${response.status}`);
      addLog('client', 'history.saved', { source: meta.source, sentence_count: rows.length });
    } catch (error) {
      historySavedRef.current = false;
      addLog('client', 'history.save_failed', { message: error instanceof Error ? error.message : String(error) });
    }
  }, [addLog, config.language, config.model]);

  const connectASR = useCallback(() => new Promise<WebSocket>((resolve, reject) => {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${scheme}//${window.location.host}/ws/asr/stream`);
    socket.binaryType = 'arraybuffer';
    wsRef.current = socket;
    const timeout = window.setTimeout(() => reject(new Error('连接识别服务超时')), 12000);
    socket.onopen = () => {
      const startConfig = {
        ...config,
        audioFormat: 'pcm',
        hotwords: config.hotwords.filter(h => h.word).map(h => ({ text: h.word, weight: h.weight })),
        sensitiveWords: config.filterEnabled ? [
          ...config.maskWords.filter(w => w.word).map(w => ({ text: w.word, action: 'mask' })),
          ...config.removeWords.filter(w => w.word).map(w => ({ text: w.word, action: 'remove' })),
        ] : [],
      };
      socket.send(JSON.stringify({ type: 'start', config: startConfig }));
      addLog('client', 'start', { ...startConfig, hotwords: startConfig.hotwords.length, sensitiveWords: startConfig.sensitiveWords.length });
    };
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data));
      addLog('server', message.type, message);
      if (message.type === 'ready') {
        window.clearTimeout(timeout);
        setIsConnecting(false); setIsConnected(true);
        resolve(socket);
      } else if (message.type === 'transcript') {
        if (lastAudioSentAtRef.current) setLatency(Math.max(0, Math.round(performance.now() - lastAudioSentAtRef.current)));
        if (!message.final) {
          setInterimText(message.text || '');
        } else if (message.text) {
          const filtered = applyFilter(message.text, config.maskWords, config.removeWords);
          const nextSegment: TranscriptSegment = {
            id: `${Date.now()}-${segmentsRef.current.length}`,
            text: message.text,
            filteredText: filtered.text,
            matchedFilter: filtered.matched,
            isFinal: true,
            timestamp: message.start_ms ?? recordingTime,
            duration: Math.max(0, (message.end_ms ?? 0) - (message.start_ms ?? 0)),
            words: config.showWordTimestamps ? (message.words || []).map((word: any) => ({
              word: word.text || word.word || '', start: word.start_ms ?? word.start ?? 0,
              end: word.end_ms ?? word.end ?? 0, confidence: word.confidence ?? 1,
            })) : undefined,
          };
          segmentsRef.current = [...segmentsRef.current, nextSegment];
          setSegments(segmentsRef.current);
          setInterimText('');
        }
      } else if (message.type === 'finished') {
        setIsConnected(false); setIsConnecting(false); socket.close();
        void persistRecognitionHistory();
      } else if (message.type === 'error') {
        window.clearTimeout(timeout);
        const error = new Error(message.message || '语音识别失败');
        setMicError(error.message); setFileError(error.message);
        setIsRecording(false); setIsConnected(false); setIsConnecting(false);
        reject(error);
      }
    };
    socket.onerror = () => {
      window.clearTimeout(timeout);
      setIsConnecting(false); setIsConnected(false);
      reject(new Error('无法连接语音识别服务'));
    };
    socket.onclose = () => { setIsConnected(false); wsRef.current = null; };
  }), [addLog, config, persistRecognitionHistory, recordingTime]);

  const handleStartMic = async () => {
    setMicError(null);
    const result = await audioEngine.startMic();
    if (!result.ok || !result.stream) { setMicError(result.error || '未知错误'); return; }
    setAudioSource('mic'); setIsRecording(true); setIsPaused(false); setRecordingTime(0);
    setSegments([]); segmentsRef.current = []; setInterimText(''); setLogs([]); setIsConnecting(true);
    historySavedRef.current = false;
    historyMetaRef.current = { title: `麦克风识别 ${new Date().toLocaleString()}`, source: 'mic', startedAt: Date.now() };
    try {
      const socket = await connectASR();
      audioEngine.startPcmCapture(result.stream, config.sampleRate, chunk => {
        if (!pausedRef.current && socket.readyState === WebSocket.OPEN) {
          lastAudioSentAtRef.current = performance.now();
          socket.send(chunk);
        }
      });
    } catch (error: any) {
      audioEngine.stopMic(); setAudioSource('idle'); setIsRecording(false);
      setMicError(error.message || '启动识别失败');
    }
  };

  const handleStartFile = async (file: File) => {
    setFileError(null);
    if (file.size > 100 * 1024 * 1024) { setFileError('文件大小不能超过 100MB'); return; }
    const result = await audioEngine.playFile(file);
    if (!result) { setFileError('文件解码失败'); return; }
    setAudioFile({ name: file.name, size: file.size, duration: result.duration });
    setAudioSource('file'); setIsRecording(true); setIsPaused(false); setRecordingTime(0);
    setSegments([]); segmentsRef.current = []; setInterimText(''); setLogs([]);
    historySavedRef.current = false;
    historyMetaRef.current = { title: file.name, source: 'file', startedAt: Date.now(), durationMs: Math.round(result.duration * 1000) };
    result.audio.ontimeupdate = () => setFileProgress((result.audio.currentTime / result.duration) * 100);
    result.audio.onended = () => setFilePlaying(false);
    setIsConnecting(true); fileSendCancelledRef.current = false;
    try {
      const socket = await connectASR();
      const { ctx } = audioEngine.ensureContext();
      const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      const channel = decoded.getChannelData(0);
      const secondChannel = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null;
      const ratio = decoded.sampleRate / config.sampleRate;
      const outputLength = Math.floor(channel.length / ratio);
      const pcm = new Int16Array(outputLength);
      for (let i = 0; i < outputLength; i++) {
        const sourceIndex = Math.min(channel.length - 1, Math.floor(i * ratio));
        const sample = Math.max(-1, Math.min(1, secondChannel ? (channel[sourceIndex] + secondChannel[sourceIndex]) / 2 : channel[sourceIndex]));
        pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      await result.play(); setFilePlaying(true);
      const samplesPerChunk = Math.max(1, Math.floor(config.sampleRate / 10));
      for (let offset = 0; offset < pcm.length && !fileSendCancelledRef.current; offset += samplesPerChunk) {
        while (pausedRef.current && !fileSendCancelledRef.current) await new Promise(resolve => setTimeout(resolve, 80));
        if (socket.readyState !== WebSocket.OPEN) break;
        const chunk = pcm.slice(offset, Math.min(offset + samplesPerChunk, pcm.length));
        lastAudioSentAtRef.current = performance.now();
        socket.send(chunk.buffer);
        await new Promise(resolve => setTimeout(resolve, 95));
      }
      if (!fileSendCancelledRef.current && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'finish' }));
        addLog('client', 'finish', {});
      }
      setIsRecording(false); setFilePlaying(false);
    } catch (error: any) {
      audioEngine.stopFile(); setAudioSource('idle'); setIsRecording(false); setFilePlaying(false);
      setFileError(error.message || '文件识别失败');
    }
  };

  const handleStop = () => {
    setIsRecording(false); setIsPaused(false);
    fileSendCancelledRef.current = true;
    if (audioSource === 'mic') audioEngine.stopMic();
    if (audioSource === 'file') audioEngine.stopFile();
    setFilePlaying(false); setAudioSource('idle'); setAudioFile(null); setFileProgress(0);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'finish' }));
      addLog('client', 'finish', {});
    }
  };

  const handlePause = () => { setIsPaused(p => !p); };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) handleStartFile(f); };
  const updateConfig = <K extends keyof AppConfig>(k: K, v: AppConfig[K]) => setConfig(c => ({ ...c, [k]: v }));
  const addHotword = () => updateConfig('hotwords', [...config.hotwords, { id: Date.now().toString(), word: '', weight: 5 }]);
  const removeHotword = (id: string) => updateConfig('hotwords', config.hotwords.filter(h => h.id !== id));
  const updateHotword = (id: string, field: 'word' | 'weight', value: any) => updateConfig('hotwords', config.hotwords.map(h => h.id === id ? { ...h, [field]: value } : h));
  const addMaskWord = () => updateConfig('maskWords', [...config.maskWords, { id: Date.now().toString(), word: '', action: 'mask' }]);
  const removeMaskWord = (id: string) => updateConfig('maskWords', config.maskWords.filter(w => w.id !== id));
  const updateMaskWord = (id: string, word: string) => updateConfig('maskWords', config.maskWords.map(w => w.id === id ? { ...w, word } : w));
  const addRemoveWord = () => updateConfig('removeWords', [...config.removeWords, { id: Date.now().toString(), word: '', action: 'remove' }]);
  const removeRemoveWord = (id: string) => updateConfig('removeWords', config.removeWords.filter(w => w.id !== id));
  const updateRemoveWord = (id: string, word: string) => updateConfig('removeWords', config.removeWords.map(w => w.id === id ? { ...w, word } : w));
  const exportTranscript = () => {
    const text = segments.map(s => `[${formatTime(s.timestamp)}] ${s.filteredText || s.text}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `transcript-${Date.now()}.txt`; a.click();
  };

  return (
    <>
      <style>{SHIMMER_KEYFRAMES}</style>
      <div className="asr-studio min-h-screen bg-slate-50 text-slate-900 dark:bg-neutral-950 dark:text-neutral-100 relative overflow-x-hidden">
        {/* 背景装饰：渐变光斑 + 网格 */}
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full orb" style={{ background: 'radial-gradient(circle, rgba(14, 165, 233, 0.15) 0%, transparent 70%)' }} />
          <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] rounded-full orb" style={{ background: 'radial-gradient(circle, rgba(6, 182, 212, 0.12) 0%, transparent 70%)', animationDelay: '-4s' }} />
          <div className="absolute inset-0 opacity-[0.015]" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h60v60H0z' fill='none' stroke='%23ffffff' stroke-width='0.5'/%3E%3C/svg%3E")` }} />
        </div>

        {/* =================== 顶栏 =================== */}
        <div className="sticky top-0 z-40 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-2xl border-b border-slate-200 dark:border-neutral-800">
          <div className="max-w-[1600px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 via-cyan-500 to-blue-500 flex items-center justify-center text-white shadow-lg shadow-sky-500/30">
                <AudioWaveform className="w-5 h-5" />
                {isRecording && <div className="absolute -inset-1 rounded-xl border-2 border-sky-400/50 ring-pulse" />}
              </div>
              <div>
                <div className="font-bold text-sm flex items-center gap-2 tracking-tight">
                  Qwen ASR <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-gradient-to-r from-sky-500/20 to-cyan-500/20 border border-sky-500/30 text-sky-300 font-semibold">STUDIO</span>
                </div>
                <div className="text-[10px] text-slate-500 tracking-wide uppercase font-medium">Realtime Speech Recognition</div>
              </div>
            </div>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/5 backdrop-blur">
              {[
                { key: 'workbench', label: '工作台', icon: <Mic className="w-3.5 h-3.5" /> },
                { key: 'history', label: '历史', icon: <History className="w-3.5 h-3.5" /> },
                { key: 'docs', label: '文档', icon: <BookOpen className="w-3.5 h-3.5" /> },
              ].map(t => (
                <button key={t.key} onClick={() => setTab(t.key as any)}
                  className={cn("px-3.5 h-8 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all",
                    tab === t.key
                      ? 'bg-gradient-to-r from-sky-500/20 to-cyan-500/20 text-white border border-sky-500/30 shadow-inner'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className={cn("flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-medium border transition-all",
                isConnected ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.15)]' :
                isConnecting ? 'bg-blue-500/10 text-blue-300 border-blue-500/30' :
                'bg-white/5 text-slate-500 border-white/10'
              )}>
                {isConnected ? <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span> :
                  isConnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <WifiOff className="w-3 h-3" />}
                <span className="tracking-wide uppercase text-[10px]">{isConnected ? 'Live' : isConnecting ? 'Connecting' : 'Offline'}</span>
              </div>
              {isRecording && (
                <div className="hidden md:flex items-center gap-1.5 px-3 h-8 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 font-mono">
                  <Gauge className="w-3 h-3 text-sky-400" />
                  <span className="tabular-nums">{Math.round(animatedLatency)}</span>
                  <span className="text-slate-500 text-[10px]">ms</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {tab === 'workbench' && (
          <ResizableSplit defaultRatio={0.62} min={400} max={1100}>
            <WorkbenchLeft
              isRecording={isRecording} isPaused={isPaused}
              audioSource={audioSource} audioFile={audioFile} fileProgress={fileProgress}
              micError={micError} fileError={fileError} fileInputRef={fileInputRef}
              recordingTime={recordingTime} animatedTime={animatedTime} animatedSegments={animatedSegments}
              vadActive={vadActive} volume={volume}
              segments={segments} interimText={interimText} logs={logs} logsEndRef={logsEndRef}
              config={config} currentModel={currentModel}
              canvasRef={canvasRef} showRawJSON={showRawJSON} setShowRawJSON={setShowRawJSON}
              updateConfig={updateConfig}
              onStartMic={handleStartMic} onStartFile={handleStartFile}
              onStop={handleStop} onPause={handlePause}
              onExport={exportTranscript} onFileSelect={handleFileSelect}
              onClearError={() => { setMicError(null); setFileError(null); }}
            />
            <WorkbenchRight
              activeConfigTab={activeConfigTab} setActiveConfigTab={setActiveConfigTab}
              config={config} currentModel={currentModel} corpusTokens={corpusTokens}
              isConnected={isConnected} latency={latency}
              updateConfig={updateConfig}
              addHotword={addHotword} removeHotword={removeHotword} updateHotword={updateHotword}
              addMaskWord={addMaskWord} removeMaskWord={removeMaskWord} updateMaskWord={updateMaskWord}
              addRemoveWord={addRemoveWord} removeRemoveWord={removeRemoveWord} updateRemoveWord={updateRemoveWord}
              recordingTime={recordingTime} segments={segments}
            />
          </ResizableSplit>
        )}

        {tab === 'history' && <HistoryView />}
        {tab === 'docs' && <DocsView />}

        <style>{`
          .config-input { width: 100%; height: 34px; padding: 0 10px; border-radius: 8px; border: 1px solid rgb(203 213 225); background: white; color: rgb(15 23 42); font-size: 12px; outline: none; transition: all 0.2s; }
          .config-input:focus { box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.3); border-color: rgba(14, 165, 233, 0.5); background: rgba(255,255,255,0.05); }
          .config-input::placeholder { color: rgb(148 163 184); }
          html:not(.dark) .asr-studio .text-white,
          html:not(.dark) .asr-studio .text-slate-100 { color: rgb(15 23 42) !important; }
          html:not(.dark) .asr-studio .text-slate-200,
          html:not(.dark) .asr-studio .text-slate-300 { color: rgb(51 65 85) !important; }
          html:not(.dark) .asr-studio .text-slate-400 { color: rgb(71 85 105) !important; }
          html:not(.dark) .asr-studio button[class*="from-sky-500"][class*="to-"] { color: white !important; }
          html.dark .asr-studio .config-input { border-color: rgba(255,255,255,0.08); background: rgba(0,0,0,0.3); color: white; }
          html.dark .asr-studio .config-input::placeholder { color: rgba(255,255,255,0.3); }
        `}</style>
      </div>
    </>
  );
}

/* =================== 左侧：Hero + 主工作区 =================== */

function WorkbenchLeft(props: any) {
  const {
    isRecording, isPaused, audioSource, audioFile, fileProgress,
    micError, fileError, fileInputRef, recordingTime, animatedTime, animatedSegments,
    vadActive, volume, segments, interimText, logs, logsEndRef, config, currentModel,
    canvasRef, showRawJSON, setShowRawJSON, updateConfig,
    onStartMic, onStartFile, onStop, onPause, onExport, onFileSelect, onClearError,
  } = props;

  return (
    <div className="px-6 py-6 space-y-5 h-full overflow-y-auto">
      {/* ============ Hero 数据仪表盘 ============ */}
      <div className="relative rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.04] to-white/[0.01] backdrop-blur-xl p-6 overflow-hidden">
        {/* 顶部光斑装饰 */}
        <div className="absolute -top-32 -right-32 w-64 h-64 rounded-full" style={{ background: 'radial-gradient(circle, rgba(14, 165, 233, 0.2) 0%, transparent 60%)' }} />
        <div className="absolute -bottom-32 -left-32 w-64 h-64 rounded-full" style={{ background: 'radial-gradient(circle, rgba(6, 182, 212, 0.15) 0%, transparent 60%)' }} />

        <div className="relative">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="flex items-center gap-2 text-[10px] text-sky-300 uppercase tracking-widest font-semibold mb-1.5">
                <Sparkle className="w-3 h-3" /> Live Session
              </div>
              <h1 className="text-2xl font-bold tracking-tight">实时识别工作台</h1>
              <p className="text-xs text-slate-400 mt-1">基于通义千问 ASR 引擎 · 流式音频转文本</p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-sky-500/20 to-cyan-500/20 border border-sky-500/30 text-[10px] font-semibold uppercase tracking-wider text-sky-200">
              <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              {currentModel.family}
            </div>
          </div>

          {/* 大数字仪表盘 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="本次时长" value={formatTime(animatedTime)} unit="" gradient="from-sky-400 to-cyan-400" />
            <MetricCard label="识别句数" value={String(animatedSegments)} unit="句" gradient="from-cyan-400 to-blue-400" />
            <MetricCard label="实时延迟" value={String(Math.round(props.latency || 0))} unit="ms" gradient="from-emerald-400 to-teal-400" />
            <MetricCard label="积分余额" value={String((9850).toLocaleString())} unit="" gradient="from-amber-400 to-orange-400" />
          </div>
        </div>
      </div>

      {/* ============ 模型选择器 ============ */}
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-xl p-5 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Cpu className="w-4 h-4 text-sky-400" /> 选择识别模型
            </h2>
            <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wider">Model Selection</p>
          </div>
          <a href="https://platform.qianwenai.com/docs/developer-guides/speech/speech-to-text-models" target="_blank" rel="noreferrer"
            className="text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors">
            模型库 <ArrowUpRight className="w-3 h-3" />
          </a>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {MODELS.map(m => {
            const sel = config.model === m.id;
            return (
              <button key={m.id} onClick={() => { updateConfig('model', m.id); if (!m.sampleRate.includes(config.sampleRate)) updateConfig('sampleRate', m.sampleRate[0]); }}
                className={cn("relative p-3 rounded-xl border text-left transition-all overflow-hidden group",
                  sel
                    ? 'border-sky-500/50 bg-gradient-to-br from-sky-500/10 to-cyan-500/5 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                    : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
                )}>
                {sel && <div className="absolute inset-0 bg-gradient-to-br from-sky-500/5 to-transparent pointer-events-none" />}
                {m.recommended && (
                  <div className="absolute -top-2 right-2 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-gradient-to-r from-amber-400 to-orange-500 text-white">Best</div>
                )}
                {m.badge && !m.recommended && (
                  <div className="absolute -top-2 right-2 px-1.5 py-0.5 rounded text-[8px] font-bold bg-gradient-to-r from-blue-500 to-rose-500 text-white">{m.badge}</div>
                )}
                <div className="relative">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-xs font-bold tracking-tight">{m.family}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wider bg-white/5 text-slate-400 border border-white/5">
                      {m.mode === 'realtime' ? 'RT' : m.mode === 'filetrans' ? 'FT' : 'FL'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 line-clamp-1 font-mono">{m.name}</div>
                  <div className="flex items-center gap-1 mt-2">
                    {m.supportsHotwords && <span className="text-[8px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">热词</span>}
                    {m.supportsContext && <span className="text-[8px] px-1 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20">上下文</span>}
                    {m.supportsEmotion && <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">情绪</span>}
                    {m.supportsSpeaker && <span className="text-[8px] px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">说话人</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ============ 波形 + 控制 ============ */}
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Radio className="w-4 h-4 text-sky-400" /> 实时音频流
            </h2>
            <div className="flex items-center gap-2 text-[10px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className={cn("w-1.5 h-1.5 rounded-full", vadActive ? "bg-emerald-400 animate-pulse" : "bg-slate-600")} />
                <span className="text-slate-400 font-medium">{vadActive ? '语音中' : '静音'}</span>
              </span>
              <span className="text-slate-700">·</span>
              <span className="font-mono uppercase tracking-wider">{config.audioFormat} · {config.sampleRate/1000}kHz</span>
              {audioSource !== 'idle' && (
                <>
                  <span className="text-slate-700">·</span>
                  <span className="text-sky-300 font-semibold">{audioSource === 'mic' ? '麦克风' : '文件'}</span>
                </>
              )}
            </div>
          </div>
          <div className="text-[10px] font-mono text-slate-500 tabular-nums">{formatTime(recordingTime)}</div>
        </div>

        <div className="relative">
          <canvas ref={canvasRef} width={1200} height={220} className="w-full h-[220px]" />
          {audioSource === 'idle' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="relative w-20 h-20 mx-auto mb-4">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-sky-500/20 to-cyan-500/20 blur-xl" />
                  <div className="relative w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center backdrop-blur">
                    <Mic2 className="w-8 h-8 text-slate-400" />
                  </div>
                </div>
                <p className="text-sm font-semibold text-slate-300 mb-1">选择音频源</p>
                <p className="text-[11px] text-slate-500">点击下方「麦克风录音」或「上传音频文件」开始</p>
              </div>
            </div>
          )}
          {isRecording && (
            <>
              <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/90 backdrop-blur text-white text-[10px] font-bold tracking-widest uppercase shadow-lg shadow-rose-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> REC
              </div>
              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/90 backdrop-blur text-white text-[10px] font-medium shadow-lg shadow-emerald-500/30">
                <Volume2 className="w-3 h-3" /> <span className="tabular-nums">{volume}%</span>
              </div>
            </>
          )}
        </div>

        {audioSource === 'file' && audioFile && (
          <div className="px-5 py-3 border-t border-white/5 bg-white/[0.02]">
            <div className="flex items-center gap-2 text-[10px] text-slate-300 mb-2">
              <FileAudio className="w-3 h-3 text-sky-400" />
              <span className="font-medium truncate flex-1">{audioFile.name}</span>
              <span className="text-slate-500">{(audioFile.size/1024/1024).toFixed(2)}MB</span>
              <span className="font-mono tabular-nums text-slate-400">{formatTime(fileProgress/100*audioFile.duration*1000)} / {formatTime(audioFile.duration*1000)}</span>
            </div>
            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-sky-500 to-cyan-500 transition-all shadow-[0_0_10px_rgba(168,85,247,0.5)]" style={{ width: `${fileProgress}%` }} />
            </div>
          </div>
        )}

        {(micError || fileError) && (
          <div className="mx-5 mt-3 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[10px] text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span className="flex-1">{micError || fileError}</span>
            <button onClick={onClearError} aria-label="关闭错误提示"><X className="w-3 h-3" /></button>
          </div>
        )}

        <div className="px-5 py-4 border-t border-white/5 bg-white/[0.02]">
          {!isRecording ? (
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <button onClick={onStartMic}
                className="group relative h-12 px-6 rounded-xl bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-500 text-white font-semibold text-sm flex items-center gap-2 shadow-lg shadow-sky-500/30 hover:shadow-sky-500/50 transition-all overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                <Mic className="w-4 h-4 relative" />
                <span className="relative">麦克风录音</span>
              </button>
              <div className="h-8 w-px bg-white/10" />
              <button onClick={() => fileInputRef.current?.click()}
                className="h-12 px-6 rounded-xl border border-white/10 bg-white/5 text-white font-semibold text-sm flex items-center gap-2 hover:bg-white/10 transition-all">
                <FileUp className="w-4 h-4 text-sky-300" /> 上传音频文件
              </button>
              <input ref={fileInputRef} type="file" accept="audio/*" onChange={onFileSelect} className="hidden" />
              <div className="text-[10px] text-slate-500 ml-1 flex items-center gap-1">
                <Sparkle className="w-3 h-3" /> MP3 / WAV / M4A / OGG · ≤100MB
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <button onClick={onPause}
                className="h-10 px-4 rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 text-sm flex items-center gap-2 transition-all">
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                {isPaused ? '继续' : '暂停'}
              </button>
              <button onClick={onStop}
                className="h-10 px-4 rounded-lg bg-gradient-to-r from-rose-500 to-blue-500 text-white text-sm font-medium flex items-center gap-2 shadow-lg shadow-rose-500/30 hover:shadow-rose-500/50 transition-all">
                <Square className="w-3.5 h-3.5" /> 停止
              </button>
              <button onClick={onExport} disabled={!segments.length}
                className="h-10 px-3 rounded-lg border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 text-sm flex items-center gap-1.5 disabled:opacity-40 transition-all">
                <Download className="w-3.5 h-3.5" /> 导出
              </button>
              <div className="ml-auto flex items-center gap-1">
                <button onClick={() => updateConfig('showWordTimestamps', !config.showWordTimestamps)}
                  className={cn("h-7 px-2.5 rounded-md text-[10px] font-medium transition-all",
                    config.showWordTimestamps ? 'bg-sky-500/20 text-sky-200 border border-sky-500/30' : 'text-slate-500 hover:bg-white/5 border border-transparent'
                  )}>词级时间戳</button>
                <button onClick={() => setShowRawJSON(!showRawJSON)}
                  className={cn("h-7 px-2.5 rounded-md text-[10px] font-medium flex items-center gap-1 transition-all",
                    showRawJSON ? 'bg-sky-500/20 text-sky-200 border border-sky-500/30' : 'text-slate-500 hover:bg-white/5 border border-transparent'
                  )}><FileJson className="w-3 h-3" /> JSON</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ============ 识别结果 ============ */}
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <FileText className="w-4 h-4 text-sky-400" /> 识别结果
            <span className="text-[10px] text-slate-500 font-normal uppercase tracking-wider">{segments.length} sentences</span>
          </h2>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono uppercase tracking-wider">Streaming</span>
          </div>
        </div>

        <div className="p-5 max-h-[500px] overflow-y-auto space-y-3">
          {segments.length === 0 && !interimText && (
            <div className="text-center py-12">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                <FileText className="w-5 h-5 text-slate-600" />
              </div>
              <p className="text-sm text-slate-500">识别结果会实时显示在这里</p>
            </div>
          )}
          {segments.map((seg: TranscriptSegment) => {
            const filtered = seg.filteredText || seg.text;
            const parts = highlightHotwords(filtered, config.hotwords);
            const hasFilter = seg.matchedFilter && seg.matchedFilter.length > 0;
            return (
              <div key={seg.id} className="group rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 p-4 transition-all">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
                    <Clock className="w-3 h-3" />
                    <span className="font-mono tabular-nums">{formatTime(seg.timestamp)}</span>
                    <span className="text-slate-700">·</span>
                    <span className="tabular-nums">{(seg.duration/1000).toFixed(1)}s</span>
                    {seg.emotion && (
                      <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-500/10 text-blue-300 border border-blue-500/20">
                        {seg.emotion}
                      </span>
                    )}
                    {hasFilter && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        <Shield className="w-2.5 h-2.5 inline mr-0.5" />已过滤
                      </span>
                    )}
                    {parts.some(p => p.isHot) && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        <Tag className="w-2.5 h-2.5 inline mr-0.5" />热词
                      </span>
                    )}
                  </div>
                  <button onClick={() => navigator.clipboard?.writeText(filtered)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-white/10">
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
                <p className="text-[13px] text-slate-100 leading-relaxed">
                  {parts.map((p, i) => (
                    <span key={i} className={cn(p.isHot && "px-1 py-0.5 rounded bg-amber-500/20 text-amber-200 font-medium border-b border-amber-400/30")}>
                      {p.word}
                    </span>
                  ))}
                </p>
                {showRawJSON && (
                  <pre className="mt-2 p-2 rounded bg-black/30 text-[10px] font-mono text-slate-400 overflow-x-auto border border-white/5">
                    {JSON.stringify(seg, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
          {interimText && (
            <div className="rounded-xl border border-dashed border-sky-500/30 bg-sky-500/5 p-4">
              <div className="flex items-center gap-2 mb-1.5 text-[10px] text-sky-300 uppercase tracking-widest font-semibold">
                <Loader2 className="w-3 h-3 animate-spin" /> Intermediate
              </div>
              <p className="text-[13px] text-slate-300">
                {applyFilter(interimText, config.maskWords, config.removeWords).text}
                <span className="inline-block w-0.5 h-3.5 ml-0.5 bg-sky-400 animate-pulse align-middle" />
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ============ 事件日志 ============ */}
      <div className="rounded-2xl border border-white/5 bg-black/40 backdrop-blur-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-sm font-bold flex items-center gap-2 text-white">
            <Terminal className="w-4 h-4 text-emerald-400" /> WebSocket Event Stream
            <span className="text-[10px] text-slate-500 font-normal uppercase tracking-wider">{logs.length} events</span>
          </h2>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono">→ C</span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono">← S</span>
          </div>
        </div>
        <div className="p-3 max-h-56 overflow-y-auto font-mono text-[10.5px]">
          {logs.length === 0 ? (
            <div className="text-slate-600 text-center py-6 text-[11px]">{'// waiting for connection...'}</div>
          ) : (
            logs.map((log: WSLogEntry) => (
              <div key={log.id} className="flex items-start gap-2 py-0.5 hover:bg-white/[0.02] px-1 rounded">
                <span className="text-slate-600 flex-shrink-0 tabular-nums">
                  {new Date(log.ts).toLocaleTimeString('zh-CN', { hour12: false })}.{String(new Date(log.ts).getMilliseconds()).padStart(3, '0')}
                </span>
                <span className={cn("flex-shrink-0 font-bold w-3", log.direction === 'client' ? 'text-blue-400' : 'text-emerald-400')}>
                  {log.direction === 'client' ? '→' : '←'}
                </span>
                <span className="text-sky-300 flex-shrink-0 font-semibold">{log.type}</span>
                {log.data && Object.keys(log.data).length > 0 && (
                  <span className="text-slate-500 truncate">{JSON.stringify(log.data).slice(0, 90)}</span>
                )}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
}

/* =================== 数字仪表卡 =================== */

function MetricCard({ label, value, unit, gradient }: { label: string; value: string; unit: string; gradient: string }) {
  return (
    <div className="relative group rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur p-3.5 overflow-hidden">
      <div className={cn("absolute -top-12 -right-12 w-24 h-24 rounded-full opacity-20 group-hover:opacity-30 transition-opacity bg-gradient-to-br", gradient)} />
      <div className="relative">
        <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1.5">{label}</div>
        <div className="flex items-baseline gap-1.5">
          <div className={cn("text-2xl font-bold tracking-tight bg-gradient-to-br bg-clip-text text-transparent tabular-nums", gradient)}>
            {value}
          </div>
          {unit && <div className="text-[10px] text-slate-500 font-medium">{unit}</div>}
        </div>
      </div>
    </div>
  );
}

/* =================== 右侧：配置面板 =================== */

function WorkbenchRight(props: any) {
  const {
    activeConfigTab, setActiveConfigTab, config, currentModel, corpusTokens,
    isConnected, latency, updateConfig,
    addHotword, removeHotword, updateHotword,
    addMaskWord, removeMaskWord, updateMaskWord,
    addRemoveWord, removeRemoveWord, updateRemoveWord,
    recordingTime, segments,
  } = props;

  return (
    <div className="px-6 py-6 space-y-4 h-full overflow-y-auto">
      {/* 实时状态卡 */}
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="WebSocket" value={isConnected ? 'OPEN' : 'CLOSED'} color={isConnected ? 'emerald' : 'slate'} />
        <MiniStat label="RTT" value={`${Math.round(latency)}ms`} color="sky" />
        <MiniStat label="VAD" value={config.mode === 'vad' ? 'Server' : 'Manual'} color="cyan" />
        <MiniStat label="Reconnect" value={`0 / ${config.maxRetries}`} color="amber" />
      </div>

      {/* 主配置面板 */}
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-xl overflow-hidden">
        <div className="grid grid-cols-5 border-b border-white/5">
          {[
            { key: 'model', label: '模型', icon: <Cpu className="w-3.5 h-3.5" /> },
            { key: 'context', label: '上下文', icon: <Brain className="w-3.5 h-3.5" /> },
            { key: 'hotwords', label: '热词', icon: <Tag className="w-3.5 h-3.5" /> },
            { key: 'filter', label: '过滤', icon: <Shield className="w-3.5 h-3.5" /> },
            { key: 'fault', label: '容错', icon: <Network className="w-3.5 h-3.5" /> },
          ].map(t => (
            <button key={t.key} onClick={() => setActiveConfigTab(t.key as any)}
              className={cn(
                "relative px-1 h-11 text-[10px] font-medium flex flex-col items-center justify-center gap-0.5 transition-all",
                activeConfigTab === t.key ? 'text-white' : 'text-slate-500 hover:text-slate-300'
              )}>
              {activeConfigTab === t.key && <div className="absolute inset-x-2 bottom-0 h-0.5 bg-gradient-to-r from-sky-500 to-cyan-500 rounded-full" />}
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="p-4 max-h-[640px] overflow-y-auto space-y-3">
          {activeConfigTab === 'model' && (
            <>
              <ConfigRow label="音频格式">
                <select value={config.audioFormat} onChange={e => updateConfig('audioFormat', e.target.value)} className="config-input">
                  {AUDIO_FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                </select>
              </ConfigRow>
              <ConfigRow label="采样率">
                <select value={config.sampleRate} onChange={e => updateConfig('sampleRate', Number(e.target.value))} className="config-input">
                  {currentModel.sampleRate.map((s: number) => <option key={s} value={s}>{s/1000}kHz</option>)}
                </select>
              </ConfigRow>
              {currentModel.id.includes('8k') && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300 flex items-start gap-1.5">
                  <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>8K 模型专用电话场景 · 不要上采样到 16kHz</span>
                </div>
              )}
              <ConfigRow label="识别语言">
                <select value={config.language} onChange={e => updateConfig('language', e.target.value)} className="config-input">
                  {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              </ConfigRow>
              <ConfigRow label="分句模式">
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={() => updateConfig('mode', 'vad')} className={cn("h-9 rounded-lg text-[11px] font-medium transition-all", config.mode === 'vad' ? 'bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-lg shadow-sky-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5')}>VAD 自动</button>
                  <button onClick={() => updateConfig('mode', 'manual')} className={cn("h-9 rounded-lg text-[11px] font-medium transition-all", config.mode === 'manual' ? 'bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-lg shadow-sky-500/30' : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5')}>手动</button>
                </div>
              </ConfigRow>
              {config.mode === 'vad' && (
                <>
                  <ConfigRow label="VAD 阈值" hint={config.vadThreshold.toFixed(1)}>
                    <input type="range" min="-1" max="1" step="0.1" value={config.vadThreshold} onChange={e => updateConfig('vadThreshold', Number(e.target.value))} className="w-full accent-sky-500" />
                  </ConfigRow>
                  <ConfigRow label="静音时长" hint={`${config.vadSilenceMs}ms`}>
                    <input type="range" min="200" max="2000" step="100" value={config.vadSilenceMs} onChange={e => updateConfig('vadSilenceMs', Number(e.target.value))} className="w-full accent-sky-500" />
                  </ConfigRow>
                </>
              )}
            </>
          )}

          {activeConfigTab === 'context' && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-sky-400" /> 上下文增强
                    {currentModel.supportsContext ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">支持</span> : <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">不支持</span>}
                  </h3>
                </div>
                <span className={cn("text-[10px] font-mono font-bold tabular-nums", corpusTokens > 10000 ? 'text-rose-400' : corpusTokens > 8000 ? 'text-amber-400' : 'text-slate-500')}>
                  {corpusTokens} / 10000
                </span>
              </div>
              <textarea value={config.corpusText} onChange={e => updateConfig('corpusText', e.target.value)} disabled={!currentModel.supportsContext} rows={8}
                className="w-full px-3 py-2.5 rounded-lg border border-white/10 bg-black/30 text-[11px] font-mono text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500/50 resize-none disabled:opacity-40" />
              <div className="grid grid-cols-3 gap-1.5">
                {CORPUS_TEMPLATES.map(t => (
                  <button key={t.name} onClick={() => updateConfig('corpusText', t.text)}
                    className="h-7 px-2 rounded-md bg-white/5 hover:bg-sky-500/20 text-[10px] font-medium text-slate-300 border border-white/5 hover:border-sky-500/30 transition-all">
                    {t.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {activeConfigTab === 'hotwords' && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-amber-400" /> 热词表
                  {currentModel.supportsHotwords ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">支持</span> : <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20">不支持</span>}
                </h3>
                <button onClick={addHotword} disabled={!currentModel.supportsHotwords}
                  className="h-6 px-2 rounded bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white text-[10px] font-medium flex items-center gap-1">
                  <Plus className="w-3 h-3" /> 添加
                </button>
              </div>
              <div className="space-y-1.5">
                {config.hotwords.map((h: Hotword) => (
                  <div key={h.id} className="flex items-center gap-1.5 p-1.5 rounded-lg bg-white/[0.03] border border-white/5">
                    <input value={h.word} onChange={e => updateHotword(h.id, 'word', e.target.value)} placeholder="词汇"
                      className="flex-1 h-7 px-2 rounded bg-black/30 border border-white/10 text-[11px] focus:outline-none focus:ring-1 focus:ring-sky-500/40" />
                    <input type="number" min="1" max="10" value={h.weight} onChange={e => updateHotword(h.id, 'weight', Number(e.target.value))}
                      className="w-10 h-7 px-1 rounded bg-black/30 border border-white/10 text-[11px] text-center focus:outline-none focus:ring-1 focus:ring-sky-500/40 tabular-nums" />
                    <button onClick={() => removeHotword(h.id)} className="w-6 h-6 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 flex items-center justify-center">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeConfigTab === 'filter' && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-rose-400" /> 敏感词过滤
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">Fun-ASR</span>
                </h3>
                <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                  <input type="checkbox" checked={config.filterEnabled} onChange={e => updateConfig('filterEnabled', e.target.checked)} className="rounded accent-rose-500" />
                  启用
                </label>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">filter_with_signed · 替换为 *</div>
                <div className="space-y-1">
                  {config.maskWords.map((w: SensitiveWord) => (
                    <div key={w.id} className="flex items-center gap-1.5">
                      <input value={w.word} onChange={e => updateMaskWord(w.id, e.target.value)} placeholder="例如：测试"
                        className="flex-1 h-7 px-2 rounded bg-white/5 border border-white/10 text-[11px] focus:outline-none focus:ring-1 focus:ring-rose-500/40" />
                      <button onClick={() => removeMaskWord(w.id)} className="w-6 h-6 rounded text-slate-500 hover:text-rose-400 flex items-center justify-center">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={addMaskWord} className="mt-1.5 text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> 添加
                </button>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">filter_with_empty · 完全移除</div>
                <div className="space-y-1">
                  {config.removeWords.map((w: SensitiveWord) => (
                    <div key={w.id} className="flex items-center gap-1.5">
                      <input value={w.word} onChange={e => updateRemoveWord(w.id, e.target.value)} placeholder="例如：开始"
                        className="flex-1 h-7 px-2 rounded bg-white/5 border border-white/10 text-[11px] focus:outline-none focus:ring-1 focus:ring-rose-500/40" />
                      <button onClick={() => removeRemoveWord(w.id)} className="w-6 h-6 rounded text-slate-500 hover:text-rose-400 flex items-center justify-center">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={addRemoveWord} className="mt-1.5 text-[10px] text-sky-400 hover:text-sky-300 flex items-center gap-0.5">
                  <Plus className="w-3 h-3" /> 添加
                </button>
              </div>
              <pre className="p-2.5 rounded-lg bg-black/40 text-emerald-300 text-[10px] font-mono overflow-x-auto border border-white/5">
{JSON.stringify({
  special_word_filter: {
    filter_with_signed: { word_list: config.maskWords.filter((w: SensitiveWord) => w.word).map((w: SensitiveWord) => w.word) },
    filter_with_empty: { word_list: config.removeWords.filter((w: SensitiveWord) => w.word).map((w: SensitiveWord) => w.word) },
    system_reserved_filter: config.filterEnabled,
  }
}, null, 2)}
              </pre>
            </>
          )}

          {activeConfigTab === 'fault' && (
            <>
              <h3 className="text-xs font-bold flex items-center gap-1.5">
                <Network className="w-3.5 h-3.5 text-cyan-400" /> 容错策略
              </h3>
              <ConfigRow label="心跳保活">
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                  <input type="checkbox" checked={config.heartbeat} onChange={e => updateConfig('heartbeat', e.target.checked)} className="rounded accent-sky-500" />
                  {config.heartbeat ? '已启用' : '未启用'}
                </label>
              </ConfigRow>
              <ConfigRow label="最大重试次数" hint={`${config.maxRetries} 次`}>
                <input type="range" min="0" max="10" value={config.maxRetries} onChange={e => updateConfig('maxRetries', Number(e.target.value))} className="w-full accent-sky-500" />
              </ConfigRow>
              <div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-[10px] text-cyan-300 space-y-1">
                <div className="font-bold flex items-center gap-1"><Lightbulb className="w-3 h-3" /> 最佳实践</div>
                <ul className="space-y-0.5 text-slate-400">
                  <li>· on_error + threading.Event</li>
                  <li>· for 循环重试 N 次</li>
                  <li>· heartbeat=true 保持长连接</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
        {hint && <span className="text-[9px] text-slate-500 font-mono tabular-nums">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: 'emerald' | 'slate' | 'sky' | 'cyan' | 'amber' }) {
  const colorMap = {
    emerald: 'text-emerald-300',
    slate: 'text-slate-400',
    sky: 'text-sky-300',
    cyan: 'text-cyan-300',
    amber: 'text-amber-300',
  };
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] backdrop-blur px-3 py-2.5">
      <div className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold mb-0.5">{label}</div>
      <div className={cn("text-sm font-bold font-mono tabular-nums", colorMap[color])}>{value}</div>
    </div>
  );
}

/* =================== 历史 =================== */

function HistoryView() {
  type HistoryRecord = { id: string; title: string; model: string; source: 'mic' | 'file'; language: string; duration_ms: number; sentence_count: number; transcript: string; created_at: string };
  const [sessions, setSessions] = useState<HistoryRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/music/asr-history');
      if (!response.ok) throw new Error(`加载历史失败（${response.status}）`);
      setSessions(await response.json());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const remove = async (id: string) => {
    const response = await fetch(`/api/music/asr-history/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (response.ok) setSessions(prev => prev.filter(item => item.id !== id));
  };
  const visibleSessions = sessions.filter(item => `${item.title} ${item.model} ${item.transcript}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="max-w-[1600px] mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] text-sky-300 uppercase tracking-widest font-semibold mb-1.5">
            <History className="w-3 h-3" /> Sessions
          </div>
          <h1 className="text-2xl font-bold tracking-tight">识别历史</h1>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索会话…" className="h-10 pl-9 pr-4 rounded-lg border border-white/10 bg-white/5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-sky-500/40" />
        </div>
      </div>
      <div className="rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-white/[0.02] border-b border-white/5">
            <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
              <th className="px-5 py-3.5">会话名称</th>
              <th className="px-5 py-3.5">模型</th>
              <th className="px-5 py-3.5">来源</th>
              <th className="px-5 py-3.5">时长</th>
              <th className="px-5 py-3.5">句数</th>
              <th className="px-5 py-3.5">语言</th>
              <th className="px-5 py-3.5">时间</th>
              <th className="px-5 py-3.5"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">正在加载识别历史…</td></tr> : error ? <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-rose-400">{error} <button onClick={() => void loadHistory()} className="ml-2 underline">重试</button></td></tr> : visibleSessions.length === 0 ? <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">暂无识别历史</td></tr> : visibleSessions.map(s => (
              <tr key={s.id} className="border-t border-white/5 hover:bg-white/[0.02] transition-colors">
                <td className="px-5 py-3.5 text-sm font-medium">{s.title}</td>
                <td className="px-5 py-3.5 text-[10px] font-mono text-slate-400">{s.model}</td>
                <td className="px-5 py-3.5 text-xs">{s.source === 'file' ? '文件' : '麦克风'}</td>
                <td className="px-5 py-3.5 text-sm font-mono tabular-nums">{formatTime(s.duration_ms).slice(0, 5)}</td>
                <td className="px-5 py-3.5 text-sm">{s.sentence_count}</td>
                <td className="px-5 py-3.5 text-sm">{s.language}</td>
                <td className="px-5 py-3.5 text-xs text-slate-500">{new Date(`${s.created_at}Z`).toLocaleString()}</td>
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-1">
                    <button className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white"><ChevronRight className="w-4 h-4" /></button>
                    <button onClick={() => { const blob = new Blob([s.transcript], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${s.title || 'transcript'}.txt`; link.click(); URL.revokeObjectURL(url); }} className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white" aria-label="导出文本"><Download className="w-4 h-4" /></button>
                    <button onClick={() => void remove(s.id)} className="p-1.5 rounded hover:bg-rose-500/10 text-slate-500 hover:text-rose-400" aria-label="删除历史"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =================== 文档 =================== */

function DocsView() {
  return (
    <div className="max-w-[1100px] mx-auto px-6 py-6 space-y-6">
      <div>
        <div className="flex items-center gap-2 text-[10px] text-sky-300 uppercase tracking-widest font-semibold mb-1.5">
          <BookOpen className="w-3 h-3" /> Documentation
        </div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Qwen ASR 文档</h1>
        <p className="text-sm text-slate-400">基于千问官方文档，实时语音识别能力完整对照</p>
      </div>

      <div className="rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/5 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-sky-400" />
          <h2 className="font-bold text-sm tracking-tight">实时模型对照</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-white/[0.02]">
              <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
                <th className="px-5 py-3">模型</th>
                <th className="px-5 py-3">协议</th>
                <th className="px-5 py-3">热词</th>
                <th className="px-5 py-3">上下文</th>
                <th className="px-5 py-3">情绪</th>
                <th className="px-5 py-3">说话人</th>
                <th className="px-5 py-3">采样率</th>
                <th className="px-5 py-3">时长</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['qwen-audio-3.0-asr-flash-streaming', 'WebSocket', '✓', '✓', '✗', '✗', '任意', '不限'],
                ['fun-asr-realtime', 'WebSocket', '✓', '✗', '✗', '✗', '任意', '不限'],
                ['qwen3-asr-flash-realtime', 'WebSocket', '✗', '✗', '✓', '✗', '8/16k', '不限'],
                ['fun-asr-flash-8k-realtime', 'WebSocket', '✓', '✗', '✗', '✗', '8k', '不限'],
              ].map((row, i) => (
                <tr key={i} className="border-t border-white/5 hover:bg-white/[0.02]">
                  {row.map((cell, j) => (
                    <td key={j} className={cn("px-5 py-3", j === 0 && "font-mono text-sky-300", cell === '✓' && 'text-emerald-400', cell === '✗' && 'text-slate-600')}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { icon: <Brain className="w-5 h-5" />, title: '上下文增强', desc: '通过 corpus_text 注入领域词汇，支持词汇列表 / 自然语言 / 混合内容，10K token 上限', gradient: 'from-sky-500 to-cyan-500' },
          { icon: <Tag className="w-5 h-5" />, title: '热词定制', desc: '带权重的词汇表，权重 1-10，提升专有名词/人名/品牌识别准确率', gradient: 'from-amber-500 to-orange-500' },
          { icon: <Shield className="w-5 h-5" />, title: '敏感词过滤', desc: 'special_word_filter 支持两种模式：filter_with_signed（替换为 *）/ filter_with_empty（移除），最多 32 个', gradient: 'from-rose-500 to-blue-500' },
          { icon: <Network className="w-5 h-5" />, title: '容错策略', desc: '心跳保活 + 断线重连 + 指数退避 + 限流处理，保证长连接稳定', gradient: 'from-cyan-500 to-blue-500' },
          { icon: <Sparkle className="w-5 h-5" />, title: '情绪识别', desc: 'Qwen3-ASR 支持 7 种情绪：惊讶/平静/愉快/悲伤/厌恶/愤怒/恐惧', gradient: 'from-blue-500 to-rose-500' },
          { icon: <Radio className="w-5 h-5" />, title: 'VAD 模式', desc: 'server_vad 自动分句 / 手动模式（commit 触发），支持 threshold 和 silence_duration_ms 调优', gradient: 'from-emerald-500 to-teal-500' },
        ].map((c, i) => (
          <div key={i} className="rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-xl p-5 hover:bg-white/[0.04] transition-colors">
            <div className={cn("w-10 h-10 rounded-xl bg-gradient-to-br text-white flex items-center justify-center mb-3 shadow-lg", c.gradient)}>{c.icon}</div>
            <h3 className="font-bold text-sm mb-1 tracking-tight">{c.title}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">{c.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
