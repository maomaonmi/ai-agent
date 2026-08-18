---
name: ai-pre-code-review
description: 在 tasks 生成后、apply 之前，使用 GitNexus code graph 校验 design/tasks 是否贴合真实代码结构，识别影响范围遗漏和模块归属错误，并按用户确认后将修正写入 artifacts。GitNexus 不可用时自动降级为只读建议模式。
version: 2.0.0
updated: 2026-06-15
author: 严灿平

---

# 代码图谱校准 (ai-pre-code-review)

在 design/tasks 已生成后、apply 之前，借助 GitNexus MCP 工具对当前 change 做一次
"代码现实校准"——用真实代码结构验证设计假设，发现偏差后直接修正 artifacts。

---

## 触发方式

以下方式均可触发本技能：

- `/ai-pre-code-review`
- `/ai-pre-code-review <change-name>`
- "请做一次代码图谱校准"
- "在 apply 之前用 code graph 检查当前 change"

---

## 步骤

### 1. 定位 change

如果用户指定了 change 名称，直接使用；否则：

```bash
openspec list --json
```

如果只有一个活跃 change，自动选中；多个则提示用户选择。

确认后运行：

```bash
openspec status --change "<name>" --json
```

**前置检查**：tasks artifact 必须已存在。若缺失，提示用户先运行 `/ai-tasks-change <change-name>` 或 `openspec-continue-change tasks` 补全。

### 2. 加载 change artifacts

```bash
openspec instructions apply --change "<name>" --json
```

读取返回的 `contextFiles` 中全部文件（proposal、specs、design、tasks）。
重点提取：

- design 中声明的 **模块列表** 和 **模块职责描述**
- design 中的 **调用链 / 时序 / 数据流**
- tasks 中的 **每一条任务**（解析 checkbox 行）

### 3. 用 GitNexus 校验模块归属

先读取工作区根 `project-profile.yaml`，根据当前 change 的 scope、design/tasks 中的文件路径或模块归属推断 GitNexus `repo` 参数：
- 若任务涉及明确文件路径，取该路径所属的 `repositories[].path` 对应 `gitnexus_index`
- 若只有 scope，取该 scope 绑定的 `repositories[]` 中对应仓库
- 若仍无法唯一确定，先列出候选仓库并要求人工确认，不得省略 `repo`

对 design 中涉及的每个模块 / 类 / 服务名，使用 GitNexus 查询真实代码结构：

```
gitnexus_query({ query: "<模块名或关键词>", repo: "<repo>" })
```

目的：

- 该模块 / 类 / 包是否真实存在
- 实际代码位置 (文件路径) 是否与 design 描述一致
- 是否遗漏了中间适配层、共享服务、公共工具类

如果 query 结果不够精确，用 context 获取 360° 视图：

```
gitnexus_context({ name: "<具体符号名>", repo: "<repo>" })
```

### 4. 用 GitNexus 评估影响范围

对 tasks 中每条任务涉及的核心符号，运行影响分析：

```
gitnexus_impact({ target: "<符号名>", direction: "upstream", repo: "<repo>" })
```

关注：

- d=1 (WILL BREAK) 的直接调用者是否在 tasks 中有对应处理
- d=2 的间接依赖是否涉及共享模块（如项目公共服务包、缓存层、底座 utils 等；具体可参考 .ai-sdd/context/engineering/ 中记录的共享模块列表）
- 是否有非本需求路径会被波及

#### 4.1 可选：下游影响分析（涉及接口/枚举/契约变更时执行）

> 仅在以下场景执行 `direction: "downstream"`：
> 1. 任务涉及公共接口方法签名变更（增/删/改参数、返回类型）
> 2. 任务涉及共享枚举/常量/字段常量类修改
> 3. 任务涉及路由/服务编码调整
> 4. 任务涉及 OUTBOUND/INBOUND 外部协议字段映射

执行命令：

```
gitnexus_impact({ target: "<符号名>", direction: "downstream", repo: "<repo>" })
```

关注：

- 直接被调用者（d=1）是否全部在 tasks 覆盖范围
- 是否有跨仓库依赖未在 design/tasks 中登记
- 涉及共享组件（CSF/components）仓库时，必须在 `review-notes.md` 登记下游影响清单

不涉及上述场景的纯内部实现任务可跳过 4.1 步骤。

如果需要沿调用链追踪，可补充 cypher 查询：

```
gitnexus_cypher({ query: "MATCH (a)-[:CALLS]->(b {name: '<符号名>'}) RETURN a.name, a.file", repo: "<repo>" })
```

### 5. 交叉检查：tasks vs 影响范围

将第 3–4 步的发现与 tasks 做交叉比对，识别以下问题：

