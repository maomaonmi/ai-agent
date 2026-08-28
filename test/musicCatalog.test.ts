import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { MUSIC_TRACKS, filterTracks, type MusicTrack } from '../src/features/music/musicCatalog.ts';

// Why: 清单 cover 路径必须与 public 资产逐一一致（design R6/T1.2），防止 404 破图。
test('music catalog covers all real assets under public/music/cover', () => {
  const coverDir = path.resolve(import.meta.dirname, '../public/music/cover');
  const assetIds = readdirSync(coverDir)
    .filter((name) => name.endsWith('.jpeg'))
    .map((name) => name.replace(/\.jpeg$/, ''))
    .sort();
  const catalogIds = MUSIC_TRACKS.map((track) => track.id).sort();
  assert.deepEqual(catalogIds, assetIds);
  assert.equal(MUSIC_TRACKS.length, 50);
});

test('filterTracks returns matching subset for each tag', () => {
  const featured = filterTracks('featured');
  const remix = filterTracks('remix');
  const accompaniment = filterTracks('accompaniment');
  assert.equal(featured.length + remix.length + accompaniment.length, MUSIC_TRACKS.length);
  assert.ok(featured.every((track) => track.tag === 'featured'));
  // Why: 用户确认 50 图顺序轮转均分三标签 → 17/17/16。
  assert.equal(featured.length, 17);
  assert.equal(remix.length, 17);
  assert.equal(accompaniment.length, 16);
});

test('filterTracks returns empty array for empty catalog without throwing', () => {
  assert.deepEqual(filterTracks('featured', []), []);
});

test('filterTracks returns empty array when no track matches the tag', () => {
  const onlyFeatured: MusicTrack[] = MUSIC_TRACKS.filter((track) => track.tag === 'featured');
  assert.deepEqual(filterTracks('remix', onlyFeatured), []);
});
