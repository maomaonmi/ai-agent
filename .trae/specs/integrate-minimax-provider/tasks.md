# Tasks

> 原则：每个任务独立可验证；后端 minimax 包先行（T1-T2 是一切的地基），链路与专项功能并行推进；每完成一个任务勾选对应复选框。

## T1 配置层：模型目录与 profile

- [x] Task 1: model_settings.py 接入 minimax 供应商配置
  - [x] 1.1 MODEL_CATALOG 新增 `"minimax"` 分组：MiniMax-M3（supports_vision=True，thinking_control="minimax"，input 1M / output 32K）、MiniMax-M2.7、M2.7-highspeed、M2.5、M2.5-highspeed（vision=False，同 thinking_control，204_800 上下文）；新增 `supports_active_cache` 能力位（M2.7/M2.5 系 True，M3 False）
  - [x] 1.2 `ModelSettings.provider` 枚举加 `"minimax"`；`api_format` Literal 加 `"anthropic_messages"`
  - [x] 1.3 `ModelSettingsStore.load()` 加 minimax 默认 profile：base_url=`https://api.minimaxi.com/anthropic`、model_id=`MiniMax-M3`、display_name=`MiniMax M3`
  - [x] 1.4 前端 `lib/api.ts` 的 `ModelSettings['provider']` 联合类型加 `"minimax"`
  - [x] 1.5 单测：catalog 接口返回 minimax 分组；capabilities_for_model("MiniMax-M3") 命中新条目；GLM/千问/DeepSeek 目录回归不变

## T2 minimax 包地基：客户端与事件桥接

- [x] Task 2: minimax/client.py —— httpx 直调 Anthropic Messages 客户端
  - [x] 2.1 包骨架 `minimax/__init__.py` + 常量（OPENAI_COMPAT_BASE_URL=`https://api.minimaxi.com/v1`、默认 Anthropic base_url、模型 ID 常量、H3 素材限制常量）
  - [x] 2.2 非流式 `create_message()`：messages/tools/system/thinking/max_tokens 组装，Bearer 认证，错误映射（401/403 Key 无效、429 限流、4xx 参数错误带响应体摘要）
  - [x] 2.3 流式 `stream_message()`：httpx SSE 逐行解析（UTF-8 显式解码），产出结构化事件：message_start(usage)、thinking_delta、text_delta、tool_use 块完成、server_tool_use、web_search_tool_result、message_delta(stop_reason+usage 含 cache_read_input_tokens)、message_stop
  - [x] 2.4 单测：SSE 样例帧解析（含多 content 块交错、tool_use input_json_delta 拼接）、错误映射、M3/M2.7 请求体快照断言

## T3 对话主链路（standard / deep / web）

- [ ] Task 3: minimax/chat.py + main.py 薄分发
  - [ ] 3.1 `stream_chat_events()`：对标 generate_direct_chat_events 的事件协议（node/reasoning_delta/token/web_docs/usage/done），记忆注入（L2/L3/L4，与现有直连链路对齐）、MCP system prompt 注入、Hook/TokenUsage 接线
  - [ ] 3.2 deep 模式：thinking 开关控制（先探针验证 Anthropic 兼容层 thinking 参数；不支持则依赖默认行为 + 展示层过滤）
  - [ ] 3.3 web 模式：tools 注入 `{"type":"web_search_20250305","name":"web_search"}`；web_search_tool_result → web_docs 事件（title/url/page_age/content），命中计数；搜索失败降级为普通对话 + error 提示不阻断
  - [ ] 3.4 main.py /chat 分发条件加 minimax（~L7489），MCP 预检轮事件透出对齐 direct_stream_with_mcp；附件门禁靠 supports_vision 自动生效（M3 放行）
  - [ ] 3.5 单测：事件序列快照（standard/deep/web 三模式）、web_docs 桥接、错误路径 logger.exception

## T4 Interleaved Thinking 工具循环

- [ ] Task 4: minimax/agent_loop.py —— 多轮 Tool Use 循环
  - [ ] 4.1 OpenAI function schema → Anthropic tools 格式转换器（name/description/input_schema），支持 mcp__ 前缀工具全集注入 + token 预算护栏（沿用 30000 字符预算）
  - [ ] 4.2 循环主体：响应含 tool_use → TOOL_REGISTRY 分发执行（异常转 is_error tool_result）→ tool_result 回传 → 继续；**每轮 assistant content（thinking+text+tool_use 块）完整入历史**；轮次上限护栏；thinking_delta 每轮透出
  - [ ] 4.3 server web_search 与本地 MCP 工具在同一次请求的 tools 中共存（server tool 无需本地回传）
  - [ ] 4.4 单测：mock 客户端两轮工具循环（历史完整性断言）、工具异常 is_error、轮次上限截断

