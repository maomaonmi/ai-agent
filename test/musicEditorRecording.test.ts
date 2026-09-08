import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculatePeakDb,
  calculateRmsDb,
  meterColorFromDb,
  meterDisplayLevel,
  meterLevelFromDb,
  normalizeCountInBars,
  selectAudioInputDevices,
  visualMeterLevelFromDb,
} from '../src/features/music/lib/musicEditorRecording.ts';

test('RMS meter follows real waveform amplitude in dBFS', () => {
  assert.equal(calculateRmsDb(new Float32Array([0, 0, 0])), -60);
  assert.ok(calculateRmsDb(new Float32Array([0.5, -0.5])) < 0);
  assert.ok(calculateRmsDb(new Float32Array([1, -1])) > calculateRmsDb(new Float32Array([0.5, -0.5])));
  assert.equal(meterLevelFromDb(-60), 0);
  assert.equal(meterLevelFromDb(0), 1);
});

test('visual meter expands quiet levels without changing the real dB reading', () => {
  assert.equal(visualMeterLevelFromDb(-60), 0);
  assert.equal(visualMeterLevelFromDb(0), 1);
  assert.ok(visualMeterLevelFromDb(-45) > meterLevelFromDb(-45));
  assert.ok(visualMeterLevelFromDb(-45) - visualMeterLevelFromDb(-50) > meterLevelFromDb(-45) - meterLevelFromDb(-50));
});

test('peak meter follows the highest real sample and respects the floor', () => {
  assert.equal(calculatePeakDb(new Float32Array([0, 0, 0])), -60);
  assert.ok(calculatePeakDb(new Float32Array([0.25, -0.5])) > calculatePeakDb(new Float32Array([0.1, -0.1])));
  assert.equal(calculatePeakDb(new Float32Array([1, -1])), 0);
});

test('meter fill keeps a visible status color for every real level', () => {
  assert.equal(meterColorFromDb(-35), '#10b981');
  assert.equal(meterColorFromDb(-12), '#fbbf24');
  assert.equal(meterColorFromDb(-3), '#f43f5e');
});

test('meter display uses one aligned edge for current and held peak levels', () => {
  assert.equal(meterDisplayLevel(0.42, 0.68), 0.68);
  assert.equal(meterDisplayLevel(0.82, 0.68), 0.82);
  assert.equal(meterDisplayLevel(-1, 2), 1);
});

test('audio input enumeration keeps only microphones and preserves labels', () => {
  const devices = selectAudioInputDevices([
    { kind: 'audioinput', deviceId: 'default', label: '默认麦克风' },
    { kind: 'audiooutput', deviceId: 'speaker', label: '扬声器' },
    { kind: 'audioinput', deviceId: 'headset', label: '耳机麦克风' },
  ]);
  assert.deepEqual(devices, [
    { deviceId: 'default', label: '默认麦克风' },
    { deviceId: 'headset', label: '耳机麦克风' },
  ]);
});

test('count-in only allows off, one bar, or two bars', () => {
  assert.equal(normalizeCountInBars(0), 0);
  assert.equal(normalizeCountInBars(1), 1);
  assert.equal(normalizeCountInBars(2), 2);
  assert.equal(normalizeCountInBars(3), 0);
});
