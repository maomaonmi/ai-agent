# MCP / Skills / Plugins 模块实施计划书

> 版本：v1.0 · 日期：2026-08-07
> 参考实现：`MCP&Skills/`（mcp_catalog.json / mcp_client_manager.py / mcp_marketplace_api.py）
> 参考 UI：`frontend/ai-agent/src/MCP/McpMarketplaceModal.tsx` + Claude Directory 截图

---

## 1. 目标

在左侧侧边栏（新建会话 之下、会话历史 之上）新增 **MCP / Skills / Plugins** 入口，点击打开 Directory 风格弹窗，提供三个页签：

| 页签 | 内容 | 本版范围 |
|------|------|---------|
| **Connectors (MCP)** | MCP 插件市场：浏览目录 → 配置凭证安装 → 启用/暂停/卸载 → 进程常驻 → 工具注入 Agent | 完整实现 |
| **Skills** | 项目已有 skill（skill_store）的可管理列表：启停、编辑触发条件与内容 | 完整实现 |
| **Plugins** | 内置能力插件管理（非 MCP 协议的本地工具，如 run_terminal / web_search 等 TOOL_REGISTRY 项的启停） | 完整实现（轻量） |

用户可在 UI 内嵌 JSON 编辑器中直接编辑整个 MCP 配置文件（`config/installed_mcps.json`），保存即热生效。

### 已确认决策（用户答复）

1. MCP 工具注入 **聊天 + code 全模式**。
2. 进程生命周期：**启用即拉起，常驻进程池**；暂停/卸载杀进程；崩溃自动重启。
3. Skills 页签：**可管理**（启停 + 编辑）。
4. 自定义配置：**UI 内嵌 JSON 编辑器**（语法校验 + 保存热加载）。
5. **双层开关语义**（新增）：
   - **全局层**（市场弹窗）：安装/启用 = 进程常驻池，工具"可用"；
   - **会话层**（运行设置抽屉）：`关闭 / 自动 / 自定义` 三段 + 插件多选 chips，决定**当前会话实际注入哪些 MCP 工具**，随会话持久化（与输出长度/联网搜索同一机制）。
   - Why 分层：进程拉起有冷启动成本（npx 拉包数十秒），不能因为会话级临时不用就杀进程；会话层只做"工具 schema 注入过滤"，零进程操作，即时生效。

---

## 2. 现状与差距

| 项 | 现状 | 差距 |
|----|------|------|
| 目录/安装 API | `MCP&Skills/mcp_marketplace_api.py` 独立 FastAPI 雏形 | 未挂入主后端；`installed_at` 用文件 mtime 是 bug；无凭证脱敏 |
| 进程通信 | `mcp_client_manager.py` 同步阻塞 `readline()` | 在 FastAPI async 上下文会**阻塞事件循环**，必须异步化 |
| 工具注入 | 无；`App.py` 有 `TOOL_REGISTRY` + `to_openai_schema()` 统一通道 | MCP 工具需转为 ToolSpec 兼容形态并入调度 |
| 前端 | `McpMarketplaceModal.tsx` 参考稿 | 不符合目标 UI（无页签/搜索/分类）；未挂侧边栏 |
| Skills 管理 | `skill_store.py` + `SkillInspector.tsx` 只读展示 + 删除 | 缺启停标志与编辑能力 |

---

## 3. 总体架构

```
[SessionSidebar] "MCP · Skills · Plugins" 入口
        │ 打开
        ▼
[DirectoryModal (React)]  ←── 三页签 + 搜索 + 分类过滤 + JSON 编辑器
        │ REST
        ▼
[main.py 路由层]  /api/mcp/*  ·  /api/skills/* (扩展)  ·  /api/plugins/*
        │
        ▼
[mcp_manager.py (新)]  MCP 进程池（asyncio 子进程 + JSON-RPC over stdio）
        │ 启用即拉起 / tools/list / tools/call / 崩溃重启 / 优雅退出
        ▼
[工具注入层]  MCP tools → ToolSpec 兼容 → 并入 App.py 调度（全模式）
```

---

## 4. 后端设计

### 4.1 新模块 `mcp_manager.py`（核心）

**Why 异步重写**：参考实现 `process.stdout.readline()` 是同步阻塞调用，在 uvicorn 事件循环中会冻结所有 SSE 流（聊天断流）。必须用 `asyncio.create_subprocess_exec` + 异步读行。

