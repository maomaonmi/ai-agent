import assert from 'node:assert/strict';
import test from 'node:test';

import { sendChatMessage } from '../src/lib/api.ts';
import { createOmniTurnContext } from '../src/features/omni/turnContext.ts';
import type { ArtifactId, ArtifactVersionId } from '../src/features/omni/types.ts';

test('本轮上下文冻结创作意图、运行能力、附件和正在查看的历史版本', () => {
  const attachments = [{ type: 'image_url' as const, url: 'data:image/png;base64,one', name: 'one.png' }];
  const context = createOmniTurnContext({
    preferredCapability: 'image',
    runtimeSettings: { webSearch: 'on', deepThinking: 'on' },
    attachments,
    artifactPanelState: {
      status: 'open',
      artifactId: 'artifact-1' as ArtifactId,
      versionId: 'version-2' as ArtifactVersionId,
      displayMode: 'split',
    },
  });

  attachments[0].name = 'changed.png';
  assert.equal(context.preferredCapability, 'image');
  assert.deepEqual(context.runtimeCapabilities, { webSearch: 'on', deepThinking: 'on' });
  assert.deepEqual(context.activeArtifact, { artifactId: 'artifact-1', versionId: 'version-2' });
  assert.equal(context.attachments[0].name, 'one.png');
});

test('未打开右侧作品时不产生隐式 it 引用', () => {
  const context = createOmniTurnContext({
    preferredCapability: 'omni',
    runtimeSettings: { webSearch: 'off', deepThinking: 'auto' },
    attachments: [],
    artifactPanelState: { status: 'closed' },
  });
  assert.equal(context.preferredCapability, 'auto');
  assert.equal(context.activeArtifact, undefined);
});

test('音乐创作意图冻结为 music 作品能力', () => {
  const context = createOmniTurnContext({
    preferredCapability: 'music',
    runtimeSettings: { webSearch: 'off', deepThinking: 'on' },
    attachments: [],
    artifactPanelState: { status: 'closed' },
  });
  assert.equal(context.preferredCapability, 'music');
});

test('聊天请求把冻结快照作为独立 omni_context 发送', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response('', { status: 200 });
  }) as typeof fetch;

  try {
    const context = createOmniTurnContext({
      preferredCapability: 'writing',
      runtimeSettings: { webSearch: 'on', deepThinking: 'on' },
      attachments: [],
      artifactPanelState: { status: 'closed' },
    });
    await sendChatMessage('写一篇文章', 'standard', {}, { omniTurnContext: context });
    assert.deepEqual(requestBody?.omni_context, JSON.parse(JSON.stringify(context)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
