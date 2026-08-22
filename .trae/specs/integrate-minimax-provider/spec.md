# MiniMax 全栈接入 Spec

> change-id: `integrate-minimax-provider`
> 决策基线（已与用户确认）：
> ① 文本主链路走 **Anthropic Messages 协议**（`https://api.minimaxi.com/anthropic`），httpx 直调 REST，零新依赖；
> ② web / research / plan 三模式在新建 `minimax/` 包内写主链路，main.py 只做薄分发；
> ③ agent / distributed_plan 两模式走 **OpenAI 兼容端点**（`https://api.minimaxi.com/v1`）参数适配进现有 LangGraph 链路；
> ④ Code 模式在 App.py 现有供应商分支处加 minimax 适配，不动 Code 主逻辑；
> ⑤ 深度调研新增「MiniMax 原生调研」引擎按钮（与千问原生研究 UI 模式对齐）。

---

## Why

全面接入 MiniMax 模型系列（文本 M3/M2.7/M2.5、图像 image-01、视频 MiniMax-H3）。M3 原生支持 Interleaved Thinking（每轮 Tool Use 前根据工具返回再思考）与服务端联网搜索（web_search，仅 Anthropic Messages API），是现有 GLM/千问/DeepSeek 三供应商都不具备的 Agent 能力，可直接增强调研、自主规划、Code、写作、PPT 链路。现有 main.py（432KB）/App.py（311KB）逻辑已过载，新供应商主链路必须独立成包，主文件只保留接口挂载与控制。

## 官方协议事实（实现依据）

| 能力 | 协议路径 | 关键参数/行为 |
|---|---|---|
| 文本（Anthropic 兼容，主链路） | `POST {base_url}/v1/messages`，`base_url=https://api.minimaxi.com/anthropic` | 认证 `Authorization: Bearer <key>`；响应 `content` 为块列表（`thinking`/`text`/`tool_use`）；流式 SSE 事件 `message_start` → `content_block_start/delta/stop` → `message_delta` → `message_stop` |
| 文本（OpenAI 兼容，LangGraph/Code 用） | `https://api.minimaxi.com/v1` | `extra_body={"reasoning_split": True}` 时思考内容分离到 `reasoning_details` 字段；不开启则 `<think>` 标签混在 content 里 |
| Interleaved Thinking | 两条协议均支持 | **必须完整回传 assistant 消息**（含 thinking 块/tool_calls/reasoning_details），思维链才不被打断 |
| 服务端联网搜索 | **仅 Anthropic Messages API**，Beta | `tools: [{"type": "web_search_20250305", "name": "web_search"}]`；一次请求内完成；响应含 `server_tool_use` 与 `web_search_tool_result` 块 |
| 被动 Prompt 缓存 | 自动，无需参数 | 前缀匹配顺序：工具定义 → system → messages；≥512 输入 token 生效；M3/M2.7/M2.5 全支持；用量字段 `cache_read_input_tokens`（Anthropic）/ `prompt_tokens_details.cached_tokens`（OpenAI） |
| 主动缓存（cache_control） | 仅 Anthropic 协议 | `cache_control: {"type": "ephemeral"}`；**M3 不支持，仅 M2.7/M2.5 系列**；5min 过期自动续期；单请求最多 4 个断点、20 块回溯窗口 |
| 图像生成 | `POST https://api.minimaxi.com/v1/image_generation` | `model="image-01"`；文生图（prompt）+ 图生图（`subject_reference`，单张参考图，type=character）；`aspect_ratio`；`response_format="base64"` → `data.image_base64[]` |
| 视频生成（MiniMax-H3） | `POST https://api.minimaxi.com/v2/video_generation`；轮询 `GET /v2/query/video_generation/{task_id}`（推荐 10s） | 多模态 `content[]`：`type` ∈ text/image_url/video_url/audio_url，`role` ∈ first_frame/last_frame/reference_image/reference_video；t2v 时 `ratio` 必填非 adaptive，i2v 恒 adaptive；`duration` 4~15 整数；`resolution` 768P/2K；succeeded 后 `task.content.url` 即成片地址 |