```
class McpServerProcess:
    server_id, command, args, env, status(pending/ready/error/stopped)
    process: asyncio.subprocess.Process
    tools: list[dict]            # tools/list 缓存
    restart_count, last_error
    async start()                # 拉起 + initialize 握手 + tools/list
    async call_tool(name, args, timeout=30s)
    async stop()                 # terminate → 5s 宽限 → kill
    async _read_loop()           # 按 id 分发响应到 pending future；探测崩溃

class McpProcessPool:
    servers: dict[str, McpServerProcess]
    async sync_from_config()     # 对照 installed_mcps.json diff：新增拉起/停用杀掉/配置变更重启
    def all_tool_specs()         # 汇总 enabled server 的 OpenAI function schema
    async dispatch(name, args)   # 按 mcp__<server>__<tool> 前缀路由
    async shutdown_all()         # atexit / 后端关闭钩子
```

关键策略：

- **命名空间隔离**：工具名统一改写为 `mcp__<server_id>__<tool_name>`（Claude Code 惯例），防止与 `TOOL_REGISTRY` 及多 server 间撞名。
- **崩溃自愈**：读循环检测到 EOF/非零退出 → 标记 error → 指数退避重启（1s/2s/4s，上限 3 次），超限置 `error` 等用户干预。
- **调用超时**：`tools/call` 默认 30s `asyncio.wait_for`，超时返回结构化错误给模型而不是挂起。
- **stderr 不落盘吞掉**：按 server 循环保留最近 50 行，UI「详情」可查看，排查 npx 拉包失败等问题。
- **Windows 兼容**：`npx` 在 Windows 实为 `npx.cmd`，`asyncio.create_subprocess_exec` 需解析（`shutil.which("npx")` 或显式补 `.cmd`），否则 FileNotFoundError。

### 4.2 配置与目录文件

| 文件 | 作用 | 说明 |
|------|------|------|
| `MCP&Skills/mcp_catalog.json` → 迁移至 `config/mcp_catalog.json` | 市场目录（预置，只读） | 扩充条目：每条新增 `transport`(stdio)、`provider`、`tags`、`homepage` |
| `config/installed_mcps.json` | 用户安装配置（读写） | 结构对齐 Claude Desktop `mcpServers`，便于用户迁移 |

`installed_mcps.json` 格式：

```json
{
  "mcpServers": {
    "github-mcp": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxx" },
      "enabled": true,
      "installed_at": "2026-08-07T20:00:00"
    }
  }
}
```

### 4.3 API 路由（挂入 `main.py`）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mcp/marketplace` | 目录 + 安装/启用/运行状态聚合（含每 server 工具数、error 摘要） |
| POST | `/api/mcp/install` | 安装：校验 plugin_id 存在 + env_schema 必填项齐全 → 写配置 → 拉起进程 |
| POST | `/api/mcp/toggle/{id}` | 启停：改配置 + 池同步 |
| DELETE | `/api/mcp/uninstall/{id}` | 停进程 + 删配置 |
| GET | `/api/mcp/config` | 读 `installed_mcps.json` 原文（**env 值脱敏**：`ghp_***`） |
| PUT | `/api/mcp/config` | JSON 编辑器保存：schema 校验 → 写入 → 池 diff 同步 |
| GET | `/api/mcp/servers/{id}/tools` | 某 server 的工具清单 + 最近 stderr（详情抽屉） |
| GET/PUT | `/api/skills` 扩展 | skill 增加 `enabled` 字段；新增 PATCH 编辑（名称/触发条件/内容） |
| GET/PUT | `/api/plugins` | 内置插件（TOOL_REGISTRY 子集）启停状态读写 |

**安全约束**（对应用户规则）：

- GET 类接口**永不返回完整 env 值**（掩码处理）；PUT 时未修改的掩码字段保留原值。
- JSON 编辑器保存时校验 `command` 白名单（`npx`/`uvx`/`python`/`node`），拒绝任意可执行路径，防命令注入。
- `env_schema` 必填项服务端校验，缺失 422。

### 4.4 工具注入（全模式）

- `App.py` 工具编排处（`TOOL_REGISTRY` → OpenAI tools 数组，约 L4458）改为：**内置 tools + `mcp_pool.all_tool_specs()` 动态合并**，每次请求实时取，启停即时生效。
- 调度分发：`name` 带 `mcp__` 前缀 → `mcp_pool.dispatch()`；否则走原 `TOOL_REGISTRY`。
- code 模式：MCP 工具默认按 `mutation=False` 处理（只读语义），不参与 finalized 门控；若某工具确需写语义后续再加白名单。
- **token 预算护栏**：注入工具的 schema 总字符数设上限（默认 6000 chars，可配），超限时按 server 启用顺序截断并在响应 meta 中提示——防止装 10 个 server 后 system prompt 爆炸。

### 4.4.1 会话级注入过滤（运行设置联动）

