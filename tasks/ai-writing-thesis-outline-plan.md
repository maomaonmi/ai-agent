# AI 写作论文场景：真实大纲、参考资料与流式正文计划

> 状态：产品方案已确认，待进入实施
> 日期：2026-08-12
> 所属版本：AI 写作 V2 · 论文工作台第一阶段
> 视觉参考：用户提供的千问论文大纲与章节设置截图

## 1. 目标

把当前固定的大纲演示改造成论文场景专属的真实工作流：第一次提交论文题目时只生成结构化大纲；系统随后为每个大章节检索真实参考资料；用户可调整全文期望字数、大章节长度、增删子章节或换一版大纲；确认后再点击“基于大纲生成正文”，正文按章节真实流式写入右侧文档区。

本阶段完成后，论文场景的主流程为：

```text
输入论文要求
  → 流式生成大纲
  → 按大章节联网检索参考资料
  → 用户编辑/换一换/调整章节长度
  → 基于已确认大纲生成正文
  → 按章节流式写入正文
```

## 2. 已确认的产品决策

1. “大纲”只在论文场景显示；通用、作文、小说、工作总结、读后感、实习报告和申请书不显示大纲标签。
2. 论文第一次提交只生成大纲，不直接生成正文。
3. 大纲由模型根据用户真实题目、论文类型、学段和期望字数生成，不使用固定章节数组。
4. 期望字数影响章节数量、层级深度和每章字数预算。
5. “换一换”基于当前题目和期望字数生成候选大纲；旧大纲和旧资料保留，用户确认后才切换。
6. 每个大章节以 4–6 条高质量参考资料为目标，上限 6 条；结果不足时展示真实数量，不填充虚假来源。
7. “参考资料”入口放在大章节“段落设置”和“＋”按钮左侧。
8. 段落长度设置作用于当前大章节，选项为“简短 / 适中 / 较长”。
9. “＋”直接展开两个输入框：子章节标题、子章节内容主题/写作要求；两个输入框末尾各有独立清除按钮。
10. 大纲和正文都必须使用真实服务端流式事件，禁止用前端定时器伪造打字机效果。

## 3. 场景与标签规则

### 3.1 论文场景

右侧顶部显示：

```text
大纲 | 正文 | 排版
```

- 初始进入大纲视图。
- 大纲未完成时，正文视图展示等待状态，不出现生成内容。
- 大纲完成后，底部出现“换一换”和“基于大纲生成正文”。
- 开始生成正文后自动切换到正文视图。

### 3.2 非论文场景

右侧顶部只显示：

```text
正文 | 排版
```

这些场景保持直接生成正文，不经过论文大纲链路。

## 4. 大纲信息架构

### 4.1 文档级字段

```ts
interface ThesisOutlineDocument {
  id: string;
  title: string;
  thesisType: string;
  educationLevel: string;
  targetWords: number | null;
  abstract: OutlinePrefaceNode;
  englishAbstract: OutlinePrefaceNode;
  chapters: ThesisOutlineChapter[];
  status: 'idle' | 'generating' | 'searching' | 'ready' | 'failed';
  versionId: string;
}
```

### 4.2 大章节字段

```ts
type ChapterLength = 'short' | 'medium' | 'long';

interface ThesisOutlineChapter {
  id: string;
  order: number;
  title: string;
  summary: string;
  length: ChapterLength;
  targetWords: number;
  children: ThesisOutlineSection[];
  references: ThesisReference[];
  generationStatus: 'pending' | 'streaming' | 'complete' | 'failed';
  searchStatus: 'idle' | 'searching' | 'complete' | 'failed';
}
```

### 4.3 子章节字段

```ts
interface ThesisOutlineSection {
  id: string;
  order: number;
  title: string;
  writingBrief: string;
  targetWords: number;
  status: 'pending' | 'streaming' | 'complete' | 'failed';
}
```

`writingBrief` 是后续正文生成的重要提示，不只是展示文案。

### 4.4 参考资料字段

