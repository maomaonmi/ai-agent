import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VOCAL_EFFECTS,
  buildVocalEffectParameters,
  clampVocalEffectIntensity,
  listVocalEffects,
  vocalEffectIntensityFromAngle,
} from '../src/features/music/lib/musicEditorVocalEffects.ts';

test('vocal effect catalog covers every editor category with stable unique ids', () => {
  const ids = VOCAL_EFFECTS.map((effect) => `${effect.category}:${effect.id}`);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(listVocalEffects('recommend').length, 6);
  assert.equal(listVocalEffects('enhance').length, 4);
  assert.equal(listVocalEffects('special').length, 4);
  assert.equal(listVocalEffects('style').length, 5);
  assert.ok(VOCAL_EFFECTS.every((effect) => effect.description.length > 0 && effect.backendPreset.length > 0));
});

test('effect intensity is clamped to button-friendly percentage values', () => {
  assert.equal(clampVocalEffectIntensity(-10), 0);
  assert.equal(clampVocalEffectIntensity(150), 100);
  assert.equal(clampVocalEffectIntensity(62.4), 62);
  assert.equal(clampVocalEffectIntensity(Number.NaN), 100);
});

test('effect parameters contain an allowlisted preset id and normalized intensity', () => {
  const parameters = buildVocalEffectParameters('rap', 75);
  assert.deepEqual(parameters, { effectId: 'rap', intensity: 75 });
  assert.throws(() => buildVocalEffectParameters('not-allowed', 50), /不支持/);
});

test('dial angle maps continuously to one-percent intensity steps', () => {
  assert.equal(vocalEffectIntensityFromAngle(135), 0);
  assert.equal(vocalEffectIntensityFromAngle(45), 100);
  assert.equal(vocalEffectIntensityFromAngle(270), 50);
  assert.equal(vocalEffectIntensityFromAngle(0), 83);
  assert.equal(vocalEffectIntensityFromAngle(180), 17);
});
