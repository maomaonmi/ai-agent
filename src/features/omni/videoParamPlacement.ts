export type VideoParameterPlacement = 'up' | 'down';

/** Chooses the side with enough room for the video settings popover. */
export function chooseVideoParameterPlacement(
  anchorTop: number,
  anchorBottom: number,
  viewportHeight: number,
  panelHeight = 390,
): VideoParameterPlacement {
  const below = Math.max(0, viewportHeight - anchorBottom);
  const above = Math.max(0, anchorTop);
  if (below >= panelHeight || below >= above) return 'down';
  return 'up';
}