- 请求 meta 新增两个字段（随会话持久化，沿用现有 runtime settings 透传链路）：
  - `mcp_mode: "off" | "auto" | "custom"`（默认 `auto`）
  - `mcp_server_ids: list[str]`（仅 custom 生效）
- 过滤逻辑（注入前执行，纯内存操作）：
  - `off` → 不注入任何 MCP 工具，`mcp__*` 调用直接返回"本会话已关闭 MCP"；
  - `auto` → 注入全部全局 enabled 的 server 工具；
  - `custom` → 仅注入 `mcp_server_ids` 白名单内的 server 工具。
- 会话层过滤**不触碰进程池**（server 进程保持常驻），只影响 tools 数组与 dispatch 准入。
- Why：进程冷启动贵（npx 拉包），会话级开关必须零进程成本、即时生效。

### 4.5 Skills / Plugins 后端扩展

- `skill_store.py`：表/记录加 `enabled`（默认 1）；`list_skills` 返回该字段；新增 `update_skill(id, fields)`。`skill_matched` 匹配逻辑过滤 `enabled=0`。
- Plugins：内置清单静态定义（id/名称/描述/对应 TOOL_REGISTRY 工具名/适用模式），启停状态存 `config/plugins_state.json`；agent 编排构建 tools 时按状态过滤。

---

## 5. 前端设计

### 5.1 入口

- `SessionSidebar.tsx`：在「＋ 新建会话」按钮与「历史会话」列表之间插入入口项（图标 `Puzzle` + 文案 "MCP · Skills · Plugins"），点击 `setDirectoryOpen(true)`。
- 遵循 Tailwind 类名规范、函数组件 + Hooks。

### 5.2 `DirectoryModal.tsx`（重写，替代参考稿）

布局对齐截图（Directory）：

```
┌────────────────────────────────────────────┐
│ Directory                            [✕]   │
│ ┌──────────┐  ┌──────────────────────────┐ │
│ │ Skills   │  │ 🔍 Search...  Filter Sort│ │
│ │ Connectors│ │ ┌─────┐ ┌─────┐ ┌─────┐  │ │
│ │ Plugins  │  │ │card │ │card │ │card │  │ │
│ │          │  │ └─────┘ └─────┘ └─────┘  │ │
│ │ [</>JSON]│  │ ...（卡片网格）            │ │
│ └──────────┘  └──────────────────────────┘ │
└────────────────────────────────────────────┘
```

- **Connectors 卡片**：图标/名称/分类徽标/描述（line-clamp-2）/状态（未安装=「＋安装」；已安装=启用开关 + 详情 + 卸载）/运行状态点（ready 绿 / pending 黄 / error 红）。
- **安装流程**：点安装 → 凭证弹窗（按 `env_schema` 渲染表单，password 类型掩码输入）→ 确认 → POST install → 轮询状态至 ready/error。
- **详情抽屉**：工具清单（名称+描述+参数）、最近 stderr、运行指标（重启次数）。
- **Skills 页签**：现有 skill 表格（名称/触发条件/启用开关/编辑/删除），编辑用行内抽屉表单。
- **Plugins 页签**：内置插件卡片 + 启停开关 + 适用模式徽标。
- **JSON 编辑器**：左下 `</>` 按钮切换右区为编辑视图。textarea + 等宽字体 + 行号（轻量自绘，不引入 Monaco）；保存前 `JSON.parse` + 结构校验（mcpServers/command/args 类型），错误行号提示；保存成功 toast + 状态刷新。
- 搜索：名称/描述/分类本地过滤（目录量级小，无需后端搜索）。

### 5.3 API 封装（`lib/api.ts`）

新增 `getMcpMarketplace / installMcp / toggleMcp / uninstallMcp / getMcpConfig / saveMcpConfig / getMcpServerTools / updateSkill / toggleSkill / getPlugins / togglePlugin`，类型全部显式声明（严禁 any）。

### 5.4 运行设置抽屉扩展（`RuntimeSettingsDrawer.tsx`）

在「深度思考」之后新增「MCP 插件」section，复用现有视觉模式：

```
┌─────────────────────────────┐
│ MCP 插件                     │
│ 选择当前会话可用的已安装插件    │
│ ┌──────┬──────┬──────────┐ │
│ │ 关闭  │ 自动  │  自定义   │ │   ← 复用 SegmentedControl
│ └──────┴──────┴──────────┘ │
│ （自定义时展开 chips 多选）：    │
│ [✓ 🐙 GitHub] [🐘 Postgres] │   ← 复用"讨论成员"chip 模式
│ [✓ 🦁 Brave]  [📁 文件系统]  │
│ 未安装插件？→ 打开市场（跳转）  │
└─────────────────────────────┘
```