```ts
interface ThesisReference {
  id: string;
  chapterId: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  evidenceText?: string;
  accessedAt: string;
  status: 'found' | 'scraped' | 'verified' | 'failed';
}
```

参考资料必须与大章节绑定，后续正文引用和核验继续使用同一个 `referenceId`。

## 5. 期望字数设计

论文场景新增字数档位：

```text
不限 / 3000 / 5000 / 8000 / 10000 / 15000 / 20000 / 30000
```

推荐的默认规划约束：

| 目标字数 | 建议大章节 | 层级深度 | 生成方式 |
|---|---:|---|---|
| 不限 / 3000 | 4–5 | 二级标题为主 | 可连续生成 |
| 5000 / 8000 | 5–7 | 二级标题，必要时三级 | 按大章节生成 |
| 10000 / 15000 | 6–9 | 二至三级标题 | 章节队列 |
| 20000 / 30000 | 8–12 | 三级标题 | 章节队列 + checkpoint |

模型可根据题目调整章节数，但必须满足总字数预算基本守恒。大章节的“简短 / 适中 / 较长”对应相对权重，而不是固定字数：

- 简短：默认章节预算的约 0.7 倍。
- 适中：默认章节预算的 1.0 倍。
- 较长：默认章节预算的约 1.4 倍。

调整某一大章节后，系统重新分配该章内部子章节预算；其他大章节默认不被静默修改。若导致全文预算明显超限，显示提示并允许用户确认重新平衡全文。

## 6. 大纲生成与流式协议

### 6.1 为什么不能流式返回一个完整 JSON

完整 JSON 在结束前通常无法稳定解析，也无法逐节点渲染。论文大纲应使用离散 SSE 事件，每个事件都是合法 JSON。

### 6.2 建议事件

```text
thesis_outline_started
thesis_title
thesis_preface
thesis_chapter_started
thesis_chapter_delta
thesis_section
thesis_chapter_completed
thesis_outline_completed
thesis_outline_failed
```

事件示例：

```json
{
  "type": "thesis_section",
  "document_id": "doc-123",
  "chapter_id": "chapter-2",
  "section": {
    "id": "section-2-1",
    "title": "2.1 相关理论基础",
    "writing_brief": "梳理核心理论并说明与研究问题的联系"
  }
}
```

前端收到节点事件后立即添加章节；收到 `chapter_delta` 后只更新当前章节摘要。UI 可按动画帧合并小 Token，既保持真实流式，也避免每个汉字触发整页重渲染。

## 7. 联网搜索与网页抓取

### 7.1 协议选择

论文参考资料需要稳定获得来源列表和后续引用映射。实施时优先使用千问 DashScope 原生协议：

- `enable_search: true`
- `search_options.enable_source: true`
- 需要正文角标时使用 `enable_citation: true`
- 流式时使用 `prepend_search_result: true` 提前返回来源
- 对选中的 URL 使用网页抓取/`web_extractor` 获取证据正文

官方依据：

- https://platform.qianwenai.com/docs/developer-guides/tool-calling/web-search
- https://platform.qianwenai.com/docs/developer-guides/tool-calling/web-scraping

当前普通聊天使用的 OpenAI Chat Completions 兼容搜索链路继续保留，但不作为论文参考资料的唯一来源契约，因为官方不保证该协议返回来源和自动角标。

### 7.2 每章搜索策略

1. 大纲章节完成后，根据“论文题目 + 大章节标题 + 子章节主题”构造章节查询。
2. 每个大章节独立搜索，避免全文只得到一批宽泛来源。
3. 获取候选来源后去重、过滤不可访问页面和低相关结果。
4. 抓取高相关页面正文或关键片段。
5. 最终为每章选择目标 4–6 条，上限 6 条。
6. 搜索不足时展示真实数量和“资料不足”提示，可手动重新搜索。

### 7.3 搜索事件

```text
chapter_search_started
chapter_reference_found
chapter_reference_scraped
chapter_search_completed
chapter_search_failed
```

参考资料入口在搜索过程中显示数量和加载状态，例如“参考资料 3/6”。点击后展开来源列表，不打断大纲流式生成。

