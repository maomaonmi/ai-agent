# 全能模式任务清单

## 阶段 0：契约与兼容基础

- [x] 0.1 新建全能模式前端领域契约与契约测试
- [x] 0.2 为新旧聊天消息建立稳定 messageId
- [x] 0.3 定义后端 Project/Artifact/Version/Link 请求响应模型
- [x] Checkpoint 0：契约与会话回归通过；全库类型检查保留既有错误基线

## 阶段 1：项目归属纵向切片

- [x] 1.1 项目存储与 session.project_id 单归属
- [x] 1.2 项目 CRUD、会话加入/移动/移出 API 与前端客户端
- [x] 1.3 左侧新建项目与项目会话树
- [x] Checkpoint 1：刷新恢复且不复制消息/作品

## 阶段 2：作品与右侧面板

- [x] 2.1 Artifact/Version/MessageLink/Relation 存储
- [x] 2.2 作品查询 API 与前端客户端
- [x] 2.3 统一作品消息卡片
- [x] 2.4 按需滑出右侧面板状态机
- [x] Checkpoint 2：历史版本准确、最新版提示、连续点击不串台

## 阶段 3：第一阶段 MVP

- [x] 3.1 单行全能输入工具栏
- [x] 3.2 TurnContext 接入联网/深思现有链路
- [x] 3.3 文档型作品适配器
- [x] 3.4 图片作品适配器
- [x] Checkpoint 3：全能对话→作品卡片→右侧面板→刷新恢复→加入项目

## 阶段 4：完整能力

- [x] 4.1 Research Adapter
- [x] 4.2 Writing/Thesis Adapter
- [x] 4.3 Video Adapter
- [x] 4.4 PPT Adapter
- [x] 4.5 项目摘要检索、跨会话和跨项目引用

## 当前执行

- [x] Task 0.1：前端领域契约（4 项契约测试通过）
- [x] Task 0.2：稳定 messageId（旧快照确定性恢复，流式更新保持身份）
- [x] Task 0.3：后端严格契约
- [x] Task 1.1：项目存储与会话单归属
- [x] Task 1.2：项目 API 与前端客户端
- [x] Task 1.3：普通会话接入服务端项目树；PPT 本地标记隔离保留
- [x] Task 2.1：Artifact/Version/MessageLink/Relation 原子存储
- [x] Task 2.2：作品、版本和消息引用查询 API 与前端客户端
- [x] Task 2.3：统一作品消息卡片与历史版本视图模型
- [x] Task 2.4：批量消息关系、作品卡片和右侧面板接入 ChatInterface
- [x] Task 3.1：单行全能输入工具栏；联网/深思独立开关复用现有状态
- [x] Task 3.2：发送前冻结创作意图、联网/深思、附件与当前作品版本，并随聊天请求透传
- [x] Task 3.3：文档型作品适配器；支持聊天生成、不可变版本、右侧预览和原会话内专业编辑回写
- [x] Task 3.4：图片作品适配器；支持完整候选批次、历史版本预览与生图工作台回写
- [x] Task 4.1：Research Adapter；全能入口与既有调研模式均可落成带来源的研究作品
- [x] Task 4.2：Writing/Thesis Adapter；论文正文、大纲、章节、来源与引用按结构化版本保存和恢复
- [x] Task 4.3：Video Adapter；异步任务卡片可刷新恢复，终态生成精确版本并支持视频工作台回写
- [x] Task 4.4：PPT Adapter；异步 run 可刷新恢复，终态保存精确 presentation/revision/run，支持历史版本预览与 PPT 工作台跳转
- [x] Task 4.5：项目摘要检索、跨会话和跨项目引用；摘要自动注入，具体版本显式引用，跨项目保持原归属并标识来源

## 已知验证基线

- `npm run test:omni`：通过（10/10）。
- 项目、契约、会话后端测试：通过（22/22）。
- 项目树接入后 `npm run test:omni`：通过（12/12），相关 ESLint 通过。
- 作品卡片与面板接入后 `npm run test:omni`：通过（17/17），新增 Omni 组件 ESLint 通过，Next 实际编译与首页 HTTP 200。
- 全能输入工具栏接入后 `npm run test:omni`：通过（19/19），新增工具栏文件 ESLint 通过，Next 实际编译与首页 HTTP 200。
- TurnContext 接入后 `npm run test:omni`：通过（22/22）；Omni/项目/作品后端相关测试通过（10/10）。
- 文档适配器首段接入后 `npm run test:omni`：通过（23/23）；作品存储/API/契约后端测试通过（15/15）；Next 实际编译与首页 HTTP 200。
- 文档专业工作台桥接后：无修改不生成版本；修改后在原会话创建新版本与消息关系；前端 23/23、后端 15/15，Next 实际编译与首页 HTTP 200。
- 图片适配器接入后 `npm run test:omni`：通过（25/25）；完整批次按版本保存，卡片封面与右侧候选图均读取精确版本；Next 实际编译与首页 HTTP 200。
- Research Adapter 接入后 `npm run test:omni`：通过（26/26）；报告正文、原始查询和有界来源摘要按精确版本保存；Next 实际编译与首页 HTTP 200。
- Writing/Thesis Adapter 接入后 `npm run test:omni`：通过（27/27）；论文完成事件携带最终结构快照，专业工作台按精确版本恢复并继续回写；Next 实际编译与首页 HTTP 200。
- Video Adapter 接入后 `npm run test:omni`：通过（29/29）；生成中任务与 taskId 持久化，刷新恢复轮询，成功/失败追加终态版本；后端相关测试 15/15，Next 实际编译与首页 HTTP 200。
- PPT Adapter 接入后 `npm run test:omni`：通过（30/30）；生成中 run 与 runId 持久化，刷新恢复轮询，终态保存精确演示文稿版本，右侧可预览历史幻灯片并进入对应 PPT 工作台；相关 ESLint/TypeScript 检查通过，Next 实际编译与首页 HTTP 200。
- 项目检索与引用接入后 `npm run test:omni`：通过（31/31）；相关后端项目/作品/契约测试通过（24/24）；跨会话与跨项目均引用精确版本、不复制作品，相关 ESLint/TypeScript 检查通过，Next 实际编译与首页 HTTP 200。
- 本地 HTTP 验证：`GET /api/projects` 成功，Next 首页返回 200；当前会话未暴露可用的应用内浏览器控制工具，因此尚无截图/DOM 人工验收记录。
- `npx tsc --noEmit`：当前被既有问题阻断，包括 `ai-input` 缺少 Vite 类型、PPT SearchProvider 类型不一致、VideoStudioWorkspace 既有类型错误；Task 0.1 未新增 TypeScript 错误。
