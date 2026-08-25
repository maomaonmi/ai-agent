import { useState } from 'react';
import { InputBar, VideoSettingsPanel } from '../InputBar';
import { VideoIcon, PlusIcon, SparkleIcon } from '../Icons';

interface VideoViewProps {
  onBack: () => void;
}

export const VideoView: React.FC<VideoViewProps> = ({ onBack }) => {
  const [showSettings, setShowSettings] = useState(true);

  return (
    <div className="mode-view">
      <div className="mode-view__title">
        <span>灵感成片</span>
        <span className="mode-view__title-icon">
          <VideoIcon size={22} />
        </span>
        <span>即刻呈现</span>
      </div>

      <div className="mode-view__input-wrap mode-view__input-wrap--with-preview">
        <InputBar
          mode="video"
          placeholder="上传图片、视频进行参考生成，使用 @ 快速调用已上传素材"
          referenceArea={
            <div className="input-bar__reference">
              <div className="reference-card">
                <PlusIcon size={16} />
                <span>参考</span>
              </div>
            </div>
          }
          tag={{
            id: 'ai-video',
            label: 'AI生视频',
            icon: <VideoIcon size={14} />,
          }}
          options={[
            { id: 'model', label: '万相 2.7', hasChevron: true },
            { id: 'multi', label: '多参考生成', hasChevron: true },
            { id: 'preset', label: '720P-5s', hasChevron: true, onClick: () => setShowSettings((s) => !s) },
          ]}
          rightExtras={
            <button className="extras-btn" aria-label="积分">
              <SparkleIcon size={14} />
              <span>20</span>
            </button>
          }
          onExitMode={onBack}
        />

        {showSettings && <VideoSettingsPanel />}
      </div>
    </div>
  );
};
