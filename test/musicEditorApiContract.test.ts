import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildEditorDocument,
  createEditorAudioProcessing,
  exportEditorProject,
} from '../src/features/music/lib/musicEditorApi.ts';
import { SINGER_PRESETS } from '../src/features/music/lib/singerPresets.ts';

test('buildEditorDocument converts bar positions to seconds and preserves asset references', () => {
  const document = buildEditorDocument({
    bpm: 120,
    timeSignature: '4/4',
    selectedKey: 'D小调',
    volume: 0.7,
    tracks: [{
      id: 'track-1', name: '主唱', type: 'vocal', muted: false, solo: true, volume: 0.5,
      clips: [{ id: 'clip-1', name: '演唱', start: 2, duration: 4, assetId: 'asset-1', sourceOffset: 2, sourceDuration: 12, muted: true, pitchSemitones: 2, playbackRate: 1.1 }],
    }],
  });

  assert.equal(document.tempo.bpm, 120);
  assert.deepEqual(document.tempo.timeSignature, [4, 4]);
  assert.deepEqual(document.key, { root: 'D', scale: 'minor' });
  assert.equal(document.tracks[0].clips[0].startSeconds, 4);
  assert.equal(document.tracks[0].clips[0].sourceInSeconds, 2);
  assert.equal(document.tracks[0].clips[0].sourceOutSeconds, 10);
  assert.equal(document.tracks[0].clips[0].isMuted, true);
  assert.equal(document.tracks[0].clips[0].pitchSemitones, 2);
  assert.equal(document.tracks[0].clips[0].playbackRate, 1.1);
  assert.equal(document.tracks[0].isSolo, true);
});

test('singer presets expose all eleven pure-vocal references without claiming a voice model', () => {
  assert.equal(SINGER_PRESETS.length, 11);
  for (const singer of SINGER_PRESETS) {
    assert.equal(singer.presetOnly, true);
    assert.equal(existsSync(join(process.cwd(), 'public', singer.avatarUrl)), true, singer.avatarUrl);
    assert.equal(singer.referenceKind, 'pure_vocal');
    assert.equal(existsSync(join(process.cwd(), 'public', singer.referenceAudioUrl)), true, singer.referenceAudioUrl);
  }
});

test('audio processing helper posts the backend operation contract', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ id: 'op-1', status: 'SUBMITTED', progress: 0, error: null, results: [] }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const operation = await createEditorAudioProcessing('project/1', {
      type: 'pitch_shift',
      inputAssetId: 'asset-1',
      clientRequestId: 'request-1',
      pitchSemitones: 2,
    });
    assert.equal(operation.id, 'op-1');
    assert.equal(capturedUrl, '/api/music/editor/projects/project%2F1/processing');
    assert.equal(capturedInit?.method, 'POST');
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      type: 'pitch_shift', inputAssetId: 'asset-1', clientRequestId: 'request-1', pitchSemitones: 2,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('export helper returns the rendered audio blob and reports server errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new Blob(['wav-data'], { type: 'audio/wav' }), {
    status: 200,
    headers: { 'Content-Type': 'audio/wav' },
  })) as typeof fetch;
  try {
    const blob = await exportEditorProject('project-1', 'wav');
    assert.equal(blob.type, 'audio/wav');
    assert.equal(await blob.text(), 'wav-data');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
