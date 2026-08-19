# AI 视觉工作流（Infinite Canvas Visual DAG）架构计划

## 1. 产品目标

在现有 AI 图片与 AI 视频模块之上新增独立的“视觉工作流”模块，将提示词、图片、视频、视觉理解和模型调用抽象成可连接、可保存、可复用、可分叉并行执行的有向无环图（DAG）。

第一版的成功标准不是复刻 ComfyUI 的全部能力，而是打通一条稳定的纵向闭环：

1. 用户在无限画布中放置输入节点、模型节点和预览节点。
2. 端口类型和 DAG 规则同时在前后端校验。
3. 保存产生不可变工作流修订版本。
4. 后端按拓扑批次并发执行，并复用已有图片/视频异步任务引擎。
5. 节点状态通过 SSE 实时回推；刷新页面后可恢复运行状态。
6. 未变化的节点通过内容哈希命中缓存，不重复调用付费模型。

截图仅作为“暗色无限画布、紧凑节点、彩色类型连线、底部画布工具”的视觉参考；不照搬其品牌、模型和交互细节。主题继续跟随项目设置，不新增积分按钮。

## 2. 明确不做的范围

首期不做：

- 多人实时协作、光标跟随、Yjs/CRDT。
- 用户编写任意 Python/JavaScript 节点。
- 循环、条件回边和动态图结构；首期只允许 DAG。
- 跨机器分布式调度、Redis/Celery/Kubernetes Worker。
- 自动从 URL 执行未经验证的任意媒体；外部媒体必须先进入资产系统。
- 对 Gemini、Flux 等尚未接入本项目的模型做假适配器。
- 完整复刻 ComfyUI 的插件生态和数百种图像算子。

## 3. 技术选型结论

### 3.1 前端画布

选择：`@xyflow/react 12.11.3`。

理由：

- 与项目当前 React 18.3.1 兼容，官方 peer dependency 为 React 17+。
- 原生提供无限画布、节点/边、多个 Handle、缩放平移、MiniMap、Controls、键盘操作和连接校验。
- `isValidConnection` 可承担即时端口类型反馈，`getOutgoers` 可在连线时阻止环路。
- 官方 TypeScript 指南支持用判别联合定义自定义节点和边，适合建立强类型节点注册表。

官方资料：

- https://reactflow.dev/learn/concepts/building-a-flow
- https://reactflow.dev/learn/advanced-use/typescript
- https://reactflow.dev/examples/interaction/validation
- https://reactflow.dev/examples/interaction/prevent-cycles

### 3.2 前端图状态

选择：`Zustand 5.0.15`，不把完整图状态塞进单个 React 组件。

状态分层：

- `workflowDocumentStore`：nodes、edges、viewport、selection、dirty/version。
- `workflowRunStore`：run、nodeRuns、events、connectionState。
- 远端持久化数据仍由 API 获取；Zustand 只管理编辑会话和实时运行投影。

官方 React Flow 状态管理指南明确建议复杂节点应用使用集中状态库，并以 Zustand 为示例：https://reactflow.dev/learn/advanced-use/state-management

首期 Undo/Redo 使用工作流命令栈，最多保留 100 个编辑操作；运行状态、选择状态和 viewport 不进入撤销历史。暂不引入额外 temporal 插件。

### 3.3 自动布局

首期不引入 ELK/Dagre 作为硬依赖。用户位置是工作流文档的一部分，提供“整理布局”接口占位；第二阶段若真实复杂图需要自动布局，再引入 `elkjs`。这样避免布局引擎过早决定节点尺寸、动态 Handle 和分组策略。

### 3.4 后端 DAG 引擎

选择：Python 标准库 `graphlib.TopologicalSorter` + `asyncio` 并发批次。

理由：

- 当前后端已运行 Python 3.14，无需引入另一套工作流框架。
- `prepare()` 原生检测循环；`get_ready()` 返回当前所有可执行节点，适合并行分叉；节点完成后调用 `done()` 解锁下游。
- LangGraph 保留给 Agent 状态机；视觉工作流需要的是可持久化的用户计算图，两者不要混成同一套语义。

官方资料：https://docs.python.org/3/library/graphlib.html

### 3.5 实时协议

首期选择：REST 命令 + SSE 事件流 + 短轮询兜底。

- 工作流编辑通过 REST 保存，不需要常驻双向连接。
- 执行状态只需服务器单向推送，SSE 与现有视频任务引擎一致。
- SSE 断开后每 3 秒轮询运行快照；通过 `Last-Event-ID` 补发事件。
- WebSocket 只在未来加入多人协作、远程拖拽或交互式终端节点时使用。

