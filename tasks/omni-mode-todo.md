# 全能模式任务清单

## 阶段 0：契约与兼容基础

- [x] 0.1 新建全能模式前端领域契约与契约测试
- [x] 0.2 为新旧聊天消息建立稳定 messageId
- [x] 0.3 定义后端 Project/Artifact/Version/Link 请求响应模型
- [ ] Checkpoint 0：类型、会话回归和前端检查通过

## 阶段 1：项目归属纵向切片

- [x] 1.1 项目存储与 session.project_id 单归属
- [x] 1.2 项目 CRUD、会话加入/移动/移出 API 与前端客户端
- [ ] 1.3 左侧新建项目与项目会话树
- [ ] Checkpoint 1：刷新恢复且不复制消息/作品

## 阶段 2：作品与右侧面板

- [ ] 2.1 Artifact/Version/MessageLink/Relation 存储
- [ ] 2.2 作品查询 API 与前端客户端
- [ ] 2.3 统一作品消息卡片
- [ ] 2.4 按需滑出右侧面板状态机
- [ ] Checkpoint 2：历史版本准确、最新版提示、连续点击不串台

## 阶段 3：第一阶段 MVP

- [ ] 3.1 单行全能输入工具栏
- [ ] 3.2 TurnContext 接入联网/深思现有链路
- [ ] 3.3 文档型作品适配器
- [ ] 3.4 图片作品适配器
- [ ] Checkpoint 3：全能对话→作品卡片→右侧面板→刷新恢复→加入项目

## 阶段 4：完整能力

- [ ] 4.1 Research Adapter
- [ ] 4.2 Writing/Thesis Adapter
- [ ] 4.3 Video Adapter
- [ ] 4.4 PPT Adapter
- [ ] 4.5 项目摘要检索、跨会话和跨项目引用

## 当前执行

- [x] Task 0.1：前端领域契约（4 项契约测试通过）
- [x] Task 0.2：稳定 messageId（旧快照确定性恢复，流式更新保持身份）
- [x] Task 0.3：后端严格契约
- [x] Task 1.1：项目存储与会话单归属
- [x] Task 1.2：项目 API 与前端客户端
- [ ] Task 1.3：迁移侧栏本地伪项目并接入服务端项目树（下一步）

## 已知验证基线

- `npm run test:omni`：通过（10/10）。
- 项目、契约、会话后端测试：通过（22/22）。
- `npx tsc --noEmit`：当前被既有问题阻断，包括 `ai-input` 缺少 Vite 类型、PPT SearchProvider 类型不一致、VideoStudioWorkspace 既有类型错误；Task 0.1 未新增 TypeScript 错误。
