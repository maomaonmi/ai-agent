'use client';

import type { ReactNode } from 'react';
import {
  Check,
  FilePenLine,
  Globe2,
  Image as ImageIcon,
  MessageCircle,
  Music2,
  Presentation,
  Sparkles,
  Telescope,
  Video,
  X,
} from 'lucide-react';

import type { CapabilityMode } from '../../lib/api';
import {
  OMNI_COMPOSER_CAPABILITIES,
  type OmniComposerCapability,
} from './composerCapabilities';

const CAPABILITY_ICONS = {
  omni: MessageCircle,
  ppt: Presentation,
  music: Music2,
  writing: FilePenLine,
  image: ImageIcon,
  video: Video,
  research: Telescope,
} as const;

interface OmniComposerToolbarProps {
  preferredCapability: OmniComposerCapability;
  webSearch: CapabilityMode;
  deepThinking: CapabilityMode;
  disabled?: boolean;
  onCapabilityChange: (capability: OmniComposerCapability) => void;
  onWebSearchChange: () => void;
  onDeepThinkingChange: () => void;
  attachmentControl: ReactNode;
  moreControl: ReactNode;
  modelControl: ReactNode;
  sendControl: ReactNode;
  modeControl?: ReactNode;
  videoModeControl?: ReactNode;
}

function RuntimeToggle({
  active,
  disabled,
  icon: Icon,
  label,
  title,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: typeof Globe2;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
      }`}
    >
      <Icon size={15} />
      <span className="hidden sm:inline">{label}</span>
      {active && <Check size={12} aria-hidden="true" />}
    </button>
  );
}

export default function OmniComposerToolbar({
  preferredCapability,
  webSearch,
  deepThinking,
  disabled,
  onCapabilityChange,
  onWebSearchChange,
  onDeepThinkingChange,
  attachmentControl,
  moreControl,
  modelControl,
  sendControl,
  modeControl,
  videoModeControl,
}: OmniComposerToolbarProps) {
  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-visible" aria-label="全能输入工具栏">
      <div className="shrink-0">{attachmentControl}</div>
      <div className="flex min-w-0 items-center gap-0.5 overflow-visible">
        {modeControl}
        {preferredCapability === 'video' ? (() => {
          const Icon = CAPABILITY_ICONS.video;
          return (
            <button
              type="button"
              aria-pressed="true"
              disabled={disabled}
              title="视频：为本轮请求指定创作意图"
              onClick={() => onCapabilityChange('omni')}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-slate-100 px-2 text-xs font-medium text-slate-950 shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Icon size={15} />
              <span className="hidden sm:inline">AI生视频</span>
              <X size={12} aria-label="取消当前模式" />
            </button>
          );
        })() : OMNI_COMPOSER_CAPABILITIES.filter((item) => item.id !== 'omni').map((item) => {
          const Icon = CAPABILITY_ICONS[item.id];
          const active = preferredCapability === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              disabled={disabled || item.id === 'music'}
              title={item.id === 'music' ? '音乐生成将在后续能力阶段接入' : `${item.label}：为本轮请求指定创作意图`}
              onClick={() => onCapabilityChange(item.id)}
              className={`${item.responsiveClassName ?? 'inline-flex'} h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? 'bg-slate-100 text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
              }`}
            >
              <Icon size={15} />
              <span className={item.id === 'omni' ? 'hidden min-[460px]:inline' : 'hidden 2xl:inline'}>{item.label}</span>
              {active && <X size={12} aria-label="取消当前模式" />}
            </button>
          );
        })}
        {preferredCapability === 'video' && videoModeControl}
        <div className="shrink-0">{moreControl}</div>
      </div>
      <div className="mx-1 h-5 w-px shrink-0 bg-slate-200" aria-hidden="true" />
      <RuntimeToggle active={webSearch === 'on'} disabled={disabled} icon={Globe2} label="联网" title="联网搜索（可与深度思考同时开启）" onClick={onWebSearchChange} />
      <RuntimeToggle active={deepThinking === 'on'} disabled={disabled} icon={Sparkles} label="深思" title="深度思考（可与联网搜索同时开启）" onClick={onDeepThinkingChange} />
      <div className="min-w-0 shrink">{modelControl}</div>
      <div className="shrink-0">{sendControl}</div>
    </div>
  );
}
