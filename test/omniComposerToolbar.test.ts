import assert from 'node:assert/strict';
import test from 'node:test';

import {
  capabilityUsesTaskRoute,
  OMNI_COMPOSER_CAPABILITIES,
  nextCapabilityMode,
  selectPreferredCapability,
} from '../src/features/omni/composerCapabilities.ts';

test('全能模式下的图片、视频和 PPT 意图走专项任务路由', () => {
  assert.equal(capabilityUsesTaskRoute('image', 'omni'), true);
  assert.equal(capabilityUsesTaskRoute('video', 'omni'), true);
  assert.equal(capabilityUsesTaskRoute('ppt', 'omni'), true);
  assert.equal(capabilityUsesTaskRoute('writing', 'omni'), false);
  assert.equal(capabilityUsesTaskRoute('image', 'research'), false);
});

test('全能输入区按确认顺序声明创作能力，并保持单选意图', () => {
  assert.deepEqual(
    OMNI_COMPOSER_CAPABILITIES.map((item) => item.id),
    ['omni', 'ppt', 'music', 'writing', 'image', 'video', 'research'],
  );
  assert.equal(selectPreferredCapability('image', 'video'), 'video');
  assert.equal(selectPreferredCapability('video', 'video'), 'omni');
});

test('联网与深思开关分别变化，允许同时开启', () => {
  const webSearch = nextCapabilityMode('auto');
  const deepThinking = nextCapabilityMode('off');

  assert.equal(webSearch, 'on');
  assert.equal(deepThinking, 'on');
  assert.deepEqual({ webSearch, deepThinking }, { webSearch: 'on', deepThinking: 'on' });
  assert.equal(nextCapabilityMode('on'), 'off');
});
