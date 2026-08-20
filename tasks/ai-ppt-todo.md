# AI PPT 实施任务清单

每项任务应在单个专注会话内完成，并尽量控制在 5 个文件以内。任务顺序按依赖排列。

## Phase 0：技术验证

### Task 1：LibreOffice 运行时探测

**Description:** 增加可配置的 `soffice` 路径解析、版本探测、任务级临时用户配置和健康检查。

**Acceptance criteria:**

- [ ] Windows 默认路径和 `LIBREOFFICE_PATH` 均可解析。
- [ ] 并发转换使用独立用户配置目录。
- [ ] 未安装时返回结构化 `LIBREOFFICE_NOT_AVAILABLE`。

**Verification:** `python -m pytest -q tests/test_ppt_runtime.py`

**Dependencies:** None

**Files likely touched:** `ppt_runtime.py`, `tests/test_ppt_runtime.py`, `requirements.txt`

### Task 2：全能力导出技术样例

**Description:** 用 PptxGenJS 生成含文字、图片、图形、表格、图表、媒体和备注的样例，再由 OOXML 后处理器加入切换与常用动画。

**Acceptance criteria:**

- [ ] 样例覆盖全部约定元素。
- [ ] 解包关系和 XML 校验通过。
- [ ] LibreOffice 转 PDF 成功，真实 PowerPoint 打开无修复提示。

**Verification:** `npm run build`；`python -m pytest -q tests/test_ppt_ooxml_spike.py`；人工 PowerPoint 验收记录

**Dependencies:** Task 1

**Files likely touched:** `frontend/ai-agent/src/features/ppt/export/pptxSpike.ts`, `ppt_ooxml.py`, `tests/test_ppt_ooxml_spike.py`, `frontend/ai-agent/package.json`, `frontend/ai-agent/package-lock.json`

## Checkpoint A：高风险能力

- [ ] LibreOffice 探测与转换稳定。
- [ ] 全能力样例不触发 PowerPoint 修复。
- [ ] 动画不通过时暂停后续高级编辑，先提交兼容性结论。

## Phase 1：领域模型和存储

### Task 3：定义 PresentationDocument 契约

**Description:** 建立主题、幻灯片、元素判别联合、动画、备注和操作模型，并提供前后端一致的 schemaVersion 1。

**Acceptance criteria:**

- [ ] 全部元素几何和样式字段有边界校验。
- [ ] 未知字段被拒绝，旧文档可通过 schemaVersion 路由迁移。
- [ ] TypeScript 与 Pydantic Golden JSON 一致。

**Verification:** `python -m pytest -q tests/test_ppt_models.py`; `npm run lint`

**Dependencies:** Task 2

**Files likely touched:** `ppt_models.py`, `tests/test_ppt_models.py`, `frontend/ai-agent/src/features/ppt/types.ts`, `frontend/ai-agent/src/features/ppt/__tests__/types.contract.ts`

### Task 4：实现文档操作归约与修订冲突

**Description:** 实现操作列表应用、不可变修订、`baseRevision` 冲突和操作幂等。

**Acceptance criteria:**

- [ ] 新增/删除/排序页与全部元素操作可归约。
- [ ] 重复 operationId 不重复应用。
- [ ] 过期 baseRevision 返回冲突而不覆盖数据。

**Verification:** `python -m pytest -q tests/test_ppt_operations.py`

**Dependencies:** Task 3

**Files likely touched:** `ppt_operations.py`, `ppt_models.py`, `tests/test_ppt_operations.py`

### Task 5：建立 PPT Repository

**Description:** 创建模板、预览页、演示文稿、修订、Run、Event、Asset 和 Export 表及 CRUD。

**Acceptance criteria:**

- [ ] 初始化可重复执行。
- [ ] Run 事件 `(runId, sequence)` 唯一且 append-only。
- [ ] 模板与资产 owner 过滤生效。

**Verification:** `python -m pytest -q tests/test_ppt_repository.py`

**Dependencies:** Task 3

**Files likely touched:** `ppt_repository.py`, `tests/test_ppt_repository.py`, `ppt_models.py`

