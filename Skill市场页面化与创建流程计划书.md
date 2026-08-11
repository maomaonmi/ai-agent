# Skill 市场页面化 & 创建流程改造计划书

> 目标：把「MCP · Skills · Plugins」市场从弹窗升级为 SPA 内全屏页面，Skill 市场补齐
> 目录数据（排序/筛选/搜索），并打通「AI 代写 / 手动编写 / 上传解析」三条 Skill 创建链路；
> 设置页新增已安装三模块管理列表，与市场页双向跳转。
> 参考原型：Anthropic Directory（卡片网格）、Settings Skills 列表、Add 下拉、
> Write skill instructions 表单、Upload skill 弹窗。

---

## 0. 已确认决策（用户拍板）

| # | 决策点 | 结论 |
| :--- | :--- | :--- |
| D1 | 市场"单独页面"的形态 | **SPA 内全屏视图切换**（非 Next.js 路由）：侧边栏入口点击后主区整页切为市场，会话状态保留、返回即聊天 |
| D2 | Skill 市场目录数据 | **新建 `config/skill_catalog.json`**，预置约 12 个 Anthropic 官方风格 Skill（完整 trigger/steps/rules），安装即落库为 `published` |
| D3 | 手动创建/上传的落库形态 | **直接 `published` + 新增 skill_type `instruction`**（用户亲自创建=已确认；与 code 沉淀物区分） |
| D4 | Create with agent 提示词 | **随机提示词池**：点击后新建对话并从池里随机抽一条预填输入框（不自动发送） |
| D5 | Add 下拉范围 | **只放市场页 Skills 页签**（MCP/Plugins 是安装制，无手写概念）；设置页三列表的 Browse 按钮跳市场对应页签 |

---

## 1. 视图架构（D1 落地）

```text
ChatInterface
  ├─ view = 'chat'        → 现有聊天主区（不变）
  └─ view = 'marketplace' → <DirectoryPage initialTab={tab} /> 全屏替换主区
        ├─ SessionSidebar 保持渲染（会话列表不丢）
        ├─ 顶栏：← 返回聊天 | 页签切换 | 设置按钮(齿轮) | Add 下拉(仅 Skills 页签)
        └─ SettingsDialog 以 Dialog 形式叠加在市场页之上（齿轮触发）
```

- `ChatInterface` 新增 `view` 状态 + `directoryTab` 状态（'skills' | 'connectors' | 'plugins'）。
- `openDirectory(tab?)` 语义从"开弹窗"改为"切视图"：侧边栏入口、设置页 Browse 按钮、运行设置抽屉入口统一走它。
- `DirectoryModal.tsx` 重构为 `DirectoryPage.tsx`：去掉遮罩/关闭按钮/Esc 关闭逻辑，内容区改为整页布局；connectors/plugins 两页签逻辑**原样保留**，仅容器变化。

> Why 全屏切换而非路由：ChatInterface 持有 SSE 流、输入草稿、运行设置等大量内存态，
> 路由跳转会强制卸载。SPA 切换零状态损耗，也与 code 模式的全屏切换同构。

---

## 2. Skill 市场目录（D2 落地）

### 2.1 `config/skill_catalog.json` 结构

```jsonc
{
  "skills": [
    {
      "catalog_id": "web-artifacts-builder",   // 稳定主键，幂等安装判重
      "name": "/web-artifacts-builder",
      "author": "Anthropic",
      "downloads": 1100000,                     // 数值，排序用；展示时格式化为 1.1M
      "category": "artifacts",                  // 筛选维度：artifacts/design/writing/meta/productivity/devtools
      "description": "卡片简述（网格卡片显示，两行截断）",
      "trigger_condition": "落库为 trigger_condition",
      "standard_steps": ["...", "..."],
      "validation_rules": ["...", "..."]
    }
  ]
}
```

### 2.2 预置 12 个 Skill（对齐参考图）

| catalog_id | category | 内容定位 |
| :--- | :--- | :--- |
| /web-artifacts-builder | artifacts | 多组件 HTML artifact 套件（前端组件化规范） |
| /theme-factory | design | 主题化 styling（slides/docs/landing page） |
| /canvas-design | design | .png/.pdf 视觉艺术生成设计哲学 |
| /brand-guidelines | design | 品牌色与排版规范套用 |
| /algorithmic-art | design | 生成艺术（p5.js 风格算法美学） |
| /doc-coauthoring | writing | 文档协作结构化工作流 |
| /internal-comms | writing | 内部沟通文案格式集 |
| /slack-gif-creator | productivity | Slack 动图制作流程 |
| /morning | productivity | 晨间简报 HTML artifact 渲染 |
| /learn | meta | 概念讲解/教学型回答组织法 |
| /skill-creator | meta | 创建/改进/评估 skill 的元技能 |
| /mcp-builder | devtools | 高质量 MCP server 开发指南 |

> 每个的 standard_steps / validation_rules 由我编写（中文、可直接投产的质量），
> 不放空壳。

### 2.3 安装语义