## T5 MiniMax 原生调研引擎（research）

- [ ] Task 5: minimax/research.py + 前端引擎按钮
  - [ ] 5.1 梳理现有 research 模式 SSE 事件契约（node 阶段命名 / web_docs / done 报告结构，对齐 ResearchProgressPanel 与文档卡片）
  - [ ] 5.2 `stream_research_events()`：agent_loop + server web_search 多轮检索综合；产出兼容事件流与调研报告
  - [ ] 5.3 main.py research 分发：provider=minimax 时接入；research+auto 组合触发逻辑对齐 wants_web 语义
  - [ ] 5.4 前端 ResearchOptionsPopover：provider=minimax 显示「MiniMax 原生调研 / Firecrawl / 自研引擎」按钮（对齐千问三按钮模式），选择透传后端
  - [ ] 5.5 端到端验证：一次完整原生调研，进度面板逐阶段滚动 + 报告产出

## T6 自主规划链路（plan）

- [ ] Task 6: minimax/plan.py
  - [ ] 6.1 梳理现有 plan 模式事件契约（PlanChainTimeline / TaskExecutionPanel 消费的事件类型）
  - [ ] 6.2 `stream_plan_events()`：Interleaved Thinking agent loop 实现"计划→执行→观察→调整"，事件对齐现有前端
  - [ ] 6.3 main.py plan 分发：provider=minimax 走新链路（其余 provider 保持 LangGraph 不变）
  - [ ] 6.4 端到端验证：含工具调用与计划调整的任务一次，时间线正常

## T7 主动缓存与用量可视化

- [ ] Task 7: minimax/caching.py + 前端展示
  - [ ] 7.1 缓存断点策略：按能力位 `supports_active_cache` 决定是否注入 cache_control（system 尾块 + tools 尾项 ≤2 断点；M3 请求体禁止携带——单测断言）
  - [ ] 7.2 前缀构成与记忆注入顺序对齐：静态 system + 工具定义在前、滑窗历史居中、最新用户消息在尾
  - [ ] 7.3 usage 事件透出 cache_read_input_tokens / cached_tokens；前端用量区展示"缓存命中 X tokens"
  - [ ] 7.4 验证：M2.7 同会话第二轮 cache_read_input_tokens > 0；M3 被动缓存 cached_tokens 观测

## T8 OpenAI 兼容适配：LangGraph 深度链路 + Code 模式

- [ ] Task 8: minimax/openai_compat.py + main.py / App.py 分支
  - [ ] 8.1 适配器：create_kwargs 构造（base_url=OPENAI_COMPAT_BASE_URL、extra_body={"reasoning_split": True}）；`<think>` 剥离工具；reasoning_details 提取；断言不携带他协议 thinking 参数
  - [ ] 8.2 main.py LangGraph 链路（agent / distributed_plan）：minimax 分支接入适配器，正文无 think 污染
  - [ ] 8.3 App.py Code 链路：三处供应商分支点（~L392 uses_json_format、~L469 思考参数、~L5345 附件门禁）加 minimax 分支；三级兜底保留；json_object 实测后定能力位
  - [ ] 8.4 Code 沙箱以 MiniMax 跑一次全栈生成实测（SSE + 预览 + 自动修复冒烟）
  - [ ] 8.5 单测：适配器请求体快照、<think> 剥离、GLM/千问/DeepSeek 分支回归

## T9 图像生成接入

- [ ] Task 9: minimax/image.py + main.py 图片注册表
  - [ ] 9.1 `generate_image()`：POST /v1/image_generation（model=image-01，prompt/aspect_ratio/n/subject_reference，response_format=base64 → 解码）；错误映射与 Key 校验
  - [ ] 9.2 main.py 图片模型注册表（~L5330）加 image-01 能力条目（文生图+图生图参考标记）；/api/image/direct 视觉导演推荐规则加 image-01 档
  - [ ] 9.3 任务链路分发接入（智谱/千问旁新增 minimax 分支）；前端模型下拉自动出现（/api/image/models 单一数据源）
  - [ ] 9.4 验证：文生图 + 图生图（带参考图）各一次

