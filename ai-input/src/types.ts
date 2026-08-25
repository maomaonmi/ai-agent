import type { ReactNode } from 'react';

export type ModeType = 'chat' | 'ppt' | 'video' | 'image' | 'research';

export interface InputTag {
  id: string;
  label: string;
  icon?: ReactNode;
}

export interface InputOption {
  id: string;
  label: string;
  icon?: ReactNode;
  hasChevron?: boolean;
  onClick?: () => void;
}

export interface RightExtras {
  before?: ReactNode;
  mic?: boolean;
  send?: boolean;
}