## Checkpoint B：数据基础

- [ ] 模型、操作和 Repository 测试通过。
- [ ] 不修改现有会话表语义。
- [ ] `python -m pytest -q` 无回归。

## Phase 2：模板市场纵向切片

### Task 6：模板 REST API

**Description:** 提供分页列表、详情、更新、删除和预览页列表，统一错误契约。

**Acceptance criteria:**

- [ ] 列表支持分页、场景、来源和关键字过滤。
- [ ] 私有模板越权访问返回 404。
- [ ] 删除幂等且不暴露磁盘路径。

**Verification:** `python -m pytest -q tests/test_ppt_template_api.py`

**Dependencies:** Task 5

**Files likely touched:** `ppt_api.py`, `ppt_service.py`, `tests/test_ppt_template_api.py`, `main.py`

### Task 7：PPT 前端 API 与模板 Store

**Description:** 建立独立 `pptApi`、分页查询和模板上传状态 store，不向全局 `api.ts` 塞入大量业务类型。

**Acceptance criteria:**

- [ ] API 响应和统一错误被类型化。
- [ ] 列表支持取消旧请求和分页追加。
- [ ] 上传状态可在页面重挂载后恢复查询。

**Verification:** `npm run lint`; `npm run build`

**Dependencies:** Task 6

**Files likely touched:** `frontend/ai-agent/src/features/ppt/api.ts`, `frontend/ai-agent/src/features/ppt/store.ts`, `frontend/ai-agent/src/features/ppt/types.ts`

### Task 8：增加双入口和独立路由

**Description:** 绑定“更多 → PPT 创作”，为展开/折叠侧边栏增加 AI PPT，并创建 `/ppt` 路由壳。

**Acceptance criteria:**

- [ ] 两个入口都导航到 `/ppt`。
- [ ] 不改变聊天会话模式和当前消息。
- [ ] 刷新 `/ppt` 可直接打开。

**Verification:** `python -m pytest -q tests/test_ppt_entry_contract.py`; `npm run build`

**Dependencies:** Task 7

**Files likely touched:** `frontend/ai-agent/src/components/ChatInterface.tsx`, `frontend/ai-agent/src/components/SessionSidebar.tsx`, `frontend/ai-agent/src/app/ppt/page.tsx`, `tests/test_ppt_entry_contract.py`

### Task 9：现代模板市场页面

**Description:** 实现推荐 Bento 区、筛选、搜索、上传卡和响应式模板网格。

**Acceptance criteria:**

- [ ] 卡片悬停显示预览和使用按钮。
- [ ] 私有模板有明确标识和管理操作。
- [ ] 键盘焦点可触达卡片操作，移动端不依赖 hover。

**Verification:** `npm run lint`; `npm run build`; 浏览器手工检查 1280/1440/1920px

**Dependencies:** Task 7, Task 8

**Files likely touched:** `frontend/ai-agent/src/features/ppt/market/PptTemplateMarket.tsx`, `frontend/ai-agent/src/features/ppt/market/TemplateCard.tsx`, `frontend/ai-agent/src/features/ppt/market/TemplateFilters.tsx`, `frontend/ai-agent/src/app/ppt/page.tsx`

### Task 10：模板全页预览弹窗

**Description:** 实现缩略图栏、大图、分页按需加载、键盘控制、缩放、全屏和使用模板。

**Acceptance criteria:**

- [ ] 所有预览页可访问，第一页优先加载。
- [ ] 弹窗焦点被正确约束，Escape 可关闭。
- [ ] 缺字体、媒体和动画提示可见。

**Verification:** `npm run build`; 浏览器键盘与全屏检查

**Dependencies:** Task 9

**Files likely touched:** `frontend/ai-agent/src/features/ppt/market/TemplatePreviewDialog.tsx`, `frontend/ai-agent/src/features/ppt/market/PptTemplateMarket.tsx`, `frontend/ai-agent/src/features/ppt/api.ts`

## Checkpoint C：市场主路径

- [ ] 两个入口、市场、悬停、预览、使用模板端到端可用。
- [ ] 前端 lint/build 通过。
- [ ] 市场页 Lighthouse 可访问性无严重问题。

