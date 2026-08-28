import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMusicAgentPrompt, musicSessionTitle, parseMusicDraft } from '../src/features/music/musicInspiration.ts';

test('parses the structured lyric document returned by the music agent', () => {
  const result = parseMusicDraft('<title>时间的回声</title><note>温暖叙事</note><lyrics>[Verse 1]\n钟摆向前</lyrics>');
  assert.equal(result.title, '时间的回声');
  assert.equal(result.note, '温暖叙事');
  assert.match(result.lyrics, /\[Verse 1\]/);
});

test('music prompt forbids web tools and keeps a stable output contract', () => {
  const prompt = buildMusicAgentPrompt('时间');
  assert.match(prompt, /不要联网/);
  assert.match(prompt, /<lyrics>/);
  assert.match(prompt, /用户灵感：时间/);
  assert.equal(musicSessionTitle('我想写一首关于时间流逝与成长的歌曲'), '我想写一首关于时间流逝与成长的歌曲');
});