### 3.6 持久化和资产

首期继续使用 SQLite 与现有本地资产/私有 OSS：

- 工作流定义、修订、运行、节点运行、缓存索引、事件写入 SQLite。
- 图片和视频产物只以 `artifactId` 在图内传播，不把临时签名 URL 写进缓存键或工作流文档。
- 上传媒体复用现有图片资产与参考视频 OSS 资产服务。
- 单实例阶段由 FastAPI lifespan 启动工作流调度器；多实例前必须迁移到 PostgreSQL + Redis 队列或独立 Worker。

### 3.7 备选方案取舍

| 方案 | 结论 | 原因 |
|---|---|---|
| 自研 Canvas/SVG 编辑器 | 不选 | 需要自行实现命中测试、viewport、选择、Handle、键盘与无障碍，投入大且容易留下交互债务 |
| Rete.js | 暂不选 | 更偏完整可执行节点框架，会与本项目后端执行语义和已有任务引擎产生第二套运行时 |
| 直接嵌入 ComfyUI Web | 不选 | 节点和后端围绕 ComfyUI/Python 图像算子设计，难以自然复用当前 Qwen/GLM/视频 Job API |
| LangGraph 执行视觉画布 | 不选 | LangGraph 适合 Agent 状态图；这里需要用户文档修订、媒体 artifact、内容缓存和供应商任务对账 |
| React Flow + 自有 DAG 后端 | 选择 | 画布和执行边界清楚，能复用现有资产、模型适配器、SQLite、SSE 和视频监控器 |
| WebSocket + Yjs | 延后 | 单人首期没有双向协作需求，先用 REST/SSE 完成稳定闭环 |

## 4. 三层核心模型

必须严格分开以下三层，避免节点 UI、任务状态和模型结果互相污染。

### 4.1 Workflow Definition（用户编辑的图）

只包含可复现配置：节点种类、位置、参数、边和 viewport。不能包含 `running`、进度、临时 URL 或供应商 Task ID。

### 4.2 Workflow Revision（不可变执行快照）

每次执行固定到一个修订版本。用户继续拖动或修改画布不会改变已经运行的图。

### 4.3 Workflow Run（某次执行实例）

包含节点状态、输入/输出 artifact、缓存命中、供应商任务、错误和事件序列。

```text
Workflow ──1:N── Revision ──1:N── Run ──1:N── NodeRun
                                         │
                                         ├── Artifact
                                         └── Event
```

## 5. 图与端口契约

### 5.1 媒体类型

```ts
type PortDataType =
  | 'prompt.text'
  | 'image.asset'
  | 'video.asset'
  | 'media.asset'
  | 'audio.url'
  | 'image.asset[]'
  | 'video.asset[]';

interface PortSchema {
  id: string;
  direction: 'input' | 'output';
  dataType: PortDataType;
  required: boolean;
  cardinality: 'one' | 'many';
}
```

首期不做隐式类型转换。只有类型完全一致，或节点注册表显式声明转换规则时才能连接。例如：

- `image.asset → image.asset`：允许。
- `prompt.text → prompt.text`：允许。
- `image.asset/video.asset → media.asset`：允许，用于混合参考媒体输入。
- `image.asset → video.asset`：禁止。
- 任意同类型端口支持多条连接，输入端和输出端都允许 fan-in/fan-out；只禁止重复边、自连、类型不匹配和成环。

### 5.2 工作流文档

```ts
interface WorkflowDocumentV1 {
  schemaVersion: 1;
  workflowId: string;
  revision: number;
  name: string;
  nodes: WorkflowNodeV1[];
  edges: WorkflowEdgeV1[];
  viewport: { x: number; y: number; zoom: number };
}

interface WorkflowNodeV1 {
  id: string;
  kind: WorkflowNodeKind;
  definitionVersion: number;
  position: { x: number; y: number };
  label?: string;
  config: Record<string, unknown>;
  isDisabled?: boolean;
}

interface WorkflowEdgeV1 {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}
```

节点文档不保存可伪造的 `inputs`、`outputs`、Handle 类型或运行状态。这些信息分别由边、节点注册表和 NodeRun 提供。

### 5.3 节点注册表

前后端共享相同的稳定 `kind` 字符串和 `definitionVersion`；后端是最终权威。