模型目录（用户指定 5 个文本模型 + 2 个专项模型）：

| model_id | 定位 | 上下文 | 能力 |
|---|---|---|---|
| MiniMax-M3 | 旗舰 | 1M | 原生多模态（image_url/video_url）、Interleaved Thinking |
| MiniMax-M2.7 | 均衡 | 204,800 | thinking 块、主动缓存 |
| MiniMax-M2.7-highspeed | 极速 | 204,800 | 同 M2.7，约 100 TPS |
| MiniMax-M2.5 | 性价比 | 204,800 | thinking 块、主动缓存 |
| MiniMax-M2.5-highspeed | 极速 | 204,800 | 同 M2.5，约 100 TPS |
| image-01 | 图像 | — | 文生图 + 图生图 |
| MiniMax-H3 | 视频 | — | t2v / 首尾帧 / 全能参考 |

## What Changes

- **新增 `minimax/` 后端包**（核心交付）：Anthropic 客户端、SSE 事件桥接、对话链路（standard/deep/web）、Interleaved Thinking 工具循环（research/plan/MCP）、主动缓存策略、OpenAI 兼容参数适配器、图像与视频供应商实现
- **配置层** `model_settings.py`：MODEL_CATALOG 新增 minimax 分组；provider 枚举加 `"minimax"`；api_format 加 `"anthropic_messages"`；默认 profile
- **main.py**：`/chat` 分发加 minimax 分支（薄调用）；图片模型注册表加 image-01；写作链路 provider 化
- **App.py**：Code 模式加 minimax 分支（思考参数 / `<think>` 剥离 / JSON 能力开关）
- **video_engine.py**：新增 MiniMaxVideoProvider + H3 能力注册（t2v / 首尾帧 / 全能参考）
- **ppt_agent_loop.py / ppt_api.py**：model_provider 枚举加 `"minimax"`
- **前端**：SettingsDialog 预设、ModelQuickSwitcher 分组（catalog 驱动自动出现）、调研引擎按钮「MiniMax 原生调研」、图片/视频工作区模型下拉、PPT 创建选项、写作模型路由、缓存命中量展示
- 后置（不在本轮）：H3-Context-IR 提示词增强任务、视频再生成（768P→2K）、M2-her 对话模型

## Impact

- Affected code：
  - 新增 `minimax/`（client / chat / agent_loop / research / plan / server_search / caching / openai_compat / image / video / __init__）
  - `model_settings.py`（MODEL_CATALOG、ModelSettings、ModelSettingsStore.load）
  - `main.py`（/chat 分发 ~L7489、图片注册表 ~L5330、写作端点 ~L7461、settings API 无需改）
  - `App.py`（供应商分支 ~L392/L469-L494/L5345）
  - `video_engine.py`、`video_api.py`（如需注册路由）、`ppt_agent_loop.py`、`ppt_api.py`、`thesis_writing.py` 相关端点
  - 前端：`SettingsDialog.tsx`、`ModelQuickSwitcher.tsx`、`ResearchOptionsPopover.tsx`（引擎按钮）、`ImageStudioWorkspace.tsx`（模型列表来自后端，自动）、`VideoStudioWorkspace.tsx`（同）、`features/ppt/api.ts`、`features/ai-writing/writingModelRouter.ts`、`lib/api.ts`（类型）
- 现有 GLM/千问/DeepSeek 行为零改动（回归红线）

## ADDED Requirements

### Requirement: MiniMax Anthropic 客户端（minimax/client.py）

系统 SHALL 提供 httpx 直调 MiniMax Anthropic Messages REST 的客户端：非流式与流式（SSE）两种调用，流式解析出 `thinking_delta` / `text_delta` / `tool_use` / `server_tool_use` / `web_search_tool_result` / usage（含 `cache_read_input_tokens`）结构化事件；超时 ≥120s；401/403/429/4xx 错误映射为可读中文错误。禁止引入 anthropic SDK 依赖。

