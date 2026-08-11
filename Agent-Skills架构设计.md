# Agent-Skills 架构设计 & 落地计划书

> 目标：把"Skill"从 code 模式的副产物，升级为**用户可控、按需挂载、渐进披露**的一等能力，
> 同时不破坏现有 mode 体系（standard/deep/web/research/agent/plan/code）中真正有工程价值的重基建。

---

## 0. 核心边界：Skill 能做什么、不能做什么

| 维度 | 适合 Skill 化 | 必须保留为代码（mode / LangGraph） |
| :--- | :--- | :--- |
| 决策与组织逻辑（prompt 层） | ✅ 写作规范、审查清单、追问话术、工具使用指引 | — |
| 确定性工程链路 | — | ✅ 并发抓取、Reranker 打分、向量切片、多智能体状态机、修复循环 |
| Token 成本 | ✅ 渐进披露，命中才加载全文 | — |

**结论：Skill 是"给模型看的操作手册"，mode 是"代码铺好的执行轨道"。**
本计划让两者协作，而非互相替代。standard/deep/web 这类"纯 prompt 差异"可后续收敛为
default mode + 常驻 Skill；research/agent/code 等有真实工程链路的 mode 保留不动。

---

## 1. 顶层依据：五层构成 + 五模式（沿用你的理论框架）

### 1.1 Skill 五层构成（Trigger / Schema / Logic / Context Binding / Policy）

```text
1. Trigger (触发条件)      ──► 意图匹配、规则判断、上下文状态感知
2. Schema (输入输出)       ──► 严格的参数约束与异常码定义
3. Logic (执行逻辑)        ──► 单 API、多步工作流、代码执行或服务编排
4. Context Binding (上下文)──► 记忆、历史、用户档案卡定向注入
5. Policy (策略控制)       ──► 权限拦截、重试、降级、可观测埋点
```

映射到现有 `SkillCapsule`（`skill_store.py`）字段：

| 五层 | 现有字段 | 本期是否动 |
| :--- | :--- | :--- |
| Trigger | `trigger_condition` + `trigger_keywords` | 复用 |
| Schema | `required_params` + `validation_rules` | 复用 |
| Logic | `standard_steps` | 复用 |
| Context Binding | （缺）由 `_build_memory_prompt_suffix` 注入 L2/L3 | 复用现有注入 |
| Policy | （缺）降级/重试未结构化 | **本期仅加 `status` 生命周期** |

> Why 不全量实现五层：现有 `SkillCapsule` 已覆盖 Trigger/Schema/Logic 三层且被
> `match_skills` 两阶段匹配消费。Context Binding 已由记忆系统（profile/summary）承担。
> Policy 的降级/重试属于运行时行为，等 Skill 真正驱动工具调用时再结构化，本期不过度设计。

### 1.2 五模式（Generator/Reviewer/Inversion/Pipeline/Tool Wrapper）的定位

五模式是 **SKILL.md 的"内容组织范式"**，不是五种独立运行时。运行时统一为：
**模型读到 Skill → 自主决定何时用 → 按 standard_steps 组织回答。**

需要运行时代码支撑的仅两种（后续迭代再做，本期不实现 Handler）：
- **Inversion**：缺参时中断流程向用户反问（门控追问）。
- **Pipeline**：步骤间显式 Gate 校验。

> 本期聚焦"人工确认上架 + 三态挂载 + 渐进披露注入"这条主干，五模式作为
> `skill_type` 的语义标签保留（code_pattern/task_flow/fix_template 可后续映射到五模式）。

---

## 2. 现状问题（为什么要改）

当前 Skill 链路（`App.py` code 模式成功回调）：

```text
代码生成成功
  → maybe_create_skill_from_success（同 trigger 连续成功 2 次）
  → 直接 INSERT skill_capsules（enabled=1）
  → /api/memory/skills 全量列出
  → 下次聊天 match_skills 命中即注入 prompt
```

**问题：全程无用户确认。** 自动沉淀的 Skill 直接参与注入，等于"自动上架"。
噪声沉淀（误触发、过时的 fix_template）会持续污染 prompt，用户只能事后删除。

---

## 3. 改造方案（三个决策的落地）

### 决策 1：Skill 上架改为人工确认（pending / published）

引入生命周期状态机：

```text
自动沉淀 ──► pending（待确认，不参与匹配）
              │ 用户在记忆面板点「上架」
              ▼
           published（已上架，参与匹配注入）
              │ 用户点「下架/删除」
              ▼
           回到 pending（软下架）/ DELETE（硬删除）
```

- **DB**：`skill_capsules` 加 `status TEXT NOT NULL DEFAULT 'pending'`
  （`pending` / `published`）。存量数据迁移为 `published`（避免已上线的突然失效）。
- **匹配过滤**：`quick_match` / `match_skills` / `list_skills` 只查
  `status='published' AND enabled=1`。pending 一律不参与注入。
- **接口**（已落地，归一为单接口）：
  - `POST /api/memory/skills/{id}/status`，body `{"status":"published"|"pending"}`
    → 上架 / 下架（软下架回 pending，硬删除走既有 DELETE）
  - `GET /api/memory/skills?status=pending|published` → 按状态过滤
- **前端** `SkillInspector.tsx`：pending 卡片渲染「✓ 上架 / ✗ 丢弃」，
  published 卡片渲染「下架」+ 现有启停开关，并加状态徽标。

### 决策 2：运行设置加 Skill 三态挂载（off / auto / custom）

完全复用 MCP 的三态范式（`session_mcp_allowed` 已是现成模板）：

- `RuntimeSettings` 新增：
  - `skill_mode: Literal["off","auto","custom"] = "auto"`
  - `skill_ids: List[int] = []`（custom 模式下的白名单 skill_id）
