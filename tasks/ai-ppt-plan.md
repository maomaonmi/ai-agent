# Spec & Implementation Plan: AI PPT 生成与编辑工作台

## 1. 文档状态

- 状态：已确认需求，等待实施
- 日期：2026-08-20
- 目标版本：AI PPT V1
- 需求确认：上传 PPT 仅作为私有模板；必须支持全页静态预览；允许安装 LibreOffice；编辑器覆盖文字、图片、图形、表格、图表、媒体、动画和演讲者备注。

## 2. 假设与定义

1. 产品首先服务桌面 Web，推荐宽度不低于 1280px；移动端提供模板浏览、任务查看和放映，不承诺完整拖拽编辑体验。
2. “完整预览上传 PPT”定义为：解析并展示文件中的全部幻灯片，尽量保持字体、图片、图表和版式的静态视觉一致；视频和动画在模板预览中显示标识，不要求通过 PDF 预览播放。
3. 用户上传的文件只用于提取主题、字体、色板、母版、布局和占位符，不把原文件中的每个内容对象导入编辑器。
4. 模板默认私有。当前应用是本地单用户环境，因此先使用 `ownerScope=local`；未来接入认证时迁移为真实 `ownerId`，接口不改变。
5. AI 生成的新演示文稿默认使用 16:9；模板声明其他比例时继承模板比例。
6. “支持动画”定义为：工作台可配置页面切换，以及常用进入、强调、退出和路径动画的顺序、触发方式、延迟和时长；导出为 PowerPoint 可识别的 OOXML 动画。不会承诺与 PowerPoint 桌面端全部动画效果一比一等价。
7. 查阅资料时至少执行两轮搜索，每次返回不超过 20 条；只有纯创意、无事实资料需求的任务可以跳过联网检索。
8. 每个完成的 AI PPT 至少包含 3 张来自网页的可追溯图片，以及 3 张 AI 生成图片，分别承担封面、中段视觉背景和结尾页视觉。

## 3. 目标

构建从“选择模板或上传私有模板”到“AI 多轮规划、检索、收集素材、生成图片、逐页搭建、人工编辑、放映及导出”的完整 PPT 创作链路。

成功体验应满足：

- 用户可从输入框“更多 → PPT 创作”及主侧边栏“AI PPT”进入模板市场。
- 模板市场采用现代化响应式排列；卡片悬停时出现“预览”和“使用此模板”。
- 上传 `.pptx`/`.potx` 后异步生成所有幻灯片预览，并提取可复用的主题与布局。
- 点击模板预览打开全屏或大尺寸弹窗，可逐页查看；点击使用后进入独立 PPT 工作台。
- 工作台左侧实时展示 Agent 工作流，主编辑区从空白开始按幻灯片、组件逐步搭建。
- 任务刷新后可以恢复，支持取消、失败重试和从上次事件继续订阅。
- 完成后可继续编辑并下载结构化 `.pptx`，不是把每页简单导出成一张图片。

## 4. 现有架构分析

### 4.1 可直接复用

- `frontend/ai-agent/src/components/ChatInterface.tsx`
  - 已存在“PPT 创作”菜单项。
  - 已有独立市场/工作台视图的入口模式，但文件已达 3,000 多行，只应增加导航调用，不应承载 PPT 业务状态。
- `frontend/ai-agent/src/components/SessionSidebar.tsx`
  - 已有 AI 生图、AI 视频、AI 工作流入口，可按同一方式增加 AI PPT。
- `frontend/ai-agent/src/lib/api.ts`
  - 已有 SSE 解析、会话快照、搜索事件、Agent Loop 节点事件、图片任务类型，可以复用协议习惯，但 PPT 类型应拆到独立 API 文件。
- `main.py`
  - 已有 DeepSeek + Firecrawl、千问原生搜索、GLM 原生搜索、Plan-and-Execute、Agent Loop、异步生图任务和素材下载保护。
  - `WebSearchInput.top_n` 已限制为 20，符合单次搜索上限。
- `visual_workflow_*` 与 `video_*`
  - 提供了较成熟的 APIRouter、Repository、异步任务、幂等请求、统一错误和 SSE 序号模式，应作为 PPT 后端模块化范例。
