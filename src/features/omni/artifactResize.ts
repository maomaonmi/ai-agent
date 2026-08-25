export const ARTIFACT_PANEL_MIN_WIDTH = 32;
export const ARTIFACT_PANEL_MAX_WIDTH = 70;
export const ARTIFACT_PANEL_DEFAULT_WIDTH = 52;

export function clampArtifactPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return ARTIFACT_PANEL_DEFAULT_WIDTH;
  const bounded = Math.min(ARTIFACT_PANEL_MAX_WIDTH, Math.max(ARTIFACT_PANEL_MIN_WIDTH, value));
  return Math.round(bounded * 10) / 10;
}

/** Converts the divider's viewport x coordinate to the panel width in vw. */
export function artifactPanelWidthFromPointer(clientX: number, viewportWidth: number): number {
  if (!Number.isFinite(clientX) || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return ARTIFACT_PANEL_DEFAULT_WIDTH;
  }
  return clampArtifactPanelWidth(((viewportWidth - clientX) / viewportWidth) * 100);
}
