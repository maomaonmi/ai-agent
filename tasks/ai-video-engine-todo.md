# AI 视频异步任务引擎实施任务清单

> 前置门禁：先评审 `tasks/ai-video-engine-plan.md`，确认开放问题后再进入实现。

## Task 1：冻结能力矩阵与统一契约

**说明：** 依据千问 AI 平台和智谱官方文档，定义模型能力、请求/响应、任务状态机、错误体和 Provider 协议；区分 V1 已开放模式与模型未来可扩展模式。

**验收标准：**
- [x] 七个模型的模式、比例/尺寸、时长、分辨率和音频能力有单一后端注册表。
- [x] Wan 3.0 注册为同一模型 ID 下的全能视频模型，V1 只开放文生视频。
- [x] 非法组合在调用厂商前被拒绝。
- [x] 所有 API 与外部响应都有类型/schema。

**验证：** `python -m pytest tests/test_video_models.py -q`

**依赖：** 无  
**预计范围：** M（3–5 个文件）

## Task 2：建立 SQLite 任务、事件与资产 Repository

**说明：** 创建可迁移的表结构和状态迁移方法，使本地数据库成为任务真相源。

**验收标准：**
- [x] 幂等创建、单调事件序号和终态保护可用。
- [x] 上游快照脱敏，数据库不保存密钥。
- [x] 可查询活动任务与分页历史。

**验证：** `python -m pytest tests/test_video_job_repository.py -q`

**依赖：** Task 1  
**预计范围：** M（3–5 个文件）

## Task 3：实现千问 Provider 适配器

**说明：** 完成异步创建、查询、状态映射、响应校验与错误翻译。

**验收标准：**
- [x] 创建请求包含异步头并正确解析 task ID。
- [x] HappyHorse、Wan 2.6、Wan 2.7、Wan 3.0 的差异参数分别通过官方样例合约测试。
- [x] PENDING/RUNNING/SUCCEEDED/FAILED/UNKNOWN 映射稳定。
- [x] 429、5xx、超时与畸形响应被归类且不泄露密钥。

**验证：** `python -m pytest tests/test_qwen_video_provider.py -q`

**依赖：** Task 1  
**预计范围：** M（3–5 个文件）

## Task 4：实现智谱 Provider 适配器

**说明：** 完成 CogVideoX-3 异步创建、结果查询、参数映射与错误翻译。

**验收标准：**
- [x] 文生视频创建与 task ID 解析通过 mock 合约。
- [x] 比例/时长/分辨率被映射为官方支持字段。
- [x] 成功结果和所有异常状态归一化。

**验证：** `python -m pytest tests/test_zhipu_video_provider.py -q`

**依赖：** Task 1  
**预计范围：** M（3–5 个文件）

## Checkpoint A：后端基础（已完成）

- [x] Tasks 1–4 的测试通过。
- [x] 数据库迁移、API schema 和脱敏策略已落地。
- [x] 未发起任何真实付费调用。

## Task 5：实现后台 Task Monitor 与重启恢复

**说明：** 用有界并发调度器推进活动任务，持久化 `next_poll_at` 并在启动时恢复。

**验收标准：**
- [x] 无 SSE 客户端时任务仍会推进。
- [x] 同一任务不会被重复并发查询。
- [x] 节流、退避、总体超时和重启恢复均可测试。

**验证：** `python -m pytest tests/test_video_task_monitor.py -q`

**依赖：** Tasks 2–4  
**预计范围：** M（3–5 个文件）

## Task 6：实现视频转存与安全资产服务

**说明：** 成功后下载厂商临时 URL，校验并原子落盘，提供支持 Range 的播放/下载路由。

**验收标准：**
- [x] 下载失败不会产生半成品资产。
- [x] MIME、大小、重定向与超时受限。
- [x] 浏览器可通过安全资产路由播放和下载。

**验证：** `python -m pytest tests/test_video_assets.py -q`

**依赖：** Tasks 2、5  
**预计范围：** M（3–5 个文件）

## Task 7：实现创建、状态、历史 API

**说明：** 提供模型列表、异步创建、状态读取和分页历史；创建返回 202。

**验收标准：**
- [x] `client_request_id` 重试不重复提交厂商任务。
- [x] 状态 API 只读本地，不同步等待厂商。
- [x] 错误体在所有视频路由上一致。

**验证：** `python -m pytest tests/test_video_api.py -q`