- `ResearchWorkspace` / `PlanWorkspace`
  - 已有报告、来源、异步配图、失败重试和刷新恢复逻辑，可复用思想，不直接复用 UI。
- `ImageStudioWorkspace` 与 `/api/image/*`
  - 已经支持千问/GLM 图片生成、批次记录和本地资产落盘，可作为 PPT 图片工具的底层供应者。

### 4.2 必须补齐

- 没有 PPT 文档领域模型、模板表、演示文稿修订、生成任务、事件账本和导出任务。
- 没有 `.pptx` 上传校验、OOXML 主题/布局提取、LibreOffice 预览转换和缩略图生成。
- 当前调研 Agent Loop 的模型客户端和搜索工具偏向 DeepSeek + Firecrawl，不能直接满足按当前模型供应商选择原生搜索的要求。
- 当前网页配图只是在报告完成后尽力补图，缺少“网页图至少 3 张、AI 图至少 3 张”的生成完成门禁。
- 没有结构化 PPT 画布、元素选择、拖拽缩放、图层、动画时间线、备注和 PPTX 导出器。
- `PptxGenJS` 尚未安装；系统也尚未检测到 LibreOffice 命令。

### 4.3 架构约束

- 不继续扩大 `main.py`：只在其中初始化服务并 `include_router`。
- 不继续扩大 `ChatInterface.tsx`：只保留跳转到 `/ppt` 的入口。
- 不将幻灯片保存为 HTML；后端和前端共享一个版本化的 `PresentationDocument` JSON 契约。
- 生成过程与文档修订分离：Agent Run 是过程账本，Presentation Revision 是可编辑结果。
- 第三方网页、模型和文档解析结果均视为不可信数据，在 API/工具边界完成校验和清洗。

## 5. 产品结构与交互

### 5.1 入口与路由

- 输入框：`更多 → PPT 创作 → /ppt`
- 主侧边栏：新增“AI PPT”入口，折叠态同步增加图标。
- 页面路由：
  - `/ppt`：模板市场
  - `/ppt/workspace/[presentationId]`：PPT 工作台
- 独立路由避免 PPT 状态与聊天消息状态耦合，也允许刷新、复制链接和恢复任务。

### 5.2 模板市场

- 顶部：标题、搜索、场景筛选、风格筛选、比例筛选、上传按钮。
- 首屏：推荐模板采用大小错落的 Bento/Masonry 排列；后续模板使用稳定响应式网格。
- 模板场景：工作汇报、商业计划、教育课件、研究报告、产品发布、营销提案、个人展示、数据分析等。
- 模板卡片悬停：暗色渐变遮罩、页数/比例/风格信息、“预览”“使用此模板”。
- 上传卡：拖拽或选择 `.pptx`/`.potx`，显示上传、解析、预览生成、完成/失败状态。
- 私有模板有“私有”标识，可重命名和删除，不进入公共推荐数据。

### 5.3 模板预览

- 大弹窗包含左侧页缩略图、中央大图、右侧模板元信息。
- 支持上一页/下一页、键盘方向键、缩放、全屏、使用模板。
- 所有幻灯片按需加载；第一页和相邻页优先。
- 视频、音频和动画在预览元信息中显示能力标识；静态预览由 LibreOffice 转 PDF 后逐页栅格化生成。

### 5.4 PPT 工作台

桌面布局从左到右：

1. Agent 工作流栏（约 320px）：需求理解、任务规划、搜索、网页抓取、图片收集、AI 生图、大纲、逐页搭建、质量检查、导出；支持展开每轮搜索和来源。
2. 幻灯片缩略图栏（约 180px）：新增、复制、删除、拖动排序、分节、当前页状态。
3. 主画布：16:9/模板比例画布，AI 通过细粒度事件逐个加入背景、标题、正文、图片、图表和装饰组件。
4. 属性/动画面板（约 300px，可折叠）：位置尺寸、样式、图层、数据、媒体、动画、备注。
5. 顶部工具栏：新建幻灯片、文本、图形、图片、媒体、图表、表格、绘图、格式、动画、放映、分享、下载、缩放。

小于 1440px 时属性面板变为抽屉；小于 1024px 时只保证查看、评论、放映和任务状态。