#### Scenario: 流式对话
- **WHEN** 以 MiniMax-M3 发起流式 messages 请求
- **THEN** 客户端逐事件产出结构化回调，thinking 内容与正文内容分开，usage 在 message_delta 中捕获

#### Scenario: 网络或鉴权失败
- **WHEN** API Key 无效（401/403）或限流（429）
- **THEN** 抛出带中文说明的异常，上层转为 SSE `error` 事件，服务端记录 `logger.exception` traceback

### Requirement: MiniMax 对话主链路（standard / deep / web 模式）

系统 SHALL 在 provider=minimax 且 mode ∈ {standard, deep, web} 时走 `minimax/` 包链路：复用现有 SSE 事件协议（`node` / `reasoning_delta` / `token` / `web_docs` / `usage` / `done`），前端零适配。deep 模式启用 thinking 输出；web 模式启用服务端 web_search（`web_search_20250305`）并把 `web_search_tool_result` 桥接为 `web_docs` 事件与引用列表。记忆注入（L2 画像 / L3 摘要 / L4 滑窗）与现有直连链路对齐。

#### Scenario: 标准对话
- **WHEN** 用户在 provider=minimax 下发起 standard 模式对话
- **THEN** SSE 依次产出 node(processing) → token 流 → node(completed) → usage → done，打字机效果与 GLM/千问一致

#### Scenario: 联网搜索
- **WHEN** web 模式（或 research + web_search=on）
- **THEN** 请求 tools 声明 web_search server tool；`web_search_tool_result` 中的 title/url/page_age 桥接为 web_docs 事件，前端联网面板显示"阅读了 X 个网页"

### Requirement: Interleaved Thinking 工具循环（minimax/agent_loop.py）

系统 SHALL 提供基于 Anthropic 协议的多轮工具循环：MCP 工具（`mcp__<server>__<tool>`，来自 TOOL_REGISTRY / mcp_pool）的 OpenAI function schema 转换为 Anthropic `input_schema` 格式注入 tools；响应含 `tool_use` 块时本地执行工具并将 `tool_result` 回传；**每轮 assistant 响应（thinking + text + tool_use 块）完整追加进消息历史**以保证思维链连续；工具轮次上限走现有 token/轮次护栏；每轮 thinking_delta 通过 SSE `reasoning_delta` 实时透出。

#### Scenario: 多轮工具调用
- **WHEN** 模型连续调用 2 个 MCP 工具后给出最终答案
- **THEN** 每轮 tool_use 前的 thinking 块均流式透出，工具结果回传后模型继续思考，最终 done 事件包含完整答案

#### Scenario: 工具执行失败
- **WHEN** 某个 MCP 工具执行抛异常
- **THEN** 以 `tool_result`（`is_error=true`）回传错误摘要，循环继续，不中断整个请求

### Requirement: MiniMax 原生调研引擎（research 模式）

系统 SHALL 在 provider=minimax 的 research 模式提供「MiniMax 原生调研」引擎：基于 Interleaved Thinking 工具循环 + 服务端 web_search（可叠加 MCP fetch），模型自主多轮检索、筛选、综合并产出调研报告；SSE 产出兼容现有 ResearchProgressPanel / 深度调研文档卡片的事件流（node 阶段事件 + web_docs + token + done）。前端引擎按钮与千问原生研究同款交互，Firecrawl / 自研引擎按钮保留可选。

#### Scenario: 原生调研
- **WHEN** 用户选择「MiniMax 原生调研」发起深度调研
- **THEN** 进度面板逐阶段显示模型思考/检索/筛选节点，web_docs 展示命中的网页，完成后产出调研报告文档

### Requirement: MiniMax 自主规划链路（plan 模式）