| 问题类型 | 描述 |
|----------|------|
| **遗漏任务** | impact 发现 d=1 调用者需要更新，但 tasks 中没有对应项 |
| **模块归属错误** | design 把职责分配给了错误的模块（代码中实际由另一个模块负责） |
| **影响范围低估** | task 标注为"局部修改"，但实际影响共享模块 |
| **多余任务** | design 新增了模块/接口，但 code graph 显示已有可复用能力 |
| **缺少回归测试** | 修改涉及共享接口/公共 DTO，但无回归测试任务 |

### 6. 输出校准报告

输出一份简洁的校准报告，包含：

**结论等级**（必须首先给出）：

- **绿色** — design/tasks 与代码现实基本一致，可直接 apply
- **黄色** — 存在遗漏或偏差，需要修正后再 apply
- **红色** — 模块归属 / 影响范围有重大错误，必须先修正

**发现列表**（仅列出有问题的项，没问题的不列）：

每条发现格式：
> `[类型] 描述`
> - 证据：GitNexus 查询结果摘要
> - 建议：具体修正动作

### 7. 修正 artifacts（黄色/红色时执行）

如果结论为黄色或红色，**必须先生成修正草案并征得用户同意，再写入** `design.md` / `tasks.md`：

**7.1 准备修正草案**

针对每条发现，整理出待写入的具体修改：

- **补充遗漏的 task**：在 tasks.md 中新增 `- [ ]` 条目
- **修正模块归属**：更新 design.md 中的模块职责描述
- **补充回归测试 task**：为受影响的共享模块添加测试任务
- **删除多余 task**：如果已有可复用能力，移除不必要的新建任务
- **标注风险**：在 design.md 相关段落添加 `> ⚠️ 高风险` 提示

每条草案展示为：`<目标文件>:<段落/行号> | <动作 add/modify/delete> | <证据> | <修改文本>`。

**7.2 用户确认门**

按需读取 `assets/templates/repair-confirm.md`，调用 ask-questions 工具向用户展示修正草案与选项。

**7.3 写入与摘要**

- 仅写入用户确认通过的条目，未通过的写入"建议项"清单（不入 artifact）。
- 写入完成后，输出修改摘要（改了什么、为什么改、跳过哪些、原因）。
- 用户选择"全部不应用"时不写入任何 artifact，仅输出报告。

**7.4 GitNexus 不可用降级**

若 Step 2-5 任一 GitNexus 调用因 MCP 不可用而失败：

- 在结论中明确标注 `⚠️ GitNexus 不可用，本次校准为降级模式（仅静态文档对比）`。
- **降级模式下禁止自动修正 artifacts**，仅输出建议清单供用户人工核对。
- 跳过 7.2 确认门，直接给出建议但不进入写入流程。

---

## GitNexus 工具速查

| 工具 | 用途 | 本技能中的使用场景 |
|------|------|--------------------|
| `gitnexus_query` | 按概念搜索代码 | 验证 design 中的模块是否存在 |
| `gitnexus_context` | 符号 360° 视图 | 查看模块的调用者/被调用者/参与流程 |
| `gitnexus_impact` | 影响范围分析 | 评估 task 修改的 blast radius |
| `gitnexus_cypher` | 自定义图查询 | 追踪特定调用链 |

> 多仓库项目中，以上所有 GitNexus 调用都必须带 `repo` 参数；`repo` 由 AI 根据当前 change 的 scope/文件路径从 `project-profile.yaml` 推断。

---

## 重要规则

1. **不得仅凭 code graph 推翻业务上下文**——如果 code graph 与 `.ai-sdd/context` 文档冲突，必须显式指出冲突并标记为"待人工确认"，不得擅自裁决。
2. **共享模块影响不可忽略**——d=1 调用者涉及共享服务时，必须补任务或补回归测试。
3. **遵循 config.yaml 核心约束**——"复用 > 修改 > 新增"优先级同样适用于校准建议。
4. **无法确认的标"待确认"**——不假设、不猜测。
5. **修正 artifacts 时保持最小改动**——只改有证据支撑的部分，不做额外"优化"。


<!-- skills-platform-usage-reporting -->
## Usage Reporting

When this Skill is selected for a real task and the MCP tool `report_skill_invocation` is available, call it once at the start with:

```json
{
  "skillCode": "ai-pre-code-review",
  "agentName": "qoder",
  "installTarget": "qoder",
  "installScope": "project",
  "workspace": "d:\\IdeaProjects\\newpoj",
  "invocationStatus": "STARTED",
  "sourceChannel": "MCP_CALLBACK"
}
```

Do not block the user's task if the reporting tool is unavailable or the callback fails.