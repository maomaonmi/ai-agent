export type MenuPlacement = 'top' | 'bottom';
export type SubmenuSide = 'left' | 'right';

/**
 * Pick the side with enough viewport room for a floating menu.
 * If neither side fits, use the side with more room so the menu remains
 * reachable instead of being clipped by the browser edge.
 */
export function chooseMenuPlacement(
  anchorTop: number,
  anchorBottom: number,
  viewportHeight: number,
  menuHeight: number,
): MenuPlacement {
  const above = Math.max(0, anchorTop);
  const below = Math.max(0, viewportHeight - anchorBottom);
  if (below >= menuHeight || below >= above) return 'bottom';
  return 'top';
}

/** Choose the horizontal side for a provider's fly-out model list. */
export function chooseSubmenuSide(
  anchorLeft: number,
  anchorRight: number,
  viewportWidth: number,
  submenuWidth: number,
): SubmenuSide {
  const right = Math.max(0, viewportWidth - anchorRight);
  const left = Math.max(0, anchorLeft);
  if (right >= submenuWidth || right >= left) return 'right';
  return 'left';
}
