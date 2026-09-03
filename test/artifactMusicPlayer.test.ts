import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/features/omni/ArtifactMessageCard.tsx', import.meta.url), 'utf8');
const playerSource = readFileSync(new URL('../src/features/omni/MusicAudioPlayer.tsx', import.meta.url), 'utf8');

test('music artifact cards use the shared player and fill the available card width', () => {
  assert.match(source, /MusicAudioPlayer/);
  assert.match(source, /artifact\.kind === 'music'/);
  assert.match(source, /max-w-none/);
  assert.doesNotMatch(source, /<audio[^>]+controls/);
});

test('custom music player keeps playback and seeking keyboard-accessible', () => {
  assert.match(playerSource, /type="range"/);
  assert.match(playerSource, /调整\$\{title\}播放进度/);
  assert.match(playerSource, /onTimeUpdate/);
  assert.match(playerSource, /aria-label=\{playing \? `暂停\$\{title\}` : `播放\$\{title\}`\}/);
});
