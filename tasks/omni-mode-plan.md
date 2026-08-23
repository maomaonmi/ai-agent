# 全能模式实施计划

## 概览

依据 [全能模式项目化多模态工作区计划书](../docs/ideas/全能模式项目化多模态工作区计划书.md)，以纵向切片逐步建立“项目可选、对话优先、作品驱动、版本精确”的全能模式。第一里程碑只打通统一契约、稳定消息身份、作品卡片、按需右侧面板、刷新恢复和会话加入项目，不一次性重写现有五类专业工作台。

## 架构决策

- `mode` 只表达会话执行体验，不再决定右侧作品类型。
- 消息通过稳定 `messageId` 和 `MessageArtifactLink` 精确引用 `artifactId + versionId`。
- 全能模式和专业工作台使用同一领域实体，现有 ImageBatch、VideoTask、WritingDocument、Research report、Presentation 通过适配器映射。
- 联网搜索与深度思考复用现有 `RuntimeSettings`，作为可同时开启的横向能力。
- 新契约采用加法扩展，旧会话快照在读取时规范化，不做破坏性原地改写。
- 先完成文档型作品与图片型作品两个差异化适配，再接视频和 PPT。

## 依赖顺序

```text
统一类型契约
  └── 稳定消息 ID
      ├── 项目存储/API
      └── 作品/版本/消息关系存储 API
          └── 前端 API 客户端
              ├── 项目会话树
              └── 全能会话外壳
                  ├── 统一作品卡片
                  ├── 右侧面板状态机
                  └── 首批作品适配器
```

## 阶段 0：契约与兼容基础

### Task 0.1：冻结前端领域契约

**说明：** 新建全能模式领域类型，覆盖 Project、Artifact、ArtifactVersion、MessageArtifactLink、TurnContext、面板状态和事件信封。

**验收标准：**

- [ ] ID 类型不可被不同实体误用。
- [ ] 事件通过判别联合携带 artifactId/versionId。
- [ ] webSearch 与 deepThinking 可同时为 `on`。

**验证：** `npm run test:omni`

**依赖：** 无

**预计文件：** `src/features/omni/types.ts`、`test/omniTypesContract.test.ts`、`package.json`

### Task 0.2：为消息增加稳定 ID

**说明：** 对新消息生成稳定 ID，对旧快照缺失 ID 的消息做确定性规范化，并在快照保存后保持不变。

**验收标准：**

- [ ] 新用户消息和助手消息创建时都有 ID。
- [ ] 同一旧快照重复恢复得到相同 ID。
- [ ] 编辑、删除、研究文档选择不再要求长期依赖数组索引。

**验证：** 前端契约测试和相关 Python 会话契约测试。

**依赖：** Task 0.1

### Task 0.3：定义后端请求/响应契约

**说明：** 以 Pydantic 定义项目、作品、版本和消息关系模型，保持现有 session API 向后兼容。

**验收标准：**

- [ ] 外部输入在 API 边界校验。
- [ ] 错误采用统一结构。
- [ ] 现有会话创建请求仍可工作。

**验证：** `pytest` 契约测试。

**依赖：** Task 0.1

### Checkpoint 0

- [ ] 类型契约测试通过。
- [ ] 旧会话测试无回归。
- [ ] 前端 TypeScript 检查通过。

## 阶段 1：项目归属纵向切片

### Task 1.1：项目存储与会话单归属

创建项目表并为 session 增加 nullable project_id，支持创建、列表、重命名、归档和安全删除。

### Task 1.2：项目 API 与前端客户端

提供项目 CRUD、加入、移动、移出会话接口，列表响应支持分页或稳定排序。

### Task 1.3：左侧项目会话树

在 SessionSidebar 增加“新建项目”和项目折叠树，项目节点下只展示会话。

### Checkpoint 1

- [ ] 普通会话可加入、移动和移出项目。
- [ ] 刷新后归属不变。
- [ ] 不复制消息或生成结果。

## 阶段 2：作品与版本纵向切片

### Task 2.1：作品、版本与消息关系存储

建立 artifacts、artifact_versions、message_artifact_links 和 artifact_relations，并实现原子创建。

### Task 2.2：作品查询 API 和前端客户端

支持按会话列出作品、读取指定版本和查看最新版。

### Task 2.3：统一作品消息卡片

在对话流中渲染类型无关外壳，所有点击操作只传递 artifactId/versionId。

### Task 2.4：右侧面板状态机

实现 closed/opening/open 与 split/maximized，进入会话默认关闭，切换作品时原地更新。

### Checkpoint 2

- [ ] 历史卡片打开历史版本。
- [ ] 非最新版有明确提示和“查看最新版”。
- [ ] 多作品连续点击无串台。

## 阶段 3：全能输入与首批适配器

### Task 3.1：单行全能输入工具栏

迁移 ai-input 视觉结构，实现附件、能力入口、联网、深思、模型和发送的单行工具栏及响应式收纳。

### Task 3.2：TurnContext 与现有运行能力复用

冻结每轮 preferredCapability、作品引用、webSearch、deepThinking 和附件；复用现有 RuntimeSettings 与 SSE 链路。

### Task 3.3：文档型作品适配器

优先从 Research 或 Writing 选择风险较低者，支持卡片、右侧预览、历史版本和进入专业工作台。

### Task 3.4：图片作品适配器

映射 ImageBatch 与候选 Asset，支持指定批次/版本打开和派生编辑。

### Checkpoint 3（第一阶段 MVP）

- [ ] 全能对话可连续生成文档和图片作品。
- [ ] 联网与深思可同时开启。
- [ ] 点击卡片滑出正确版本。
- [ ] 刷新后数据恢复且面板默认关闭。
- [ ] 会话可加入项目。

## 阶段 4：全面能力接入

- [ ] Research Adapter
- [ ] Writing/Thesis Adapter
- [ ] Video Adapter 与实时任务事件
- [ ] PPT Adapter 与专业工作台版本同步
- [ ] 跨作品派生关系
- [ ] 项目摘要检索与跨项目显式引用

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| ChatInterface 继续膨胀 | 高 | 先抽 Omni Shell/Panel/Adapter 边界 |
| 工作区存在大量未提交改动 | 高 | 只修改明确文件，逐文件检查 diff，不清理用户改动 |
| 旧实体 ID 语义不同 | 高 | Artifact 包装现有实体，暂不重写领域存储 |
| 实时事件乱序/重复 | 高 | runId + artifactId + versionId 幂等归并 |
| 旧快照没有 messageId | 中 | 确定性规范化并回写新快照 |
| 输入工具栏宽度不足 | 中 | 单行分级收纳，禁止自然换行 |

## 当前无阻塞问题

产品关键决策已在计划书中确认。实现中如遇到会改变产品语义或需要破坏性迁移的选择，再暂停请求确认。