```ts
interface NodeDefinition {
  kind: WorkflowNodeKind;
  version: number;
  category: 'input' | 'transform' | 'image' | 'video' | 'output';
  inputPorts: PortSchema[];
  outputPorts: PortSchema[];
  configSchema: JsonSchema;
  cachePolicy: 'never' | 'content';
  executorKey: string;
}
```

## 6. 首期节点目录

### 输入节点

- `prompt_input`：输出 `prompt.text`。
- `image_input`：上传/选择已有图片资产，输出 `image.asset`。
- `video_input`：上传/选择 READY 参考视频，输出 `video.asset`。
- `audio_url_input`：只接受公开 HTTP/HTTPS URL，输出 `audio.url`。

### 理解与提示词节点

- `vision_to_prompt`：图片输入，经 Qwen 视觉或 GLM 视觉模型输出提示词。
- `prompt_template`：组合固定模板与多个提示词输入。

### 图片节点

- `image_generate`：文本生成图片，复用现有图片模型矩阵；支持必需提示词与多张可选参考图。
- `image_edit`：提示词 + 参考图生成编辑结果。
- `image_compare`：接收多个图片资产，在 UI 中并排预览，不调用模型。

### 视频节点

- `text_to_video`：提示词 → 视频。
- `image_to_video`：提示词 + 首帧图片 + 可选音频 URL → 视频。
- `start_end_video`：提示词 + 首帧 + 尾帧 → 视频。
- `reference_to_video`：提示词 + 图片/视频混合参考数组 → 视频；每个参考输入都可通过 `referencePurpose` 指定动作、主体或风格意图。

视频节点必须调用已有 `VideoGenerationRequest`、`VideoJobRepository` 和 `VideoTaskMonitor`，不能复制一套供应商轮询代码。

### 输出节点

- `preview_output`：预览单个图片或视频 artifact。
- `gallery_output`：收集同类型多个 artifact，便于模型横向对比。

## 7. 双层图校验

前端校验用于即时反馈，后端校验用于安全和正确性。后端绝不能信任前端已经校验。

校验顺序：

1. 文档 schemaVersion、节点数、边数和 ID 唯一性。
2. 节点 kind/version 是否存在，config 是否通过对应 Pydantic/JSON Schema。
3. source/target 节点及端口是否存在，方向是否正确。
4. 类型、cardinality、required 和最大连接数。
5. 禁止自连、重复边和有向环。
6. 执行前检查必需输入是否都能由上游或节点配置提供。
7. 资产必须存在、READY、未过期且属于当前工作区。

错误统一到具体节点/端口：

```json
{
  "error": {
    "code": "WORKFLOW_INVALID",
    "message": "工作流包含 2 个错误",
    "details": {
      "issues": [
        {"nodeId":"node_2","portId":"firstFrame","code":"REQUIRED_INPUT_MISSING","message":"缺少首帧图片"}
      ]
    }
  }
}
```

## 8. 后端执行模型

```text
[加载固定 Revision]
        ↓
[Schema/端口/资产/DAG 校验]
        ↓
[编译 predecessor map]
        ↓
[TopologicalSorter.prepare()]
        ↓
[get_ready() 返回同层节点]
        ↓
[缓存检查 ──命中──► CACHED/SUCCESS]
        │未命中
        ▼
[按节点/厂商并发信号量执行]
        ↓
[写 Artifact + Cache + NodeRun Event]
        ↓
[done(node) 解锁下游]
```

### 8.1 状态机

Run：

`QUEUED → VALIDATING → RUNNING → SUCCEEDED | PARTIAL_FAILED | FAILED | CANCELLED`

NodeRun：

`PENDING → READY → RUNNING → SUCCEEDED | CACHED | FAILED | SKIPPED | CANCELLED`

失败策略：默认“分支隔离”。一个节点失败后，只把它的后代标记 `SKIPPED`；无依赖的其他分支继续执行。根级校验失败才使整个 Run 直接 `FAILED`。

### 8.2 并发护栏

初始默认值：

- 单个工作流 Run 同时最多 4 个节点。
- 单供应商同时最多 2 个图片节点。
- 单供应商同时最多 1 个视频节点。
- 单工作区同时最多 1 个视频生成节点、2 个图片生成节点。

并发限制由后端配置，不接受前端绕过。

### 8.3 取消与重试

- 取消 Run：停止派发新节点；能取消的供应商任务尝试取消，不能取消的任务继续对账但结果不再解锁下游。
- 重试失败节点：创建新的 Run attempt，复用原 Revision 与成功节点缓存；不修改历史 NodeRun。
- “从此节点运行”：计算该节点的祖先闭包和后代闭包，只执行必需子图。

