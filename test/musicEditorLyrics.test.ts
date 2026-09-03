import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLyricsPolishPrompt,
  countLyricsSeedCharacters,
  targetLyricsCharacters,
} from '../src/features/music/lib/musicEditorLyrics.ts';

test('歌词扩展长度随输入长度增长并受上下限约束', () => {
  assert.equal(countLyricsSeedCharacters('  毕业  '), 2);
  assert.equal(targetLyricsCharacters('毕业'), 80);
  assert.equal(targetLyricsCharacters('毕业的夏天和未说出口的告别'), 104);
  assert.equal(targetLyricsCharacters('a'.repeat(100)), 500);
  assert.equal(targetLyricsCharacters(''), 0);
});

test('歌词提示词包含原始主题和可执行的输出约束', () => {
  const prompt = buildLyricsPolishPrompt('毕业');
  assert.match(prompt, /原始输入：毕业/);
  assert.match(prompt, /约 80 字/);
  assert.match(prompt, /只输出歌词正文/);
});
