# HOOK 项目自定义可视化计划书

## 1. 目标与范围

为现有 Agent 平台建立一套可管理、可追踪、可解释的 HOOK 能力。用户能够：

1. 查看已注册的 HOOK，了解其生命周期、作用范围、启停状态和最近执行结果。
2. 创建或编辑受支持的自定义 HOOK 配置，并进行启停、排序和测试。
3. 在 Agent 运行期间实时看到 HOOK 命中、修改、放行、阻断和异常。
4. 在运行结束后回看一次 Agent run 的完整 HOOK 时间线。

本计划只覆盖 HOOK 的管理与可视化基础设施，不在第一阶段重做 Agent 执行器、记忆系统或 MCP 管理器。

## 2. 当前架构依据

- 后端主入口：[main.py](../main.py)，承载普通聊天、调研、多智能体、计划执行和全局 API。
- 代码 Agent 路由：[App.py](../App.py)，承载代码生成、修复、全栈工具循环、VFS 和终端。
- HOOK 原型：[HOOK/agent_hook_engine.py](../HOOK/agent_hook_engine.py)，当前为独立注册中心和同步触发器，尚未接入主应用。
- 前端聊天壳：[frontend/ai-agent/src/components/ChatInterface.tsx](../frontend/ai-agent/src/components/ChatInterface.tsx)。
- 前端代码 Agent 状态中心：[frontend/ai-agent/src/hooks/useCodeAutoRepair.ts](../frontend/ai-agent/src/hooks/useCodeAutoRepair.ts)。
- 可复用的运行可视化：[frontend/ai-agent/src/components/NodeProgressPanel.tsx](../frontend/ai-agent/src/components/NodeProgressPanel.tsx)、[TaskExecutionPanel.tsx](../frontend/ai-agent/src/components/TaskExecutionPanel.tsx) 和 [CodeWorkspace.tsx](../frontend/ai-agent/src/components/CodeWorkspace.tsx)。

当前后端存在两套事件协议：普通聊天使用命名 SSE 事件，代码 Agent 使用 JSON `type` 事件。HOOK 事件必须先定义统一信封，再分别适配两条链路。

## 3. 信息架构决策

### 3.1 HOOK 管理中心：放在侧边栏一级入口

推荐入口：主应用侧边栏新增“HOOK”一级入口，点击后进入独立的 HOOK 工作区。

理由：

- HOOK 是跨聊天、调研、计划、代码 Agent 的运行能力，不属于单一模型设置。
- 管理、调试和查看执行记录属于高频运维动作，放在设置深层页面会降低可发现性。
- 侧边栏入口便于未来显示“启用数量、最近阻断、异常数”等状态徽标。
- 可以在不改变当前聊天主界面的前提下，拥有完整的列表、详情、编辑和测试布局。

设置页只保留全局策略：默认启用状态、敏感字段脱敏级别、事件保留时间、是否允许阻断、调试日志级别等。设置页不承载 HOOK 列表和运行时间线。

### 3.2 实时管理中心：当前运行上下文的右侧观察面板

推荐采用“两级观察”布局：

1. 当前运行时：在聊天工作区或 CodeWorkspace 右侧增加可折叠的“HOOK 观察”面板。面板默认折叠，仅在本轮出现 HOOK 事件时显示状态徽标；用户点击后展开。
2. 跨运行回看：在侧边栏 HOOK 工作区中提供“运行记录/时间线”页，可筛选 session、agent run、生命周期、结果和时间范围。

不建议把实时观察做成全局弹窗：弹窗会遮挡代码预览和对话上下文，也不适合展示连续事件。也不建议只放在设置页：用户无法在 Agent 执行时及时理解“为什么被修改或阻断”。

### 3.3 管理中心页面布局

```text
侧边栏：HOOK
  ├─ 概览 / 运行记录
  ├─ 已注册 HOOK
  └─ 全局策略（跳转设置中的 HOOK 区域）

HOOK 工作区
  ├─ 左栏：HOOK 列表、启停状态、生命周期筛选、异常徽标
  ├─ 中栏：HOOK 详情、执行顺序、作用范围、最近结果
  └─ 右栏：测试输入、预览变更、阻断结果、最近执行样例

当前 Agent 工作区右侧
  └─ HOOK 观察面板：实时事件时间线 + 当前状态 + 变更/阻断详情
```

## 4. 产品对象与事件契约

### 4.1 HOOK 配置对象

建议最小字段：

- `id`、`name`、`description`
- `lifecycle`: `on_session_start | before_llm_call | after_llm_call | before_tool_call | after_tool_call | on_error`
- `enabled`、`priority`
- `scope`: `global | chat | research | plan | code`
- `handler_type`: `builtin | declarative`
- `policy`: `allow | transform | block | observe`
- `created_at`、`updated_at`、`last_run_at`

第一版不允许通过 UI 直接上传和执行任意 Python。自定义逻辑先采用内置处理器和受限声明式规则，避免把管理页面变成远程代码执行入口；如未来需要脚本 HOOK，必须单独进行沙箱和权限设计。

### 4.2 统一 HOOK 事件信封

每个事件至少包含：

```json
{
  "type": "hook_event",
  "event": "started | completed | transformed | blocked | errored",
  "hook_id": "pii_masking",
  "hook_name": "PII 脱敏",
  "lifecycle": "before_llm_call",
  "session_id": "...",
  "agent_run_id": "...",
  "sequence": 12,
  "timestamp_ms": 0,
  "duration_ms": 4,
  "status": "running | passed | changed | blocked | failed",
  "summary": "检测到手机号并完成脱敏",
  "diff": {"prompt": {"changed": true}},
  "cancel_reason": null,
  "error": null
}
```

