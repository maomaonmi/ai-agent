import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/features/omni/MusicOmniWorkspace.tsx', import.meta.url), 'utf8');

test('music workspace keeps lyrics editable and exposes preset instructions', () => {
  assert.match(source, /aria-label="编辑歌词"/);
  assert.match(source, /STYLE_PRESETS/);
  assert.match(source, /INSTRUMENT_PRESETS/);
  assert.match(source, /aria-label="音乐创作指令"/);
});

test('music workspace generates and streams a Suno task with artwork-backed results', () => {
  assert.match(source, /generateSunoMusic/);
  assert.match(source, /openSunoTaskStream/);
  assert.match(source, /resolveSunoAssetUrl\(.*image_url/);
  assert.match(source, /opacity-20/);
});
