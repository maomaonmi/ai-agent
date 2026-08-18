# AI 生图模块产品与技术实施计划书

> 版本：v1.0  
> 日期：2026-08-15  
> 状态：待评审  
> 范围：计划书，不包含本轮代码实现

## 1. 项目结论

在现有 AI Agent 产品内新增一级工作台“AI 生图”。它拥有两个等价入口：

1. 全局侧边栏的“AI 生图”；
2. 新建对话输入框“更多 → AI 生图”。

两个入口都进入同一工作台，不在普通聊天流中直接生成。工作台采用“视觉导演自动决策、用户可手动覆盖”的模式：用户只需描述想要的画面，系统完成意图解析、模型推荐、提示词增强、参数适配、任务执行、作品持久化与复用。

第一版以文生图为核心，但数据结构和适配器为后续参考图生图、图片编辑、局部重绘和多图一致性预留扩展点。

## 2. 设计原则

- **一句话也能出好图**：高级参数不能成为首次生成的门槛。
- **推荐可解释、选择可覆盖**：自动路由要说明“为什么推荐”，用户也可锁定模型。
- **能力由后端声明**：尺寸、张数、负向提示词等约束来自模型能力注册表，前端不写死。
- **生成任务可恢复**：离开页面、刷新或重启应用后仍能查看任务与作品。
- **远端 URL 不是资产**：成功后立即下载到本地受管目录，避免供应商临时链接失效。
- **原始意图不可丢失**：原始需求、增强提示词、负向提示词、路由依据与最终参数同时保存。
- **失败可行动**：错误必须告诉用户下一步能做什么，而不只显示“生成失败”。

## 3. 信息架构与入口

### 3.1 侧边栏

在“新建对话”下方新增一级入口：

- 图标：`Image` / `Images`（沿用 lucide-react）；
- 文案：`AI 生图`；
- 激活态：与现有一级导航保持一致；
- 折叠侧边栏：保留图标和 Tooltip；
- 点击后进入 `image-studio` 视图，不创建普通聊天会话。

历史会话和 AI 生图作品是不同的信息对象。侧边栏的对话历史继续展示聊天会话；生图历史在 Image Studio 内管理，避免不同类型记录混在一起。

### 3.2 输入框“更多”菜单

“AI 生图”菜单项点击后：

- 跳转到与侧边栏完全相同的 `image-studio` 视图；
- 若输入框已有文字，自动带入“创作描述”，但不自动发起生成；
- 若存在未上传附件，不静默丢弃，提示用户“当前版本仅带入文字需求”；
- 关闭更多菜单，保留返回普通对话的能力。

### 3.3 路由与状态建议

第一阶段可延续现有 `ChatInterface` 的 view 状态模式，新增 `image-studio`；但应将生图页拆成独立 feature，而非继续扩大主组件。后续再迁移为 Next.js 独立路由 `/image-studio`。

建议支持 URL 查询参数：

```text
/image-studio?prompt=科技感赛博朋克猫咪在写代码
```

URL 只携带草稿，不携带 API Key、完整负向提示词或本地文件路径。

## 4. Image Studio 产品形态

### 4.1 总体布局

采用与现有产品一致的明亮中性设计语言，而不是独立的深色“工具站”风格。

桌面端分为三层：

1. **顶部栏**：返回、页面标题、自动/手动模式、作品库入口；
2. **创作区**：居中的自然语言输入和核心参数；
3. **结果区**：当前任务进度、作品网格、历史作品。

高级参数使用右侧抽屉或折叠面板，不长期占据大面积左栏。移动端改为单列，参数通过底部抽屉展开。

### 4.2 空状态

空状态不是纯占位图，而是帮助用户快速开始：

- 主标题：`描述你想看到的画面`；
- 多行输入框；
- 4—6 个可点击示例，例如中文海报、商品图、写实人像、国风插画；
- 模式默认显示：`智能推荐模型`；
- 主按钮：`生成图片`；
- 下方显示最近作品（存在时）。

### 4.3 创作输入区

基础字段：

- 原始需求 `raw_prompt`；
- 模型模式：自动推荐 / 手动选择；
- 画幅比例：1:1、4:3、3:4、16:9、9:16、自定义；
- 生成张数：根据当前候选模型能力动态限制；
- 清晰度/质量：仅在模型支持时显示。

