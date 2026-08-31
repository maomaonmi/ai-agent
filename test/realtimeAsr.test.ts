import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInlineAsrConfig, composeRecognitionText } from '../src/features/music/hooks/useRealtimeASR.ts';

test('builds a safe PCM ASR start config for the music composer', () => {
  assert.deepEqual(buildInlineAsrConfig(), {
    model: 'qwen3-asr-flash-realtime',
    audioFormat: 'pcm',
    sampleRate: 16000,
    language: 'auto',
    mode: 'vad',
    heartbeat: true,
  });
});

test('keeps existing prompt text while composing final and interim recognition', () => {
  assert.equal(composeRecognitionText('写一首', ['关于海边的歌'], '副歌要轻快'), '写一首 关于海边的歌 副歌要轻快');
  assert.equal(composeRecognitionText('', [], '你好'), '你好');
});