- `POST /api/skills/catalog/install {catalog_id}` → 查 catalog → `skill_store.create_skill(...)`
  落库为 `status='published'`、`skill_type='instruction'`、`author=catalog.author`、
  `source=catalog_id`。
- **幂等**：`source` 已存在 → 返回已有 skill（409 或 200+existing 标记，前端置灰"已安装"）。
- 卸载 = 删除该 source 对应行（复用 DELETE `/api/memory/skills/{id}`）。

### 2.4 skill_capsules 表结构演进

| 新列 | 类型 / 默认 | 用途 |
| :--- | :--- | :--- |
| `author` | `TEXT NOT NULL DEFAULT 'local'` | 设置页 Author 列；catalog 安装='Anthropic'，手动/上传='我'，code 沉淀='agent' |
| `source` | `TEXT`（NULL） | catalog_id 回溯；判重；区分来源 |

迁移：`_initialize` 里 `ALTER TABLE ... ADD COLUMN`（幂等 try/except），存量行
`author='agent'`（皆 code 沉淀）、`source=NULL`。

---

## 3. 三条 Skill 创建链路（市场页 Add 下拉）

```text
Add ▾
 ├─ Create with agent      → 关市场→新建会话(standard)→输入框预填随机提示词（不发送）
 ├─ Write skill instruction → <CreateSkillModal>（图4 表单，空初始值）
 └─ Upload a skill         → <UploadSkillModal>（图5 拖拽/点击上传 .md）
                               → 前端解析 → 打开 <CreateSkillModal> 预填解析结果
```

### 3.1 Create with agent（D4）

- 新建 `lib/skillPromptPool.ts`：6 条采访式提示词（例如"我想创建一个新 skill。请通过
  提问帮我明确：①解决什么场景 ②触发条件 ③标准步骤 ④校验规则，最后输出
  name/description/instructions 三段式，我会把它加入我的 skill 库。"及其变体）。
- 流程：`setView('chat')` → `handleCreateSession()` → 输入框 `setInput(randomPick(pool))`。
  **只预填不发送**，用户审阅后自行发送。
- 依赖：ChatInterface 输入框 value 需支持外部注入（检查现有 input 受控状态，加
  `prefillInput` 通道）。

### 3.2 Write skill instruction（图4 表单）

`CreateSkillModal` 三字段 + Cancel/Create：

| 表单字段 | 落库映射 |
| :--- | :--- |
| Skill name | `skill_name`（去空格、长度 ≤64 校验） |
| Description | `trigger_condition`（非空校验） |
| Instructions | `standard_steps`（按非空行拆分，≥1 行校验） |

- 调 `POST /api/memory/skills`（新增接口），落库 `skill_type='instruction'`、
  `status='published'`、`author='我'`。
- 创建成功后刷新市场页已安装标记 + toast 提示。

### 3.3 Upload a skill（图5）

`UploadSkillModal`：

- 拖拽区（dragover 高亮）+ 点击选文件，**仅接受 `.md`**（`.zip`/`.skill` 列入后续范围，见 §7）。
- 前端解析（零新依赖）：
  - YAML frontmatter：`/^---\n([\s\S]*?)\n---/` 内取 `name:` / `description:` 简单键值
    （不支持嵌套 YAML——SKILL.md 规范只需扁平键值）；
  - 正文剩余部分 → instructions 原文。
- 解析失败（无 frontmatter / 缺 name）→ 弹窗内报错行，不进入下一步。
- 解析成功 → 关闭上传弹窗 → 打开 `CreateSkillModal` 并预填三字段，用户确认后创建
  （与 3.2 共用同一落库接口）。

---

## 4. 市场页 Skills 页签改版（需求 1）

- 数据源从 `getSkills()`（DB 沉淀列表）改为 `getSkillCatalog()`（目录）+ 本地已安装
  skill 的 `source` 集合做"已安装"标记。
- 顶行：搜索框（名称+描述模糊匹配）、`Filter by` 下拉（category 多选/单选）、
  `Sort by` 下拉（下载量↓ / 名称 A-Z / 最近更新——catalog 加 `updated_at` 字段支撑）。
- 卡片网格：名称 / author · 下载量 / 两行描述 / 右上操作钮（未安装=「+」安装，
  已安装=齿轮→ 跳设置页定位该行）。两列网格（参考图 1）。
- connectors/plugins 页签：仅容器改为整页，功能不动。

---

## 5. 设置页新增「MCP · Skills · Plugins」模块（需求 3、4）

`SettingsDialog` section 联合类型加 `'directory'`，左侧导航加第 4 项。

