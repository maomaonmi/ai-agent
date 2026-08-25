import assert from 'node:assert/strict';
import test from 'node:test';

import { buildArtifactCardViewModel } from '../src/features/omni/artifactPresentation.ts';
import { artifactPanelReducer } from '../src/features/omni/panelState.ts';
import type { Artifact, ArtifactId, ArtifactVersion, ArtifactVersionId } from '../src/features/omni/types.ts';

const artifact = {
  id: 'artifact-1' as ArtifactId,
  projectId: null,
  originConversationId: 'session-1',
  kind: 'image',
  title: '新春海报',
  summary: '红金配色的新春海报',
  status: 'ready',
  currentVersionId: 'version-2' as ArtifactVersionId,
  metadata: {},
  createdAt: '2026-08-23T00:00:00Z',
  updatedAt: '2026-08-23T00:00:00Z',
} satisfies Artifact;

const historicalVersion = {
  id: 'version-1' as ArtifactVersionId,
  artifactId: artifact.id,
  versionNumber: 1,
  status: 'ready',
  sourceRef: { type: 'image_batch', imageBatchId: 'batch-1', imageAssetIds: ['asset-1'] },
  summary: '第一版',
  createdAt: '2026-08-23T00:00:00Z',
} satisfies ArtifactVersion;

test('card view model marks a historical version without replacing it with latest', () => {
  const viewModel = buildArtifactCardViewModel(artifact, historicalVersion);

  assert.equal(viewModel.versionId, historicalVersion.id);
  assert.equal(viewModel.isHistoricalVersion, true);
  assert.equal(viewModel.versionLabel, '版本 1 · 非最新版');
  assert.equal(viewModel.kindLabel, '图片');
});

test('opening another artifact switches the existing panel in place', () => {
  const first = artifactPanelReducer({ status: 'closed' }, {
    type: 'open', artifactId: artifact.id, versionId: historicalVersion.id,
  });
  const second = artifactPanelReducer(first, {
    type: 'open',
    artifactId: 'artifact-2' as ArtifactId,
    versionId: 'version-3' as ArtifactVersionId,
  });

  assert.equal(second.status, 'opening');
  if (second.status !== 'closed') {
    assert.equal(second.artifactId, 'artifact-2');
    assert.equal(second.displayMode, 'split');
  }
});

test('closing the panel removes the implicit active artifact', () => {
  const closed = artifactPanelReducer({
    status: 'open',
    artifactId: artifact.id,
    versionId: historicalVersion.id,
    displayMode: 'maximized',
  }, { type: 'close' });

  assert.deepEqual(closed, { status: 'closed' });
});

test('panel can maximize and return to split without changing its version', () => {
  const open = {
    status: 'open' as const,
    artifactId: artifact.id,
    versionId: historicalVersion.id,
    displayMode: 'split' as const,
  };
  const maximized = artifactPanelReducer(open, { type: 'setDisplayMode', displayMode: 'maximized' });
  const split = artifactPanelReducer(maximized, { type: 'setDisplayMode', displayMode: 'split' });

  assert.equal(maximized.status !== 'closed' && maximized.versionId, historicalVersion.id);
  assert.equal(split.status !== 'closed' && split.displayMode, 'split');
});
