import { WritingFieldDefinition, WritingSceneDefinition, WritingSceneId } from './writingTypes';

const options = (values: Array<string | number>) => values.map((value) => ({ value: String(value), label: value === '不限' ? '不限' : String(value) }));
const field = (id: string, label: string, values: Array<string | number>, defaultValue = String(values[0])): WritingFieldDefinition => ({ id, label, options: options(values), defaultValue });
const words = (values: number[]) => field('length', '字数', ['不限', ...values.map((value) => `${value}字`)]);

export const WRITING_SCENES: WritingSceneDefinition[] = [
  { id: 'general', label: '通用', description: '自由创作与文本改写', placeholder: '描述你想写的内容，或粘贴需要处理的原文', routingProfile: 'general-writing', fields: [field('action', '写法', ['写作','仿写','润色','扩写','缩写','续写']), field('style', '风格', ['不限','简洁','严肃','文艺','口语','幽默']), words([100,300,500,800,1000,1500,3000,5000,8000,10000,20000,30000])] },
  { id: 'essay', label: '作文', description: '按文体和学段完成作文', placeholder: '输入作文题目、材料和具体要求', routingProfile: 'general-writing', fields: [field('genre','文体',['通用作文','单元作文','议论文','记叙文','说明文','散文','日记','周记']), field('level','学段',['小学','初中','高中']), words([100,200,300,400,500,600,700,800,900,1000])] },
  { id: 'novel', label: '小说', description: '灵感、大纲、情节与角色', placeholder: '描述世界观、角色或你想展开的情节', routingProfile: 'character-writing', fields: [field('type','类型',['通用','写大纲','写灵感','写情节','细节描写','润色文本','扩写情节','续写情节','角色取名']), field('scope','篇幅',['篇幅不限','短篇小说','中篇小说','长篇小说'])] },
  { id: 'thesis', label: '论文', description: '论文结构与学术表达', placeholder: '输入论文主题、研究问题和已有材料', routingProfile: 'deep-research', fields: [field('type','论文类型',['通用类型','毕业论文','课程论文','职称论文','期刊论文','专升本论文']), field('level','学段',['学段不限','专科生','本科生','硕士生','博士生']), words([3000,5000,8000,10000,15000,20000,30000])] },
  { id: 'work-summary', label: '工作总结', description: '个人、团队与述职总结', placeholder: '输入工作内容、成果、问题和下一步计划', routingProfile: 'general-writing', fields: [field('type','类型',['通用总结','个人总结','团队总结','转正述职','竞聘述职','学生会']), field('audience','人群',['人群不限','企业人群','教师','医护','政府人员','学生'])] },
  { id: 'reflection', label: '读后感', description: '阅读、观影与心得记录', placeholder: '输入作品名称、内容概要和你的真实感受', routingProfile: 'long-context', fields: [field('type','类型',['通用主题','心得体会','读书笔记','观后感']), field('level','学段',['学段不限','小学','初中','高中','大学']), words([100,200,300,400,500,600,700,800,900,1000,1200,1500])] },
  { id: 'internship', label: '实习报告', description: '实习与社会实践材料', placeholder: '输入单位、岗位、工作内容、收获与反思', routingProfile: 'long-context', fields: [field('type','类型',['通用报告','实习','社会实践']), field('period','周期',['周期不限','完整报告','月报','周记','日记']), words([500,800,1000,1500,2000,3000,5000,8000,10000])] },
  { id: 'application', label: '申请书', description: '正式申请与个人陈述', placeholder: '输入申请事项、个人情况、理由和目标', routingProfile: 'general-writing', fields: [field('type','类型',['通用申请','入党','入团','奖学金','助学金','贫困补助','转正']), words([100,300,500,800,1000,1500,2000,3000])] },
  { id: 'report', 
    label: '开题报告', 
    description: '开题报告与个人陈述', 
    placeholder:  '输入项目名称、研究问题、研究方法、预期成果', 
    routingProfile: 'general-writing', 
    fields: [
      field('type','类型',['通用开题','毕业设计','课程设计','专业项目']), 
      field('level','学段',['学段不限','专科生','本科生','硕士生','博士生']), 
      field('major','专业',['专业不限','哲学','经济学','法学','教育学','文学','历史学','理学','工学','农学','医学','管理学','艺术学']), 
      words([100,300,500,800,1000,1500,2000,3000,5000,8000,10000,15000,20000,30000])
    ] 
  },
  { id: 'thought', 
    label: '思考汇报', 
    description: '个人思考与问题', 
    placeholder: '输入你想思考的问题或主题', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用人群','党员','积极分子','学生','工人','军人']), 
      words([100,300,500,800,1000,1500,2000,3000])
    ] 
  },
  { id: 'teaching', 
    label: '教案', 
    description: '教学方案', 
    placeholder: '输入你想思考的问题或主题', 
    routingProfile: 'general-writing', 
    fields: [
      field('level','学段',['学段不限','幼儿园','小学','初中','高中','大学']), 
      field('type','类型',['通用学科','语文','数学','英语','物理','化学','生物']),
      words([500,800,1000,1500,2000,3000,5000])
    ]
  },
  { id: 'rewrite', 
    label: '文稿仿写场景', 
    description: '文案仿写', 
    placeholder: '输入你想仿写的文案或稿子', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用稿件','媒体新闻','小红书文案','抖音文案','公众号推文','微博文案']), 
      words([100,300,500,800,1000,1500,2000,3000,5000,8000,10000])
    ] 
  },
  { id: 'scheme', 
    label: '策划方案', 
    description: '策划方案与活动策划', 
    placeholder: '输入策划主题、目标、内容和执行计划', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用方案','营销策划','活动策划','解决方案','项目方案']), 
      words([500,800,1000,1500,2000,3000,5000,8000,10000])
    ]
  },
  { id: 'business-plan', 
    label: '商业计划', 
    description: '商业计划书', 
    placeholder: '输入商业计划的主题、目标、内容和执行计划', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用主题','创业计划','融资计划']), 
      field('industry','行业',['行业不限','互联网','餐饮','美妆','门店','硬件','娱乐','服务']), 
      words([500,800,1000,1500,2000,3000,5000,8000,10000])
    ]
  },
  { id: 'blessing', 
    label: '祝福语', 
    description: '祝福语与贺卡', 
    placeholder: '输入祝福语的主题、对象和场景', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用格式','八字祝福','朋友圈','对仗','顺口溜','藏头诗','谐音梗','祝酒词']), 
      field('target','对象',['对象不限','长辈','老师','晚辈','学生','领导','客户','朋友','同事','情侣']), 
      words([50,100,200,300,400,500])
    ]
  },
  { id: 'friend-circle', 
    label: '朋友圈文案', 
    description: '朋友圈文案', 
    placeholder: '输入朋友圈文案的主题、对象和场景', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用场景','微商推广','情感抒发','旅游打卡','家庭记录','校园生活','美食分享']), 
      words([50,100,200,300,400,500])
    ]
  },
  { id: 'little-red-book', 
    label: '小红书文案', 
    description: '小红书文案', 
    placeholder: '输入小红书文案的主题、对象和场景', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用场景','物品介绍','旅游日志','美食攻略','门店体验','体验记录','情感抒发','生活记录']), 
      words([100,200,300,400,500,800,1000])
    ]
  },
  { id: 'book-review', 
    label: '心得体会', 
    description: '心得体会', 
    placeholder: '输入心得体会的主题、对象和场景', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用主题','党团','安全','培训','学习','参观','座谈','讲座','会议','活动']), 
      field('audience','人群',['人群不限','企业人员','教师','政府人员','学生']),
      words([300,400,500,800,1000,1500,2000,3000,5000,8000,10000])
    ]
  },
  { id: 'speech', 
    label: '发言稿', 
    description: '发言稿', 
    placeholder: '输入发言稿的主题、对象和场景', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用发言','自我介绍','面试','竞聘','演讲','主持','祝酒词','致辞','汇报','总结','表彰','答辩']), 
      field('tone','语气',['语气不限','正式','幽默','文艺','高情商','口语化','学术化','专业化']),
      words([100,200,300,400,500,600,800,1000,1200,1500])
    ]
  },
  { id: 'poem', 
    label: '诗句', 
    description: '诗句', 
    placeholder: '输入诗句的主题、对象和场景', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用诗句','五言律诗','五言绝句','七言律诗','七言绝句','现代诗','古体诗','自由诗','藏头诗','藏尾诗','顺口溜']), 
      field('emotion','情感',['情感不限','委婉','豪放','浪漫','自由','伤感']),
      words([50,100,200,300,400,500])
    ]
  },
  { id: 'emotional-reply', 
    label: '高情商回复', 
    description: '高情商回复', 
    placeholder: '输入高情商回复的主题、对象和场景', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用回复','情侣','职场','聚会','家庭','朋友圈','校园','社交','商务','客户','领导','同事','朋友']), 
      words([50,100,200,300,400,500,600,800,1000])
    ]
  },
  { id: 'self-introduction', 
    label: '自我介绍', 
    description: '自我介绍', 
    placeholder: '输入自我介绍的主题、对象和场景', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用介绍','新生入学','加入社团','求职面试','干部竞选','工作入职','社交聚会','商务洽谈','公众演讲']), 
      field('style','风格',['风格不限','正式','幽默','简洁','社恐','社牛','文艺','专业']),
      words([50,100,200,300,400,500,600,800,1000])
    ]
  },
  { id: 'daily-report', 
    label: '日报月报', 
    description: '日报月报', 
    placeholder: '输入日报月报的主题、对象和场景', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用报告','日报','周报','月报','季度报告','年度总结']),
      field('audience','人群',['人群不限','企业员工','实习生','教师','医护','政府人员','学生','社团成员']), 
      words([500,800,1000,1500,2000,3000,5000,8000,10000])
    ]
  },
  { id: 'survey', 
    label: '调查问卷', 
    description: '调查问卷', 
    placeholder: '输入调查问卷的主题、对象和场景', 
    routingProfile: 'general-writing',
    fields: [
      field('type','类型',['通用问卷','满意度调查','需求调研','社会调查','意见收集','市场调研','用户反馈']), 
      words([100,300,500,800,1000,1200])
    ]
  },
];

export const WRITING_SCENE_MAP = Object.fromEntries(WRITING_SCENES.map((scene) => [scene.id, scene])) as Record<WritingSceneId, WritingSceneDefinition>;
export const createDefaultWritingValues = () => Object.fromEntries(WRITING_SCENES.map((scene) => [scene.id, Object.fromEntries(scene.fields.map((item) => [item.id, item.defaultValue]))])) as Record<WritingSceneId, Record<string, string>>;
