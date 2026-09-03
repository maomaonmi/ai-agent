import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/features/omni/MusicOmniWorkspace.tsx', import.meta.url), 'utf8');

test('music workspace keeps lyrics editable and exposes preset instructions', () => {
  assert.match(source, /aria-label="编辑歌词"/);
  assert.match(source, /STYLE_PRESETS/);
  assert.match(source, /INSTRUMENT_PRESETS/);
  assert.match(source, /aria-label="音乐创作指令"/);
  assert.match(source, /aria-label="音乐生成进度"/);
  assert.match(source, /aria-label="音乐生成结果"/);
  assert.match(source, /task\.progress/);
});

test('music workspace submits a Suno task and reports the completed result to the conversation', () => {
  assert.match(source, /generateSunoMusic/);
  assert.match(source, /openSunoTaskStream/);
  assert.match(source, /onGenerated/);
  assert.match(source, /音乐生成完成/);
  assert.match(source, /setView\('result'\)/);
});

test('music result uses the shared custom audio player instead of browser-native controls', () => {
  assert.match(source, /MusicAudioPlayer/);
  assert.doesNotMatch(source, /<audio[^>]+controls/);
});
