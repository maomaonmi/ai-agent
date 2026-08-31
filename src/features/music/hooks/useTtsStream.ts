'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type TtsStreamState =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'completed'
  | 'error';

export interface TtsStartParams {
  voiceId: string;
  provider?: 'qwen' | 'minimax' | string;
  model?: string;
  format?: 'wav' | 'mp3' | 'pcm';
  speed?: number;
  pitch?: number;
  volume?: number;
  instruction?: string;
  ssml?: boolean;
  latex?: boolean;
}

export interface TtsStreamMeta {
  sessionId: string;
  mimeType: string;
  sampleRate: number;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// 单个片段上限（远低于后端 20000 字符上限，留足余量）
const MAX_CHUNK_CHARS = 2000;

function pcm24MonoToWav(pcm: ArrayBuffer, sampleRate = 24000): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  const dataLength = pcm.byteLength;
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataLength, true);
  return new Blob([header, pcm], { type: 'audio/wav' });
}

// 服务端 JSON 控制帧（与 music_api.py handle_tts_stream_websocket 协议一一对应）
interface ServerMessage {
  type: string;
  session_id?: string;
  mime_type?: string;
  sample_rate?: number;
  message?: string;
  code?: string;
  total_bytes?: number;
  dropped_chunks?: number;
}

// Why: Next.js rewrites 只代理 HTTP 请求，WebSocket 升级不会被转发（与 IntegratedTerminal 同理），
// 所以必须直连后端端口，不能依赖当前页面 host。
function buildWebSocketUrl(): string {
  const wsProto = API_BASE_URL.startsWith('https') ? 'wss:' : 'ws:';
  const url = new URL(API_BASE_URL);
  return `${wsProto}//${url.host}/ws/tts/stream`;
}

// 按 code point 切分长文本（避免 UTF-16 代理对 emoji 被切断）
function splitText(text: string): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += MAX_CHUNK_CHARS) {
    chunks.push(chars.slice(i, i + MAX_CHUNK_CHARS).join(''));
  }
  return chunks;
}

export interface TtsStreamControls {
  state: TtsStreamState;
  error: string | null;
  warnings: string[];
  meta: TtsStreamMeta | null;
  totalBytes: number;
  droppedChunks: number;
  audioUrl: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  /** 一次完整会话：start → text(分段) → complete，完成后 audioUrl 就绪 */
  synthesize: (params: TtsStartParams, text: string) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setMuted: (muted: boolean) => void;
  replay: () => void;
}