**依赖：** Tasks 2–6  
**预计范围：** M（3–5 个文件）

## Task 8：实现可重连 SSE 事件流

**说明：** 从持久化事件表推送 snapshot/status/progress/result/error/heartbeat。

**验收标准：**
- [x] `Last-Event-ID` 能补发遗漏事件且不重复终态。
- [x] SSE 断开不改变业务任务状态。
- [x] 终态发送后正常关闭，代理缓冲相关响应头正确。

**验证：** `python -m pytest tests/test_video_sse.py -q`

**依赖：** Tasks 2、5、7  
**预计范围：** M（3–5 个文件）

## Checkpoint B：后端完整闭环（已完成）

- [x] mock 厂商下可完成 submit → monitor → SSE/status → asset。
- [x] 断线、乱序、429、超时和进程重启场景通过专项测试。
- [x] 目标后端测试集全绿。

## Task 9：接入侧边栏与 Video Studio 壳层

**说明：** 增加 AI 视频入口、ChatInterface 视图切换和响应式双栏页面。

**验收标准：**
- [x] 入口与 AI 生图并列且可返回对话。
- [x] 响应式双栏/单列布局已实现。
- [x] 明暗主题、标题层级和键盘焦点代码路径已实现。

**验证：** `python -m pytest tests/test_video_workspace_contract.py -q`；`npm run lint`

**依赖：** Task 1  
**预计范围：** M（3–5 个文件）

## Task 10：实现创作表单与能力联动

**说明：** 从后端模型列表渲染提示词、模型、比例、时长、分辨率和提交状态。

**验收标准：**
- [x] 模型切换会修正非法参数并给出说明。
- [x] 空提示、不可用模型和重复提交被阻止。
- [x] 创建成功后立即进入本地任务视图。

**验证：** `npm run lint`；`npm run build`；浏览器键盘表单检查

**依赖：** Tasks 7、9  
**预计范围：** M（3–5 个文件）

## Task 11：实现轮询/SSE 合流 Hook

**说明：** 统一处理 3 秒本地轮询、SSE 更新、断线回退、重连和组件卸载清理。

**验收标准：**
- [x] 乱序响应不会覆盖较新的状态或回退终态。
- [x] SSE 断开后轮询继续，重连后不重复事件。
- [x] 离开页面后 EventSource、timer 和 fetch 被清理。

**验证：** reducer/Hook 测试；浏览器模拟 offline/online

**依赖：** Tasks 7、8  
**预计范围：** M（3–5 个文件）

## Task 12：实现任务详情、播放器与历史记录

**说明：** 展示预计进度、连接状态、成功播放器、下载、失败重试和分页历史。

**验收标准：**
- [x] 刷新和重新进入页面可恢复活动任务。
- [x] 成功视频支持播放、全屏和下载。
- [x] 空、加载、失败、断线和历史空态都有明确反馈。

**验证：** `npm run lint`；`npm run build`；浏览器核心旅程

**依赖：** Tasks 6、7、10、11  
**预计范围：** M（3–5 个文件）

## Checkpoint C：完整用户旅程（代码已完成，浏览器人工验收待环境支持）

- [x] 侧边栏 → 创建 → 排队/生成 → 播放/下载代码路径完成并通过契约/构建验证。
- [x] 刷新恢复、SSE 断线回退和失败重试代码路径完成并通过后端/Hook 契约验证。
- [ ] 响应式、明暗主题、键盘与可访问性需在 Chrome DevTools MCP 可用后人工验收。

## Task 13：全模型冒烟、文档与发布验收

**说明：** 在明确费用许可后验证厂商账号能力，记录禁用模型原因并完成最终质量门槛。

**验收标准：**
- [ ] 两个厂商至少各一个 5 秒真实任务完整成功。
- [ ] 其余模型完成授权/创建/查询能力核验，结果记录可追溯。
- [ ] 日志、SQLite 与前端网络响应不含密钥。

**验证：** 完整 `python -m pytest -q`；`npm run lint`；`npm run build`；真实冒烟清单

**依赖：** Tasks 1–12；用户确认调用预算  
**预计范围：** M（验证与文档）

## 最终评审

- [ ] `tasks/ai-video-engine-plan.md` 的 Definition of Done 全部满足。
- [ ] 未解决限制已记录，不以静默降级掩盖。
- [ ] V1 范围外需求进入后续版本，不阻塞本次闭环。