- 新增 props：`mcpMode: CapabilityMode`、`selectedMcpServerIds: string[]` 及两个 onChange，由 ChatInterface 持有并随会话持久化（与 `webSearch`/`deepThinking` 完全同一链路）。
- chips 数据源：drawer 打开时拉 `GET /api/mcp/marketplace`，仅显示 `is_installed && is_enabled` 的 server；运行状态点（ready/error）一并展示，error 的置灰不可选。
- 「自动」为默认：注入全部全局启用插件；「自定义」仅注入勾选子集；「关闭」本会话不注入。
- code 模式下该 section 同样展示并生效（决策 #1 全模式注入）。

### 5.5 聊天侧反馈（可选增强，本版含最小实现）

- Agent 调用 MCP 工具时复用现有 tool 调用展示链路即可；不新增 SSE 事件类型（`trace.output`/工具调用已有通道）。**Why**：避免动流式协议，降低回归风险。

---

## 6. 对参考实现的优化点（Why 汇总）

1. **同步 → 异步**：阻塞 readline 会冻结 uvicorn 事件循环（SSE 断流前车之鉴）。
2. **`installed_at` 改用真实时间戳**：参考实现误用目录文件 mtime。
3. **凭证脱敏**：参考实现 GET 全量回传 env（含 token），本版掩码。
4. **命令白名单**：JSON 自由编辑必须防任意命令注入。
5. **进程自愈 + 超时**：参考实现一次崩溃即永久失效，调用无超时。
6. **命名空间前缀**：多 server 工具撞名防护。
7. **token 预算护栏**：防工具 schema 膨胀拖垮上下文（与记忆机制 token 预算同一哲学）。
8. **池 diff 同步**：配置变更只重启受影响的 server，而非全量重建。

---

## 7. 任务拆解

| # | 任务 | 产出 | 依赖 |
|---|------|------|------|
| T1 | `mcp_manager.py`：异步进程池 + JSON-RPC + 自愈 + 超时 | 模块 + 单测（假 MCP server 脚本） | — |
| T2 | 配置文件迁移 + catalog 扩充 + 安全校验 | `config/*.json` + loader | — |
| T3 | main.py 挂 8 条 MCP 路由 | API + 集成测试 | T1 T2 |
| T4 | App.py 工具注入与分发（全模式 + 前缀路由 + token 护栏 + **会话级过滤**） | 改造 + 单测 | T1 |
| T5 | skill_store 启停/编辑 + plugins 状态管理 | 后端 + 测试 | — |
| T6 | api.ts 封装 + 类型 | 前端 lib | T3 T5 |
| T7 | DirectoryModal 三页签 + 侧边栏入口 | UI | T6 |
| T8 | 安装凭证弹窗 + 详情抽屉 + JSON 编辑器 | UI | T7 |
| T9 | **RuntimeSettingsDrawer「MCP 插件」section + ChatInterface 状态链路 + meta 透传** | UI + 联调 | T4 T6 |
| T10 | 端到端验证 + 文档收尾 | 验证记录 | 全部 |

---

## 8. 测试思路

- **T1 单测**：写一个 20 行的假 MCP server（stdin 读 JSON-RPC 回固定 tools/echo），验证握手、tools/list、call、超时、崩溃重启计数。
- **T3 集成**：临时目录配置 → install/toggle/uninstall 全链路 → 断言文件与池状态一致。
- **T4 单测**：mock pool 注入 2 个 `mcp__` 工具 → 断言 schema 合并、前缀分发、超预算截断；**会话过滤三态**：off 不注入/custom 只注入白名单/auto 全量。
- **T5**：enabled=0 的 skill 不参与 `skill_matched`。
- **前端**：`tsc --noEmit` 0 error；手动验证安装 github-mcp（mock env）后聊天模式模型能列出并调用工具。

---

## 9. 风险与注意

| 风险 | 缓解 |
|------|------|
| 用户机器无 Node/npx → npx 类 server 全挂 | 安装时预检 `shutil.which`，缺失在 UI 明示「需要 Node.js」 |
| npx 首次拉包慢（数十秒） | install 异步化，状态 pending → ready，UI 轮询进度 |
| 凭证落盘明文 | 本版仅本地单机场景，掩码回显 + `.gitignore`；远期可换系统钥匙串 |
| code 模式工具循环中 MCP 调用慢拖垮生成 | 30s 超时 + token 护栏 + 调用失败结构化返回让模型自恢复 |
| 后端 reload 波及进程池 | 池随 uvicorn 生命周期；`reload_excludes` 无需变（不写 generated/） |
