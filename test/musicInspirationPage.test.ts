import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/features/music/components/MusicInspirationPage.tsx', import.meta.url), 'utf8');

test('music inspiration page surfaces provider errors instead of saving an empty lyric draft', () => {
  assert.match(source, /let streamError = ''/);
  assert.match(source, /onError: \(event\) => \{ streamError = event\.message; \}/);
  assert.match(source, /if \(streamError\) throw new Error\(streamError\)/);
  assert.match(source, /if \(!parsed\.lyrics\.trim\(\)\) throw new Error/);
});
