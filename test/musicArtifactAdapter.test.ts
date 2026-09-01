import assert from 'node:assert/strict';
import test from 'node:test';

import { createMusicArtifactInput, isMusicGenerationCommand, readMusicArtifactPayload } from '../src/features/omni/musicArtifactAdapter.ts';

test('creates an editable lyrics-stage music artifact', () => {
  const input = createMusicArtifactInput({
    messageId: 'message-1',
    title: '夜航',
    lyrics: '[Verse]\n城市向后退',
    instruction: '轻柔女声，钢琴和弦乐',
  });

  assert.equal(input.kind, 'music');
  assert.equal(input.status, 'draft');
  assert.equal(input.sourceRef.type, 'music_task');
  assert.deepEqual(readMusicArtifactPayload(input.payload), {
    schemaVersion: 1,
    stage: 'lyrics',
    title: '夜航',
    lyrics: '[Verse]\n城市向后退',
    instruction: '轻柔女声，钢琴和弦乐',
    style: '',
    task: null,
  });
});

test('rejects malformed music artifact payloads', () => {
  assert.equal(readMusicArtifactPayload({ stage: 'lyrics', lyrics: 42 }), null);
});

test('recognizes generation commands without treating ordinary style revisions as generation', () => {
  assert.equal(isMusicGenerationCommand('按这个版本生成音乐'), true);
  assert.equal(isMusicGenerationCommand('开始作曲吧'), true);
  assert.equal(isMusicGenerationCommand('副歌更克制一些，加入钢琴'), false);
});