## Phase 3：私有模板上传

### Task 11：PPTX 安全扫描与主题提取

**Description:** 验证 ZIP/OOXML，拒绝宏和危险归档，提取主题、字体、页面尺寸、母版和布局清单。

**Acceptance criteria:**

- [ ] ZIP Bomb、路径穿越、恶意 XML 和损坏关系测试被拒绝。
- [ ] `.pptx`/`.potx` 主题和布局可生成 TemplateManifest。
- [ ] 原始内容元素不进入新文档。

**Verification:** `python -m pytest -q tests/test_ppt_template_parser.py tests/test_ppt_security.py`

**Dependencies:** Task 1, Task 5

**Files likely touched:** `ppt_template_parser.py`, `ppt_security.py`, `tests/test_ppt_template_parser.py`, `tests/test_ppt_security.py`

### Task 12：LibreOffice 全页预览流水线

**Description:** 把上传模板转 PDF，再逐页生成 WebP 封面、缩略图和大预览图。

**Acceptance criteria:**

- [ ] 200 页以内文稿的每一页都有可查询状态。
- [ ] 转换超时、字体缺失和损坏文件有稳定错误码。
- [ ] 同模板重复处理可幂等恢复。

**Verification:** `python -m pytest -q tests/test_ppt_template_pipeline.py`

**Dependencies:** Task 1, Task 11

**Files likely touched:** `ppt_template_pipeline.py`, `ppt_runtime.py`, `ppt_repository.py`, `tests/test_ppt_template_pipeline.py`

### Task 13：上传 API 与市场状态接线

**Description:** 接入 multipart 上传、异步处理、状态查询及前端拖拽/进度/重试。

**Acceptance criteria:**

- [ ] 上传完成前模板卡显示真实阶段。
- [ ] 刷新后仍可继续查询处理状态。
- [ ] 成功后立即可打开全部页预览。

**Verification:** `python -m pytest -q tests/test_ppt_upload_api.py`; `npm run build`; 浏览器上传样例

**Dependencies:** Task 10, Task 12

**Files likely touched:** `ppt_api.py`, `tests/test_ppt_upload_api.py`, `frontend/ai-agent/src/features/ppt/market/TemplateUploadCard.tsx`, `frontend/ai-agent/src/features/ppt/api.ts`, `frontend/ai-agent/src/features/ppt/market/PptTemplateMarket.tsx`

## Checkpoint D：私有模板

- [ ] 上传、解析、全部页预览、删除和权限测试通过。
- [ ] 超大/恶意文件不会落入可访问资产区。

## Phase 4：基础工作台

### Task 14：工作台路由与文档加载

**Description:** 创建 `/ppt/workspace/[presentationId]`、工作台壳、加载/空/冲突/错误状态。

**Acceptance criteria:**

- [ ] 使用模板可创建 Presentation 并打开工作台。
- [ ] 刷新后恢复当前修订。
- [ ] 不存在或无权文稿显示稳定错误页。

**Verification:** `npm run build`; `python -m pytest -q tests/test_ppt_presentation_api.py`

**Dependencies:** Task 4, Task 6, Task 10

**Files likely touched:** `frontend/ai-agent/src/app/ppt/workspace/[presentationId]/page.tsx`, `frontend/ai-agent/src/features/ppt/workspace/PptWorkspace.tsx`, `frontend/ai-agent/src/features/ppt/api.ts`, `ppt_api.py`, `tests/test_ppt_presentation_api.py`

### Task 15：幻灯片缩略图与页面 CRUD

**Description:** 实现新增、复制、删除、排序、选择和撤销重做。

**Acceptance criteria:**

- [ ] 排序有键盘替代操作。
- [ ] 操作生成稳定 operationId 并持久化新修订。
- [ ] 409 冲突不会丢失本地草稿。

**Verification:** `npm run lint`; `npm run build`; store reducer 测试

**Dependencies:** Task 14

