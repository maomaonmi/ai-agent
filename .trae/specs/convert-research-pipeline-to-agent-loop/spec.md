# 将深度调研改造为 Agent Loop 模式

## Why

当前深度调研是固定 Pipeline（规划 → 搜索 → 切片 → 重排 → 思考 → 输出），阶段一次性执行，无法表达大模型 Agent 的循环决策能力。需要将调研推理层改造为 **ReAct / Agent Loop**：LLM 每轮自主决定是继续调用工具（搜索/抓取/浏览）还是终止并给出最终答案。搜索 → 切片 → 重排这套基础设施作为 Agent 可调用的工具保留不变。

## What Changes

- 新增基于自研链路的 **Agent Loop 推理核心**，取代默认固定 Pipeline。
- 工具化：WebSearch、Fetch、Chunker、Reranker 封装为可被 Agent 调用的工具。
- Firecrawl 黑盒路径保留为可选降级/外部完整研究方案，不再作为默认路径。
- 新事件协议：按 **迭代轮次** 组织 NodeEvent（`Iteration-N Think / Search / Observe / Final`）。
- 前端进度面板从固定阶段时间轴改为支持循环迭代的可折叠时间轴。
- 动态迭代进度持久化到 `ChatMessage.nodeProgress`，刷新/重启不丢失。
- 顺带消除旧 bug：重复的 `研究任务执行中…` 转圈、`思考内容` 实为 Firecrawl 活动日志的问题。

## Impact

- 后端：`main.py` 新增 Agent Loop 核心、工具注册与事件发射逻辑。
- 前端：`NodeProgressPanel.tsx`、`ChatInterface.tsx`、`api.ts` 调整事件解析与展示。
- 配置：可能新增默认走 Agent Loop 还是 Firecrawl 的开关。

## ADDED Requirements

### Requirement: Agent Loop 核心

The system SHALL provide an Agent Loop for deep research that iterates through **Think → Action → Observe → Decide** until the LLM chooses to output a final answer or a guard limit is hit.

#### Scenario: 成功完成一次深度调研

- **WHEN** 用户发送一个需要调研的问题
- **THEN** 后端启动 Agent Loop，最多运行 `MAX_RESEARCH_ITERATIONS` 轮
- **AND** 每轮开始 LLM 先输出 `thought`
- **AND** LLM 决定调用工具（`web_search` / `fetch` / `chunk` / `rerank`）或输出 `final_answer`
- **AND** 工具返回结果作为下一轮 `observation`
- **AND** 当 LLM 输出 `final_answer` 或达到最大轮次时，循环终止并返回答案

### Requirement: 工具调用

The Agent SHALL be able to invoke the existing search infrastructure as tools.

- `web_search`: 执行关键词搜索，返回结果列表。
- `fetch`: 抓取指定 URL 内容。
- `chunk`: 对抓取内容进行切片。
- `rerank`: 对切片结果进行重排并返回精选片段。

> 这些工具的内部实现保持现有搜索 → 切片 → 重排逻辑不变。

### Requirement: 迭代式事件协议

Backend SHALL emit `research_process` events organized by iteration.

- `stage` 字段格式：`iteration_N_think`、`iteration_N_search`、`iteration_N_observe`、`iteration_N_final`
- `status`: `running` / `completed`
- `message`: 人类可读描述
- `extras` 可包含：
  - `iteration`: 轮次编号
  - `tool_name`: 当前调用的工具名
  - `tool_input`: 工具输入摘要
  - `observation_summary`: 工具返回摘要
  - `thought_snippet`: 当前轮 thought 摘要

### Requirement: 进度面板支持循环展示

Frontend SHALL render Agent Loop progress as a vertical timeline grouped by iteration.

- 同一轮次的 Think / Search / Observe 视觉上归为一组。
- `Final Answer` 节点在最后一轮显示。
- 支持展开每轮 thought 查看完整推理内容。
- 不再对同阶段重复节点做合并去重（循环中重复是正常行为）。

### Requirement: 动态进度持久化

Dynamic iteration progress SHALL be saved to `ChatMessage.nodeProgress` and survive page refresh or backend restart.

### Requirement: 护栏与降级

The Agent Loop SHALL have guardrails.

- 最大迭代次数：`MAX_RESEARCH_ITERATIONS`（默认 5）。
- 单轮工具调用超时：30s。
- 总调研超时：600s。
- 当 Agent Loop 失败或配置关闭时，允许降级到原有 Firecrawl 路径或固定 Pipeline。

## MODIFIED Requirements

### Requirement: 搜索 → 切片 → 重排 Pipeline

搜索 → 切片 → 重排这套方案保留不变，但不再作为顶层固定阶段顺序执行，而是作为 Agent 可调用的工具组合。Agent 可以只调用搜索、也可以搜索+抓取+切片+重排，也可以多轮反复调用。

## REMOVED Requirements

### Requirement: 默认固定阶段 Pipeline

**Reason**: 被 Agent Loop 取代。
**Migration**: Firecrawl 完整研究路径保留为配置项或失败降级方案，不再默认启用。

### Requirement: Firecrawl activities 作为 reasoning_full

**Reason**: 活动日志不是模型思考，不应显示为"思考脉络"。
**Migration**: 新架构下 `reasoning_full` 仅来自 LLM 的 `thought`；Firecrawl 路径若启用，仅展示外部研究完成状态，不再把 activities 包装成可展开思考。