系统 SHALL 在 provider=minimax 的 plan 模式走 minimax/ 包新链路：Interleaved Thinking agent loop 执行"计划 → 工具执行 → 观察 → 动态调整"，SSE 事件兼容现有自主规划前端组件（PlanChainTimeline / TaskExecutionPanel 所消费的事件协议）。执行前必须先梳理现有 plan 模式事件契约并在实现中对齐。

#### Scenario: 动态调整
- **WHEN** 工具返回结果显示某子任务不可行
- **THEN** 模型在 thinking 中决策调整计划，前端时间线呈现调整节点

### Requirement: 主动缓存与成本可视化（minimax/caching.py）

系统 SHALL：① 被动缓存自动生效（无需参数）；② Anthropic 链路对 system 尾块与 tools 尾项注入 `cache_control: {"type": "ephemeral"}` 断点，**仅当当前模型 ∈ M2.7/M2.5 系列**（M3 不支持，请求中不得携带）；③ usage 事件透出 `cache_read_input_tokens` / `cached_tokens`，前端在用量区域展示缓存命中量。缓存前缀构成须与记忆注入顺序对齐（静态 system + 工具定义在前，滑窗历史居中，最新用户消息在尾）。

#### Scenario: M2.7 多轮对话缓存命中
- **WHEN** 5 分钟内对同一会话发起第二轮对话
- **THEN** 第二轮 usage 的 cache_read_input_tokens > 0，前端显示缓存命中 token 数

#### Scenario: M3 不携带主动缓存标记
- **WHEN** 当前模型为 MiniMax-M3
- **THEN** 请求不含任何 cache_control 字段（避免兼容层报错），被动缓存照常生效

### Requirement: OpenAI 兼容参数适配器（minimax/openai_compat.py）

系统 SHALL 提供供 LangGraph 链路（agent / distributed_plan 模式）与 App.py Code 链路复用的适配器：基于 `https://api.minimaxi.com/v1` 构造 create_kwargs（`extra_body={"reasoning_split": True}`）；统一剥离 `<think>` 标签（未开启 reasoning_split 的兜底）；reasoning_details 思考内容提取。App.py 内以 minimax 分支接入：`uses_json_format` / 附件门禁走能力矩阵，思考参数按 minimax 协议分发，保留现有三级兜底（流式空 → 非流式重试 → reasoning 兜底）。

#### Scenario: 多智能体协同模式
- **WHEN** provider=minimax 且 mode=agent（或 distributed_plan）
- **THEN** 现有 LangGraph 链路以 OpenAI 兼容端点正常完成多智能体讨论，思考内容不污染正文输出

#### Scenario: Code 模式全栈生成
- **WHEN** Code 沙箱以 minimax 模型发起全栈生成
- **THEN** SSE 流式正常，`<think>` 不出现在生成的前端代码中；若 json_object 实测不可用则该模型关闭 JSON 能力开关（能力矩阵控制），链路走普通文本解析

### Requirement: 图像生成接入（image-01）

系统 SHALL 在 main.py 图片模型注册表新增 minimax image-01：文生图（prompt + aspect_ratio + n）与图生图（subject_reference 单参考图，对接现有参考图能力标记）；响应 base64 解码后进入现有图片任务与画廊链路；API Key 复用 minimax profile。视觉导演推荐规则：MiniMax image-01 定位"主体一致性/写实人像"推荐档。

#### Scenario: 图生图
- **WHEN** 用户在图片工作区选择 image-01 并附带一张人物参考图
- **THEN** 生成保留主体特征的新图，进入画廊

### Requirement: 视频生成接入（MiniMax-H3）

系统 SHALL 在 video_engine.py 新增 MiniMaxVideoProvider 并注册 MiniMax-H3 能力：文生视频（ratio 必填非 adaptive）、首帧/尾帧图生视频（role=first_frame/last_frame，ratio 恒 adaptive）、全能参考生成（参考图/视频/音频，遵守 ≤9 图、≤3 视频、≤3 音频、混合 ≤12 文件、单素材大小限制）；异步任务提交 `/v2/video_generation`、轮询 `/v2/query/video_generation/{task_id}`（10s 间隔）接入现有 VideoTaskMonitor；succeeded 后取 `task.content.url` 下载存储；失败/取消终态透出错误。前端视频工作区模型下拉自动出现 MiniMax-H3（模型列表来自 `/api/video/models`）。