## 8. 大章节操作设计

每个大章节标题栏结构：

```text
[拖拽] 2. 文献综述        [参考资料 5] [段落设置] [＋]
```

### 8.1 段落长度设置

点击设置按钮打开向下菜单：

```text
段落长度设置
— 段落简短
≡ 段落适中 ✓
☰ 段落较长
──────────
删除大章节
```

- 设置仅作用于当前大章节。
- 更改设置后立即更新章节预算和保存草稿。
- 已经生成正文时，更改长度只标记“正文需要重新生成”，不自动覆盖现有正文。
- 删除大章节需要二次确认；若已有正文或参考资料，应明确告知影响。

### 8.2 添加子章节

点击“＋”后在大章节底部展开：

```text
[输入子章节标题                              ×]
[输入子章节内容主题/写作要求                  ×]
                              [取消] [添加子章节]
```

- 两个输入框后面分别有清除按钮，只清除对应输入内容。
- 标题必填；内容主题建议填写，未填写时允许模型根据标题补全。
- 添加成功后按当前排序生成编号，并重新分配当前大章节内部字数。
- 输入框支持 Esc 取消、Ctrl/Cmd + Enter 确认。

## 9. “换一换”版本机制

1. 点击“换一换”后，旧大纲继续可见且不可被覆盖。
2. 系统按当前题目、论文参数和最新期望字数流式生成候选大纲。
3. 候选大纲完成后提供“采用新版 / 保留原版”。
4. 只有用户采用新版后，才将其设为活动版本。
5. 新版采用后重新执行章节搜索；旧版及旧参考资料保留在版本历史中。
6. 手动添加或修改的章节在换一换之前提示“新版不会自动继承手动调整”。

## 10. 基于大纲生成正文

右侧大纲底部固定操作条：

```text
[换一换] [基于大纲生成正文]
```

按钮状态：

- 大纲生成中：两个按钮禁用。
- 大纲完成但搜索仍在进行：允许换一换；正文按钮显示“参考资料检索中”。
- 大纲和参考资料完成：正文按钮可用。
- 参考资料部分失败：允许用户选择重试搜索或使用现有资料继续。
- 正文生成中：正文按钮变为“暂停生成”。

正文按大章节/子章节队列生成，使用事件：

```text
thesis_body_started
thesis_section_started
thesis_section_delta
thesis_citation_added
thesis_section_completed
thesis_body_paused
thesis_body_completed
thesis_body_failed
```

每个 `section_delta` 立即写入右侧正文对应章节。章节完成时保存 checkpoint，避免刷新、暂停或失败后丢失已生成内容。

## 11. 前端组件拆分

当前 `WritingWorkspace.tsx` 已超过适合继续堆叠逻辑的范围，实施时拆分：

```text
features/ai-writing/thesis/
├─ ThesisOutlineView.tsx
├─ ThesisOutlineHeader.tsx
├─ ThesisChapterCard.tsx
├─ ThesisChapterLengthMenu.tsx
├─ ThesisAddSectionForm.tsx
├─ ThesisReferencesPopover.tsx
├─ ThesisOutlineActions.tsx
├─ ThesisBodyView.tsx
├─ thesisTypes.ts
├─ thesisEvents.ts
├─ thesisReducer.ts
├─ thesisApi.ts
└─ thesisPrompts.ts
```

`WritingWorkspace` 负责场景路由和双栏布局；论文组件负责大纲、搜索和正文状态。提示词继续放在独立文件，不写进 React 组件。

## 12. 后端边界

建议新增论文专用接口，避免把结构化论文事件混进普通 `/chat`：

```text
POST /api/writing/thesis/outline/stream
POST /api/writing/thesis/{document_id}/references/stream
POST /api/writing/thesis/{document_id}/body/stream
POST /api/writing/thesis/{document_id}/outline/regenerate
PUT  /api/writing/thesis/{document_id}/outline
```

所有写接口校验 `writing` 会话和文档归属；搜索参数、目标字数、章节数量和输入长度在后端限制。未提交草稿仍保存在本地，首次大纲请求才创建 `writing` 会话。

