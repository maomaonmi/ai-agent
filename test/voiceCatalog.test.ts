import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { normalizeVoices, VOICE_AVATAR_FILES } from '../src/features/music/voiceCatalog.ts';

test('normalizes API snake_case fields and assigns avatar files by response order', () => {
  const voices = normalizeVoices([
    {
      voice_id: 'voice-a',
      model: 'qwen-tts',
      name: '音色 A',
      description: '测试音色',
      tags: ['中文'],
      is_hot: true,
      is_new: false,
      is_premium: false,
    },
  ]);

  assert.equal(voices[0].voiceId, 'voice-a');
  assert.equal(voices[0].isHot, true);
  assert.equal(voices[0].avatar, `/music/Minimax/${VOICE_AVATAR_FILES[0]}`);
});

test('voice avatar manifest follows the image folder filename order', () => {
  const avatarDir = path.resolve(import.meta.dirname, '../public/music/Minimax');
  const folderImages = readdirSync(avatarDir)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));

  assert.deepEqual(VOICE_AVATAR_FILES, folderImages);
});