#### Scenario: 全能参考生成
- **WHEN** 用户选择 MiniMax-H3 并上传 2 张参考图 + 1 段参考视频
- **THEN** 任务创建成功，轮询进度实时更新，完成后成片可在工作区播放

#### Scenario: 输入越界校验
- **WHEN** 参考素材超出数量/大小/时长限制
- **THEN** 创建请求返回 422 并给出具体越界项说明，不发起 API 调用

### Requirement: PPT 与写作接入

系统 SHALL：① ppt 链路 `model_provider` 枚举加 `"minimax"`（ppt_api.py 请求模型 + ppt_agent_loop 分发 + 前端创建选项），模型调用走 minimax 适配（大纲/逐页生成的 OpenAI 兼容调用），封面 AI 图可选 image-01；② 写作链路（thesis 大纲/正文/参考资料）支持 provider 选择：新增 minimax 选项（M3 1M 上下文承载长文），前端 writingModelRouter 路由表扩展，默认仍为千问不回归。

#### Scenario: PPT 生成
- **WHEN** 用户创建 PPT 任务并选择 model_provider=minimax
- **THEN** agent loop 各阶段（检索/大纲/逐页/Review）以 MiniMax 模型执行，SSE 阶段事件与现有前端一致

#### Scenario: 论文正文生成
- **WHEN** 写作工作区选择 MiniMax 模型生成章节正文
- **THEN** 流式逐段落输出，引用校验流程照常

### Requirement: 设置界面与输入框同步

系统 SHALL：① MODEL_CATALOG 新增 minimax 分组（5 文本模型，含 supports_vision/thinking_control/input_context/output_context）后，前端 ModelQuickSwitcher 与 SettingsDialog 经 `/api/settings/model-catalog` 自动渲染分组（单一数据源机制，无需前端硬编码）；② SettingsDialog PRESETS 增加 MiniMax 预设（base_url=https://api.minimaxi.com/anthropic、默认 MiniMax-M3、Key 输入持久化 data/model_settings.json，GET 脱敏）；③ 思考控件按 `thinking_control="minimax"` 渲染（思考开关；budget 档位如协议验证支持则展示）；④ 输入框模型下拉与正式聊天/Code 沙箱同步显示当前 minimax 模型（沿用全局 active profile 语义）。

#### Scenario: 设置与快速切换
- **WHEN** 用户在设置界面保存 MiniMax 预设（填入 Key）
- **THEN** 输入框下拉出现「MiniMax」分组（5 模型），选择后全局生效，会话头像旁显示当前模型名

## MODIFIED Requirements

### Requirement: /chat 供应商分发（main.py ~L7489）

原：`provider in {"glm", "qwen"} and mode in {"standard","deep","web","research"}` → direct_stream_with_mcp。
改：条件扩为 `provider in {"glm", "qwen", "minimax"}`；minimax 分支调用 minimax 包的流式生成器（含 MCP 预检轮同款 mcp 事件透出、Hook 触发、TokenUsage tracker 接线），main.py 不包含 MiniMax 业务逻辑。附件门禁：M3 因 supports_vision=True 自动放行，M2.x 系列照旧 422。

### Requirement: LangGraph 深度链路 thinking 参数分发（main.py / App.py 既有分发点）

原：GLM / 千问 / DeepSeek 三协议分支。
改：新增 minimax 分支——OpenAI 兼容端点 + `extra_body={"reasoning_split": True}`（+ 思考开关映射），不向 MiniMax 传 GLM/千问/DeepSeek 协议参数（防 400）。

### Requirement: 写作链路 provider（main.py ~L7461）

