import type { CapabilityMode } from '../../lib/api';

export type OmniComposerCapability =
  | 'omni'
  | 'ppt'
  | 'music'
  | 'writing'
  | 'image'
  | 'video'
  | 'research';

export const OMNI_COMPOSER_CAPABILITIES: ReadonlyArray<{
  id: OmniComposerCapability;
  label: string;
  responsiveClassName?: string;
}> = [
  { id: 'omni', label: '全能对话' },
  { id: 'ppt', label: 'PPT', responsiveClassName: 'hidden sm:inline-flex' },
  { id: 'music', label: '音乐', responsiveClassName: 'hidden 2xl:inline-flex' },
  { id: 'writing', label: '写作', responsiveClassName: 'hidden xl:inline-flex' },
  { id: 'image', label: '生图', responsiveClassName: 'hidden md:inline-flex' },
  { id: 'video', label: '视频', responsiveClassName: 'hidden lg:inline-flex' },
  { id: 'research', label: '研究', responsiveClassName: 'hidden xl:inline-flex' },
];

export function selectPreferredCapability(
  current: OmniComposerCapability,
  selected: OmniComposerCapability,
): OmniComposerCapability {
  return current === selected && selected !== 'omni' ? 'omni' : selected;
}

export function nextCapabilityMode(current: CapabilityMode): CapabilityMode {
  return current === 'on' ? 'off' : 'on';
}

/** Specialized generation capabilities must bypass the generic chat stream,
 * including when the conversation itself is in Omni mode. */
export function capabilityUsesTaskRoute(capability: OmniComposerCapability, mode: string): boolean {
  return (capability === 'ppt' || capability === 'image' || capability === 'video' || capability === 'music')
    && (mode === 'omni' || mode === 'standard' || mode === 'deep' || mode === 'web');
}