高级字段：

- 增强提示词；
- Negative Prompt（仅对支持模型展示或发送）；
- seed（模型不支持时隐藏）；
- 风格标签；
- 构图、镜头、光影参数；
- 输出格式；
- “锁定我的模型与参数”开关。

### 4.4 视觉导演反馈

用户输入停止约 400—600ms 后可进行本地轻量检测；真正的增强在点击生成后执行，减少无效模型调用。

生成前展示简洁的导演建议卡：

```text
推荐 CogView-4
原因：需求包含必须准确呈现的中文“2026”，且为霓虹招牌场景。
已优化：补充构图、材质、光线；添加低清晰度和文字变形排除项。
```

用户可展开查看完整增强提示词，也可恢复原始版本或直接编辑。

### 4.5 生成中状态

每个生成请求创建持久化任务，状态为：

```text
draft → directing → queued → generating → downloading → succeeded
                                      ↘ failed / cancelled
```

界面展示：

- 当前步骤与模型名；
- 已完成张数 / 目标张数；
- 可取消（供应商不能真正取消时，至少停止轮询并标记本地取消）；
- 离开页面提示“任务将在后台继续”；
- 同一作品批次的骨架屏保持最终画幅比例，避免布局跳动。

不展示虚假的百分比；供应商没有进度数据时只展示阶段与耗时。

### 4.6 结果画廊

图片卡片默认提供：

- 点击全屏 Lightbox；
- 下载原图；
- 复制增强提示词；
- `做同款`：复制完整配置到新草稿；
- `基于原始需求再来一组`；
- 删除作品（需二次确认，可先软删除）；
- 查看元数据：模型、尺寸、seed、生成时间、路由原因。

Lightbox 支持键盘左右切换、Esc 关闭、缩放、下载。批次层面支持“全部下载”，后续可增加 ZIP 导出。

### 4.7 作品库

作品库按批次而不是单图组织：

- 最近生成；
- 搜索原始需求和提示词；
- 按模型、日期、画幅筛选；
- 成功、失败、生成中任务均可追踪；
- 批次详情保留全部图片和生成配置；
- 重启后自动恢复未完成任务，或标为“中断待重试”。

## 5. 视觉导演 Agent

### 5.1 输入与输出

输入：

```json
{
  "raw_prompt": "科技感赛博朋克猫咪在写代码，带‘2026’霓虹字",
  "requested_ratio": "1:1",
  "requested_count": 4,
  "model_mode": "auto",
  "locked_model": null
}
```

输出使用结构化数据，不从自然语言中二次解析：

```json
{
  "intent": {
    "scene": "cyberpunk",
    "contains_required_text": true,
    "required_texts": ["2026"],
    "needs_character_consistency": false,
    "needs_4k": false,
    "speed_priority": "balanced"
  },
  "enhanced_prompt_zh": "...",
  "enhanced_prompt_en": "...",
  "negative_prompt": "...",
  "composition": "medium shot, centered composition",
  "lighting": "cyan-magenta neon rim light",
  "recommended_model": "cogview-4",
  "fallback_models": ["glm-image", "qwen-image-3.0-pro"],
  "routing_reasons": ["required_chinese_text", "complex_semantics"],
  "suggested_ratio": "1:1",
  "warnings": []
}
```

### 5.2 路由策略

路由器采用“硬约束过滤 + 加权评分”，而不是让大模型直接随意返回模型 ID。

第一步：能力过滤

- 是否支持当前任务类型；
- 是否支持所需尺寸、张数与负向提示词；
- 供应商是否已配置且健康；
- 是否触发内容安全限制。

第二步：打分

| 信号 | 优先模型 |
|---|---|
| 必须准确呈现中文或中英混排 | CogView-4 / GLM-Image / Qwen Image 3.0 Pro |
| 复杂版面、小字、多语言排版 | qwen-image-3.0-pro |
| 4K、品牌色、连续角色、多图一致性 | wan2.7-image-pro |
| 速度与成本优先、写实人像或商品图 | z-image-turbo |
| 普通生成且偏平衡 | qwen-image-3.0 / wan2.7-image / glm-image |

第三步：参数适配

将统一参数转换为供应商实际参数；不支持的参数必须丢弃并记录 warning，不能原样透传导致接口报错。