原：固定 `model_settings_store.load("qwen")`。
改：按前端显式传入 provider 加载（默认 qwen 保持兼容），minimax 走 minimax 适配调用。

## REMOVED Requirements

无（纯增量接入，现有三供应商行为全部保留）。

---

## 架构红线

1. minimax/ 包自包含：不 import main.py / App.py 的内部符号；main.py / App.py 只 import minimax 包的公开入口。
2. 能力判断一律走 `capabilities_for_model()`，禁止 `"minimax" in model.lower()` 字符串嗅探。
3. 现有 GLM/千问/DeepSeek 链路的 create_kwargs 构造零改动；minimax 参数构造全部在 minimax 包内。
4. API Key 走 settings 持久化 + `public()` 脱敏，GET 接口禁止明文回传。
5. 所有 SSE 错误路径必须 `logger.exception` 记录 traceback（项目既有教训）。
6. Windows 下 httpx 流式读取注意 UTF-8 解码（MCP fetch server 编码超时教训）。
7. 思考预算若走 Anthropic `thinking.budget_tokens`，必须 clamp 到 max_tokens 以下（千问 budget 挤占前科）。

## 风险与规避

| 风险 | 等级 | 规避 |
|---|---|---|
| MiniMax Anthropic 兼容层 thinking 参数开关/budget 文档未明示 | 中 | 实现时先发探针请求验证；不支持则不传参数（默认行为即输出 thinking 块），思考开关降级为"前端展示层过滤" |
| M3 `json_object` response_format 兼容性未实测 | 中 | 能力矩阵 `supports_json_format` 初值 True，实测失败即改 False，Code 链路自动走文本解析 |
| 服务端 web_search 为 Beta，行为可能调整 | 中 | 失败时降级为普通对话 + 明确错误事件，不阻断请求 |
| 主动缓存误加到 M3 请求导致 4xx | 高 | 能力矩阵按模型判定是否注入 cache_control，单测断言 M3 请求体无该字段 |
| LangGraph 链路传入他协议 thinking 参数致 400 | 高 | 适配器单测断言 minimax 分支 create_kwargs 不含 thinking/enable_thinking/reasoning_effort（OpenAI 兼容路径仅 reasoning_split） |
| `<think>` 标签混入 Code/正文输出 | 高 | 统一在适配器/桥接层剥离，单测覆盖 |
| H3 参考素材限制校验缺失导致 API 侧失败 | 中 | 创建前本地校验数量/大小/时长/比例，422 明确提示 |
| GLM/千问/DeepSeek 回归 | 高 | 全部改动新增分支，不动既有分支；回归用例清单见 checklist |

## 验收标准（总）

1. 设置界面可保存 MiniMax 预设；输入框下拉出现 MiniMax 分组且全局切换生效。
2. standard/deep/web 三模式以 MiniMax 模型流式对话正常：deep 出思考流，web 出服务端搜索引用与"阅读了 X 个网页"。
3. research 模式「MiniMax 原生调研」完成一次多轮检索调研并产出报告，进度面板逐阶段滚动。
4. plan 模式以 MiniMax 完成一次含工具调用与计划调整的任务，前端时间线正常。
5. agent / distributed_plan 以 MiniMax（OpenAI 兼容）完成多智能体讨论，正文无 `<think>` 污染。
6. Code 模式以 MiniMax 完成一次全栈生成，SSE 流式与预览正常。
7. 图片工作区用 image-01 完成文生图与图生图各一次。
8. 视频工作区用 MiniMax-H3 完成文生视频与首尾帧/参考生成各一次，轮询与成片播放正常。
9. PPT 以 model_provider=minimax 走完整 agent loop 出片。
10. 写作以 MiniMax 模型生成大纲 + 章节正文。
11. M2.7 连续两轮对话第二轮 usage 显示缓存命中；前端展示缓存命中量。
12. 全部新增单测通过；GLM/千问/DeepSeek 既有链路回归通过。