## 6. PPT 文档契约

前后端共享 `schemaVersion: 1`，顶层结构如下：

```ts
interface PresentationDocument {
  schemaVersion: 1;
  presentationId: string;
  revision: number;
  title: string;
  aspectRatio: '16:9' | '4:3' | 'CUSTOM';
  canvas: { width: number; height: number };
  theme: PresentationTheme;
  slides: SlideDocument[];
  metadata: { templateId?: string; language: string; createdAt: string; updatedAt: string };
}

interface SlideDocument {
  id: string;
  order: number;
  layoutId?: string;
  background: SlideBackground;
  elements: SlideElement[];
  transition?: SlideTransition;
  notes?: string;
}

type SlideElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | TableElement
  | ChartElement
  | MediaElement
  | GroupElement;

interface ElementAnimation {
  id: string;
  targetElementId: string;
  category: 'ENTRANCE' | 'EMPHASIS' | 'EXIT' | 'MOTION_PATH';
  effect: string;
  trigger: 'ON_CLICK' | 'WITH_PREVIOUS' | 'AFTER_PREVIOUS';
  order: number;
  durationMs: number;
  delayMs: number;
}
```

所有元素共享稳定的几何字段：`x/y/width/height/rotation/zIndex/opacity/isLocked/isHidden`。位置使用归一化画布单位，避免浏览器像素与 PPT 英寸互相污染。

前端编辑不直接 PATCH 整份文档，而发送带 `baseRevision` 的操作列表：

```ts
type PresentationOperation =
  | { type: 'ADD_SLIDE'; slide: SlideDocument }
  | { type: 'DELETE_SLIDE'; slideId: string }
  | { type: 'MOVE_SLIDE'; slideId: string; toIndex: number }
  | { type: 'ADD_ELEMENT'; slideId: string; element: SlideElement }
  | { type: 'UPDATE_ELEMENT'; slideId: string; elementId: string; patch: Record<string, unknown> }
  | { type: 'DELETE_ELEMENT'; slideId: string; elementId: string }
  | { type: 'SET_NOTES'; slideId: string; notes: string }
  | { type: 'SET_ANIMATIONS'; slideId: string; animations: ElementAnimation[] };
```

修订冲突返回 `409 REVISION_CONFLICT` 和服务器当前修订号，禁止静默覆盖。

## 7. 模板上传与完整预览

### 7.1 安全入口

- 只接受 `.pptx` 与 `.potx`；V1 拒绝含宏的 `.pptm`/`.potm`。
- 默认限制：100MB、200 页、解压后 1GB、压缩比异常或路径穿越立即拒绝。
- 验证 ZIP 文件签名、`[Content_Types].xml`、关系文件和目标路径。
- 私有模板资产存放于 `data/ppt-assets/{ownerScope}/{templateId}`，不暴露真实磁盘路径。

### 7.2 提取

- 使用 Python `zipfile + defusedxml/lxml` 读取 OOXML：主题颜色、字体方案、母版、布局、占位符、页面尺寸、背景和媒体清单。
- 生成内部 `TemplateManifest`，只保留可复用的主题和布局，不导入原页面内容到编辑器。
- 预览流程使用独立临时用户配置调用 LibreOffice，避免并发任务锁住同一用户目录。

### 7.3 预览流水线

`上传 → 安全扫描 → OOXML 提取 → LibreOffice Headless 转 PDF → PDF 逐页转 WebP → 生成封面/缩略图 → READY`

- LibreOffice 使用显式路径和任务级临时目录。
- PDF 栅格化使用 PyMuPDF，生成 320px 缩略图和 1600px 预览图。
- 若字体缺失，记录 `MISSING_FONT` 警告并在模板详情展示，不让任务无限等待。
- 原始文件、PDF 和预览页均通过受控资产接口访问。

## 8. AI Agent Loop

### 8.1 状态机

```text
INTAKE
  → PLAN
  → RESEARCH_LOOP (SEARCH → OBSERVE → GAP_CHECK → 可重复)
  → WEB_IMAGE_COLLECTION
  → STORYBOARD
  → AI_IMAGE_GENERATION
  → COMPOSE_LOOP (逐页、逐元素)
  → DESIGN_QA
  → CONTENT_QA
  → EXPORT_QA
  → COMPLETED
```