第四步：回退

- 仅对可重试错误自动回退：超时、限流、服务暂不可用；
- 鉴权失败、余额不足、内容安全拒绝不自动切换供应商；
- 自动回退最多一次，避免重复扣费；
- 回退前若可能产生重复计费，必须检查供应商任务 ID 或幂等状态。

### 5.3 自动与手动的关系

- 默认：自动推荐；
- 用户手动选择模型后，该次任务锁定模型；
- 即使手动选择，导演仍负责提示词增强和参数合法化；
- 如果用户参数超出模型能力，界面给出可选修正，不悄悄降低质量；
- `做同款` 默认复用原模型，但用户可以切回自动推荐。

## 6. 模型能力注册表

能力信息放在后端单一数据源中，建议配置结构：

```python
ImageModelCapability(
    id="qwen-image-3.0-pro",
    provider="qianwen",
    task_types={"text_to_image", "image_edit"},
    max_outputs=6,
    max_width=2048,
    max_height=2048,
    supports_negative_prompt=True,
    supports_seed=False,
    supports_reference_images=True,
    enabled=True,
)
```

前端通过 `GET /api/image/models` 获取可用模型和约束。注册表还应包含：展示名、描述、推荐场景、允许尺寸、质量选项、供应商模型编码、API 版本和更新时间。

基于 2026-08-15 官方文档的初始基线：

| 统一模型 ID | 供应商实际 ID | 重点能力 | 官方上限基线 |
|---|---|---|---|
| qwen-image-3.0-pro | qwen-image-3.0-pro | 复杂版面、小字、多语言、负向提示词 | 6 张，2048×2048 |
| qwen-image-3.0 | qwen-image-3.0 | 平衡速度与质量 | 6 张，2048×2048 |
| wan2.7-image-pro | wan2.7-image-pro | 4K、品牌色、多图一致性 | 通常 4 张；顺序模式 12 张；文生图 4096×4096 |
| wan2.7-image | wan2.7-image | 平衡版 Wan | 通常 4 张；顺序模式 12 张；2048×2048 |
| z-image-turbo | z-image-turbo | 极速、低成本、写实 | 1 张，2048×2048 |
| cogview-4 | cogview-4 / cogview-4-250304 | 中文文字、国风、双语理解 | 尺寸按智谱能力约束动态下发 |
| glm-image | glm-image | 知识密集版面、中文长文本、通用高质量 | 边长 512—2048，尺寸需符合官方倍数/像素约束 |

注意：前端展示上限不能直接依赖本表文字；实现时以注册表及供应商官方文档为准。

## 7. 后端架构

### 7.1 模块边界

建议新增独立包：

```text
image_generation/
  contracts.py          # 统一请求、响应、错误类型
  capabilities.py       # 模型能力注册表
  director.py           # 意图解析、增强、推荐与解释
  router.py             # 过滤、评分、参数适配、回退
  service.py            # 用例编排与事务边界
  repository.py         # 批次、任务、作品持久化
  storage.py            # 图片下载、校验、缩略图与文件路径
  providers/
    base.py
    qianwen.py
    zhipu.py
```

`main.py` 只负责 FastAPI 路由装配，避免继续堆积供应商细节。

### 7.2 统一请求契约

```json
{
  "raw_prompt": "string",
  "model_mode": "auto",
  "model": null,
  "ratio": "1:1",
  "width": null,
  "height": null,
  "count": 4,
  "quality": "standard",
  "seed": null,
  "negative_prompt": null,
  "enhance": true,
  "idempotency_key": "uuid"
}
```

约束：

- `raw_prompt` 首版建议 1—2000 字符；适配器按模型上限再次校验；
- `count` 由候选模型能力动态裁决；
- 手动模型必须存在且启用；
- 自定义尺寸必须先统一校验，再做供应商规则校验；
- 相同 `idempotency_key` 不重复创建计费任务。

### 7.3 统一交付契约

扩展用户给出的 `ImageGenResponse`，使其能支持异步、持久化和回退：

