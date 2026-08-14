export type LayoutTemplateCategory = 'all' | 'university' | 'international';

export interface LayoutTemplate {
  id: string;
  name: string;
  category: Exclude<LayoutTemplateCategory, 'all'>;
  subtitle: string;
  accent: string;
}

export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  { id: 'course-report', name: '课程设计报告', category: 'university', subtitle: '规范课程报告封面', accent: '#1e3a8a' },
  { id: 'degree-thesis', name: '本科/硕士毕业论文', category: 'university', subtitle: '全国高校通用结构', accent: '#166534' },
  { id: 'term-paper', name: '期末论文', category: 'university', subtitle: '简洁学术排版', accent: '#9a3412' },
  { id: 'apa-paper', name: 'APA Research Paper', category: 'international', subtitle: 'APA 通用论文格式', accent: '#334155' },
  { id: 'ieee-paper', name: 'IEEE Conference', category: 'international', subtitle: '国际会议论文格式', accent: '#0f766e' },
  { id: 'modern-report', name: '现代研究报告', category: 'international', subtitle: '现代清晰型排版', accent: '#4338ca' },
];
