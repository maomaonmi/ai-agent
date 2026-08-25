import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoArtifactInput, matchesVideoArtifactTask, readVideoArtifactPayload } from '../src/features/omni/videoArtifactAdapter.ts';

const task = {
  id: 'task-1', status: 'SUCCEEDED', progress: 100, provider: 'qianwen', model: 'video-1', prompt: '产品宣传片',
  parameters: { ratio: '16:9', duration: 5, resolution: '720P' }, created_at: 1, updated_at: 2,
  result: { video_url: 'https://example.com/video.mp4', asset_id: 'asset-1' },
};

test('视频适配器把任务状态与播放地址保存到精确版本', () => {
  const mapped = createVideoArtifactInput({ messageId: 'message-video-1', task });
  assert.equal(mapped.kind, 'video');
  assert.equal(mapped.status, 'ready');
  assert.equal(readVideoArtifactPayload(mapped.payload)?.task.result?.video_url, 'https://example.com/video.mp4');
});

test('未完成视频任务创建 generating 作品版本', () => {
  const mapped = createVideoArtifactInput({ messageId: 'message-video-2', task: { ...task, status: 'RUNNING', progress: 45, result: null } });
  assert.equal(mapped.status, 'generating');
});

test('恢复轮询只接受与初始版本相同的视频任务', () => {
  const mapped = createVideoArtifactInput({ messageId: 'message-video-3', task });
  assert.equal(matchesVideoArtifactTask(mapped.payload, mapped.sourceRef, 'task-1'), true);
  assert.equal(matchesVideoArtifactTask(mapped.payload, mapped.sourceRef, 'task-from-another-conversation'), false);
  assert.equal(matchesVideoArtifactTask(mapped.payload, { type: 'image_batch', imageBatchId: 'batch-1' }, 'task-1'), false);
});