```json
{
  "batch_id": "uuid",
  "task_id": "uuid",
  "status": "succeeded",
  "model": "cogview-4",
  "provider": "zhipu",
  "raw_prompt": "...",
  "prompt": "...",
  "negative_prompt": "...",
  "size": {"width": 1024, "height": 1024},
  "seed": null,
  "routing": {
    "mode": "auto",
    "reasons": ["required_chinese_text"],
    "fallback_used": false
  },
  "images": [
    {
      "id": "uuid",
      "url": "/api/image/assets/{id}",
      "thumbnail_url": "/api/image/assets/{id}/thumbnail",
      "width": 1024,
      "height": 1024,
      "mime_type": "image/png",
      "sha256": "..."
    }
  ],
  "created_at": "ISO-8601",
  "completed_at": "ISO-8601"
}
```

### 7.4 API 清单

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/image/models` | 获取已配置模型与能力 |
| POST | `/api/image/direct` | 仅运行视觉导演，返回建议，不计生图任务 |
| POST | `/api/image/generations` | 创建生成批次，返回 202 与 task_id |
| GET | `/api/image/tasks/{task_id}` | 查询任务状态 |
| POST | `/api/image/tasks/{task_id}/cancel` | 取消或停止跟踪任务 |
| GET | `/api/image/batches` | 分页、搜索、筛选作品批次 |
| GET | `/api/image/batches/{batch_id}` | 获取批次详情 |
| DELETE | `/api/image/batches/{batch_id}` | 软删除批次与作品 |
| POST | `/api/image/batches/{batch_id}/retry` | 以原始需求重试 |
| GET | `/api/image/assets/{image_id}` | 读取本地原图 |
| GET | `/api/image/assets/{image_id}/thumbnail` | 读取缩略图 |
| GET | `/api/image/health` | 检查各供应商配置与可用性（不暴露密钥） |

首版任务状态可用轮询实现（1—2 秒动态退避）；若以后并发增加，再升级 SSE/WebSocket。

## 8. 持久化设计

### 8.1 SQLite 表

#### `image_generation_batches`

- `id` UUID 主键；
- `raw_prompt`；
- `enhanced_prompt_zh`；
- `enhanced_prompt_en`；
- `negative_prompt`；
- `model_mode`；
- `selected_model`；
- `provider`；
- `routing_reasons_json`；
- `request_params_json`；
- `status`；
- `error_code`、`error_message`；
- `provider_task_id`；
- `idempotency_key` 唯一索引；
- `created_at`、`updated_at`、`completed_at`、`deleted_at`。

#### `image_generation_assets`

- `id` UUID 主键；
- `batch_id` 外键；
- `position`；
- `local_path`；
- `thumbnail_path`；
- `original_remote_url`（仅诊断，不能作为交付地址）；
- `mime_type`、`width`、`height`、`byte_size`、`sha256`；
- `seed`；
- `created_at`、`deleted_at`。

#### `image_generation_events`

记录状态转换与诊断事件：任务创建、路由结果、供应商响应、下载完成、回退、失败。事件中不得保存 API Key 或完整 Authorization header。

### 8.2 文件存储

```text
data/image-studio/
  originals/YYYY/MM/{batch_id}/{asset_id}.{ext}
  thumbnails/YYYY/MM/{batch_id}/{asset_id}.webp
