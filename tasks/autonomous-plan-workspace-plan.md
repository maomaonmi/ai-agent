# Implementation Plan: Autonomous Plan Workspace Refactor

## Overview

将 `plan` / `distributed_plan` 模式改造成独立的左右分栏工作区：左侧保留对话与执行链路，右侧按 Task 数量展示独立任务产出，并提供结构化最终报告。最终报告必须支持 Markdown、表格、图表和图片；每轮 Task 状态与产出绑定到 assistant 消息并持久化到会话快照。与此同时增强 Planner/Re-Planner 对 GLM 非严格 JSON 的容错，避免一次解析失败直接降级到安全回退计划。

## Architecture Decisions

- Plan 工作区独立于 ResearchWorkspace，复用底层 Markdown 渲染约定但不复用右侧容器和交互状态。
- Task 事件沿用现有 `plan_update` SSE 契约，新增 `planProgress` 的稳定快照字段，不改变自主任务主链路。
- 计划解析采用“严格 JSON → fenced JSON → 平衡对象扫描 → 常见 GLM JSON 修复 → 安全回退”的分层策略；修复器只返回数据，不执行模型输出。
- 任务产出报告沿用 Markdown 作为源格式，前端本地解析表格和数字证据生成图表；图片由最终报告完成后异步触发独立任务，不阻塞计划执行。
- 持久化以 assistant 消息的 `planProgress` 与报告正文为主，顶层快照字段只承担旧会话恢复兼容。

## Task List

### Phase 1: Planner Reliability

- [x] 修复 `extract_json_object`，覆盖 GLM 常见 fenced JSON、尾逗号、内嵌引号和响应前后解释文本。
- [x] Planner/Re-Planner 共享解析函数，并确保解析失败时保留已完成任务与已有结果。
- [x] 增加计划解析与任务状态持久化回归测试。

### Phase 2: Independent Workspace

- [x] 新增独立 `PlanWorkspace`、任务产出列表和最终报告文档组件。
- [x] 接入 `plan` / `distributed_plan` 的右侧固定宽度、移动端全屏、任务/报告切换、复制/下载/全屏操作。
- [x] 任务产出按任务数量渲染，每个任务拥有状态、负责人、Markdown 结果和放大查看。

### Phase 3: Structured Report

- [x] 解析最终报告中的标题、摘要、Markdown 表格和数字证据。
- [x] 渲染自适应图表、表格和异步生成图片，并提供明确的 loading/error/empty 状态。
- [x] 将最终报告与 Task 产出纳入会话恢复，避免切换会话或刷新后丢失。

### Checkpoint: Complete

- [x] GLM 非严格 JSON 不再因首个解析错误直接丢失有效任务。
- [x] 历史计划会话可在右侧恢复所有 Task 产出和最终报告。
- [x] TypeScript、Python 契约测试通过；构建失败来自既有 lint 问题，已单独记录。

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| GLM 输出包含未转义引号或解释文本 | 高 | 分层 JSON 提取与有限修复；无法确定时回退，不执行任意代码 |
| 长 Task 产出导致右侧首屏过重 | 中 | 任务卡片折叠、报告内容懒渲染、图表按需解析 |
| 执行中切换会话造成快照覆盖 | 高 | 每次 plan_update 都更新消息级快照，保存前使用 messagesRef 和 sessionId 校验 |
| 图表/图片生成失败影响报告 | 中 | 图片异步、图表仅基于显式数值证据，失败只显示局部错误 |
