# Tasks

- [x] Task 1: 设计 Agent Loop 状态机与 Prompt 模板
  - [x] 定义 AgentState（iteration, history, observations, final_answer）
  - [x] 设计 ReAct 格式：`<think>...</think>\n<action>...</action>` 或 function-calling schema
  - [x] 确定工具列表与输入 schema（web_search, fetch, chunk, rerank, final_answer）
  - [x] 编写 system prompt，要求 LLM 每轮必须输出 thought + 一个 action

- [x] Task 2: 实现 Agent Loop 后端核心
  - [x] 在 `main.py` 新增 `run_agent_loop_research(query, context, emit_event)` 函数
  - [x] 实现循环：调用 LLM → 解析 thought/action → 执行工具 → 组装 observation → 下一轮
  - [x] 接入终止条件（final_answer / max iterations / timeout）
  - [x] 集成到现有 `/deep_research` 或 `/chat` 路由，默认启用 Agent Loop

- [x] Task 3: 工具封装
  - [x] 将现有 `web_search_node` / `fetch` / `chunk` / `rerank` 逻辑封装为独立工具函数
  - [x] 统一工具输入输出接口（ToolInput / ToolOutput）
  - [x] 确保工具可被 Agent Loop 同步/异步调用

- [x] Task 4: 实现迭代式 SSE 事件协议
  - [x] 定义事件 stage 命名规则：`iteration_N_think/search/observe/final`
  - [x] 在循环关键节点 emit `running` / `completed` 事件
  - [x] 将 thought、tool_input、observation_summary 写入 extras
  - [x] 保留 hit_count / kept_count 等原有统计字段

- [x] Task 5: 重构前端进度面板支持 Agent Loop
  - [x] 修改 `NodeProgressPanel.tsx` 按 iteration 分组渲染时间轴
  - [x] 每轮显示 Think / Search / Observe 子节点
  - [x] 支持展开 Think 查看完整 reasoning
  - [x] 移除对同阶段重复节点的合并去重逻辑（循环中重复是正常行为）

- [x] Task 6: 更新前端事件处理
  - [x] 修改 `api.ts` 解析 `iteration_N_*` stage
  - [x] 修改 `ChatInterface.tsx` 的 `handleNodeEvent`，按迭代累积节点
  - [x] 同步到 `perRoundNodeEventsRef` 和最后一条消息的 `nodeProgress`

- [x] Task 7: 动态进度持久化
  - [x] 确保 `ChatMessage.nodeProgress` 保存完整迭代节点
  - [x] 会话快照加载时恢复迭代进度
  - [x] 历史消息展开后仍能看到每轮 thought

- [x] Task 8: 添加护栏与降级
  - [x] 配置 `MAX_RESEARCH_ITERATIONS`（默认 5）
  - [x] 单工具调用超时 30s，总调研超时 600s
  - [x] Agent Loop 失败时降级到原有 Firecrawl 路径或固定 Pipeline
  - [x] 记录异常日志

- [ ] Task 9: 端到端验证
  - [ ] 用样例问题触发 Agent Loop，观察时间轴是否正确展示多轮迭代
  - [ ] 验证刷新后进度不丢失
  - [ ] 验证达到最大迭代次数后自动终止
  - [ ] 验证降级路径可用

# Task Dependencies

- Task 2 依赖 Task 1
- Task 3 依赖 Task 2（工具接口需在循环中调用）
- Task 4 与 Task 2/3 并行设计，但在 Task 2 编码时落地
- Task 5 依赖 Task 4（需要知道事件格式）
- Task 6 依赖 Task 4 和 Task 5
- Task 7 依赖 Task 6
- Task 8 与 Task 2/3 并行
- Task 9 依赖 Task 5/6/7/8
