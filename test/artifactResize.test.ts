import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARTIFACT_PANEL_DEFAULT_WIDTH,
  ARTIFACT_PANEL_MAX_WIDTH,
  ARTIFACT_PANEL_MIN_WIDTH,
  artifactPanelWidthFromPointer,
  clampArtifactPanelWidth,
} from '../src/features/omni/artifactResize.ts';

test('clamps artifact panel width to the supported range', () => {
  assert.equal(clampArtifactPanelWidth(10), ARTIFACT_PANEL_MIN_WIDTH);
  assert.equal(clampArtifactPanelWidth(99), ARTIFACT_PANEL_MAX_WIDTH);
  assert.equal(clampArtifactPanelWidth(Number.NaN), ARTIFACT_PANEL_DEFAULT_WIDTH);
});

test('derives panel width from the divider position', () => {
  assert.equal(artifactPanelWidthFromPointer(480, 1000), 52);
  assert.equal(artifactPanelWidthFromPointer(0, 1000), ARTIFACT_PANEL_MAX_WIDTH);
  assert.equal(artifactPanelWidthFromPointer(1000, 1000), ARTIFACT_PANEL_MIN_WIDTH);
});
