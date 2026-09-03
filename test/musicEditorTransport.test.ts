import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaveformPath, buildWaveformValues, formatTransportTime, moveClipWithInsertion, resizeClip, splitClipAtPosition, timelineDurationSeconds } from '../src/features/music/lib/musicEditorTransport.ts';

test('时间线总时长至少覆盖网格，并能覆盖超出网格的片段', () => {
  assert.equal(timelineDurationSeconds([], 120, '4/4', 16), 32);
  assert.equal(timelineDurationSeconds([{ start: 0, duration: 20 }], 120, '4/4', 16), 40);
});

test('播放时间显示为分:秒.十分之一秒', () => {
  assert.equal(formatTransportTime(0), '00:00.0');
  assert.equal(formatTransportTime(65.27), '01:05.3');
});

test('波形路径是可缩放的上下包络闭合路径', () => {
  const path = buildWaveformPath([0.2, 0.8, 0.4]);
  assert.match(path, /^M /);
  assert.match(path, / L /);
  assert.match(path, / Z$/);
});

test('波形采样值保持稳定且包含足够的细节', () => {
  const first = buildWaveformValues(12);
  const second = buildWaveformValues(12);
  assert.deepEqual(first, second);
  assert.equal(first.length, 2200);
  assert.ok(new Set(first.map((value) => value.toFixed(3))).size > 100);
  assert.ok(first.every((value) => value >= 0 && value <= 1));
});

test('右侧拖拽不能超过源音频时长，左侧拖拽保持时间线合法', () => {
  assert.deepEqual(resizeClip({ edge: 'end', startBars: 1, durationBars: 3, deltaBars: 8, maxDurationBars: 5 }), {
    startBars: 1,
    durationBars: 5,
  });
  assert.deepEqual(resizeClip({ edge: 'start', startBars: 1, durationBars: 3, deltaBars: -4 }), {
    startBars: 0,
    durationBars: 4,
  });
  assert.deepEqual(resizeClip({ edge: 'end', startBars: 1, durationBars: 3, deltaBars: -20 }), {
    startBars: 1,
    durationBars: 0.05,
  });
});

test('左右拖拽会裁剪源音频窗口而不是压缩波形', () => {
  assert.deepEqual(resizeClip({
    edge: 'start',
    startBars: 2,
    durationBars: 4,
    deltaBars: 1,
    sourceOffsetSeconds: 2,
    sourceDurationSeconds: 12,
    secondsPerBar: 2,
  }), {
    startBars: 3,
    durationBars: 3,
    sourceOffsetSeconds: 4,
  });
  assert.deepEqual(resizeClip({
    edge: 'end',
    startBars: 2,
    durationBars: 4,
    deltaBars: 8,
    sourceOffsetSeconds: 2,
    sourceDurationSeconds: 12,
    secondsPerBar: 2,
  }), {
    startBars: 2,
    durationBars: 5,
    sourceOffsetSeconds: 2,
  });
  assert.deepEqual(resizeClip({
    edge: 'start',
    startBars: 2,
    durationBars: 4,
    deltaBars: -4,
    sourceOffsetSeconds: 2,
    sourceDurationSeconds: 12,
    secondsPerBar: 2,
  }), {
    startBars: 1,
    durationBars: 5,
    sourceOffsetSeconds: 0,
  });
});

test('跨音轨移动会在目标位置截断原片段而不是覆盖', () => {
  const tracks = moveClipWithInsertion([
    { id: 'source', clips: [{ id: 'moving', start: 1, duration: 2, sourceOffset: 0, sourceDuration: 4 }] },
    { id: 'target', clips: [{ id: 'base', start: 0, duration: 8, sourceOffset: 0, sourceDuration: 16 }] },
  ], 'source', 'moving', 'target', 3, 2);

  assert.ok(tracks);
  assert.deepEqual(tracks?.find((track) => track.id === 'source')?.clips, []);
  const targetClips = tracks?.find((track) => track.id === 'target')?.clips ?? [];
  assert.deepEqual(targetClips.map(({ id, start, duration }) => ({ id, start, duration })), [
    { id: 'base:left', start: 0, duration: 3 },
    { id: 'moving', start: 3, duration: 2 },
    { id: 'base:right', start: 5, duration: 3 },
  ]);
  assert.equal(targetClips.find((clip) => clip.id === 'base:right')?.sourceOffset, 5 * 2);
});

test('按播放头裁剪会拆分时间线和源音频窗口', () => {
  const pieces = splitClipAtPosition(
    { id: 'clip', start: 2, duration: 6, sourceOffset: 1, sourceDuration: 20 },
    5,
    2,
    'clip:left',
    'clip:right',
  );

  assert.deepEqual(pieces.map(({ id, start, duration, sourceOffset, sourceDuration }) => ({
    id, start, duration, sourceOffset, sourceDuration,
  })), [
    { id: 'clip:left', start: 2, duration: 3, sourceOffset: 1, sourceDuration: 20 },
    { id: 'clip:right', start: 5, duration: 3, sourceOffset: 7, sourceDuration: 20 },
  ]);
  assert.deepEqual(splitClipAtPosition(
    { id: 'clip', start: 2, duration: 6 },
    2,
    2,
    'left',
    'right',
  ), [{ id: 'clip', start: 2, duration: 6 }]);
});