## 9. 增量缓存

缓存键必须由稳定内容组成：

```text
SHA256(
  node.kind
  + node.definitionVersion
  + adapterVersion
  + canonicalJson(normalizedConfig)
  + ordered(upstreamPortId + artifact.sha256)
)
```

明确排除：节点位置、标签、viewport、运行状态、数据库 ID、签名 URL、供应商临时 URL。

缓存值保存输出 artifact ID 与元数据。命中前再次检查 artifact 文件/object 是否存在。模型适配器版本、默认参数或提示词处理逻辑变化时必须提升 `adapterVersion`，自动失效旧缓存。

首期缓存策略：

- 输入/预览/比较节点不产生付费缓存。
- 视觉理解、图片生成/编辑、视频生成使用内容缓存。
- 默认保留 7 天，可配置；用户删除源资产时按引用关系延迟回收。

## 10. 数据库表

### `visual_workflows`

- `id`, `name`, `description`, `current_revision`, `created_at`, `updated_at`

### `visual_workflow_revisions`

- `workflow_id`, `revision`, `schema_version`, `document_json`, `document_hash`, `created_at`
- `(workflow_id, revision)` 唯一；修订不可更新。

### `visual_workflow_runs`

- `id`, `workflow_id`, `revision`, `status`, `mode`, `progress`
- `requested_node_ids`, `client_request_id`, `created_at`, `started_at`, `completed_at`

### `visual_workflow_node_runs`

- `id`, `run_id`, `node_id`, `attempt`, `status`, `cache_key`, `is_cache_hit`
- `provider`, `provider_task_id`, `input_artifacts_json`, `output_artifacts_json`
- `error_code`, `error_message`, `started_at`, `completed_at`

### `visual_workflow_artifacts`

- `id`, `kind`, `storage_backend`, `storage_key`, `mime_type`, `size_bytes`, `sha256`
- `width`, `height`, `duration_seconds`, `created_at`, `expires_at`

### `visual_workflow_cache_entries`

- `cache_key`, `node_kind`, `adapter_version`, `output_artifacts_json`, `created_at`, `expires_at`, `last_hit_at`

### `visual_workflow_events`

- `id`, `run_id`, `sequence`, `event_type`, `node_id`, `payload_json`, `created_at`
- `(run_id, sequence)` 唯一，用于 SSE 重放。

## 11. REST 与 SSE API

本模块统一使用 camelCase 响应和结构化错误。

### 工作流资源

- `POST /api/visual-workflows`
- `GET /api/visual-workflows?page=1&pageSize=20`
- `GET /api/visual-workflows/{workflowId}`
- `PATCH /api/visual-workflows/{workflowId}`，请求携带 `baseRevision`；冲突返回 409。
- `DELETE /api/visual-workflows/{workflowId}`，有运行历史时软删除。
- `POST /api/visual-workflows/{workflowId}/validate`
- `GET /api/visual-workflow-node-definitions`

### 运行资源

- `POST /api/visual-workflows/{workflowId}/runs`
- `GET /api/visual-workflow-runs/{runId}`
- `GET /api/visual-workflow-runs?workflowId=...&page=...`
- `POST /api/visual-workflow-runs/{runId}/cancel`
- `POST /api/visual-workflow-runs/{runId}/retry`
- `GET /api/visual-workflow-runs/{runId}/events`（SSE）

创建运行请求：

```json
{
  "revision": 7,
  "mode": "FULL",
  "targetNodeIds": [],
  "clientRequestId": "uuid"
}
```

SSE 事件：

- `run.snapshot`
- `run.status`
- `node.ready`
- `node.running`
- `node.progress`
- `node.cached`
- `node.succeeded`
- `node.failed`
- `node.skipped`
- `run.completed`
- `heartbeat`

事件只包含 artifact ID 和安全元数据；签名 URL 通过单独资产读取接口按需获取。

## 12. 前端功能架构

```text
VisualWorkflowWorkspace
├── WorkflowTopbar
│   ├── 名称/保存状态
│   ├── Undo/Redo
│   ├── 校验
│   └── 运行/取消
├── NodePalette（左侧）
│   ├── 输入
│   ├── 理解/提示词
│   ├── 图片
│   ├── 视频
│   └── 输出
├── WorkflowCanvas（中央）
│   ├── ReactFlow
│   ├── TypedEdge
│   ├── MiniMap/Controls/Background
│   └── ContextMenu
├── NodeInspector（右侧）
│   ├── 节点参数
│   ├── 模型能力联动
│   ├── 输入检查
│   └── 错误定位
└── RunPanel（底部可折叠）
    ├── 节点执行时间线
    ├── 缓存命中
    ├── 错误/重试
    └── 产物对比
```