- 最大主循环 8 轮，单工具 45 秒，总运行默认 15 分钟，可配置但有硬上限。
- 每轮必须产生结构化 Decision：继续搜索、抓取页面、收集图片、修改大纲、重做页面、结束。
- 运行状态与文档修订分离；每次 COMPOSE 操作先写事件账本，再应用到新修订，保证中断恢复。

### 8.2 模型与搜索适配

统一接口：

```py
class PptResearchProvider(Protocol):
    async def plan(self, state: PptAgentState) -> AgentDecision: ...
    async def search(self, queries: list[str], limit: int) -> SearchObservation: ...
    async def compose(self, state: PptAgentState) -> list[PresentationOperation]: ...
```

- DeepSeek：Function Calling 驱动 Agent Loop；`search` 通过 Firecrawl Search/Scrape；单次 `limit <= 20`。
- 千问：使用 DashScope 原生联网搜索参数；将搜索来源标准化为统一 Observation，再回灌下一轮计划。
- GLM：使用原生 `web_search` 工具和 `search_pro`；`count <= 20`，解析工具返回的来源和摘要。
- Provider 返回值必须经过 Pydantic 校验；网页正文中的提示词只作为资料，不能改变系统计划或调用权限。

搜索质量规则：

- 有事实资料需求时至少两轮不同查询；每次 1–20 条。
- 默认最多 6 次搜索、总计最多 80 个去重来源；达到上限后必须进入综合或明确失败。
- 来源去重按 canonical URL + 内容指纹；优先官方、学术和一手来源。
- 每页内容保留标题、URL、抓取时间、摘要和用于幻灯片的证据片段。

### 8.3 网页图片硬门禁

- 新增 `collect_web_images` 工具，从至少 3 个包含图片的网页中发现 `og:image`、结构化数据图片和正文 `<img>`。
- 下载前执行 SSRF、重定向、Content-Type、尺寸、像素、文件大小和重复哈希检查。
- 每张图片保存 `sourcePageUrl/imageUrl/title/altText/licenseHint/attribution/width/height/hash`。
- 最终文稿必须至少采用 3 张不同的网页图片；未达到时 Agent 自动改写图片查询继续搜索。
- 达到搜索上限仍不足 3 张时运行进入 `NEEDS_ATTENTION`，由用户选择继续检索或仅使用 AI 图片，不能伪装为已满足。

### 8.4 AI 图片硬门禁

- 复用现有图片模型目录、导演提示词和生成接口，新增 PPT 任务调用适配层。
- 固定至少三个视觉角色：`COVER_HERO`、`MID_DECK_BACKGROUND`、`ENDING_VISUAL`。
- 每个角色先生成占位元素，随后异步替换为最终资产，让右侧画布实时可见。
- 每个角色允许自动重试两次；失败后进入可操作错误状态。

### 8.5 逐组件构建

服务端通过事件发送操作，而不是只在结束时返回整份 JSON：

- `slide.created`
- `element.added`
- `element.updated`
- `asset.collected`
- `asset.generated`
- `search.started/completed`
- `qa.issue/fixed`
- `run.completed/failed`

前端按 `sequence` 顺序应用操作，右侧画布可看到背景、标题、正文、图片、图表和装饰元素逐个出现。

## 9. API 契约