**Files likely touched:** `frontend/ai-agent/src/features/ppt/workspace/SlideNavigator.tsx`, `frontend/ai-agent/src/features/ppt/store.ts`, `frontend/ai-agent/src/features/ppt/operations.ts`, `frontend/ai-agent/src/features/ppt/workspace/PptWorkspace.tsx`

### Task 16：SVG 画布与基础元素编辑

**Description:** 实现选择、框选、拖动、缩放、旋转、吸附、图层，以及文字、图片和基础图形。

**Acceptance criteria:**

- [ ] 画布缩放不改变文档几何值。
- [ ] 文字可用 Tiptap 编辑并保留富文本样式。
- [ ] 元素操作可撤销、重做和保存。

**Verification:** `npm run build`; 浏览器拖拽/缩放/旋转检查

**Dependencies:** Task 15

**Files likely touched:** `frontend/ai-agent/src/features/ppt/editor/SlideCanvas.tsx`, `frontend/ai-agent/src/features/ppt/editor/ElementRenderer.tsx`, `frontend/ai-agent/src/features/ppt/editor/SelectionOverlay.tsx`, `frontend/ai-agent/src/features/ppt/editor/RichTextElement.tsx`, `frontend/ai-agent/src/features/ppt/store.ts`

### Task 17：顶部工具栏与属性面板

**Description:** 实现参考图中的工具栏和属性抽屉，接入新增元素、格式、对齐和层级操作。

**Acceptance criteria:**

- [ ] 工具栏包含全部约定入口并根据选中元素切换状态。
- [ ] 常用快捷键和禁用状态正确。
- [ ] 小屏属性面板切为抽屉。

**Verification:** `npm run lint`; `npm run build`; 浏览器 1024/1440px 检查

**Dependencies:** Task 16

**Files likely touched:** `frontend/ai-agent/src/features/ppt/workspace/PptToolbar.tsx`, `frontend/ai-agent/src/features/ppt/inspector/PropertyInspector.tsx`, `frontend/ai-agent/src/features/ppt/workspace/PptWorkspace.tsx`

## Checkpoint E：基础编辑

- [ ] 页面 CRUD、基础元素、撤销重做、修订保存完整可用。
- [ ] 文档刷新恢复，无几何漂移。

## Phase 5：高级编辑

### Task 18：表格编辑器

**Description:** 支持表格插入、行列操作、单元格格式和合并。

**Acceptance criteria:**

- [ ] 数据与样式进入 TableElement 契约。
- [ ] 大表格有边界和溢出提示。
- [ ] 导出样例可在 LibreOffice/PowerPoint 查看。

**Verification:** `npm run build`; 导出 Golden 样例

**Dependencies:** Task 17

**Files likely touched:** `frontend/ai-agent/src/features/ppt/editor/TableElementView.tsx`, `frontend/ai-agent/src/features/ppt/inspector/TableInspector.tsx`, `frontend/ai-agent/src/features/ppt/types.ts`

### Task 19：图表编辑器

**Description:** 支持基础和组合图表、数据表编辑、图例、坐标轴、标签和主题配色。

**Acceptance criteria:**

- [ ] 支持柱、线、饼、面积、散点和组合图。
- [ ] 非法数据在边界被拒绝。
- [ ] 导出后图表保持结构化可编辑。

**Verification:** `npm run build`; 导出 Golden 样例

**Dependencies:** Task 17

**Files likely touched:** `frontend/ai-agent/src/features/ppt/editor/ChartElementView.tsx`, `frontend/ai-agent/src/features/ppt/inspector/ChartInspector.tsx`, `frontend/ai-agent/src/features/ppt/types.ts`

### Task 20：媒体与备注

**Description:** 支持音频、视频、在线媒体、海报帧、播放设置和演讲者备注。

**Acceptance criteria:**

- [ ] 媒体上传验证格式、大小和时长。
- [ ] 浏览器可预览，PPTX 使用结构化媒体关系。
- [ ] 备注随页面修订和导出保存。

**Verification:** `python -m pytest -q tests/test_ppt_media.py`; `npm run build`

**Dependencies:** Task 17

