# 全模式打字机体验统一计划书

## 1. 背景与目标

现状：仅 AI 写作工作台具备可感知的打字机效果（真流式 + 32ms 匀速 pacing 队列，见
[WritingWorkspace.tsx#L533-574](file:///d:/AI-Agent学习计划/AI-Agent%20study/frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx#L533-L574)）。
其余模式要么整块弹出（DeepSeek 对话、调研报告、plan/agent 结论），要么真流式但 burst 太快无感（GLM/千问对话）。

目标：
1. 前端引入共享 pacing 层，所有模式答案渲染统一匀速打字机观感；
2. `sendDeepResearch` 补 token 分支，千问原生调研报告变真流式；
3. DeepSeek `chat_node` 流式化，standard/deep/web 三模式答案 + 推理过程真流式。

**不动**：code 模式（流程组件复杂，本次不碰）；AI 写作自带 pacing（不重复接入）。

## 2. 现状矩阵（排查结论）

| 模式 | 后端流式 | 前端 pacing | 现状体验 |
|---|---|---|---|
| 对话 standard/deep/web（GLM/千问） | ✅ token/reasoning_delta | ❌ | burst 几跳完成，太快 |
| 对话 standard/deep/web（DeepSeek） | ❌ 同步 create | ❌ | 整块弹出 |
| 调研（千问原生） | ✅ token 已推但前端丢弃 | ❌ | 报告整块 |
| 调研（Firecrawl/自研/AgentLoop） | ❌ | ❌ | 阶段进度逐条，报告整块 |
| plan / distributed_plan | ❌ 节点级 | ❌ | 任务面板逐条，报告整块 |
| agent | ❌ 节点级 | ❌ | 讨论逐条，结论整块 |
| AI 写作 | ✅ | ✅ 32ms 队列 | 真打字机（标杆） |

## 3. 总体设计

### 3.1 前端 pacing 层（共享 hook）

新增 `frontend/ai-agent/src/lib/useTypewriterPacing.ts`：

- 核心：文本队列 + 32ms setInterval 消费，每 tick 出 1~N 字符（N 自适应：队列积压超阈值时加速，防尾部延迟）；
- API：`push(text)`（流式 token 到达即入队）、`commit(fullText)`（整块源一次性入队切片）、`flush()`（立即全量上屏）、`drained` 状态；
- 交互兜底：消息区点击 / "立即显示" 按钮触发 `flush()`；新一轮发送前强制 flush 上一轮残留；
- 渲染落点：ChatInterface 的 assistant 消息 content 改由 pacing 输出驱动（保留现有 per-round refs 快照机制不变，pacing 只接管"上屏节奏"）。

接入点（ChatInterface.tsx）：
- `onToken`（对话流式）→ `push`；
- `onDone`（streamedAnswer 为空时）→ `commit`；
- `onAgentFinalAnswer`、plan `onDone` → `commit`；
- `onReasoningDelta` 同理接入独立 pacing 实例（推理过程匀速）。

接入点（sendDeepResearch 消费侧）：
- 新增 `onToken` handler 分支：`parsed.token !== undefined` → `handlers.onToken`（千问原生调研后端已推 token，纯前端补消费）；
- `onResearchReasonDone` 的 report → `commit`（非千问引擎整块源走伪打字机）。

### 3.2 后端 DeepSeek 流式化

根因：`chat_node` 同步节点 + 同步 `create()`；外层 `_generate_chat_events_impl` 同步 `.stream()` 阻塞事件循环，无并发泵 token 的时机。

方案（队列泵模式，复用 Agent Loop research 先例 main.py L1420-1436）：

1. **chat_node 改 async**：`async def chat_node(state)`，换 `AsyncOpenAI` 客户端，`stream=True`；
   - 逐 chunk：content → 推 `token` 事件；reasoning_content → 推 `reasoning_delta` 事件；
   - 推送通道：contextvar `chat_event_sink`（仿 `activate_tracker` 先例），外层进入前置入 asyncio.Queue；
   - usage：`stream_options={"include_usage": True}` 末 chunk 取（DeepSeek 兼容协议支持）；
   - 节点返回值结构不变（messages/final_answer/reasoning/token_usage/progress_events），保证 state 契约不破坏。
2. **外层改队列泵**：`_generate_chat_events_impl` 中 LangGraph 执行改为
   `asyncio.create_task(_pump_graph(inputs, queue))` + 主循环 `await queue.get()` 逐条 yield；
   - `_pump_graph` 内部用 `app.astream(inputs)`，节点级事件（progress_events/web_docs/final/usage）转发入队，结束放哨兵；
   - web_search/web_analyst 保持同步节点不动（LangGraph 自动线程池执行）；
   - 120s 超时逻辑移入泵循环侧。
3. **GLM/千问直连路径不动**（已流式）。

### 3.3 SSE 契约变更

- 无新增事件类型：DeepSeek 路径复用既有 `token` / `reasoning_delta` 事件，前端解析层已支持；
- 仅千问调研前端新增 `onToken` 消费分支（后端事件已存在）。
- 兼容性：前端旧版本遇到 token 事件已有处理逻辑，无破坏性变更。

## 4. 任务拆分

- T1 前端 pacing hook 实现（含自适应加速、flush、点击跳过）+ 单测思路（队列匀速、积压加速、flush 全量）；
- T2 ChatInterface 对话/agent/plan 三入口接入 pacing；
- T3 sendDeepResearch 补 onToken 分支 + 调研报告接入 pacing；
- T4 后端 chat_node async 流式化 + contextvar sink；
- T5 后端外层队列泵重构 + 超时迁移；
- T6 联调验证：DeepSeek standard/deep/web 逐字、千问调研逐字、GLM/千问对话匀速、plan/agent 伪打字机、code 模式回归无影响。

## 5. 风险与回滚

- R1 LangGraph astream + 同步节点混跑：web_search/web_analyst 同步节点在 astream 下走线程池，需验证 progress_events 转发不丢（T6 重点）；回滚=chat_node 恢复同步 + 外层恢复 .stream()，git 单提交可逆；
- R2 pacing 队列尾部延迟：自适应加速 + flush 兜底；
- R3 DeepSeek stream usage 字段差异：末 chunk 无 usage 时回退 `_response_token_usage` 空快照，token 计数不阻塞主链路；
- R4 会话持久化：pacing 只影响上屏节奏，messages 快照仍以最终全文落盘（onDone/finally 时 flush 后快照），刷新恢复不受影响。

## 6. 验收标准

1. DeepSeek standard 模式答案逐字出现，持续时长与答案长度正相关（≥3s 可见过程）；
2. 千问原生调研报告逐字出现；
3. GLM/千问对话不再"几跳完成"，匀速可感；
4. plan/agent/Firecrawl 调研报告伪打字机匀速展开；
5. 点击消息区可立即全量上屏；
6. code 模式行为零变化。
