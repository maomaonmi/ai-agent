# Spec: Day 40 会话与持久化记忆

## Objective

为每个聊天会话分配独立 UUID，并将模式、消息和富结果快照持久化到本地
SQLite。刷新页面或重启服务后，用户可通过左侧历史栏恢复完整界面状态。

## Assumptions

- 会话模式创建后固定；改变模式会切换到该模式最近的会话，没有则新建。
- 保存普通消息、推理步骤、联网资料、多智能体发言、任务规划进度和最终结果。
- 新会话首条用户消息自动生成短标题；模型失败时使用本地截断标题。
- 当前为单机单用户产品，不在本阶段增加登录与跨用户隔离。

## API Contract

- `GET /api/sessions`：按更新时间倒序返回会话摘要。
- `POST /api/sessions`：创建固定模式的新会话。
- `GET /api/sessions/{id}/history`：返回会话元数据和完整 UI 快照。
- `PUT /api/sessions/{id}/history`：原子覆盖会话 UI 快照。
- `DELETE /api/sessions/{id}`：删除指定会话及其快照。
- `DELETE /api/sessions`：清空全部历史。
- 现有 `POST /chat` 增加可选 `session_id`，保持旧客户端兼容。

## Data Model

- `sessions(session_id, title, mode, created_at, updated_at)`
- `session_snapshots(session_id, snapshot_json, updated_at)`
- 删除会话时依靠外键级联删除快照。

## Testing Strategy

- Python `unittest` 覆盖 CRUD、模式隔离、快照恢复、级联删除和请求校验。
- 前端运行 ESLint、TypeScript/Next.js 生产构建。
- 浏览器验证新建、切换模式、刷新恢复和删除交互。

## Boundaries

- Always：参数化 SQL、校验 UUID/模式、JSON 快照使用明确结构。
- Ask first：身份认证、云同步、向量长期记忆。
- Never：把 API Key 或隐藏推理过程写入会话快照。

## Success Criteria

- 刷新页面后当前会话和所有可见结果恢复。
- 不同模式使用不同会话，互不污染。
- 历史栏支持新建、打开、删除、清空。
- 旧的无 `session_id` `/chat` 请求仍正常工作。

