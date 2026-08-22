# Checklist

## 配置层
- [x] MODEL_CATALOG 含 minimax 分组（5 个文本模型，M3 supports_vision=True），catalog 接口返回该分组（冒烟验证 variants=5）
- [x] provider 枚举含 "minimax"，api_format 含 "anthropic_messages"，默认 profile 可加载并持久化
- [x] 前端 ModelSettings 类型联合含 "minimax"（api.ts L850/L883）
- [x] GLM / 千问 / DeepSeek 目录与能力矩阵回归无变化（全量单测 599 passed）

## 客户端（minimax/client.py）
- [x] httpx 直调 Anthropic Messages：非流式 + 流式 SSE 均可用，无 anthropic SDK 依赖（test_minimax_client.py）
- [x] SSE 解析覆盖 thinking_delta / text_delta / tool_use / server_tool_use / web_search_tool_result / usage（含 cache_read_input_tokens）
- [x] 401/403/429/4xx 映射为中文可读错误；异常路径 logger.exception 记录 traceback
- [x] 流式读取显式 UTF-8 解码（Windows 兼容）

## 对话主链路（standard / deep / web）
- [x] provider=minimax 且 mode ∈ {standard, deep, web} 走 minimax 包；SSE 事件序列与 GLM/千问直连链路同构（前端零适配）（test_minimax_chat.py）
- [x] deep 模式思考流（reasoning_delta）正常透出
- [ ] web 模式服务端 web_search 生效：web_docs 事件含 title/url，前端显示"阅读了 X 个网页"；搜索失败降级不阻断（待真实 Key 实测）
- [x] 记忆注入（L2/L3/L4）与 Hook/TokenUsage 接线对齐现有直连链路
- [x] M3 带附件对话放行；M2.x 系列带附件返回 422 明确提示
- [x] main.py 中 minimax 分支为薄分发（无业务逻辑），mcp 预检轮事件透出正常

## Interleaved Thinking 工具循环
- [x] MCP 工具 schema 转 Anthropic input_schema 注入，mcp__ 前缀保留，token 预算护栏生效（test_minimax_agent_loop.py）
- [x] 多轮 tool_use 循环：每轮 assistant content（thinking+text+tool_use）完整回传历史（单测断言消息历史结构）
- [x] 工具执行异常转 is_error tool_result，循环继续
- [x] 轮次上限护栏生效
- [ ] server web_search 与本地 MCP 工具同请求共存（待真实 Key 实测）

## 调研引擎（research）
- [x] 「MiniMax 原生调研」引擎按钮出现（provider=minimax），Firecrawl / 自研引擎保留可选（ChatInterface L3060）
- [x] 原生调研多轮检索 → 进度面板逐阶段滚动 → 报告产出，事件兼容 ResearchProgressPanel / 文档卡片（test_minimax_research.py）
- [x] research + web_search=auto 组合触发逻辑对齐 wants_web 语义

## 自主规划（plan）
- [x] provider=minimax 的 plan 模式走 OpenAI 兼容 plan_llm_invoke 链路（base_url 换 /v1 + think 剥离），其余 provider 保持 LangGraph 原链路（test_plan_execute.py）
- [ ] 计划 → 工具执行 → 观察 → 调整闭环，前端 PlanChainTimeline / TaskExecutionPanel 正常渲染（待真实 Key 实测）

## 缓存与用量
- [x] M2.7/M2.5 请求注入 cache_control 断点（system/tools），消息前缀构成 = 静态 system+工具 → 滑窗历史 → 最新消息（caching.py 单测）
- [x] M3 请求体不含 cache_control（单测断言），被动缓存照常
- [ ] M2.7 同会话第二轮 cache_read_input_tokens > 0（实测）
- [ ] 前端展示缓存命中 token 数（T7 待做）

## OpenAI 兼容适配（LangGraph + Code）
- [ ] agent / distributed_plan 以 MiniMax 完成多智能体讨论，正文无 `<think>` 污染（待真实 Key 实测）
- [x] 适配器 create_kwargs 仅含 reasoning_split，不含 thinking/enable_thinking/reasoning_effort 他协议参数（单测断言）
- [x] App.py 三处分支点（json 格式 / 思考参数 / 附件门禁）走能力矩阵；三级兜底保留
- [ ] Code 沙箱 MiniMax 全栈生成：SSE 流式 + 预览 + `<think>` 剥离正常；json_object 实测结论落能力位（待真实 Key 实测）

## 图像生成
- [ ] image-01 文生图与图生图（subject_reference 参考图）各实测一次，进画廊（T9 待做）
- [ ] 图片模型下拉出现 image-01（/api/image/models 数据源），视觉导演推荐规则含 image-01 档（T9 待做）

## 视频生成
- [ ] MiniMax-H3 注册：文生视频 / 首尾帧 / 全能参考三模式实测各一次，轮询进度 + 成片播放正常（T10 待做）
- [ ] 素材限制本地校验（数量/大小/时长/字符）越界返回 422 明确提示，不发起 API 调用（T10 待做）
- [ ] 失败 / 取消终态错误透出（T10 待做）

## PPT 与写作
- [ ] model_provider=minimax 走完整 PPT agent loop 出片，阶段 SSE 与现有前端一致（T11 待做）
- [ ] 写作链路：MiniMax 生成大纲 + 章节正文 + 引用校验正常；默认 provider 仍为千问（不回归）（T12 待做）

## 前端设置与同步
- [x] SettingsDialog 可保存 MiniMax 预设（服务商网格含 minimax 按钮，Key 持久化走既有 saveModelSettings，GET 脱敏回传 has_api_key）
- [x] ModelQuickSwitcher 出现 MiniMax 分组（catalog 驱动 + 兜底目录），全局切换语义不变
- [x] 正式聊天与 Code 沙箱输入框同步显示当前 MiniMax 模型（model-settings-changed 事件驱动，QuickSwitcher 复用）
- [x] 思考控件按 thinking_control="minimax" 条件渲染（QuickSwitcher 思考预算三档 + SettingsDialog 高级配置 budget_tokens）
- [x] 前端 tsc --noEmit 零错误

## 回归红线
- [x] GLM / 千问 / DeepSeek：standard/deep/web/research 事件流快照不变（路由分支零改动，diff 仅新增 minimax 分支）
- [ ] 三既有供应商 Code 沙箱全栈生成回归正常（存量失败 2 例为文案漂移，与本次无关；待真实环境复验）
- [x] 全部新增单测通过（test_minimax_client/chat/agent_loop/research + test_plan_execute 均 pass）
- [ ] spec.md 验收标准 1-12 逐项通过（含真实 Key 实测项，待 T7/T9-T12 完成后统一验收）

## 回归记录（2026-08-21）
- 全量 pytest：599 passed / 10 failed。10 个失败均为存量问题，git diff 证实与 MiniMax 改动无关：
  - test_hook_api ×4：模块级 asyncio.Event 跨事件循环（Windows pytest 既有问题，hook_api.py 零改动）
  - test_runtime_settings ×3：route_mode 返回 3 元组 vs 旧测试断言 2 元组（main.py diff 无 route_mode 改动，HEAD 即如此）
  - test_code_sandbox ×2：全栈补丁提示词/拒绝文案漂移（App.py diff 仅含思考提取与 base_url 切换，未触及补丁文案）
  - test_writing_layout_scroll_contract ×1：前端 WritingLayout 字符串契约漂移（文件未被本次改动）
- 后端导入冒烟：main + minimax 7 模块 + MODEL_CATALOG(minimax=5) 全部 OK
- 前端：tsc --noEmit 零错误