- 新增过滤函数（照搬 `session_mcp_allowed`）：

```python
def session_skill_allowed(settings) -> set[int] | None:
    if settings.skill_mode == "off":    return set()      # 一个都不注入
    if settings.skill_mode == "custom": return set(settings.skill_ids)  # 白名单
    return None                                            # auto: 全部 published
```

- 前端 `RuntimeSettingsDrawer.tsx` 在 MCP 区块下方加「Skill 技能」区块：
  三态 SegmentedControl + published Skill 多选列表（含状态点、类型徽标）。
  交互与 MCP 区块完全一致，降低学习成本。

### 决策 3：渐进披露注入（只注入简介，命中才加载全文）

现状 `_build_memory_prompt_suffix` 把命中 Skill 的 `standard_steps` 全文直接拼进
suffix。改造为**两阶段披露**，控制 token：

```text
阶段 1（常驻，便宜）：system prompt 只放 published Skill 的
        skill_name + trigger_condition（约 50 token/条），告诉模型"有这些手册"。
阶段 2（命中才加载）：当用户输入触发某 Skill，match_skills 命中后才把
        standard_steps / validation_rules 全文注入当轮 prompt。
```

- 复用现有 `match_skills` 两阶段匹配（quick_match 关键词预筛 + 可选 LLM 精排）。
- 注入点收敛到 `_build_memory_prompt_suffix`（`App.py`），先按
  `session_skill_allowed(settings)` 过滤候选集，再走 match。
- `skill_matched` SSE 事件保留，前端可视化"本轮加载了哪个 Skill 手册"。

> Why 渐进披露：published Skill 数量增长后，全量注入 standard_steps 会撑爆
> system prompt。只常驻"目录"，正文按需加载，是 Claude Skills 的核心省 token 手段。

---

## 4. day69 工作流的借鉴与取舍

`MCP&Skills/day69_skill_mcp_workflow.py` 用 LangGraph 画了
`规划器 → MCP 发现 → Skill 引擎 → 上下文池` 四步闭环。对其取舍：

- **借鉴**：Skill 绑定策略（policy）、命中降级（fallback_strategy）的思想，
  对应本期 Policy 层的语义标签。
- **不照搬**：demo 把 Skill 引擎做成了独立 LangGraph 节点串行执行。
  本期 Skill 是 **prompt 增强**，嵌在现有聊天流程的注入点里，不新建 LangGraph 图
  （避免与现有 8 种 mode 的图冲突，也符合"纯 prompt 驱动"的选型）。
- **后续**：当要做 Inversion 追问门控 / Pipeline 步骤校验时，再把对应 Skill
  提升为 LangGraph 子图节点，届时 day69 的条件边（`conditional_edges` 闭环）可直接复用。

---

## 5. 改动清单（文件级，含实施状态）

### 后端
| 文件 | 改动 | 状态 |
| :--- | :--- | :--- |
| `skill_store.py` | `SkillCapsule` 加 `status`；建表/迁移加列；`quick_match`/`list_skills`/`match_skills` 过滤 `published` + `allowed_ids` 白名单；新增 `set_skill_status()` | ✅ 已落地 |
| `main.py` | `RuntimeSettings` 加 `skill_mode`/`skill_ids`；新增 `session_skill_allowed()`；新增 `POST /api/memory/skills/{id}/status`；list 接口支持 `?status=`；聊天流程注入点传 `allowed_skill_ids` | ✅ 已落地 |
| `App.py` | `_build_memory_prompt_suffix` 接入 `skill_store` + `allowed_skill_ids` 过滤 | ✅ 已落地 |

### 前端
| 文件 | 改动 | 状态 |
| :--- | :--- | :--- |
| `lib/api.ts` | `SkillCapsule` 类型加 `status`；新增 `setSkillStatus()`；`getSkills` 支持 `status` 过滤；`RuntimeSettings` 类型加 `skill_mode`/`skill_ids` 并透传 | ✅ 已落地 |
| `components/RuntimeSettingsDrawer.tsx` | 新增「Skill 技能」三态区块 + published 多选列表 | ✅ 已落地 |
| `components/SkillInspector.tsx` | pending/published 分组渲染 + 上架/下架/丢弃按钮 + 状态徽标 | ⬜ 待实施（最后一环） |

### 测试
| 文件 | 改动 | 状态 |
| :--- | :--- | :--- |
| `tests/test_memory_engine.py` | 补：pending 不参与 match、publish 后参与、off/auto/custom 三态白名单过滤；既有用例补上架步骤 | ✅ 已落地 |

---

## 6. 验证标准（怎么确认改对了）

1. code 模式连续成功 2 次后，DB 出现 `status='pending'` 的 Skill，但**不出现在**匹配注入里。
2. 记忆面板 Skill 页签看到该 pending 卡片，点「上架」后变 published。
3. 运行设置 Skill 区块：off→完全不注入；auto→所有 published 参与；custom→只勾选的参与。
4. 发送一条命中已上架 Skill 的提问，前端收到 `skill_matched` SSE，且回答体现该 Skill 的 standard_steps；token 上，未命中时 system prompt 只多了"目录"而非全文。
5. `pytest tests/test_memory_engine.py` 全绿。

---

## 7. 不在本期范围（明确划线，防止过度工程）

- Inversion 追问门控 / Pipeline 步骤校验的运行时 Handler（需新建 LangGraph 子图，下期）。
- 五模式与 `skill_type` 的正式映射表（先保留语义标签）。
- Policy 层的结构化降级/重试（等 Skill 真正驱动 MCP 工具调用再做）。
- standard/deep/web 三个 mode 收敛为 default mode + Skill（依赖本期挂载能力稳定后，单独评估）。