export function useTtsStream(): TtsStreamControls {
  const [state, setState] = useState<TtsStreamState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [meta, setMeta] = useState<TtsStreamMeta | null>(null);
  const [totalBytes, setTotalBytes] = useState(0);
  const [droppedChunks, setDroppedChunks] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('audio/mpeg');
  const sampleRateRef = useRef(24000);
  const objectUrlRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const closeSocket = useCallback((ws: WebSocket | null) => {
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
  }, []);

  const revokeAudioUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    closeSocket(wsRef.current);
    wsRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    audioRef.current = null;
    revokeAudioUrl();
    chunksRef.current = [];
    mimeTypeRef.current = 'audio/mpeg';
    sampleRateRef.current = 24000;
    setState('idle');
    setError(null);
    setWarnings([]);
    setMeta(null);
    setTotalBytes(0);
    setDroppedChunks(0);
    setAudioUrl(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [closeSocket, revokeAudioUrl]);

  // 把累积的音频块合并为可播放的 ObjectURL
  const finalizeAudio = useCallback(async () => {
    const mimeType = mimeTypeRef.current;
    const blob = new Blob(chunksRef.current, { type: mimeType });
    const playableBlob = mimeType === 'audio/pcm'
      ? pcm24MonoToWav(await blob.arrayBuffer(), sampleRateRef.current)
      : blob;
    revokeAudioUrl();
    const url = URL.createObjectURL(playableBlob);
    objectUrlRef.current = url;
    setAudioUrl(url);
  }, [revokeAudioUrl]);

  const synthesize = useCallback(
    (params: TtsStartParams, text: string): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const finishOk = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const finishErr = (reason: Error) => {
          if (settled) return;
          settled = true;
          setError(reason.message);
          setState('error');
          reject(reason);
        };

        reset();
        setState('connecting');

        const ws = new WebSocket(buildWebSocketUrl());
        ws.binaryType = 'blob';
        wsRef.current = ws;
        mimeTypeRef.current =
          params.format === 'wav'
            ? 'audio/wav'
            : params.format === 'pcm'
              ? 'audio/pcm'
              : 'audio/mpeg';

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: 'start',
              voice_id: params.voiceId,
              provider: params.provider,
              model: params.model,
              format: params.format || 'mp3',
              speed: params.speed,
              pitch: params.pitch,
              volume: params.volume,
              instruction: params.instruction,
              ssml: params.ssml,
              latex: params.latex,
            }),
          );
        };

        ws.onmessage = (evt: MessageEvent) => {
          if (typeof evt.data === 'string') {
            let msg: ServerMessage;
            try {
              msg = JSON.parse(evt.data) as ServerMessage;
            } catch {
              finishErr(new Error('解析服务端消息失败'));
              return;
            }

            switch (msg.type) {
              case 'started':
                setMeta((prev) => ({
                  sessionId: msg.session_id ?? prev?.sessionId ?? '',
                  mimeType: mimeTypeRef.current,
                  sampleRate: msg.sample_rate ?? 24000,
                }));
                setState('streaming');
                // 收到 started 后立刻分批发送文本，再发送 complete
                for (const chunk of splitText(text)) {
                  if (!chunk) continue;
                  ws.send(JSON.stringify({ type: 'text', content: chunk }));
                }
                ws.send(JSON.stringify({ type: 'complete' }));
                break;
              case 'meta':
                if (msg.mime_type) mimeTypeRef.current = msg.mime_type;
                if (msg.sample_rate) sampleRateRef.current = msg.sample_rate;
                setMeta((prev) => ({
                  sessionId: prev?.sessionId ?? '',
                  mimeType: msg.mime_type ?? prev?.mimeType ?? mimeTypeRef.current,
                  sampleRate: msg.sample_rate ?? prev?.sampleRate ?? 24000,
                }));
                break;
              case 'warning':
                setWarnings((prev) => (msg.message ? [...prev, msg.message] : prev));
                break;
              case 'completed':
                setTotalBytes(
                  msg.total_bytes ?? chunksRef.current.reduce((s, b) => s + b.size, 0),
                );
                setDroppedChunks(msg.dropped_chunks ?? 0);
                void finalizeAudio()
                  .then(() => {
                    setState('completed');
                    closeSocket(ws);
                    finishOk();
                  })
                  .catch((reason: unknown) => {
                    finishErr(reason instanceof Error ? reason : new Error('音频封装失败'));
                  });
                break;
              case 'error':
                finishErr(new Error(msg.message ?? msg.code ?? '语音合成失败'));
                break;
            }
          } else if (evt.data instanceof Blob) {
            chunksRef.current.push(evt.data);
            setTotalBytes((prev) => prev + evt.data.size);
          }
        };

        ws.onerror = () => {
          finishErr(new Error('WebSocket 连接错误，请检查后端服务是否已启动'));
        };

        ws.onclose = () => {
          wsRef.current = null;
          // 未正常完成就断开：视为异常（已完成/出错状态不受影响）
          setState((prev) => {
            if (prev === 'connecting' || prev === 'streaming') {
              return 'error';
            }
            return prev;
          });
          if (!settled) {
            finishErr(new Error('连接提前断开，合成未完成'));
          }
        };
      });
    },
    [reset, finalizeAudio, closeSocket],
  );

  const cancel = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'cancel' }));
      } catch {
        /* noop */
      }
    }
    reset();
  }, [reset]);

  // 音频就绪后统一创建/绑定播放元素（进度、播放状态）
  useEffect(() => {
    if (!audioUrl) {
      audioRef.current = null;
      return;
    }
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.onloadedmetadata = () => setDuration(audio.duration);
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime);
    audio.onplay = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [audioUrl]);

  // 卸载兜底：释放 socket 与 ObjectURL
  useEffect(() => {
    return () => {
      closeSocket(wsRef.current);
      wsRef.current = null;
      revokeAudioUrl();
    };
  }, [closeSocket, revokeAudioUrl]);

  const play = useCallback(() => {
    audioRef.current?.play().catch(() => {});
  }, []);
  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, []);
  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  }, []);
  const setPlaybackSpeed = useCallback((speed: number) => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, []);
  const setMuted = useCallback((muted: boolean) => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, []);
  const replay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    audio.play().catch(() => {});
  }, []);

  return {
    state,
    error,
    warnings,
    meta,
    totalBytes,
    droppedChunks,
    audioUrl,
    isPlaying,
    currentTime,
    duration,
    synthesize,
    cancel,
    reset,
    play,
    pause,
    togglePlay,
    seek,
    setPlaybackSpeed,
    setMuted,
    replay,
  };
}
