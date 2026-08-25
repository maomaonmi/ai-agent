import { useState } from 'react';
import { InputBar } from '../InputBar';
import { PPTIcon, ChevronDownIcon } from '../Icons';
import type { ModeType } from '../../types';

interface PPTViewProps {
  onBack: () => void;
}

const TABS = ['热门模板', '课堂教育', '科研论文', '工作汇报'];

// 封面图：/covers/xxx.jpg，没有就 fallback 到渐变
interface Template {
  title: string;
  sub?: string;
  cover?: string;       // 渐变
  image?: string;       // 生成图路径
  special?: 'recommend';
}

const TEMPLATES: Template[] = [
  { title: '智能推荐', special: 'recommend' },
  { title: '黄白商业汇报', sub: '高级商业汇报', image: '/covers/business.jpg' },
  { title: '通用森林光影风', sub: '重塑绿色未来', image: '/covers/forest.jpg' },
  { title: '高级几何空间商务…', sub: '2025年终高颜', image: '/covers/geometric.jpg' },
  { title: '高级商务风格', sub: '专属商务春夏日', image: '/covers/business.jpg' },
  { title: '唯美油画风', sub: '印象派光影艺术', image: '/covers/oil-painting.jpg' },
  { title: '创意多色插画', sub: '年度品牌创意', image: '/covers/hand-drawn.jpg' },
  { title: '超现实主义插画风', sub: '超现实主义集锦', image: '/covers/geometric.jpg' },
  { title: '波普艺术风格', sub: 'CREATIVE PORTFOLIO', image: '/covers/hand-drawn.jpg' },
  { title: '传统新中式', sub: '空山新雨', image: '/covers/new-chinese.jpg' },
  { title: '水墨风格', sub: '谷雨', image: '/covers/ink-wash.jpg' },
  { title: '农业科技质感风', sub: '2026冬小麦', image: '/covers/forest.jpg' },
  { title: '插画手绘风', sub: 'LUMINA', image: '/covers/hand-drawn.jpg' },
  { title: '轻奢深绿莫兰迪配色风', sub: '雅境·私享运动俱乐部', image: '/covers/forest.jpg' },
  { title: '通用极简风', sub: 'NexusAI 展板', image: '/covers/geometric.jpg' },
  { title: '高级质感摄影风', image: '/covers/geometric.jpg' },
  { title: '乡村油画风', sub: '云栖谷·乡村生态艺术聚落', image: '/covers/oil-painting.jpg' },
  { title: '森系自然风', sub: '森系·生态环境保护', image: '/covers/forest.jpg' },
  { title: '艺术研究风', sub: '现代艺术馆策划', image: '/covers/oil-painting.jpg' },
  { title: '植物美学风', sub: '毕业答辩汇报', image: '/covers/forest.jpg' },
  { title: '暗黑高级建筑风', sub: '2026年商务年度', image: '/covers/vintage-black-gold.jpg' },
  { title: '红调城市商务风', sub: '城脉文创', image: '/covers/new-chinese.jpg' },
  { title: '轻奢奶油风', sub: '2026年商务', image: '/covers/oil-painting.jpg' },
  { title: '赛博朋克科技风', sub: 'AI发展趋势', image: '/covers/cyberpunk.jpg' },
  { title: '山野冷调摄影风', sub: '山野考察', image: '/covers/ink-wash.jpg' },
  { title: '传统中式水墨风', sub: '氤氲', image: '/covers/ink-wash.jpg' },
  { title: '小清新油画风', sub: '晨露农场', image: '/covers/hand-drawn.jpg' },
  { title: '高饱和水彩风', sub: '中国传统文化建设', image: '/covers/hand-drawn.jpg' },
  { title: '复古黑金轻奢风', sub: '匠人记忆', image: '/covers/vintage-black-gold.jpg' },
  { title: '黑白线性插画', sub: '2026年文化活动', image: '/covers/geometric.jpg' },
  { title: '蓝白卡片', sub: '新能源汽车市场数据分析', image: '/covers/blue-card.jpg' },
];

export const PPTView: React.FC<PPTViewProps> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="mode-view">
      <div className="mode-view__title">
        <span className="mode-view__title-icon">
          <PPTIcon size={20} />
        </span>
        <h1>万物皆可PPT</h1>
      </div>

      <div className="mode-view__input-wrap">
        <InputBar
          mode="ppt"
          placeholder="帮你制作言之有物、设计精美的智能PPT"
          tag={{
            id: 'ppt-create',
            label: 'PPT创作',
            icon: <PPTIcon size={14} />,
          }}
          options={[
            { id: 'expert', label: '专家模式', hasChevron: true },
            { id: 'ref', label: '参考资料', hasChevron: true },
            { id: 'pages', label: '页数', hasChevron: true },
          ]}
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

      <div className="ppt-grid">
        {TEMPLATES.map((t, i) => (
          <div key={i} className="ppt-card">
            <div
              className="ppt-card__cover"
              style={t.cover ? { background: t.cover } : undefined}
            >
              {t.image && <img src={t.image} alt={t.title} loading="lazy" />}
              {t.special === 'recommend' && (
                <>
                  <div className="ppt-card__recommend-bg" />
                  <div className="ppt-card__icon">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M12 2l2.5 6.5L21 9l-5 4.5L17.5 21 12 17.5 6.5 21 8 13.5 3 9l6.5-.5L12 2z"
                        fill="#5b5bf0"
                      />
                    </svg>
                  </div>
                </>
              )}
              {t.sub && <div className="ppt-card__sub">{t.sub}</div>}
            </div>
            <div className="ppt-card__title">{t.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
