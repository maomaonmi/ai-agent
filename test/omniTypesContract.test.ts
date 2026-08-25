import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createClosedArtifactPanelState,
  isArtifactEvent,
  type Artifact,
  type ArtifactCreatedEvent,
  type ArtifactId,
  type ArtifactVersion,
  type ArtifactVersionId,
  type MessageArtifactLink,
  type MessageId,
  type OmniTurnContext,
} from '../src/features/omni/types.ts';

const artifactId = 'artifact-1' as ArtifactId;
const versionId = 'version-1' as ArtifactVersionId;
const messageId = 'message-1' as MessageId;

test('web search and deep thinking can both be enabled for the same turn', () => {
  const context: OmniTurnContext = {
    preferredCapability: 'auto',
    runtimeCapabilities: {
      webSearch: 'on',
      deepThinking: 'on',
    },
    mentionedArtifacts: [],
    attachments: [],
  };

  assert.equal(context.runtimeCapabilities.webSearch, 'on');
  assert.equal(context.runtimeCapabilities.deepThinking, 'on');
});

test('artifact events retain exact artifact and version identity', () => {
  const artifact: Artifact = {
    id: artifactId,
    projectId: null,
    originConversationId: 'session-1',
    kind: 'image',
    title: '新春海报',
    summary: '一组新春主题海报',
    status: 'ready',
    currentVersionId: versionId,
    metadata: {},
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  };
  const version: ArtifactVersion = {
    id: versionId,
    artifactId,
    versionNumber: 1,
    status: 'ready',
    sourceRef: { type: 'image_batch', imageBatchId: 'batch-1', imageAssetIds: ['asset-1'] },
    summary: '第一轮生图',
    createdByMessageId: messageId,
    createdAt: '2026-08-23T00:00:00.000Z',
  };
  const event: ArtifactCreatedEvent = {
    type: 'artifact.created',
    runId: 'run-1',
    artifact,
    version,
  };

  assert.equal(isArtifactEvent(event), true);
  assert.equal(event.artifact.id, artifactId);
  assert.equal(event.version.id, versionId);
});

test('message links point to the historical version instead of only the latest artifact', () => {
  const link: MessageArtifactLink = {
    id: 'link-1',
    conversationId: 'session-1',
    messageId,
    artifactId,
    versionId,
    relation: 'created',
    displayOrder: 0,
    createdAt: '2026-08-23T00:00:00.000Z',
  };

  assert.equal(link.artifactId, artifactId);
  assert.equal(link.versionId, versionId);
});

test('artifact panel starts closed and does not retain an implicit artifact reference', () => {
  assert.deepEqual(createClosedArtifactPanelState(), { status: 'closed' });
});