```text
┌ MCP · Skills · Plugins ───────────────────────────┐
│ [Skills] [MCP] [Plugins]   （子页签切换，参考图2） │
│ ┌──────────────────────────────────────────────┐ │
│ │ 列表右上角: 🔍搜索(仅Skills) + [Browse 市场]   │ │
│ │ Skills 表格: 名称 | Last updated | Author | 操作(下架) │
│ │ MCP    表格: 名称 | 状态点 | 工具数 | 开关       │
│ │ Plugins表格: 名称 | 描述 | 开关                  │
│ └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

- **Browse 按钮**（三个列表各自一个）：`onClose()` + `openDirectory(对应tab)`。
- Skills 列表数据：`getSkills()` 全量（含 pending，加状态徽标；操作列 published→下架，
  pending→上架——复用 `setSkillStatus`，与 SkillInspector 同源）。
- MCP 列表：`getMcpMarketplace()` 已安装子集（复用启停 `toggleMcp`）。
- Plugins 列表：`getPlugins()`（复用 `togglePlugin`）。
- 深链：`SettingsDialog` 加 `initialSection`/`initialSubTab` props，市场页齿轮点击时
  `openSettings('directory', 当前tab)` 反向定位。

---

## 6. 改动清单（文件级）

### 后端
| 文件 | 改动 |
| :--- | :--- |
| `config/skill_catalog.json` | 新建，12 个预置 Skill 完整内容 |
| `skill_store.py` | `SkillCapsule` 加 `author`/`source`；建表/幂等迁移加两列；`create_skill` 透传新字段；`SKILL_TYPES` 加 `instruction` |
| `main.py` | 新增 `GET /api/skills/catalog`（读 JSON + 标注 installed）、`POST /api/skills/catalog/install`（幂等）、`POST /api/memory/skills`（手动创建，参数校验）；skill_type 校验集合加 `instruction` |

### 前端
| 文件 | 改动 |
| :--- | :--- |
| `components/DirectoryModal.tsx` → `DirectoryPage.tsx` | 弹窗→全屏页重构；Skills 页签重写（catalog 网格+搜索/筛选/排序+Add 下拉+设置齿轮）；connectors/plugins 仅换容器 |
| `components/CreateSkillModal.tsx` | 新建（图4 表单 + 初始值预填支持 + 字段校验） |
| `components/UploadSkillModal.tsx` | 新建（图5 拖拽上传 + frontmatter 解析 + 解析失败报错） |
| `lib/skillPromptPool.ts` | 新建，6 条随机提示词 |
| `lib/api.ts` | `SkillCatalogItem` 类型；`getSkillCatalog`/`installSkillFromCatalog`/`createSkill`；`SkillCapsule` 加 `author`/`source` |
| `components/ChatInterface.tsx` | `view`/`directoryTab` 状态；marketplace 渲染分支；create-with-agent 流程（新建会话+输入框预填）；设置深链回调 |
| `components/SessionSidebar.tsx` | 入口语义切视图（UI 不变，仅回调含义变化） |
| `components/SettingsDialog.tsx` | 新增 directory section：三子页签列表 + Browse 按钮 + `initialSection` 深链 props |

### 测试
| 文件 | 改动 |
| :--- | :--- |
| `tests/test_memory_engine.py` | 补：新列迁移幂等、instruction 类型 create_skill、author/source 落库 |
| `tests/test_session_api.py`（或新文件） | 补：catalog 读取、install 幂等（重复安装返回 existing）、手动创建接口 422 校验路径 |

---

## 7. 不在本期范围（划线）

- `.zip` / `.skill` 压缩包上传解析（需引入 jszip，下期）。
- 市场页 connectors/plugins 的 Add 下拉（安装制无手写概念，不做）。
- Skill 远程仓库拉取 / 版本更新检查。
- 设置页 Skills 列表的行内编辑（保持去记忆面板 SkillInspector 编辑，避免三处编辑器发散）。
- Catalog 下载量的真实统计（预置静态数值，仅排序展示用）。

---

## 8. 验证标准

1. 侧边栏点「MCP、Skills、Plugins」→ 主区整页变市场，返回后聊天会话/输入草稿原样保留。
2. Skills 页签：≥12 张卡片；搜索词过滤生效；Filter by category 生效；Sort by 下载量/名称生效。
3. 卡片点「+」安装 → DB 出现 `published + instruction + author='Anthropic' + source=catalog_id` 行；刷新后卡片显示已安装；重复安装幂等不重复建行。
4. Add→Create with agent → 自动新建会话且输入框已预填随机提示词（未发送）。
5. Add→Write skill instruction → 填三字段创建 → 市场页/设置页/记忆面板三处可见（published）。
6. Add→Upload a skill → 拖入合规 SKILL.md → 自动弹创建表单且三字段已解析预填；坏文件给行内报错。
7. 设置页 directory 模块三子页签切换正常，各 Browse 按钮跳市场对应页签；市场页齿轮反向打开设置并定位 directory。
8. `pytest` 全绿；`tsc --noEmit` 零错误。

---

## 9. 实施顺序

1. 后端：`skill_store` 加列迁移 → catalog JSON + 三个接口 → pytest
2. 前端基建：api.ts 类型/方法 + promptPool
3. DirectoryPage 重构（容器先行，connectors/plugins 先跑通）
4. Skills 页签 catalog 化 + Add 三链路（CreateSkillModal / UploadSkillModal）
5. 设置页 directory 模块 + 双向跳转
6. tsc + pytest + 手工 E2E 走查（§8 全清单）
