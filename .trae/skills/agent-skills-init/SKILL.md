---
name: "agent-skills-init"
description: "自动更新维护数字分身初始化技能"
---

# 技能下载与更新机制（公共）

本流程供所有分身共用，基于 MCP `mcp_skillshub` 实现技能的增量下载与更新。

## 前置条件

- MCP `mcp_skillshub` 可用
- 当前工程根目录已知

## 流程

### Step 1：读取技能注册表

读取 `.trae/skills/agent-skills-init/agent-skill-registry.yaml`，按当前分身标识（如 `agent-xxx`）查找所需技能列表。

若注册表文件不存在或分身标识未注册，**必须暂停并提示用户**，不可跳过下载步骤。

### Step 2：增量更新（优先）

调用 `update_skill`（server: `mcp_skillshub`），使用 `filter` 按技能名称批量匹配：

```json
{
  "filter": { "skillName": "<技能名称前缀或全名>" },
  "baseDir": "<工程根目录绝对路径>",
  "dirs": [".trae"],
  "subDir": "skills",
  "concurrency": 5
}
```

> **注意**：`skillIds` 参数仅接受服务端数字 ID，不接受技能名称。注册表中记录的是技能名称，因此必须使用 `filter.skillName` 按名称模糊匹配下载。若分身技能名称有统一前缀（如 `ca-`），可一次 `filter` 批量匹配；否则需逐个技能名称调用。

`update_skill` 会自动对比本地清单 `~/.skillshub/manifest.json` 与服务端 `updateTime`，仅下载变更或缺失的技能，跳过未变更的。

### Step 3：入口技能优先加载

若该分身有 `entry_skill`（非 null），优先确保入口技能已下载，然后读取其 SKILL.md 并按指引执行。

入口技能可能指引下载更多技能（如 `sdd-requirement-workflow` 的 Step 1 列出额外技能），此时以入口技能的指引为准，注册表中的列表作为完整性校验。

### Step 4：全量兜底（仅在增量失败时）

若 `update_skill` 调用失败（MCP 不可用、网络错误等），回退到 `download_skills_parallel` 全量下载，同样使用 `filter` 按名称匹配：

```json
{
  "filter": { "skillName": "<技能名称前缀或全名>" },
  "baseDir": "<工程根目录绝对路径>",
  "dirs": [".trae"],
  "subDir": "skills",
  "overwrite": true,
  "concurrency": 5
}
```

### Step 5：验证

扫描 `.trae/skills/` 目录，确认注册表中所有技能的 SKILL.md 均存在。缺失的技能单独重试下载。

若重试后仍缺失，列出缺失技能清单并提示用户，**不阻塞后续流程**（已下载的技能可正常使用）。

## 分身 prompt 引用方式

在各分身的 prompt 文件中，按以下格式引用本流程：

```
【技能下载与更新】
按 `.trae/skills/agent-skills-init/skill-download-procedure.md` 执行技能下载与更新，分身标识为 `agent-xxx`。
入口技能为 `yyy`（无入口技能则写"无入口技能，直接按注册表技能列表下载"）。
```

## 新增分身接入步骤

1. 在 `agent-skill-registry.yaml` 中添加分身记录（`agent-xxx`、name、entry_skill、skills）
2. 在分身 prompt 文件中添加上述引用段落
3. 无需修改本文件或其他分身 prompt