**Files likely touched:** `ppt_assets.py`, `tests/test_ppt_media.py`, `frontend/ai-agent/src/features/ppt/editor/MediaElementView.tsx`, `frontend/ai-agent/src/features/ppt/inspector/MediaInspector.tsx`, `frontend/ai-agent/src/features/ppt/inspector/NotesPanel.tsx`

### Task 21：动画、切换与放映

**Description:** 实现动画时间线、页面切换、Web Animations 预览和简易放映模式。

**Acceptance criteria:**

- [ ] 支持进入、强调、退出、路径四类及三种触发方式。
- [ ] 时间线排序、延迟和时长可编辑。
- [ ] 放映按页面切换和动画顺序执行。

**Verification:** `npm run build`; 浏览器动画/放映检查；Golden 导出验证

**Dependencies:** Task 2, Task 17

**Files likely touched:** `frontend/ai-agent/src/features/ppt/animation/AnimationTimeline.tsx`, `frontend/ai-agent/src/features/ppt/animation/animationPlayer.ts`, `frontend/ai-agent/src/features/ppt/presentation/SlideshowMode.tsx`, `frontend/ai-agent/src/features/ppt/types.ts`

## Checkpoint F：完整编辑能力

- [ ] 表格、图表、媒体、动画、切换、备注和放映全部可用。
- [ ] Golden PPTX 在真实 PowerPoint 打开无修复提示。

## Phase 6：Agent Loop 与搜索

### Task 22：PPT Run 状态机与事件账本

**Description:** 实现可恢复的 Run 状态、阶段转换、事件序号、取消和父 Run 重试关系。

**Acceptance criteria:**

- [ ] 非法状态转换被拒绝。
- [ ] 重启后可从最后持久化阶段继续。
- [ ] 取消不会继续写文档操作。

**Verification:** `python -m pytest -q tests/test_ppt_run_state.py`

**Dependencies:** Task 5

**Files likely touched:** `ppt_run_state.py`, `ppt_repository.py`, `tests/test_ppt_run_state.py`

### Task 23：三供应商搜索适配器

**Description:** 抽象 DeepSeek/Firecrawl、千问原生、GLM 原生搜索，统一来源与 Observation。

**Acceptance criteria:**

- [ ] 每次查询 limit/count 被强制限制在 1–20。
- [ ] 每种供应商均返回统一来源结构。
- [ ] 第三方畸形响应不会污染 Agent 状态。

**Verification:** `python -m pytest -q tests/test_ppt_search_providers.py`

**Dependencies:** Task 22

**Files likely touched:** `ppt_search_providers.py`, `ppt_models.py`, `tests/test_ppt_search_providers.py`, `main.py`

### Task 24：多轮 PPT Agent Loop

**Description:** 实现 Intake、Plan、Research、Storyboard、Compose、QA 的 Decide/Act/Observe 循环和预算护栏。

**Acceptance criteria:**

- [ ] 事实型任务至少两轮搜索。
- [ ] 最大迭代、搜索和总时限生效。
- [ ] 每个阶段均产生可显示的持久事件。

**Verification:** `python -m pytest -q tests/test_ppt_agent.py`

**Dependencies:** Task 23

**Files likely touched:** `ppt_agent.py`, `ppt_agent_prompts.py`, `ppt_models.py`, `tests/test_ppt_agent.py`

### Task 25：Run API 与可恢复 SSE

**Description:** 提供幂等创建、状态查询、Last-Event-ID 续订、取消和父 Run 重试。

**Acceptance criteria:**

- [ ] 重复 clientRequestId 返回同一 Run。
- [ ] SSE 断线续订不重复或漏发事件。
- [ ] 结构化错误和终止事件始终发送。

**Verification:** `python -m pytest -q tests/test_ppt_run_api.py`

**Dependencies:** Task 22, Task 24

**Files likely touched:** `ppt_api.py`, `ppt_agent_service.py`, `tests/test_ppt_run_api.py`, `main.py`

## Checkpoint G：Agent 可观察性

- [ ] 三供应商路径均完成两轮搜索样例。
- [ ] SSE 断线恢复、取消和重试测试通过。

## Phase 7：素材与实时构建

