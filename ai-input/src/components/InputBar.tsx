import { useState, type ReactNode } from 'react';
import {
  PlusIcon,
  ChatIcon,
  PPTIcon,
  MusicIcon,
  PenIcon,
  ImageIcon,
  VideoIcon,
  ResearchIcon,
  MoreIcon,
  MicIcon,
  SendIcon,
  CloseIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  WaveIcon,
  SparkleIcon,
  UploadIcon,
} from './Icons';
import type { ModeType, InputTag, InputOption } from '../types';
import './InputBar.css';

interface BaseProps {
  placeholder: string;
  referenceArea?: ReactNode;
  tag?: InputTag | null;
  options?: InputOption[];
  rightExtras?: ReactNode;
  showVoiceMode?: boolean;
  onExitMode?: () => void;
}

interface ChatInputProps extends BaseProps {
  mode: 'chat';
  currentMode: ModeType;
  onModeChange: (mode: ModeType) => void;
}

interface ModeInputProps extends BaseProps {
  mode: Exclude<ModeType, 'chat'>;
}

type InputBarProps = ChatInputProps | ModeInputProps;

type ChatModeKey = ModeType | 'writing' | 'more' | 'music';

// 底部一排模式按钮的配置
const MODE_BUTTONS: { key: ChatModeKey; label: string; Icon: typeof ChatIcon }[] = [
  { key: 'chat', label: '对话', Icon: ChatIcon },
  { key: 'ppt', label: 'PPT生成', Icon: PPTIcon },
  { key: 'music', label: '音乐生成', Icon: MusicIcon },
  { key: 'writing', label: '帮我写作', Icon: PenIcon },
  { key: 'image', label: '图像生成', Icon: ImageIcon },
  { key: 'video', label: '视频生成', Icon: VideoIcon },
  { key: 'research', label: '深入研究', Icon: ResearchIcon },
  { key: 'more', label: '更多', Icon: MoreIcon },
];

export const InputBar: React.FC<InputBarProps> = (props) => {
  const isChat = props.mode === 'chat';

  return (
    <div className={`input-bar ${isChat ? 'input-bar--chat' : 'input-bar--mode'}`}>
      {props.referenceArea}

      <div className="input-bar__text">
        <input
          type="text"
          className="input-bar__field"
          placeholder={props.placeholder}
        />
        <div className="input-bar__dots" aria-hidden>
          <span />
          <span />
        </div>
      </div>

      <div className="input-bar__bottom">
        {isChat ? (
          <ChatBottomRow
            currentMode={(props as ChatInputProps).currentMode}
            onModeChange={(props as ChatInputProps).onModeChange}
          />
        ) : (
          <ModeBottomRow
            tag={props.tag ?? null}
            options={props.options ?? []}
            rightExtras={props.rightExtras}
            showVoiceMode={props.showVoiceMode}
            onExitMode={props.onExitMode}
          />
        )}
      </div>
    </div>
  );
};

// 对话输入框的底栏：+ | 模式按钮 | 豆包快速 | 语音按钮
const ChatBottomRow: React.FC<{
  currentMode: ModeType;
  onModeChange: (mode: ModeType) => void;
}> = ({ currentMode, onModeChange }) => {
  const [voiceHover, setVoiceHover] = useState(false);

  const handleClick = (key: ChatModeKey) => {
    if (
      key === 'chat' ||
      key === 'ppt' ||
      key === 'video' ||
      key === 'image' ||
      key === 'research'
    ) {
      onModeChange(key as ModeType);
    }
    // music / writing / more 暂未实现具体视图
  };

  return (
    <div className="input-bottom">
      <div className="input-bottom__left">
        <button className="icon-btn icon-btn--plus" aria-label="添加">
          <PlusIcon size={18} />
        </button>
        <div className="mode-divider" />
        {MODE_BUTTONS.map(({ key, label, Icon }, idx) => {
          const isActive = key === 'chat' ? currentMode === 'chat' : currentMode === key;
          return (
            <button
              key={key}
              className={`mode-btn ${isActive ? 'mode-btn--active' : ''}`}
              onClick={() => handleClick(key)}
            >
              <Icon size={16} />
              <span>{label}</span>
              {idx === 0 && <ChevronRightIcon size={12} className="mode-btn__chevron" />}
            </button>
          );
        })}
      </div>

      <div className="input-bottom__right">
        <button className="voice-mode-btn">
          <span>豆包 快速</span>
          <ChevronRightIcon size={12} />
        </button>
        <button
          className={`voice-btn ${voiceHover ? 'voice-btn--hover' : ''}`}
          aria-label="语音输入"
          onMouseEnter={() => setVoiceHover(true)}
          onMouseLeave={() => setVoiceHover(false)}
        >
          <WaveIcon size={18} />
        </button>
      </div>
    </div>
  );
};

