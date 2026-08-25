import { useState } from 'react';
import { InputBar } from '../InputBar';
import { ResearchIcon, ChevronRightIcon } from '../Icons';

interface ResearchViewProps {
  onBack: () => void;
}

const SAMPLE_QUESTIONS = [
  '近三年新能源车竞争格局与趋势研究',
  '贵州茅台当前估值及未来走势分析',
  '大语言模型当前的主要研究方向整理',
  '合同违约中买卖双方主要法律责任分析',
  '初中历史工业革命单元教学设计方案',
  '国际咨询公司AI战略服务与竞争策略',
];

const FEATURES = [
  { title: '通用', sub: '研究各种复杂问题', color: '#5b5bf0' },
  { title: '文献综述', sub: '汇总分析学术文献', color: '#e63946' },
  { title: '财经分析', sub: '深入洞察投资价值', color: '#1a8a4a' },
];

export const ResearchView: React.FC<ResearchViewProps> = ({ onBack }) => {
  return (
    <div className="mode-view">
      <div className="mode-view__title">
        <span className="mode-view__title-icon">
          <ResearchIcon size={22} />
        </span>
        <h1>研究探索不息</h1>
      </div>

      <div className="mode-view__input-wrap mode-view__input-wrap--wide">
        <InputBar
          mode="research"
          placeholder="帮你完成复杂任务，并生成研究报告"
          referenceArea={
            <div className="research-questions">
              {SAMPLE_QUESTIONS.map((q, i) => (
                <button key={i} className="research-question-chip">
                  <span>{q}</span>
                  <ChevronRightIcon size={14} />
                </button>
              ))}
            </div>
          }
          tag={{
            id: 'research',
            label: '研究',
            icon: <ResearchIcon size={14} />,
          }}
          onExitMode={onBack}
        />
      </div>

      <div className="research-features">
        {FEATURES.map((f, i) => (
          <div key={i} className="research-feature-card">
            <div className="research-feature-card__title">{f.title}</div>
            <div className="research-feature-card__sub">{f.sub}</div>
            <div
              className="research-feature-card__chart"
              style={{
                background:
                  i === 0
                    ? 'radial-gradient(circle at 50% 60%, #5b5bf0 0%, #5b5bf0 18%, #88c070 18%, #88c070 36%, #f0c060 36%, #f0c060 54%, #e08070 54%, #e08070 72%, #d0d8e0 72%, #d0d8e0 100%)'
                    : i === 1
                    ? 'linear-gradient(135deg, #f5f5f5 0%, #fff 100%)'
                    : 'linear-gradient(180deg, #ffffff 0%, #f5f8f5 100%)',
              }}
            >
              {i === 0 && (
                <div className="donut">
                  <div className="donut__hole" />
                </div>
              )}
              {i === 1 && (
                <div className="pdf-preview">
                  <div className="pdf-preview__box">PDF 论文</div>
                  <div className="pdf-preview__lines">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
              {i === 2 && (
                <svg className="line-chart" viewBox="0 0 200 80" preserveAspectRatio="none">
                  <path
                    d="M0,60 C30,55 50,40 80,35 S130,30 160,15 190,10 200,5"
                    stroke="#e63946"
                    strokeWidth="2"
                    fill="none"
                  />
                  <path
                    d="M0,65 C30,60 50,55 80,50 S130,45 160,40 190,35 200,30"
                    stroke="#1a8a4a"
                    strokeWidth="2"
                    fill="none"
                  />
                  <circle cx="160" cy="15" r="3" fill="#e63946" />
                </svg>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