```

安全要求：

- 文件名由服务端 UUID 生成，不使用用户输入；
- 下载供应商图片时限制协议、响应大小、超时和 MIME；
- 防止 SSRF，只允许供应商响应中的 HTTPS URL，并执行主机策略；
- 校验实际图片格式与扩展名；
- 使用原子写入，下载未完成文件不进入成功状态；
- 删除默认先软删除，提供后续垃圾回收任务。

### 8.3 应用重启恢复

启动时扫描 `directing / queued / generating / downloading` 状态：

- 有供应商任务 ID 且支持查询：恢复轮询；
- 无法恢复：标记 `interrupted`，允许一键重试；
- 已下载但数据库未提交：通过校验和做补偿；
- 不自动重新提交可能扣费的任务。

## 9. 供应商适配

### 9.1 千问适配器

职责：

- 将统一模型 ID、尺寸、数量和负向提示词映射为千问请求；
- 兼容同步与异步任务返回；
- 解析多图、顺序模式与编辑能力；
- 统一千问错误为内部错误码；
- 对 `z-image-turbo` 等不同限制单独校验，不能套用通用 Qwen 上限。

### 9.2 智谱适配器

职责：

- 调用 `/api/paas/v4/images/generations`；
- `cogview-4` 统一别名映射到实际可用版本 ID；
- GLM-Image 与 CogView 分别使用各自尺寸/质量限制；
- 处理 `content_filter`；
- 下载返回 URL 并转为本地资产。

### 9.3 错误分类

统一错误码建议：

- `provider_not_configured`；
- `authentication_failed`；
- `insufficient_balance`；
- `rate_limited`；
- `invalid_parameters`；
- `content_rejected`；
- `provider_timeout`；
- `provider_unavailable`；
- `asset_download_failed`；
- `storage_failed`；
- `generation_interrupted`。

错误响应包含 `retryable` 和用户可执行建议，前端据此展示重试、换模型或打开设置。

## 10. 配置与密钥

- 沿用现有设置中心的供应商配置方式，新增千问与智谱图片生成可用状态；
- API Key 只保存在服务端配置或环境变量中；
- `/api/image/models` 仅返回 `configured: true/false`，不返回密钥；
- 日志、数据库事件与异常栈必须脱敏；
- 未配置供应商时，工作台仍可打开，但生成按钮给出明确配置入口；
- 模型启停独立于供应商 Key，便于临时下架单个模型。

## 11. 前端工程拆分

建议目录：

```text
src/features/image-studio/
  ImageStudioWorkspace.tsx
  imageStudioTypes.ts
  imageStudioApi.ts
  imageStudioReducer.ts
  components/
    ImagePromptComposer.tsx
    DirectorRecommendation.tsx
    ModelSelector.tsx
    GenerationSettings.tsx
    GenerationProgress.tsx
    ImageGallery.tsx
    ImageCard.tsx
    ImageLightbox.tsx
    ImageLibrary.tsx
    ImageBatchDetails.tsx
```

状态划分：

- 服务端状态：模型能力、任务、批次、作品；
- 页面草稿状态：输入、手动模型、参数、展开面板；
- Lightbox 状态：当前图片、缩放和索引；
- 不把完整图片 Base64 放入 React state 或 localStorage。

前端 API 统一走现有 API client 与 base URL 配置，禁止在组件内写死 `http://localhost:8000`。

## 12. 可访问性与响应式验收

- 全部按钮有可读名称和键盘焦点；
- 模型选择使用 radio/combobox 语义，不依赖颜色表达选中；
- 任务状态使用 `aria-live`，避免高频刷屏；
- Lightbox 可通过键盘关闭和切图，并限制焦点在弹层内；
- 图片带有基于原始需求的简短 alt；
- 200% 缩放和 320px 宽度下核心流程可完成；
- 骨架屏保留画幅比例，减少 CLS；
- 尊重 `prefers-reduced-motion`。

## 13. 测试策略

### 13.1 后端单元测试

- 中文文字信号会优先推荐 CogView/GLM/Qwen Pro；
- 4K 与一致性需求推荐 Wan Pro；
- 速度优先推荐 Turbo；
- 手动锁模不被导演覆盖；
- 每个模型的尺寸、张数和参数校验；
- 供应商错误映射、重试与最多一次回退；
- 幂等键不会产生重复任务；
- 远端图片下载安全与校验。

### 13.2 API 合约测试

- 模型列表只返回已声明字段且不泄露密钥；
- 创建任务返回 202；
- 状态机不出现非法倒退；
- 批次分页、筛选、软删除和重试；
- 重启恢复与 interrupted 行为。

### 13.3 前端测试

- 两个入口进入同一工作台；
- 输入框已有文字时正确带入；
- 自动推荐说明、手动覆盖和模型约束联动；
- 任务轮询、成功、失败、取消和恢复；
- Lightbox、下载、做同款和删除；
- 键盘与移动端核心流程。

### 13.4 供应商冒烟测试

真实 API 测试默认不进入普通单元测试，使用显式环境开关：

- 每个供应商至少执行一张低成本测试图；
- 验证返回、下载、本地读取和持久化；
- 记录调用模型与时间，不把密钥或临时 URL 写入测试快照。

## 14. 分阶段实施路线

### Phase 0：契约与能力基线

产出统一类型、状态机、能力注册表、错误码与数据库迁移。这是前后端并行开发的边界。