// 模式输入框的底栏：+ | tag | options | 右侧按钮
const ModeBottomRow: React.FC<{
  tag: InputTag | null;
  options: InputOption[];
  rightExtras?: ReactNode;
  showVoiceMode?: boolean;
  onExitMode?: () => void;
}> = ({ tag, options, rightExtras, onExitMode }) => {
  return (
    <div className="input-bottom">
      <div className="input-bottom__left">
        <button className="icon-btn icon-btn--plus" aria-label="添加">
          <PlusIcon size={18} />
        </button>
        {tag && (
          <button className="mode-tag" onClick={onExitMode} title="退出该模式">
            {tag.icon}
            <span>{tag.label}</span>
            <CloseIcon size={12} className="mode-tag__close" />
          </button>
        )}
        {options.map((opt) => (
          <button key={opt.id} className="mode-option" onClick={opt.onClick}>
            {opt.icon}
            <span>{opt.label}</span>
            {opt.hasChevron && <ChevronDownIcon size={12} className="mode-option__chevron" />}
          </button>
        ))}
      </div>

      <div className="input-bottom__right">
        {rightExtras}
        <button className="icon-btn icon-btn--mic" aria-label="语音输入">
          <MicIcon size={18} />
        </button>
        <button className="send-btn" aria-label="发送">
          <SendIcon size={18} />
        </button>
      </div>
    </div>
  );
};

// 设置弹窗组件（视频模式用）
export const VideoSettingsPanel: React.FC = () => {
  const [resolution, setResolution] = useState<'720P' | '1080P'>('720P');
  const [ratio, setRatio] = useState('9:16');
  const [duration, setDuration] = useState('5秒');
  const [voice, setVoice] = useState(false);

  const ratios: { value: string; label: string; shape: string }[] = [
    { value: '9:16', label: '9:16', shape: 'tall' },
    { value: '3:4', label: '3:4', shape: 'medium-tall' },
    { value: '1:1', label: '1:1', shape: 'square' },
    { value: '4:3', label: '4:3', shape: 'medium-wide' },
    { value: '16:9', label: '16:9', shape: 'wide' },
  ];

  return (
    <div className="settings-panel">
      <div className="settings-panel__section">
        <div className="settings-panel__label">清晰度</div>
        <div className="settings-panel__segmented">
          <button
            className={`settings-panel__seg ${resolution === '720P' ? 'is-active' : ''}`}
            onClick={() => setResolution('720P')}
          >
            720P
          </button>
          <button
            className={`settings-panel__seg ${resolution === '1080P' ? 'is-active' : ''}`}
            onClick={() => setResolution('1080P')}
          >
            1080P
          </button>
        </div>
      </div>

      <div className="settings-panel__section">
        <div className="settings-panel__label">比例</div>
        <div className="settings-panel__ratios">
          {ratios.map((r) => (
            <button
              key={r.value}
              className={`settings-panel__ratio ${ratio === r.value ? 'is-active' : ''}`}
              onClick={() => setRatio(r.value)}
            >
              <span className={`settings-panel__shape settings-panel__shape--${r.shape}`} />
              <span className="settings-panel__ratio-label">{r.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-panel__section">
        <div className="settings-panel__label">视频时长</div>
        <div className="settings-panel__segmented settings-panel__segmented--3">
          {['5秒', '10秒', '15秒'].map((d) => (
            <button
              key={d}
              className={`settings-panel__seg ${duration === d ? 'is-active' : ''}`}
              onClick={() => setDuration(d)}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-panel__section">
        <div className="settings-panel__label settings-panel__label--with-icon">
          智能配音
          <span className="settings-panel__info" title="开启后自动为视频配音">
            i
          </span>
        </div>
        <div className="settings-panel__segmented">
          <button
            className={`settings-panel__seg ${!voice ? 'is-active' : ''}`}
            onClick={() => setVoice(false)}
          >
            关
          </button>
          <button
            className={`settings-panel__seg ${voice ? 'is-active' : ''}`}
            onClick={() => setVoice(true)}
          >
            开
          </button>
        </div>
      </div>
    </div>
  );
};

// 一些通用的小型 UI 片段
export { SparkleIcon, UploadIcon };
