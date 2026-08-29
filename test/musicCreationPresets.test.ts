import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTRUMENT_PRESETS, STYLE_PRESETS, composeMusicStyle, referenceAudioLimitSeconds } from '../src/features/music/musicCreationPresets.ts';

test('music creation exposes broad style and instrument presets', () => {
  assert.ok(STYLE_PRESETS.length >= 18);
  assert.ok(INSTRUMENT_PRESETS.length >= 12);
});

test('style composer deduplicates selected presets', () => {
  assert.equal(composeMusicStyle('民谣', ['民谣', '温暖'], ['木吉他']), '民谣, 温暖, 木吉他');
});

test('reference audio duration follows the documented model limits', () => {
  assert.equal(referenceAudioLimitSeconds('V4_5ALL'), 60);
  assert.equal(referenceAudioLimitSeconds('V5'), 480);
});
