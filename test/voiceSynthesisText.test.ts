import assert from 'node:assert/strict';
import test from 'node:test';

import { stripVoiceControlTags } from '../src/features/music/voiceSynthesisText.ts';

test('removes editor-only pause and expression markers before TTS', () => {
  assert.equal(
    stripVoiceControlTags('你好 (开心) <#0.5#> 世界 (轻笑)'),
    '你好 世界',
  );
});

test('does not remove ordinary parenthesized user content', () => {
  assert.equal(stripVoiceControlTags('请读出 (第一段) 内容'), '请读出 (第一段) 内容');
});

