import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MINIMAX_VOICE_CLONE_MODEL,
  MINIMAX_VOICE_CLONE_MODELS,
  QWEN_VOICE_CLONE_MODELS,
} from '../src/features/music/voiceCloneModels.ts';

test('exposes every MiniMax model supported by voice cloning', () => {
  assert.deepEqual(
    MINIMAX_VOICE_CLONE_MODELS.map((model) => model.id),
    [
      'speech-2.8-hd',
      'speech-2.8-turbo',
      'speech-2.6-hd',
      'speech-2.6-turbo',
      'speech-02-hd',
      'speech-02-turbo',
      'speech-01-hd',
      'speech-01-turbo',
    ],
  );
  assert.equal(DEFAULT_MINIMAX_VOICE_CLONE_MODEL, 'speech-2.8-hd');
  assert.ok(MINIMAX_VOICE_CLONE_MODELS.every((model) => model.label.length > 0));
});

test('keeps the existing Qwen voice-clone models available', () => {
  assert.deepEqual(
    QWEN_VOICE_CLONE_MODELS.map((model) => model.id),
    [
      'qwen3-tts-vc-realtime-2026-01-15',
      'qwen3-tts-vc-realtime-2025-11-27',
    ],
  );
});
