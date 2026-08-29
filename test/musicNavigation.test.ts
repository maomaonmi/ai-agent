import assert from 'node:assert/strict';
import test from 'node:test';
import { musicComposeSessionUrl, musicCreationDraftUrl } from '../src/features/music/musicNavigation.ts';

test('conversation links keep the session id when opening the shared sidebar item', () => {
  assert.equal(musicComposeSessionUrl('session/a b'), '/music/compose?session=session%2Fa%20b');
});

test('creation links carry the lyric document session id', () => {
  assert.equal(musicCreationDraftUrl('lyric-123'), '/music/music-creation?lyricsSession=lyric-123');
});