### Task 26：网页图片收集与安全下载

**Description:** 从搜索网页发现候选图片，执行安全、质量、去重和来源记录，强制至少采用三张。

**Acceptance criteria:**

- [ ] 每张图关联来源页、原图、alt、版权提示、尺寸和哈希。
- [ ] SSRF、非图片、超大图和低分辨率被拒绝。
- [ ] 不足三张时 Agent 自动继续检索或进入 NEEDS_ATTENTION。

**Verification:** `python -m pytest -q tests/test_ppt_web_images.py`

**Dependencies:** Task 23, Task 24

**Files likely touched:** `ppt_web_images.py`, `ppt_assets.py`, `ppt_agent.py`, `tests/test_ppt_web_images.py`

### Task 27：三角色 AI 图片任务

**Description:** 复用现有图片服务生成封面、中段背景和结尾图，带占位、重试和资产追踪。

**Acceptance criteria:**

- [ ] 三个角色均在运行事件和文档资产中可识别。
- [ ] 每个角色独立失败和重试。
- [ ] Run 完成门禁验证三张图均实际进入页面。

**Verification:** `python -m pytest -q tests/test_ppt_generated_images.py`

**Dependencies:** Task 24

**Files likely touched:** `ppt_image_generation.py`, `ppt_agent.py`, `ppt_assets.py`, `tests/test_ppt_generated_images.py`

### Task 28：逐元素 Compose 操作流

**Description:** 把故事板转为页面与元素操作，事件先持久化再更新文档修订。

**Acceptance criteria:**

- [ ] 页面、背景、标题、正文、图片、图表和装饰逐项产生事件。
- [ ] 同一事件重放不会重复元素。
- [ ] 中断后可从最后 operationId 继续。

**Verification:** `python -m pytest -q tests/test_ppt_compose_stream.py`

**Dependencies:** Task 4, Task 24, Task 26, Task 27

**Files likely touched:** `ppt_composer.py`, `ppt_agent.py`, `ppt_operations.py`, `tests/test_ppt_compose_stream.py`

### Task 29：左侧 Agent 流程栏与实时画布接线

**Description:** 消费 Run SSE，左侧按阶段/轮次展示工作流，右侧按序应用操作并动画呈现组件。

**Acceptance criteria:**

- [ ] 搜索次数、结果数、图片来源和生成角色实时可见。
- [ ] 画布按元素事件逐个更新，不等待最终文稿。
- [ ] 刷新用 Last-Event-ID 与服务器修订恢复。

**Verification:** `npm run build`; 浏览器断网重连和刷新检查

**Dependencies:** Task 25, Task 28, Task 17

**Files likely touched:** `frontend/ai-agent/src/features/ppt/agent/PptAgentRail.tsx`, `frontend/ai-agent/src/features/ppt/agent/usePptRunEvents.ts`, `frontend/ai-agent/src/features/ppt/store.ts`, `frontend/ai-agent/src/features/ppt/workspace/PptWorkspace.tsx`

## Checkpoint H：完整 AI 生成路径

- [ ] 从输入需求到逐页完成可完整观察。
- [ ] 网页图 3 张和 AI 图 3 张门禁可证明。
- [ ] 刷新、断线、取消、失败重试均不破坏文档。

## Phase 8：QA 与导出

### Task 30：内容和视觉 QA

**Description:** 检查引用、事实覆盖、文字溢出、重叠、对比度、字体、图片清晰度和素材门禁，并产生可修复问题。

**Acceptance criteria:**

- [ ] QA 问题关联到具体 slideId/elementId。
- [ ] 自动修复也通过操作流记录。
- [ ] 未解决的阻塞问题不允许标记 Run 完成。

**Verification:** `python -m pytest -q tests/test_ppt_qa.py`

**Dependencies:** Task 28

**Files likely touched:** `ppt_qa.py`, `ppt_agent.py`, `ppt_models.py`, `tests/test_ppt_qa.py`

### Task 31：生产 PPTX 导出器

**Description:** 把 PresentationDocument 转成结构化 PPTX，执行动画后处理、XML 校验和 LibreOffice 渲染烟雾测试。

