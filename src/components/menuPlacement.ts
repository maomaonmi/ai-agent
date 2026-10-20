export type MenuPlacement = 'top' | 'bottom';
export type MenuAlign = 'start' | 'end';
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

/**
 * Pick the horizontal alignment for a dropdown menu whose positioning ancestor
 * clips overflow (CodeAgent 工作台 section 带 overflow-hidden).
 *
 * Why: 右对齐（right-0）会让菜单相对触发器向左延伸，一旦触发器靠近裁剪容器的
 * 左缘（CodeAgent 底部模型栏），菜单标题/服务商名就会被裁掉（"DeepSeek" → "Seek"）。
 * 因此优先左对齐（left-0）让菜单朝容器内部展开，只有视口右侧确实放不下时才退回右对齐。
 */
export function chooseMenuAlign(
  anchorLeft: number,
  viewportWidth: number,
  menuWidth: number,
): MenuAlign {
  return anchorLeft + menuWidth <= viewportWidth ? 'start' : 'end';
}
