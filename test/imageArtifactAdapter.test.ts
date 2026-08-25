import assert from 'node:assert/strict';
import test from 'node:test';

import { createImageArtifactInput, readImageArtifactPayload } from '../src/features/omni/imageArtifactAdapter.ts';

test('图片适配器保留完整批次和所有候选图', () => {
  const input = createImageArtifactInput({
    messageId: 'message-image-1',
    batch: {
      batch_id: 'batch-1', status: 'completed', raw_prompt: '新春海报',
      images: [{ id: 'asset-1', url: '/one.png' }, { id: 'asset-2', url: '/two.png' }],
    },
  });
  assert.equal(input.kind, 'image');
  assert.deepEqual(input.sourceRef, { type: 'image_batch', imageBatchId: 'batch-1', imageAssetIds: ['asset-1', 'asset-2'] });
  assert.equal(readImageArtifactPayload(input.payload)?.images.length, 2);
  assert.equal(input.metadata?.previewUrl, '/one.png');
});

test('无效图片版本负载不会被当成可预览批次', () => {
  assert.equal(readImageArtifactPayload({ images: [] }), null);
});