## T10 视频生成接入（MiniMax-H3）

- [x] Task 10: minimax/video.py + video_engine.py 注册
  - [x] 10.1 `MiniMaxVideoProvider`：创建任务（content[] 多模态结构：text/image_url/video_url/audio_url + role first_frame/last_frame/reference_image/reference_video；duration/resolution/ratio 规则——t2v ratio 必填非 adaptive、i2v 恒 adaptive）；轮询 GET /v2/query/video_generation/{task_id}；终态取 task.content.url 下载
  - [x] 10.2 创建前本地校验：图 ≤9 / 视频 ≤3（单段 2-15s，总 ≤15s）/ 音频 ≤3 / 混合 ≤12 文件 / 单文件大小（视频 50MB、图 30MB、音频 15MB）/ prompt ≤7000 字符 → 422 明确提示
  - [x] 10.3 _VIDEO_CAPABILITIES 注册 MiniMax-H3（模式/分辨率/时长/参考素材能力），接入 VideoTaskMonitor 轮询与产物存储
  - [x] 10.4 前端视频工作区确认模型下拉自动出现（/api/video/models），参考生成 UI 素材限制提示
  - [x] 10.5 验证：文生视频、首尾帧图生视频、全能参考（图+视频）各一次，轮询与成片播放正常

## T11 PPT 接入

- [x] Task 11: ppt 链路 minimax 分支
  - [x] 11.1 梳理 ppt_agent_loop / ppt_service 的模型调用点与 model_provider 分发逻辑
  - [x] 11.2 model_provider 枚举加 "minimax"（ppt_api.py 请求模型 + 分发 + 前端 features/ppt/api.ts 类型与创建 UI 选项），模型调用走 openai_compat 适配
  - [x] 11.3 封面 AI 图：PPT 内图片生成可选 image-01（接入点按现有 generate_required_ai_images 结构）
  - [x] 11.4 验证：model_provider=minimax 走完整 agent loop 出片一次

## T12 写作接入

- [ ] Task 12: thesis 链路 provider 化
  - [ ] 12.1 main.py 写作端点（~L7461 固定 load("qwen")）改为显式 provider 参数（默认 qwen 不回归）；minimax 走适配调用（大纲/正文/参考资料）
  - [ ] 12.2 前端 writingModelRouter.ts 路由表加 minimax 选项，模型下拉同步
  - [ ] 12.3 验证：MiniMax 模型生成大纲 + 章节正文 + 引用校验流程各一次

## T13 前端设置与全局同步

- [ ] Task 13: SettingsDialog + ModelQuickSwitcher + 输入框同步
  - [ ] 13.1 SettingsDialog PRESETS 加 MiniMax（base_url/api_key/model 下拉来自 catalog），参数区按 thinking_control="minimax" 条件渲染（隐藏 GLM/千问控件）
  - [ ] 13.2 ModelQuickSwitcher：确认 minimax 分组经 catalog 接口自动渲染；思考控件按能力渲染；切换写入 profile（全局语义）
  - [ ] 13.3 正式聊天与 Code 沙箱输入框同步显示当前 MiniMax 模型（现有 modelControl 机制验证）
  - [ ] 13.4 缓存命中量展示（对接 T7.3 usage 字段）

## T14 回归与端到端验收

- [ ] Task 14: 全量回归 + 验收清单
  - [ ] 14.1 GLM/千问/DeepSeek 三供应商回归：standard/deep/web/research 事件流快照不变、Code 沙箱全栈生成正常
  - [ ] 14.2 按 spec 验收标准 1-12 逐项实测并记录
  - [ ] 14.3 checklist.md 全项勾选

# Task Dependencies

- T1 → 一切（配置先行）
- T2 → T3/T4/T7/T8/T9/T10/T11/T12（客户端/适配器地基）
- T3 → T5/T6（对话链路是调研/规划的事件协议基座）
- T4 → T5/T6（工具循环是调研/规划的执行基座）
- T8 依赖 T2；T9/T10/T11/T12 依赖 T2（各自独立可并行）
- T13 依赖 T1（catalog）+ T7（usage 字段）
- T14 最后收口
- 可并行组：{T3+T4 串行} ∥ {T9} ∥ {T10} ∥ {T8} ∥ {T11} ∥ {T12}
