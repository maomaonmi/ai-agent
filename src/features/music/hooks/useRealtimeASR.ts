'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type RealtimeASRStatus = 'idle' | 'connecting' | 'listening' | 'stopping' | 'error';

export function buildInlineAsrConfig() {
  return {
    model: 'qwen3-asr-flash-realtime',
    audioFormat: 'pcm',
    sampleRate: 16000,
    language: 'auto',
    mode: 'vad',
    vadThreshold: 0.08,
    vadSilenceMs: 900,
    heartbeat: true,
  } as const;
}

export function composeRecognitionText(baseText: string, finalParts: string[], interimText: string): string {
  return [baseText.trim(), ...finalParts.map(part => part.trim()).filter(Boolean), interimText.trim()]
    .filter(Boolean)
    .join(' ');
}

interface RealtimeASROptions {
  baseText: string;
  onText: (text: string) => void;
}

function floatToPCM(input: Float32Array, sourceRate: number, targetRate = 16000): ArrayBuffer {
  const ratio = sourceRate / targetRate;
  const pcm = new Int16Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let index = 0; index < pcm.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) sum += input[sampleIndex];
    const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm.buffer;
}

export function useRealtimeASR({ baseText, onText }: RealtimeASROptions) {
  const [status, setStatus] = useState<RealtimeASRStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const inputGainRef = useRef<GainNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const baseTextRef = useRef(baseText);
  const finalPartsRef = useRef<string[]>([]);
  const finishSentRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const readyRef = useRef(false);
  const onTextRef = useRef(onText);

  useEffect(() => { onTextRef.current = onText; }, [onText]);

  const cleanup = useCallback(() => {
    try { processorRef.current?.disconnect(); } catch { /* already disconnected */ }
    try { inputGainRef.current?.disconnect(); } catch { /* already disconnected */ }
    try { sourceRef.current?.disconnect(); } catch { /* already disconnected */ }
    try { sinkRef.current?.disconnect(); } catch { /* already disconnected */ }
    processorRef.current = null;
    inputGainRef.current = null;
    sourceRef.current = null;
    sinkRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current.close();
      socketRef.current = null;
    }
    if (contextRef.current) void contextRef.current.close();
    contextRef.current = null;
    setVolume(0);
  }, []);

  const stop = useCallback(() => {
    cancelRequestedRef.current = true;
    const socket = socketRef.current;
    if (!socket) { cleanup(); setStatus('idle'); return; }
    setStatus('stopping');
    finishSentRef.current = true;
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'finish' }));
    window.setTimeout(() => { cleanup(); setStatus('idle'); }, 1200);
  }, [cleanup]);

  const start = useCallback(async () => {
    if (status === 'connecting' || status === 'listening') return;
    cancelRequestedRef.current = false;
    setError(null); setStatus('connecting'); baseTextRef.current = baseText; finalPartsRef.current = []; finishSentRef.current = false; readyRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (cancelRequestedRef.current) { stream.getTracks().forEach(track => track.stop()); setStatus('idle'); return; }
      streamRef.current = stream;
      const context = new AudioContext();
      contextRef.current = context;
      if (context.state === 'suspended') await context.resume();
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${scheme}//${window.location.host}/ws/asr/stream`);
      socket.binaryType = 'arraybuffer'; socketRef.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: 'start', config: buildInlineAsrConfig() }));
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as { type: string; text?: string; final?: boolean; message?: string };
        if (message.type === 'ready') {
          readyRef.current = true;
          const source = context.createMediaStreamSource(stream);
          const inputGain = context.createGain();
          // Browser AGC varies significantly by device. A moderate software gain
          // makes normal-distance speech usable without heavily amplifying noise.
          inputGain.gain.value = 2.25;
          const processor = context.createScriptProcessor(4096, 1, 1);
          const sink = context.createGain(); sink.gain.value = 0;
          processor.onaudioprocess = audioEvent => {
            if (socket.readyState !== WebSocket.OPEN || finishSentRef.current) return;
            const input = audioEvent.inputBuffer.getChannelData(0);
            let sum = 0;
            for (let index = 0; index < input.length; index += 1) sum += Math.abs(input[index]);
            setVolume(Math.min(100, Math.round((sum / input.length) * 260)));
            socket.send(floatToPCM(input, context.sampleRate));
          };
          source.connect(inputGain); inputGain.connect(processor); processor.connect(sink); sink.connect(context.destination);
          sourceRef.current = source; inputGainRef.current = inputGain; processorRef.current = processor; sinkRef.current = sink;
          setStatus('listening');
        } else if (message.type === 'transcript') {
          const text = message.text || '';
          if (message.final && text.trim()) finalPartsRef.current = [...finalPartsRef.current, text];
          onTextRef.current(composeRecognitionText(baseTextRef.current, finalPartsRef.current, message.final ? '' : text));
        } else if (message.type === 'finished') {
          cleanup(); setStatus('idle');
        } else if (message.type === 'error') {
          setError(message.message || '语音识别失败'); cleanup(); setStatus('error');
        }
      };
      socket.onerror = () => { setError('无法连接语音识别服务'); cleanup(); setStatus('error'); };
      socket.onclose = () => {
        if (!readyRef.current && !finishSentRef.current) {
          setError('语音识别服务未完成会话初始化'); setStatus('error');
        } else if (status !== 'stopping') setStatus('idle');
      };
    } catch (reason) {
      cleanup(); setStatus('error'); setError(reason instanceof Error ? reason.message : '麦克风启动失败');
    }
  }, [baseText, cleanup, status]);

  useEffect(() => () => cleanup(), [cleanup]);
  return { start, stop, status, error, volume, isListening: status === 'listening' };
}
