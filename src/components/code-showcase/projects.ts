export const CODE_PROJECT_CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'utility', label: '实用工具' },
  { id: 'web', label: '网页设计' },
  { id: 'interactive', label: '娱乐互动' },
  { id: 'education', label: '教育学习' },
] as const;

export type CodeProjectCategory = Exclude<(typeof CODE_PROJECT_CATEGORIES)[number]['id'], 'all'>;

export interface CodeShowcaseProject {
  id: string;
  title: string;
  category: CodeProjectCategory;
  prompt: string;
  cover: string;
  accent: string;
}

/** Expand a short idea into a production-ready Code prompt without losing the user's intent. */
export function optimizeCodePrompt(input: string): string {
  const brief = input.trim();
  if (!brief) return '';
  const suffix = '\n\n请将它实现为完整、可直接运行的前端项目，并遵循以下交付标准：\n1. 先梳理页面结构、用户流程和关键状态，再开始实现；\n2. 使用语义化 HTML、现代 CSS 和原生 JavaScript/React，保持响应式布局，兼容桌面与移动端；\n3. 补齐加载、空状态、错误状态、hover/focus/disabled 反馈，以及键盘可操作性；\n4. 交互必须真实可用：按钮、筛选、表单、导航、动画和数据更新都要有明确行为；\n5. 视觉上使用清晰的层级、合理的间距和一致的颜色/圆角/阴影，避免占位文字和空白模块；\n6. 输出完整文件结构与代码，确保无需额外配置即可预览，并在最后列出已实现的功能与可扩展点。';
  return /完整|交付标准|响应式布局|无需额外配置/.test(brief) ? brief : `${brief}${suffix}`;
}

const RAW_CODE_SHOWCASE_PROJECTS: CodeShowcaseProject[] = [
  { id: 'earth', title: '3D 地球', category: 'education', cover: '/code-showcase/education.png', accent: '#1d4ed8', prompt: '请生成一个完整的 HTML 文件，使用 Three.js 创建可拖拽旋转、支持缩放并带昼夜光照效果的 3D 地球模型。页面需要响应式布局、清晰的操作提示和流畅动画。' },
  { id: 'food-sort', title: '食物链排序', category: 'education', cover: '/code-showcase/education.png', accent: '#16a34a', prompt: '创建一个食物链排序学习网页。学生可以拖拽生物卡片组成正确食物链，提交后显示即时反馈、知识解释和得分。' },
  { id: 'wave', title: '波的叠加和干涉', category: 'education', cover: '/code-showcase/education.png', accent: '#0891b2', prompt: '制作一个波的叠加和干涉可视化网页，提供振幅、频率、相位滑块，并实时绘制两列波与合成波。' },
  { id: 'spelling', title: '偏旁拼字学习', category: 'education', cover: '/code-showcase/education.png', accent: '#65a30d', prompt: '创建一个面向儿童的偏旁拼字互动学习应用，通过拖拽偏旁组成汉字，包含发音、释义、闯关和正误反馈。' },
  { id: 'poem', title: '古诗排序挑战', category: 'education', cover: '/code-showcase/education.png', accent: '#9333ea', prompt: '制作古诗句排序挑战网页，随机打乱诗句，支持拖拽排序、提示、计时、评分和完整诗词赏析。' },
  { id: 'clock', title: '认识钟表时间', category: 'education', cover: '/code-showcase/education.png', accent: '#4f46e5', prompt: '创建一个儿童钟表学习网页，提供可拖动时针和分针、随机出题、数字时间同步显示与即时反馈。' },
  { id: 'blog', title: '个人博客', category: 'web', cover: '/code-showcase/web.png', accent: '#0f766e', prompt: '设计一个现代个人博客首页，包含作者介绍、精选文章、标签筛选、深浅色切换和响应式阅读布局。' },
  { id: 'resume', title: '极简个人简历', category: 'web', cover: '/code-showcase/web.png', accent: '#2563eb', prompt: '创建一份现代极简的响应式个人简历网页，包含个人简介、技能、项目经历、工作时间线和联系方式。' },
  { id: 'dashboard', title: '数据分析看板', category: 'web', cover: '/code-showcase/web.png', accent: '#7c3aed', prompt: '创建一个现代数据分析看板，包含 KPI 卡片、趋势折线图、分类柱状图、日期筛选和响应式侧边导航。' },
  { id: 'calculator', title: '计算器', category: 'utility', cover: '/code-showcase/utility.png', accent: '#ea580c', prompt: '制作一个支持键盘输入、历史记录、基础运算和百分比计算的现代计算器网页。' },
  { id: 'pomodoro', title: '专注计时器', category: 'utility', cover: '/code-showcase/utility.png', accent: '#dc2626', prompt: '创建一个番茄专注计时器，支持专注与休息周期、自定义时长、声音提醒、任务清单和统计。' },
  { id: 'weather', title: '天气卡片', category: 'utility', cover: '/code-showcase/utility.png', accent: '#0284c7', prompt: '设计一个精致的响应式天气应用界面，包含当前位置天气、逐小时预报、未来七天趋势和空气质量。' },
  { id: 'gomoku', title: '五子棋', category: 'interactive', cover: '/code-showcase/interactive.png', accent: '#a16207', prompt: '创建一个可玩的五子棋网页，支持双人对战、悔棋、重新开始、胜负判断和落子动画。' },
  { id: 'snake', title: '贪吃蛇', category: 'interactive', cover: '/code-showcase/interactive.png', accent: '#15803d', prompt: '制作一个现代贪吃蛇小游戏，支持键盘和触控操作、难度递增、最高分记录、暂停和重新开始。' },
  { id: 'tetris', title: '俄罗斯方块', category: 'interactive', cover: '/code-showcase/interactive.png', accent: '#db2777', prompt: '创建一个完整可玩的俄罗斯方块网页，包含下一个方块预览、计分、等级、暂停和键盘操作说明。' },
  { id: 'music', title: '沉浸式音乐播放器', category: 'interactive', cover: '/code-showcase/interactive.png', accent: '#7c3aed', prompt: '设计一个沉浸式音乐播放器，包含专辑封面、播放队列、进度控制、音量、歌词视图和动态背景。' },
];

export const CODE_SHOWCASE_PROJECTS: CodeShowcaseProject[] = RAW_CODE_SHOWCASE_PROJECTS.map((project) => ({
  ...project,
  prompt: optimizeCodePrompt(project.prompt),
}));