安全要求：默认只发送摘要和字段级 diff，不发送完整 prompt、完整工具参数或密钥；必要的原文必须经过统一脱敏器处理。事件序列必须 append-only，前端按 `agent_run_id + sequence` 去重和排序。

## 5. 分阶段实施路线

### 阶段 0：契约和边界

- 固化 HOOK 配置、生命周期、状态和事件信封。
- 把同步原型改造成可观测的注册中心，保留现有 PII 脱敏和命令防火墙示例。
- 定义统一的摘要、diff、脱敏和错误处理规则。

验收：后端单元测试可构造完整 HOOK 事件序列；阻断、异常和字段变更都有稳定结果。

### 阶段 1：HOOK 管理中心

- 后端提供 HOOK 列表、详情、启停、排序、测试接口。
- 前端侧边栏增加 HOOK 一级入口和独立工作区。
- 完成列表、详情、声明式编辑和测试预览。

验收：用户可以创建一个声明式脱敏/阻断规则，启用后在测试面板看到结果，并可停用恢复。

### 阶段 2：实时观察中心

- 把 HOOK 事件接入代码 Agent 和普通聊天的流式链路。
- 前端增加通用 HOOK 事件消费器和当前运行状态。
- 在聊天和 CodeWorkspace 的右侧显示可折叠观察面板。
- 在 HOOK 工作区增加运行记录、筛选和单次时间线回放。

验收：一次 Agent run 中可以实时看到 HOOK 开始、完成、修改、阻断和异常，刷新后可回看已保存的运行摘要。

### 阶段 3：可靠性和体验

- 增加断线重连、事件去重、长运行裁剪和历史保留策略。
- 增加权限边界、敏感数据审计和不可执行配置校验。
- 统一暗色模式、键盘操作、空状态、错误状态和可访问性。

验收：事件流异常不会阻塞 Agent 主流程；前端不会因单个坏事件崩溃；敏感输入不出现在日志和默认 UI 中。

## 6. 依赖关系

```text
事件/配置契约
      ↓
HOOK Registry 与执行观测
      ↓
后端 API + SSE 适配
      ↓
前端 Hook 状态层
      ↓
管理中心 UI ─────┐
                 ├─ 当前运行右侧观察面板
运行历史 API ────┘
```

必须先完成契约和后端事件，再并行开发管理中心与实时观察 UI；不能先做依赖具体字段的前端页面。

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 任意 Python HOOK 带来代码执行风险 | 高 | v1 只允许内置/声明式处理器，脚本能力另立安全设计 |
| 两套 SSE 协议导致前端重复实现 | 中 | 统一事件信封，前端只维护一个 Hook 事件模型 |
| HOOK 事件包含 prompt、密钥或工具参数 | 高 | 默认摘要化、字段级 diff 和统一脱敏；禁止原文落盘 |
| HOOK 阻断影响 Agent 主流程 | 高 | Hook 异常默认 fail-open；只有显式 `policy=block` 才允许阻断，并记录原因 |
| 高频事件造成前端渲染抖动 | 中 | 批量刷新、序列号去重、单次运行事件上限和折叠详情 |
| 当前工作区已有大量未提交修改 | 中 | 只新增专题文件；实现阶段按小任务提交并逐步验证 |

## 8. 成功标准

- 侧边栏可以进入 HOOK 管理中心，设置页只保存全局策略。
- 管理中心支持查看、启停、排序和测试至少两类内置/声明式 HOOK。
- 当前聊天和 CodeWorkspace 都能显示实时 HOOK 事件。
- 一次运行的 HOOK 时间线支持按状态、生命周期和时间排序回放。
- Hook 异常、阻断和敏感字段均有明确的安全表现和测试覆盖。
- 不新增任意脚本执行面，不破坏现有 Agent 主流程。

## 9. 已确认的产品边界

以下决策已确认，后续实现按此执行：

1. **部署与用户模型**：第一版只面向本地单用户，不做多用户权限、团队共享和远程租户隔离。
2. **HOOK 类型**：第一版只提供内置 HOOK，不开放通过 UI 上传或执行任意 Python/JavaScript；后续如需脚本 HOOK，另立安全设计。
3. **运行历史**：采用默认保留策略，只保存运行摘要和最近 100 次 run；不默认保存完整 prompt、完整工具参数或敏感原文。
4. **实时观察**：面板默认折叠，通过事件徽标提示；用户主动展开后查看详细时间线。
## 10. 管理中心增强交互边界

为让自定义 HOOK 更好用同时不引入代码执行风险，交互分为可实现和可审核两类：

- 原始文件编辑：展示内置 HOOK 的源码和路径，支持编辑并保存为 `source draft`；单用户 v1 不热加载、不执行草稿。
- AI 创建：自然语言生成受限声明式草稿，用户确认后再保存，不直接生成或执行 Python/JavaScript handler。
- 上传解析：支持 `.py`、`.md`、`.json` 的文本上传和元数据解析，展示警告并默认标记为不可执行草稿。
- Settings HOOK 模块：提供总开关、阻断策略、事件保留说明和跳转管理中心入口；列表、源码和运行时间线仍在独立工作区。

所有新增交互均采用“草稿 → 预览 → 用户确认”的提交边界，避免把上传内容或模型输出当成可执行插件。
