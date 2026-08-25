import { useState } from 'react';
import { InputBar } from '../InputBar';
import { ImageIcon, PaintIcon } from '../Icons';

interface ImageViewProps {
  onBack: () => void;
}

const TABS = ['精选', '海报', '电商', '人像'];

// 真实 AI 生图（路径指向 /gallery/）
const GALLERY: { src: string; label: string }[] = [
  { src: '/gallery/new-year-girl.jpg', label: '新春快乐' },
  { src: '/gallery/desk-figure.jpg', label: 'AI 娃娃' },
  { src: '/gallery/cat-illustration.jpg', label: '萌宠领养' },
  { src: '/gallery/fantasy-unicorn.jpg', label: '梦幻独角兽' },
  { src: '/gallery/dogs-grid.jpg', label: '比熊九宫格' },
  { src: '/gallery/beach-sunset.jpg', label: '2026 天天开心' },
  { src: '/gallery/meadow-girl.jpg', label: '自由与浪漫' },
  { src: '/gallery/ice-cream.jpg', label: '冰淇淋三色' },
  { src: '/gallery/fireworks.jpg', label: '烟花' },
  { src: '/gallery/sparkler-girl.jpg', label: '仙女棒' },
  { src: '/gallery/new-year-dinner.jpg', label: '年夜饭' },
  { src: '/gallery/perfume-ad.jpg', label: '香水广告' },
  { src: '/gallery/reading-dog.jpg', label: '读书柴犬' },
  { src: '/gallery/tea-ceremony.jpg', label: '茶道' },
  { src: '/gallery/cartoon-friends.jpg', label: '兔狐搭档' },
  { src: '/gallery/dragon-dance.jpg', label: '舞龙' },
  { src: '/gallery/ancient-scholars.jpg', label: '古风雅集' },
  { src: '/gallery/tropical-girl.png', label: '绿植少女' },
  { src: '/gallery/happy-pomeranian.png', label: '微笑博美' },
  { src: '/gallery/pets-together.jpg', label: '萌宠合照' },
];

export const ImageView: React.FC<ImageViewProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="mode-view">
      <div className="mode-view__title">
        <span>创意生图</span>
        <span className="mode-view__title-icon">
          <PaintIcon size={22} />
        </span>
        <span>智能修图</span>
      </div>

      <div className="mode-view__input-wrap">
        <InputBar
          mode="image"
          placeholder="支持图像生成与编辑，快速实现创意设计"
          tag={{
            id: 'ai-image',
            label: 'AI生图',
            icon: <ImageIcon size={14} />,
          }}
          options={[
            { id: 'ref', label: '参考图' },
            { id: 'ratio', label: '比例 3:4', hasChevron: true },
          ]}
          rightExtras={
            <button className="extras-btn" aria-label="数量">
              <SparkleIconSmall />
              <span>1/张</span>
            </button>
          }
          onExitMode={onBack}
        />
      </div>

      <div className="mode-view__tabs">
        {TABS.map((tab, i) => (
          <button
            key={tab}
            className={`mode-view__tab ${i === activeTab ? 'is-active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="image-grid">
        {GALLERY.map((g, i) => (
          <div key={i} className="image-card">
            <img src={g.src} alt={g.label} loading="lazy" />
            <div className="image-card__label">{g.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const SparkleIconSmall = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
    <path d="M19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14z" />
  </svg>
);