## 13. 实施阶段

### Phase A：论文状态契约与场景门控

- 定义论文大纲、章节、子章节、资料和版本类型。
- 论文显示三标签；其他场景隐藏大纲。
- 论文首次提交改为大纲请求，不再调用普通正文生成。

**检查点：** 论文与其他七类场景不会串链；旧写作会话仍可打开。

### Phase B：真实流式大纲

- 实现论文大纲提示词和结构化 SSE 事件。
- 前端 reducer 幂等消费事件并逐节点渲染。
- 增加期望字数和章节预算。

**检查点：** 不同论文题目生成不同大纲；生成过程真实逐步呈现；刷新后可恢复已完成节点。

### Phase C：章节编辑与版本

- 实现当前大章节长度设置。
- 实现“＋”和双输入框、双清除按钮。
- 实现删除章节、重新编号和预算更新。
- 实现“换一换”候选版本与确认采用。

**检查点：** 编辑不会静默覆盖正文或旧版本；键盘和鼠标均可完成操作。

### Phase D：每章联网搜索

- 接入千问原生搜索来源返回。
- 按大章节构造查询、去重并筛选 4–6 条。
- 使用网页抓取补充证据片段。
- 实现参考资料入口和搜索状态。

**检查点：** 所有展示来源都有真实 URL；每条资料绑定正确章节；不足时不造假。

### Phase E：基于大纲流式生成正文

- 实现底部固定操作条。
- 按章节队列生成，逐 Token 写入正文。
- 支持暂停、继续、失败重试和 checkpoint。

**检查点：** 论文不会在大纲确认前生成正文；页面可看到真实流式文本；失败不丢已完成章节。

### Phase F：质量验收

- 测试 3000、8000、15000、30000 字规划。
- 测试来源不足、网页抓取失败、断网、刷新和恢复。
- 测试 1440/1024/768/320 布局、焦点和 reduced motion。
- 按参考截图执行设计 QA。

## 14. 测试策略

### 单元测试

- 期望字数映射和章节预算。
- 大章节长度权重及子章节重新分配。
- SSE 事件重放与去重。
- 子章节增删、编号和版本切换。
- 搜索来源按 URL 归一化去重及最多 6 条限制。

### API 测试

- 非论文场景不能调用论文大纲接口。
- 非法字数、章节数量和超长输入被拒绝。
- 搜索来源事件与章节 ID 一致。
- 流中断后可从 checkpoint 恢复。

### 浏览器验收

- 大纲仅论文场景可见。
- 大纲和正文都逐步出现，而不是完成后整块显示。
- “参考资料、段落设置、＋”排列和截图一致。
- 双清除按钮只清除各自输入框。
- “换一换”不会覆盖旧版本。

## 15. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 流式完整 JSON 中途不可解析 | 高 | 使用离散、合法 JSON SSE 事件 |
| OpenAI 兼容搜索拿不到稳定来源 | 高 | 论文链路使用 DashScope 原生来源契约 |
| 每章搜索导致调用量过高 | 高 | 限并发、缓存同查询、最多 6 条、按需重试 |
| 换一换覆盖用户手工修改 | 高 | 候选版本确认后才切换 |
| 30000 字 DOM 更新卡顿 | 高 | 按章节存储、动画帧批量 Token、分段渲染 |
| 参考资料与正文引用错位 | 高 | 全程使用稳定 chapter/section/reference ID |

## 16. 完成定义

- 只有论文场景显示大纲。
- 论文第一次提交只生成真实大纲。
- 大纲随题目、论文参数和字数变化，结构清晰且真实流式呈现。
- 每个大章节拥有长度设置、添加子章节和参考资料入口。
- 添加子章节包含两个输入框与两个独立清除按钮。
- “换一换”保留旧版本并在确认后切换。
- 参考资料来自真实搜索与抓取，不伪造数量或来源。
- 正文只能由“基于大纲生成正文”触发，并按章节真实流式生成。
- 新增代码通过类型检查、限定 lint、相关测试和浏览器视觉验收。