节点卡片保持紧凑：标题栏、状态图标、主要预览、端口、必要参数摘要。复杂表单放右侧 Inspector，不把模型所有参数塞进节点卡片。

端口按类型显示固定颜色，但同时使用图标/标签，不能只靠颜色区分：

- Prompt：紫色 + 文本图标。
- Image：青绿色 + 图片图标。
- Video：橙红色 + 视频图标。
- Audio URL：黄色 + 音频图标。

运行时只让正在执行的节点边框轻微发光；避免整条边持续高成本动画。React Flow 官方性能指南要求节点组件、回调和配置对象保持稳定引用，并避免节点组件订阅完整 nodes 数组：https://reactflow.dev/learn/advanced-use/performance

## 13. 文件与模块边界建议

前端：

```text
frontend/ai-agent/src/features/visual-workflow/
├── VisualWorkflowWorkspace.tsx
├── canvas/WorkflowCanvas.tsx
├── nodes/
├── edges/
├── inspector/
├── palette/
├── run-panel/
├── store/document-store.ts
├── store/run-store.ts
├── graph/validation.ts
├── graph/commands.ts
└── types.ts
```

后端：

```text
visual_workflow_api.py
visual_workflow_models.py
visual_workflow_repository.py
visual_workflow_registry.py
visual_workflow_validator.py
visual_workflow_executor.py
visual_workflow_cache.py
visual_workflow_events.py
visual_workflow_adapters/
```

`main.py` 只负责装配 router、repository、executor 和 lifespan，不继续堆叠工作流业务逻辑。

## 14. 实施阶段

### Phase 1：可编辑、可保存的强类型画布

交付节点注册表、无限画布、输入/输出节点、端口校验、环检测、保存修订和恢复。

### Phase 2：本地无付费执行闭环

先实现 prompt、输入、template、preview、gallery 等不调用模型的节点，证明 DAG、事件、缓存和恢复机制正确。

### Phase 3：图片模型纵向闭环

接入视觉理解、图片生成和图片编辑；实现一图分叉三个模型、结果并排比较。

### Phase 4：视频模型纵向闭环

把现有 T2V/I2V/首尾帧/R2V 作为节点执行器接入，复用 Task ID、轮询、SSE 和资产转存。

### Phase 5：增量运行与生产护栏

实现从节点运行、失败分支重试、缓存管理、并发/成本预检、运行审计。

### Phase 6：高级体验

自动布局、分组/折叠、模板市场、复制粘贴、可选多人协作。

## 15. 关键风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| 把 UI 状态写入执行定义导致缓存不稳定 | 高 | Definition/Revision/Run 三层分离 |
| 前端阻止非法连线但后端仍可被伪造请求绕过 | 高 | 后端重复完整校验 |
| 供应商临时 URL 进入缓存后过期 | 高 | 图内只传播 artifactId + sha256 |
| 同一节点双击执行导致重复付费 | 高 | clientRequestId、Run 幂等、NodeRun 唯一约束 |
| 视频节点占满并发阻塞所有图片节点 | 高 | 总并发 + 供应商 + 媒体类型三级信号量 |
| 保存时覆盖另一个标签页的修改 | 中 | baseRevision 乐观锁，409 后人工合并 |
| 大图造成画布频繁重渲染 | 中 | memo、自定义 selector、缩略图、简化边动画 |
| SQLite 多 Worker 竞争 | 高 | 首期明确单实例；扩容前迁移队列与数据库 |
| 任意 URL/自定义代码导致 SSRF/RCE | 高 | 资产白名单、禁止任意执行节点 |

## 16. 架构确认项

建议按以下默认决策开始实施：

1. 模块名：`视觉工作流`，侧边栏与 `AI 视频` 并列，而不是塞进现有视频表单。
2. 第一条付费模型闭环先做图片，再做视频；DAG 引擎先用无付费节点验证。
3. 单人编辑、SSE 执行；多人协作延后。
4. SQLite 单实例首发；不提前引入 Redis/Celery。
5. 只接入项目已有且真实可调用的模型，节点目录可以展示“即将支持”，但不可提交。