**Acceptance criteria:**

- [ ] 全部元素、备注、媒体、切换和动画进入输出。
- [ ] 导出任务异步、幂等且可查询失败原因。
- [ ] LibreOffice 验证通过后才开放下载。

**Verification:** `python -m pytest -q tests/test_ppt_export.py`; Golden PowerPoint 人工验收

**Dependencies:** Task 2, Task 18, Task 19, Task 20, Task 21, Task 30

**Files likely touched:** `frontend/ai-agent/src/features/ppt/export/pptxExporter.ts`, `ppt_export_service.py`, `ppt_ooxml.py`, `ppt_api.py`, `tests/test_ppt_export.py`

### Task 32：放映、下载与完成态 UI

**Description:** 接入放映、导出进度、下载、失败重试、来源清单和完成摘要。

**Acceptance criteria:**

- [ ] 下载按钮只在已验证导出成功后可用。
- [ ] 用户可查看网页图来源和 AI 图生成记录。
- [ ] 编辑后重新导出会创建新 Export，不覆盖旧产物。

**Verification:** `npm run lint`; `npm run build`; 浏览器完整路径检查

**Dependencies:** Task 29, Task 31

**Files likely touched:** `frontend/ai-agent/src/features/ppt/workspace/PptHeader.tsx`, `frontend/ai-agent/src/features/ppt/export/ExportDialog.tsx`, `frontend/ai-agent/src/features/ppt/agent/SourceLedger.tsx`, `frontend/ai-agent/src/features/ppt/api.ts`

## Phase 9：发布验收

### Task 33：安全与压力测试

**Description:** 覆盖恶意模板、SSRF、资产越权、200 页模板、多任务并发、长时间 SSE 和资产回收。

**Acceptance criteria:**

- [ ] 高风险输入测试全部通过。
- [ ] 并发转换不会共享 LibreOffice 用户目录。
- [ ] 取消/失败任务的临时文件被回收。

**Verification:** `python -m pytest -q tests/test_ppt_security.py tests/test_ppt_load.py`

**Dependencies:** Task 13, Task 25, Task 31

**Files likely touched:** `tests/test_ppt_security.py`, `tests/test_ppt_load.py`, `ppt_template_pipeline.py`, `ppt_assets.py`

### Task 34：浏览器端到端与视觉验收

**Description:** 自动化验证市场、预览、上传、生成、实时过程、完整编辑、放映和下载，并与参考图检查布局。

**Acceptance criteria:**

- [ ] Chromium 主路径全部通过。
- [ ] 1280/1440/1920px 无关键遮挡或溢出。
- [ ] 键盘、焦点和 reduced-motion 行为正确。

**Verification:** `python -m pytest -q tests/test_ppt_frontend_contract.py`; 浏览器 E2E；`npm run build`

**Dependencies:** Task 32, Task 33

**Files likely touched:** `tests/test_ppt_frontend_contract.py`, `frontend/ai-agent/src/features/ppt/__tests__/ppt.e2e.spec.ts`, `design-qa.md`

### Task 35：全量回归与交付记录

**Description:** 执行全部后端、前端和 PowerPoint 兼容性矩阵，补充运行配置和故障排查文档。

**Acceptance criteria:**

- [ ] 后端全测、lint、build、E2E 全绿。
- [ ] LibreOffice 和目标 PowerPoint 版本兼容样例通过。
- [ ] 安装 LibreOffice、字体、资产目录和环境变量有明确文档。

**Verification:** `python -m pytest -q`; `npm run lint`; `npm run build`

**Dependencies:** Task 34

**Files likely touched:** `README.md`, `docs/ai-ppt-operations.md`, `tasks/ai-ppt-plan.md`, `tasks/ai-ppt-todo.md`

## Final Checkpoint

- [ ] 所有计划验收标准满足。
- [ ] 无未处理的 P0/P1 缺陷。
- [ ] 真实 PPTX 不是整页截图，所有承诺元素保持结构化可编辑。
- [ ] 模板与素材隐私、安全和来源审计通过。
- [ ] 可以进入人工产品验收。

