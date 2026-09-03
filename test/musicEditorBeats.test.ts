import test from 'node:test';
import assert from 'node:assert/strict';
import { BEAT_PRESETS } from '../src/features/music/lib/musicEditorBeats.ts';

test('Beats 清单与 bgm_pack 的 20 个音频和封面一一对应', () => {
  assert.equal(BEAT_PRESETS.length, 20);
  assert.equal(BEAT_PRESETS[0].audioUrl, '/music/AI_Editor/bgm_pack/audio/01_iron_will.mp3');
  assert.equal(BEAT_PRESETS[19].coverUrl, '/music/AI_Editor/bgm_pack/cover/DM_20260902180811_020.jpg');
  assert.ok(BEAT_PRESETS.every((beat) => beat.audioUrl.endsWith('.mp3') && beat.coverUrl.endsWith('.jpg')));
  assert.ok(BEAT_PRESETS.every((beat) => beat.bpm > 0 && beat.durationSeconds > 0));
});
