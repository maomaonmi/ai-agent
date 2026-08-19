# AI 可视化工作流真实执行与多模态节点计划

## Overview

将当前“可编辑、可校验、可编译”的无限画布升级为可提交真实模型任务的多模态 DAG。工作流仍以不可变 revision 为执行快照，节点之间通过强类型端口传递提示词、图片、视频、音频 URL 与多模态参考素材；后台负责拓扑执行、节点状态持久化、模型异步任务轮询和 SSE/轮询恢复，前端提供模型/工具箱式节点目录与运行检查面板。

## Architecture decisions

- **复用现有视频任务引擎**：千问与智谱的异步提交、状态轮询、OSS/FFmpeg 资产链路继续由 `video_engine.py`、`video_monitor.py` 和 `video_reference.py` 负责；工作流执行器只负责把端口产物标准化为 `VideoGenerationRequest`。
- **端口增加 `media.asset` 联合类型**：图片和视频都可以流入“参考视频生成”节点；严格兼容矩阵由服务端校验，不能把任意字符串绕过为媒体。
- **工作流执行使用独立 runner**：运行时通过依赖注入接收模型适配器，测试使用 fake provider，不在测试中调用真实供应商，也不把 API Key 暴露到前端。
- **执行结果持久化到现有 visual_workflow_* 表**：run、node run、artifact、event 是可恢复的事实来源；前端断线后从 run 查询恢复，SSE 只做低延迟推送。
- **模型/工具目录由服务端定义**：前端不硬编码供应商限制；节点卡片、端口和可用参数从 node definitions 与 model catalog 渲染。

## Task list

### Phase 1: Multimodal contract

- [ ] 增加 `media.asset` 端口类型和图片/视频到 media 的兼容矩阵。
- [ ] 扩展图片生成多参考图、文生视频可选媒体参考、参考视频生成 image/video 混合参考端口。
- [ ] 为节点定义增加模型配置 schema、输入节点 URL/资产配置 schema 和工具节点定义。

### Phase 2: Real execution foundation

- [ ] 为 visual workflow repository 增加 node run、artifact、event 的读写方法。
- [ ] 实现注入式 `VisualWorkflowExecutor`：输入节点、提示词模板、图片生成/编辑、四类视频节点、预览/画廊节点。
- [ ] 将视频节点适配到现有 Qwen/Zhipu provider 与异步任务 monitor；图片节点复用现有图片模型配置并安全校验供应商 URL。
- [ ] 开放 `mode=execute`，后台执行拓扑批次；增加 run/node 状态查询与 SSE 事件流，取消可中止后续节点。

### Checkpoint: Runtime

- [ ] fake providers 覆盖 fan-out、fan-in、多张参考图、首帧、首尾帧、图片+视频参考。
- [ ] 无 API Key 时返回结构化 `PROVIDER_NOT_CONFIGURED`，不产生半成品成功结果。
- [ ] 一个真实的“提示词 → 图片 → 首帧图生视频 → 预览”流程可以提交并恢复状态。

### Phase 3: Toolbox workspace

- [ ] 画布左侧改为图标工具栏 + 可折叠目录，提供搜索、模型、编辑工具、输入/输出分类。
- [ ] 节点卡片显示模型、媒体数量、异步状态和错误；Inspector 提供 URL/提示词/模型/参数表单，不要求用户手写 JSON。
- [ ] 运行按钮提交 execute，运行面板展示节点进度、失败节点、重试/取消和最终媒体预览。

### Phase 4: Hardening and verification

- [ ] 文件/URL 输入限制大小、MIME、公开 URL 与 SSRF；所有供应商响应先校验再落库。
- [ ] 前端 TypeScript、目标 ESLint、后端 visual workflow/video 测试和路由运行检查通过。
- [ ] 更新工作流文档、模型能力矩阵和迁移说明。

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| 不同供应商媒体字段不同 | 高 | 统一端口 artifact，再由 provider adapter 生成官方 payload；保留原始响应用于诊断 |
| 视频任务耗时数分钟 | 高 | 后台 runner + 持久化 node run + SSE/轮询恢复，SSE 断开不影响执行 |
| 多参考图/视频体积过大 | 高 | 图片/视频统一走资产服务或公开 URL；限制数量、大小、MIME 和 TTL |
| 真实 API Key 缺失或限流 | 中 | 结构化错误码、单节点失败隔离、无密钥时不提交上游 |
| 前端模型限制与后端漂移 | 中 | node definitions/model catalog 服务端单一事实来源，契约测试锁定 |

## Open questions

- 真实执行默认允许哪些模型（建议先允许已配置 Key 且能力矩阵中 `enabled=true` 的模型）。
- 图片工作流输出是否统一转存到 OSS，还是先保留供应商临时 URL 并在预览/下游视频前转存。
