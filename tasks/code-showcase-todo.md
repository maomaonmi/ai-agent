# Code 作品广场实施任务清单

## Phase 1：只读作品广场

- [x] Task 1：定义作品、分类、发布状态和种子数据类型
  - Acceptance：类型不依赖会话快照；分类为受控枚举；包含 12–20 个真实中文种子条目。
  - Verify：`npx tsc --noEmit`
  - Files：前端类型/种子数据文件（1–2 个）

- [x] Task 2：创建作品广场页面与入口
  - Acceptance：“更多 → 代码”进入独立视图；可返回聊天；页面不与聊天消息混排。
  - Verify：浏览器完成进入/返回流程。
  - Files：`ChatInterface.tsx`、作品广场页面组件（2–3 个）

- [x] Task 3：实现分类和现代化响应式卡片
  - Acceptance：五个分类可筛选；卡片有封面、标题和同款入口；320–1440px 无横向溢出。
  - Verify：四档截图检查、键盘 Tab 检查。
  - Files：作品网格、作品卡片、样式/资产（3–5 个）

### Checkpoint A

- [ ] 静态作品广场可完整浏览。
- [ ] 首屏视觉通过人工评审后再进入数据层开发。

## Phase 2：提示词创作体验

- [x] Task 4：抽取自动增高输入组件
  - Acceptance：初始单行、最大 220px、Shift+Enter 换行、Enter 发送、中文输入法安全。
  - Verify：组件行为测试 + 手动输入长文本。
  - Files：输入组件、ChatInterface 接入（2–3 个）

- [x] Task 5：实现同款指令填充
  - Acceptance：填入完整提示词、不自动发送、聚焦并把光标放到末尾。
  - Verify：组件测试覆盖长提示词和多次覆盖。
  - Files：作品卡片/页面、输入状态接口（2–3 个）

- [ ] Task 6：接入优化指令
  - Acceptance：加载态、成功替换/预览、失败保留原文，不能重复请求。
  - Verify：API mock 测试和浏览器手动流程。
  - Files：页面、API client、可能的后端已有接口适配（3–5 个）

### Checkpoint B

- [ ] 从作品卡片到可发送提示词的完整路径可用。
- [ ] 长提示词输入体验通过人工评审。

## Phase 3：独立作品存储

- [x] Task 7：先写作品 Store 删除隔离测试
  - Acceptance：测试证明当前未实现；覆盖会话删除后作品仍存在。
  - Verify：指定 pytest 首次失败。
  - Files：`tests/test_code_project_store.py`

- [x] Task 8：实现作品表与 Store
  - Acceptance：CRUD、VFS 压缩、`ON DELETE SET NULL`、旧数据库可无损升级。
  - Verify：Store 测试通过。
  - Files：独立 store、数据库初始化、测试（3 个）

- [x] Task 9：先写并实现作品 API 契约
  - Acceptance：列表、详情、发布、更新、删除接口有验证和明确错误码。
  - Verify：`python -m pytest tests/test_code_project_api.py -q`
  - Files：API 模型、路由、测试（3–4 个）

- [ ] Task 10：实现封面文件存储
  - Acceptance：路径不可逃逸数据目录；失败有默认封面；删除作品清理专属封面。
  - Verify：路径安全与失败回退测试。
  - Files：封面 store、API 集成、测试（3 个）

### Checkpoint C

- [ ] 删除会话不删除作品的自动化测试通过。
- [ ] 删除作品不影响会话与 checkpoint。

## Phase 4：Code 工作台发布闭环

- [x] Task 11：前端作品 API client 与状态模型
  - Acceptance：类型与后端契约一致；列表接口不加载 VFS。
  - Verify：TypeScript 检查通过。
  - Files：`src/lib/api.ts`、作品类型文件（1–2 个）

- [x] Task 12：增加 Code 工作台发布入口
  - Acceptance：预览工具栏可打开发布弹窗；无有效代码时禁用并解释原因。
  - Verify：键盘与浏览器手动检查。
  - Files：`CodeWorkspace.tsx`、发布弹窗（2–3 个）

- [x] Task 13：完成首次发布
  - Acceptance：标题、分类、封面、提示词和 VFS 保存成功；广场立即出现作品。
  - Verify：端到端发布流程。
  - Files：ChatInterface/CodeWorkspace 状态桥接、弹窗、API（3–5 个）

- [ ] Task 14：实现待更新与更新发布
  - Acceptance：生成成功后显示“有未发布更新”；显式更新后恢复“已同步”。
  - Verify：发布 → 修改 → 更新发布流程测试。
  - Files：状态桥接、发布按钮、后端更新接口（3–5 个）

- [ ] Task 15：处理删除会话后的孤立作品
  - Acceptance：作品仍可预览和复用提示词；不再显示自动同步能力。
  - Verify：删除会话后的端到端回归。
  - Files：作品详情/卡片状态、删除提示文案（2–3 个）

### Checkpoint D

- [ ] 完整发布闭环可用。
- [ ] 数据隔离行为与计划书一致。

## Phase 5：视觉与质量验收

- [ ] Task 16：现代化视觉统一
  - Acceptance：间距、圆角、阴影、字体层级与现有新聊天页协调；无巨大空白或模板化 AI 风格。
  - Verify：参考图与实现截图并排检查。
  - Files：作品组件样式（2–4 个）

- [ ] Task 17：无障碍、错误和空状态
  - Acceptance：键盘操作完整；焦点可见；封面失败、空列表、发布失败都有明确状态。
  - Verify：Tab 流程、控制台、视觉检查。
  - Files：作品组件与发布弹窗（2–4 个）

- [ ] Task 18：最终回归
  - Acceptance：后端测试、前端类型检查、限定 lint 和生产构建完成；存量错误单独记录。
  - Verify：执行计划书第 9 节命令和核心浏览器流程。
  - Files：仅测试或必要修复文件。

### Final Checkpoint

- [ ] 产品、数据、视觉和删除语义全部验收。
- [ ] 用户确认后再开始实施或提交代码。