验收：模型能力可由 API 读取；所有请求在调用供应商前完成合法性校验。

### Phase 1：最小纵向闭环

先打通一个千问模型和一个智谱模型：创建任务 → 自动路由 → 调用 → 下载 → 持久化 → 画廊展示。

验收：重启应用后仍能查看已生成作品；临时 URL 失效不影响本地查看。

### Phase 2：全模型路由与导演

接入目标模型，完成结构化增强、路由评分、推荐理由、手动覆盖、参数动态限制与错误回退。

验收：给定典型提示词集合时，路由结果和参数均符合预期；不可用模型不会被推荐。

### Phase 3：作品库与交互完善

完成搜索筛选、Lightbox、批量下载、做同款、重试、软删除、响应式与无障碍。

验收：从任一入口进入后，可以完整完成“描述 → 生成 → 查看 → 下载 → 复用 → 历史找回”。

### Phase 4：可靠性与发布门槛

完成任务恢复、幂等、安全下载、限流、日志脱敏、真实供应商冒烟测试与回归。

验收：构建通过；自动化测试通过；关键失败场景均有可行动提示；未配置密钥时不崩溃。

## 15. 依赖关系

```text
能力注册表 + 统一契约 + 数据库迁移
                │
        ┌───────┴────────┐
        ▼                ▼
  供应商适配器       前端 API/基础壳
        │                │
        └───────┬────────┘
                ▼
       任务编排 + 本地资产存储
                │
                ▼
        视觉导演 + 自动路由
                │
                ▼
     作品库、复用、恢复与可靠性
```

## 16. 风险与缓解

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 供应商模型参数与上限变化 | 高 | 后端能力注册表、官方文档版本备注、合约测试 |
| 生成任务重复提交导致重复扣费 | 高 | 幂等键、供应商任务 ID、回退最多一次 |
| 远端 URL 过期导致历史作品丢失 | 高 | 成功后立即下载到受管本地存储 |
| 不同模型参数语义不一致 | 高 | 供应商适配器做显式映射，不透传未知字段 |
| 大图占用磁盘与内存 | 中 | 流式下载、大小限制、缩略图、容量指标与垃圾回收 |
| 中文检测规则过度简化 | 中 | 检测“必须出现在画面中的文字”，而非仅检测提示词语言 |
| 自动回退改变风格或产生二次费用 | 中 | 解释回退、限制次数、仅处理明确可重试错误 |
| 视觉导演增强偏离原意 | 中 | 同时保存原始需求，增强结果可见、可编辑、可关闭 |
| 主组件继续膨胀 | 中 | 独立 feature、API client、service 与 repository 边界 |

## 17. 第一版明确不做

- 图片编辑、局部重绘和蒙版；
- 参考图融合与角色资产管理；
- 云端对象存储和多用户权限隔离；
- 商业计费、积分与预算系统；
- 社区作品广场；
- 自训练 LoRA、风格模型上传；
- 在普通聊天消息流内直接渲染生成任务。

这些能力在契约中预留，但不进入首版验收，防止范围失控。

## 18. Definition of Done

- 两个入口都进入同一个 AI 生图工作台；
- 默认自动路由，用户能查看推荐原因并手动覆盖；
- 所有目标模型通过统一契约接入，能力约束不在前端硬编码；
- 原始需求、增强提示词、模型、尺寸、seed、路由与错误信息持久化；
- 图片保存为本地资产，应用重启后可继续查看；
- 当前任务、历史作品、下载、Lightbox、做同款、重试和删除均可用；
- 幂等、回退、安全下载、密钥脱敏和中断恢复通过测试；
- 前后端构建及测试通过，真实千问与智谱各完成至少一次冒烟调用；
- 关键桌面与移动视口完成视觉和可访问性检查。

## 19. 官方资料与基线说明

- 千问图像模型能力与上限：<https://platform.qianwenai.com/docs/developer-guides/getting-started/image-models>
- 智谱 GLM-Image：<https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image>
- 智谱 CogView-4：<https://docs.bigmodel.cn/cn/guide/models/image-generation/cogview-4>
- 智谱图像生成 API：<https://docs.bigmodel.cn/api-reference/模型-api/图像生成>

实现开始前应再次核对官方文档，尤其是模型 ID、输出张数、尺寸、异步任务与计费规则。