所有新错误统一为：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数无效",
    "details": { "issues": [] }
  }
}
```

### 9.1 模板

- `GET /api/ppt/templates?page=1&pageSize=24&scene=&query=&source=`
- `POST /api/ppt/templates`：multipart 上传私有模板，返回 `202` 和模板状态。
- `GET /api/ppt/templates/{templateId}`
- `PATCH /api/ppt/templates/{templateId}`：重命名等元数据更新。
- `DELETE /api/ppt/templates/{templateId}`：幂等删除私有模板及受控资产。
- `GET /api/ppt/templates/{templateId}/preview-pages?page=1&pageSize=20`

### 9.2 演示文稿与修订

- `POST /api/ppt/presentations`
- `GET /api/ppt/presentations/{presentationId}`
- `PATCH /api/ppt/presentations/{presentationId}`：`baseRevision + operations`。
- `GET /api/ppt/presentations/{presentationId}/revisions?page=1&pageSize=20`
- `POST /api/ppt/presentations/{presentationId}/runs`：带 `clientRequestId` 幂等创建生成任务。

### 9.3 运行与事件

- `GET /api/ppt/runs/{runId}`
- `GET /api/ppt/runs/{runId}/events`：SSE，支持 `Last-Event-ID`。
- `POST /api/ppt/runs/{runId}/cancellations`
- 失败重试通过新建 Run 并传 `parentRunId`，保留完整审计链。

SSE 格式：

```text
id: 42
event: element.added
data: {"runId":"...","presentationId":"...","sequence":42,"phase":"COMPOSE_LOOP","iteration":3,"status":"RUNNING","operation":{...}}
```

### 9.4 资产与导出

- `POST /api/ppt/presentations/{presentationId}/assets`
- `GET /api/ppt/assets/{assetId}`
- `POST /api/ppt/presentations/{presentationId}/exports`
- `GET /api/ppt/exports/{exportId}`
- `GET /api/ppt/exports/{exportId}/content`

列表接口全部分页；创建任务全部支持 `clientRequestId`；第三方失败映射为稳定错误码，不向前端暴露密钥和供应商原始栈。

## 10. 数据与文件存储

沿用当前 SQLite 与本地资产目录：

- `ppt_templates`
- `ppt_template_preview_pages`
- `ppt_presentations`
- `ppt_presentation_revisions`
- `ppt_runs`
- `ppt_run_events`
- `ppt_assets`
- `ppt_exports`

关键原则：

- 文档修订不可变；`ppt_presentations.current_revision` 指向当前版本。
- Run Event 为 append-only，`(run_id, sequence)` 唯一。
- 资产记录来源、版权提示、哈希和归属；相同哈希可复用文件但不能跨 owner 泄露元数据。
- 模板删除采用先标记、再回收文件；正在被文稿使用的主题清单已复制到修订中，不受模板删除影响。

## 11. 编辑器与导出

### 11.1 编辑器

- 使用 SVG 场景图渲染形状、图片、图表和选择框；富文本编辑使用项目已有 Tiptap。
- Zustand 保存当前文档、选择、历史栈、缩放和草稿操作。
- 支持框选、拖动、缩放、旋转、吸附、对齐、分布、锁定、隐藏、组合和图层顺序。
- 表格支持行列增删、合并、单元格样式；图表支持柱、线、饼、面积、散点和组合图的基础数据编辑。
- 媒体支持音频、视频和在线媒体链接；预览使用浏览器原生媒体元素。
- 动画时间线支持效果、触发、顺序、延迟和时长；浏览器用 Web Animations API 近似预览。
- 备注独立于画布，随幻灯片保存并导出。

### 11.2 导出

- 基础 `.pptx` 使用 PptxGenJS 生成。其官方文档支持幻灯片、文字、图片、表格、图表和媒体：
  - https://gitbrent.github.io/PptxGenJS/docs/usage-add-slide.html
  - https://gitbrent.github.io/PptxGenJS/docs/api-tables.html
  - https://gitbrent.github.io/PptxGenJS/docs/api-charts/
  - https://gitbrent.github.io/PptxGenJS/docs/api-media/
- 动画和页面切换由独立 OOXML 后处理器写入 `ppt/slides/*.xml` 与对应关系/时间节点。
- 每次导出后重新解包校验关系目标、媒体引用和 XML；再用 LibreOffice 无界面打开并转 PDF，作为结构与渲染烟雾测试。
- 最终兼容性门禁还需在真实 Microsoft PowerPoint 中验证，避免“需要修复演示文稿”。

## 12. 依赖

### 12.1 浏览器

不需要浏览器扩展或 Codex 插件。

### 12.2 系统

- LibreOffice（必须），固定并检测 `soffice` 路径。
- FFmpeg（媒体缩略图和元数据；项目已有相关运行时配置，可复用）。
- 中文字体包：至少思源黑体/宋体及常用办公字体替代映射。

### 12.3 前端

- `pptxgenjs`：结构化 PPTX 基础导出。
- 继续使用已有 `zustand`、`@tiptap/*`、`jszip`、`lucide-react`。
- 幻灯片排序优先使用原生 Pointer Events；若可访问性测试不达标，再引入 `@dnd-kit`，避免预先增加依赖。

### 12.4 后端

- `PyMuPDF`：PDF 逐页预览图。
- `defusedxml` 与 `lxml`：安全 OOXML 解析及导出后处理。
- 不依赖 `python-pptx` 作为核心解析器，因为主题、母版和动画仍需直接读取 OOXML；可以在后续作为辅助工具评估。

## 13. 命令

```powershell
# 后端依赖
python -m pip install -r requirements.txt

# 后端开发
python main.py

# 后端测试
python -m pytest -q

# PPT 后端定向测试
python -m pytest -q tests/test_ppt_models.py tests/test_ppt_repository.py tests/test_ppt_template_pipeline.py tests/test_ppt_agent.py tests/test_ppt_api.py tests/test_ppt_export.py

# 前端依赖与开发
Set-Location frontend/ai-agent
npm install
npm run dev

# 前端验证
npm run lint
npm run build

# LibreOffice 安装验证
& 'C:\Program Files\LibreOffice\program\soffice.exe' --version
```

## 14. 代码风格

后端使用 `ConfigDict(extra="forbid", populate_by_name=True)` 定义边界模型；前端使用判别联合，不传递无结构的 `any`。

```py
class CreatePptRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    client_request_id: str = Field(alias="clientRequestId", min_length=8, max_length=128)
    prompt: str = Field(min_length=1, max_length=20_000)
    provider: Literal["deepseek", "qwen", "glm"]
    search_limit: int = Field(default=10, alias="searchLimit", ge=1, le=20)
```

## 15. 测试策略

- 后端单元：文档模型、操作归约、修订冲突、状态机、搜索适配、素材门禁、OOXML 解析与生成。
- 后端集成：模板上传到预览、Run SSE 重连、取消/重试、导出到 LibreOffice 转 PDF。
- 前端单元/契约：store reducer、操作应用、事件顺序、工具栏能力、入口与路由。
- 浏览器 E2E：模板悬停、预览弹窗、使用模板、运行进度、逐元素出现、编辑与导出。
- Golden 文件：维护包含文字、图形、图片、表格、图表、音频、视频、动画和备注的最小 PPTX；每次导出回归比较解包结构和预览截图。
- 安全：ZIP Bomb、路径穿越、损坏关系、恶意 XML、SSRF、超大图片、伪造 MIME、未授权模板访问。
- 可访问性：键盘操作、焦点管理、对话框、工具栏和排序替代操作。

## 16. 分阶段实施

### Phase 0：高风险技术验证

- 安装并探测 LibreOffice。
- 生成包含全部元素类型的最小 PPTX。
- 验证 PptxGenJS 基础导出和 OOXML 动画/切换注入。
- 在 LibreOffice 与真实 Microsoft PowerPoint 中打开，不出现修复提示。

未通过 Phase 0 不进入完整 UI 开发。

### Phase 1：领域模型与存储

- 文档、元素、操作、模板、Run、Event、Asset、Export 模型。
- SQLite Repository、修订冲突和幂等请求。

### Phase 2：模板市场纵向切片

- 内置模板列表、入口、市场页面、悬停操作、预览弹窗、使用模板。
- 先用内置预览资产打通完整路径。

### Phase 3：私有模板上传

- 安全上传、OOXML 提取、LibreOffice/PDF/WebP 预览流水线、状态轮询、私有访问控制。

### Phase 4：工作台与基础编辑

- 画布、缩略图、文本/图片/图形、拖拽缩放、撤销重做、修订保存。

### Phase 5：高级编辑

- 表格、图表、媒体、动画时间线、页面切换、备注、放映。

### Phase 6：Provider 无关 Agent Loop

- DeepSeek/Firecrawl、千问原生、GLM 原生三种适配器。
- 计划、多轮搜索、来源归一化、Run Event 和 SSE 恢复。

### Phase 7：素材与逐页构建

- 网页图片收集门禁、AI 三角色图片门禁、故事板、逐元素操作流、实时画布。

### Phase 8：质量检查与导出

- 内容引用、视觉溢出、对比度、字体、图片分辨率、素材数量检查。
- PPTX 生成、OOXML 后处理、LibreOffice 验证和下载。

### Phase 9：端到端验收与性能

- 断线恢复、取消、失败重试、长文稿、200 页模板、并发任务、资产回收。
- 浏览器 E2E 与真实 PowerPoint 兼容性矩阵。

## 17. 验收标准

- 两个入口均能进入 `/ppt`，侧边栏展开/折叠态均有入口。
- 市场卡片悬停行为、预览和使用模板完整可用。
- 上传模板仅本人可见，所有页均可静态预览；失败有明确原因和重试入口。
- 至少支持创建、复制、删除、排序幻灯片，以及全部约定的元素与动画/备注功能。
- 每个事实型生成任务至少两轮搜索，每次结果不超过 20。
- DeepSeek 走 Firecrawl；千问和 GLM 走各自原生搜索，UI 显示真实供应商和结果数量。
- 成功完成的 PPT 至少实际使用 3 张网页来源图片和 3 张 AI 图片，并可查看来源/生成记录。
- 左侧过程栏与右侧画布同步，用户能看到幻灯片及元素逐步生成。
- 刷新后 Run、事件、文档和素材均可恢复；重复提交不会创建重复任务。
- 下载的 PPTX 在 LibreOffice 与受支持的 Microsoft PowerPoint 中打开无修复提示，文字、图片、图形、表格、图表、媒体、动画和备注均通过兼容性样例验证。
- `python -m pytest -q`、`npm run lint`、`npm run build` 和浏览器 E2E 全部通过。

## 18. 边界

### Always

- 所有外部输入在边界验证；所有 Run 事件带单调递增序号。
- 私有模板和资产检查 owner；下载不暴露磁盘路径。
- 每个任务和导出均有幂等键；每 2–3 个任务执行一次构建/测试检查点。
- 素材保存来源、时间和版权提示；不把网页中的文字当作系统指令。

### Ask first

- 增加云对象存储、认证体系或数据库迁移到 PostgreSQL。
- 放宽文件大小/页数、支持宏文件、公开分享用户模板。
- 使用商业模板、图库或第三方文档转换 SaaS。
- 为了 PowerPoint 完整动画兼容而引入 Windows Office COM 自动化。

### Never

- 不保存模型或服务密钥到模板、文档、事件或前端日志。
- 不绕过 PPTX ZIP/XML 安全检查。
- 不将缺少来源的网页图片标为“已验证素材”。
- 不在素材门禁未满足时静默把任务标记为成功。
- 不通过整页截图冒充可编辑的 PPTX 导出。

## 19. 主要风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| PowerPoint 动画 OOXML 复杂且生成库原生支持不足 | 高 | Phase 0 先做最小兼容样例；动画单独封装；Golden PPTX + PowerPoint 手工验收 |
| LibreOffice 与 PowerPoint 渲染差异 | 高 | 明确字体包；两套应用兼容矩阵；导出后 PDF 截图回归 |
| 用户模板字体缺失 | 中 | 字体扫描、替代映射和 UI 警告 |
| 网页图片版权/热链/失效 | 高 | 下载到受控资产、记录 attribution/licenseHint、优先官方/可授权来源 |
| Agent 多轮任务耗时和成本过高 | 中 | 搜索/迭代/图片重试预算、缓存、取消和 NEEDS_ATTENTION 状态 |
| SSE 断线造成画布丢组件 | 高 | append-only 事件、Last-Event-ID、修订幂等应用 |
| 大型文稿使前端卡顿 | 中 | 只挂载当前页与邻近缩略图、元素分层 memo、后台导出 |
| `main.py` 与 `ChatInterface.tsx` 继续膨胀 | 高 | 新功能独立 router/repository/feature route，旧文件只接线 |

## 20. 开放项

当前没有阻塞实施的产品问题。实施中若 Phase 0 证明目标 PowerPoint 版本无法稳定接受所需动画 OOXML，应暂停高级编辑阶段，提交兼容性报告后再决定是否引入 Office COM 自动化。

