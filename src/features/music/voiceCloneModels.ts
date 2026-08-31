export const MINIMAX_VOICE_CLONE_MODELS = [
  { id: 'speech-2.8-hd', label: 'Speech 2.8 HD' },
  { id: 'speech-2.8-turbo', label: 'Speech 2.8 Turbo' },
  { id: 'speech-2.6-hd', label: 'Speech 2.6 HD' },
  { id: 'speech-2.6-turbo', label: 'Speech 2.6 Turbo' },
  { id: 'speech-02-hd', label: 'Speech 02 HD' },
  { id: 'speech-02-turbo', label: 'Speech 02 Turbo' },
  { id: 'speech-01-hd', label: 'Speech 01 HD' },
  { id: 'speech-01-turbo', label: 'Speech 01 Turbo' },
] as const;

export const DEFAULT_MINIMAX_VOICE_CLONE_MODEL = MINIMAX_VOICE_CLONE_MODELS[0].id;

export const QWEN_VOICE_CLONE_MODELS = [
  { id: 'qwen3-tts-vc-realtime-2026-01-15', label: 'Qwen3-TTS-VC（最新）' },
  { id: 'qwen3-tts-vc-realtime-2025-11-27', label: 'Qwen3-TTS-VC（2025-11）' },
] as const;
