# Agent Loop：工具调用改造全栈生成（方案A）计划书

> 目标：把 `fullstack_generate_stream` 从"模型一次性吐完整 VFS JSON"改造成真正的
> **Agent Loop**——模型思考一个动作 → 调用 `write_file` 等工具实际改文件 → 后端落盘并反馈
> → 再思考下一个动作。让"边写边做"从骨架层彻底实现，而不是靠前端伪装。

---

## 1. 背景与现状

### 1.1 当前痛点
- 生成阶段模型**没有动作边界**：只能一次性输出整个子任务的文件内容 JSON，流式结束后后端才落盘。
- 用户感知"一直思考、不改代码"：子任务调用 `stream_json_completion` 期间，模型只在吐字符
  （`reasoning_content`），没有任何真实文件写入动作。
- "拆解后逐个执行"只是**任务级循环**，子任务内部仍是"一次全吐"。

### 1.2 根因
当前架构是 **"模型产出 → 后端落盘"** 的单次映射，模型没有 `write_file` 这类工具可调用，
因此无法形成"思考 → 动作 → 反馈 → 再思考"的闭环。要真正实现 agent loop，必须引入
**function calling / tool use**。

### 1.3 附带问题（Failed to fetch）
日志显示生成过程中 `WatchFiles` 检测到 `generated/<run_id>/` 落盘文件变化，触发 uvicorn
自动重载，导致 SSE 连接断开 → 前端 `Failed to fetch`。本方案一并修复。

---

## 2. 总体架构

```
fullstack_generate_stream
   │
   ├─ [拆解链] decompose_fullstack_task ──► task_list（现有，保留）
   │
   └─ 每个子任务进入 tool loop：
        stream_tool_loop(client, model, messages, TOOL_REGISTRY, run_id, working_vfs)
            │
            ├─ Model 思考 → 输出 tool_calls（例：write_file("backend/server.py", ...)）
            ├─ dispatch 校验 → 落盘 generated/<run_id>/ + 更新 working_vfs
            ├─ yield file_written / code_update / task_update（前端实时可见）
            ├─ 把工具结果回灌给 model ──────┐
            │                              │
            └── 循环直到 finalize 或达到 max_rounds ─────────┘
```

- **真实落盘发生在工具执行时**，每一个 `write_file` 都立即写入磁盘并推送 SSE，用户实时看到文件诞生。
- 模型可以自主选择调用 `read_file` / `get_contract` / `validate_project` 等辅助工具来决定下一步，
  体现"Agent 自己根据情况调用"。

---

## 3. 工具集合设计（TOOL_REGISTRY）

### 3.1 抽象

所有工具封装为一个统一注册表 `TOOL_REGISTRY`，供 tool loop 和前端一起消费：

```python
# 类型定义（严格，不 any 化）
class ToolParam:
    name: str
    type: str            # "string" | "integer" | "boolean" | "object" | "array"
    description: str
    required: bool
    enum: list[str] | None = None
    items: "ToolParam | None" = None       # 当 type=="array" 时

class ToolSpec:
    name: str
    description: str
    parameters: list[ToolParam]            # 内部用，便于校验
    handler: Callable[..., Awaitable[dict]]  # async 实现，返回统一结果 dict
    mutation: bool                          # True=会改动文件，必须记录/校验
    allowlist_only: bool                    # True=只允许写白名单路径

    def to_openai_schema(self) -> dict: ...  # 生成 OpenAI function calling schema
```

- `to_openai_schema()` 把 `ToolParam` 转成 OpenAI 的 `{type:"function", function:{name, description, parameters}}`。
- `dispatch_tool(name, args, context)` 负责：查表 → 参数强校验 → 调用 handler → 归一化返回 `{"ok":bool,"report":str,"payload":...}`。

### 3.2 工具清单（种类丰富，覆盖生成/修改/契约/校验/执行）

| 工具名 | 作用 | 是否允许改文件 | 是否必须 |
|--------|------|----------------|----------|
| `write_file` | 创建或覆盖一个文件（完整内容） | 是 | **是** |
| `patch_file` | 对已有文件做精确片段补丁（replace/insert_after/delete） | 是 | **是** |
| `delete_file` | 删除一个文件 | 是 | 是 |
| `set_database` | 写入 `backend/database.json`（JSON 对象，值为含数字 id 的数组） | 是 | 是 |
| `read_file` | 读取一个文件供参考 | 否 | 否 |
| `list_files` | 列出项目目录结构 | 否 | 否 |
| `get_contract` | 查询当前路由/数据库字段/前端 fetch 的契约摘要（供对齐） | 否 | 否 |
| `validate_project` | 校验 VFS 是否满足全栈契约（5 必需文件 + JS 语法 + 数据库结构） | 否 | 推荐 |
| `run_terminal` | 执行安全的白名单终端命令（如启动后端） | 否 | 否 |
| `finalize` | 声明本子任务/整个项目完成，返回 intent+summary，结束 loop | 否 | **是** |

### 3.3 各工具 schema（OpenAI function calling 格式）

```json
{
  "type": "function",
  "function": {
    "name": "write_file",
    "description": "创建或覆盖项目中的一个文件。必须是相对 POSIX 路径（frontend/…、backend/…），禁止绝对路径、.. 或 . 段。content 为该文件完整内容。",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {"type": "string", "description": "相对文件路径，如 backend/server.py"},
        "content": {"type": "string", "description": "文件完整内容，必须用真实换行分隔代码行，JS // 注释独占一行"}
      },
      "required": ["path", "content"]
    }
  }
}
```

`patch_file`：
```json
{
  "name": "patch_file",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {"type": "string"},
      "operations": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "op": {"type": "string", "enum": ["replace", "insert_after", "delete","new_file","delete_file"]},
            "target": {"type": "string", "description": "从当前文件逐字复制的唯一锚点片段"},
            "file": {"type": "string"},
            "content": {"type": "string"}
          },
          "required": ["op"]
        }
      }
    },
    "required": ["path", "operations"]
  }
}
```

`set_database`：
```json
{
  "name": "set_database",
  "parameters": {
    "type": "object",
    "properties": {
      "data": {"type": "object", "description": "database.json 内容，如 {\"products\":[{\"id\":1,...}]}"}
    },
    "required": ["data"]
  }
}
```

`finalize`：
```json
{
  "name": "finalize",
  "parameters": {
    "type": "object",
    "properties": {
      "intent": {"type": "string", "enum": ["patch","fullstack_bootstrap","answer"]},
      "summary": {"type": "string", "description": "1~3 段中文，说明生成/修改了哪些文件、实现什么"},
      "terminal_commands": {"type": "array", "items": {"type": "object"}}
    },
    "required": ["intent","summary"]
  }
}
```

`run_terminal` 的 `command` 参数必须通过 `trusted_prefixes`/正则白名单校验（见 §5.3），禁止删库、`rm -rf`、写系统目录、`curl | bash` 等。

---

## 4. tool_calling 循环实现

### 4.1 核心循环 `stream_tool_loop`

```python
async def stream_tool_loop(
    client: Any, model: str, messages: list[dict],
    review: ToolExecutionContext,   # run_id / working_vfs / terminal_pool / workspace / sse 收集器
    max_rounds: int = 24,
    max_tokens: int = 8_000,
) -> tuple[dict, list[str]]:
    """运行 Agent 工具循环，返回 (最终 envelope, 要 yield 的 SSE 事件)。"""
    sse: list[str] = []
    tools = [t.to_openai_schema() for t in TOOL_REGISTRY.values()]
    for _round in range(max_rounds):
        resp = await client.chat.completions.create(
            model=model,
            messages=messages,
            tools=tools,
            tool_choice="auto",          # 允许模型自主决定用不用工具
            stream=False,                # 工具循环每轮等结果，流式收益低；动作本身已实时落盘
            temperature=0.2,
            max_tokens=max_tokens,
            extra_body={"thinking": {"type": "enabled", "reasoning_effort": "high"}},
        )
        msg = resp.choices[0].message
        tool_calls = getattr(msg, "tool_calls", None) or []
        if tool_calls:
            messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [
                {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in tool_calls
            ]})
            for tc in tool_calls:
                result = await dispatch_tool(tc.function.name, tc.function.arguments, review)
                sse += result["sse"]                       # file_written / task_update / code_update
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result["report"], ensure_ascii=False)})
            continue
        # 无 tool_call：如果是 finalize 已记录，或纯文本总结，结束
        final_text = msg.content or ""
        if final_text:
            return review.envelope or normalize_final(final_text), sse
        break
    # 超轮次兜底：强制校验，不完整则标记
    review.force_close()
    return review.envelope, sse
```

### 4.2 关键点
- **每个工具调用立即落盘 + 推送 SSE**：`dispatch_tool` 内部执行 `_auto_archive_generated_vfs`，
  并 yield `file_written`（含 path）+ `code_update`（当前 working_vfs 全量）+ `task_update`。
- **工具结果回灌**：`{"role":"tool","tool_call_id":id,"content":report}`，模型据此决定下一步。
- **终止条件**：出现无 `tool_calls` 的正文（通常是 `finalize` 的确认），或 `max_rounds` 上限。
- **思考下沉到每个动作**：每轮模型只决定"这一个动作"，做完即反馈，天然"边想边做"。

### 4.3 SSE 事件流（前端可见的"边写边做"）
```
task_update   in_progress
file_written  path=backend/server.py            ← 每写一个文件实时出现
code_update   当前 working_vfs（递增）
task_update   completed
```
前端 `CodeWorkspace` 监听 `file_written` 在文件树实时高亮，体现逐文件落盘。

---

## 5. 强制规则与安全（严格）

### 5.1 代码修改/编写必须走工具
- 在 tool loop 的 system prompt 注入硬约束：
  > "你**必须**通过调用 `write_file` / `patch_file` / `delete_file` / `set_database` 来实际修改文件。
  > 禁止在正文里直接输出文件内容冒充已写入；不调用工具的文件内容一律视为未生效。"
- 后端兜底：loop 结束后若 `validate_project` 不通过（5 必需文件缺失/不完整），标记失败并回退单步生成。

### 5.2 路径与体积校验（handler 内强制）
- 路径必须通过 `_safe_vfs_relative_path`（复用现有）：相对、POSIX、禁止 `..`/`.`、禁止绝对路径。
- 只允许写入 `generated/<run_id>/` 白名单根，禁止逃逸到工程根或其他目录。
- 单文件大小 ≤ `MAX_VFS_FILE_LENGTH`，总大小 ≤ `MAX_VFS_TOTAL_LENGTH`，文件数 ≤ `MAX_VFS_FILES`。

### 5.3 终端命令白名单
- `run_terminal` 仅允许：`npm/pip install`、`lint`、`unit test`、`build`、`format`、端口探测、
  以及启动本子项目后端（`cd backend && python server.py` 等）。
- 复用现有 `trusted_prefixes` 机制 + 黑名单正则（`rm -rf`、`curl|bash`、写系统敏感目录、重启生产服务）。

### 5.4 循环防失控
- `max_rounds` 上限 + 每轮 `max_tokens` 上限。
- 工具参数 JSON 解析失败 → 把错误回灌给模型并重试一次，仍失败则终止该轮。
- `finalize` 只能触发一次，之后拒绝再执行写文件工具。

---

## 6. 与现有链路对接

- **复用**：`_safe_vfs_relative_path`、`_auto_archive_generated_vfs`、`validate_fullstack_vfs`、
  `validate_vfs_javascript`、`_fix_content_newlines`、`resolve_agent_terminal_commands`。
- **落盘时序**：工具执行即落盘（先于终端提案），维持上一轮修好的"先落盘再执行命令"。
- **终端提案**：`finalize` 返回的 `terminal_commands` 走现有 `resolve_agent_terminal_commands` 审批链。
- **拆解链**：保留 `decompose_fullstack_task`，每个子任务跑一个独立 `stream_tool_loop`，
  子任务间共享 `working_vfs` 与 `run_id`。

---

## 7. 修复 Failed to fetch（自动重载误伤）

- **根因**：`uvicorn --reload`（WatchFiles）监控到 `generated/<run_id>/` 落盘变化，触发整个 App 重启，
  断开正在进行的 SSE。
- **方案**：在 uvicorn 启动参数里把 `generated/` 排除出 reload 监控（`--reload-dir App.py 工程根` +
  忽略 `generated/`），或加载 `uvicorn.run` 时设置 reload_includes 排除。见 `main.py` 启动段。
- 这样生成过程写文件不再触发重载，SSE 不断连。

---

## 8. 风险与回退

| 风险 | 影响 | 缓解 |
|------|------|------|
| GLM tool_calls 格式不稳定 | 解析失败卡循环 | 容错解析 + 错误回灌重试 + max_rounds |
| 模型不调用代码工具直接输出 | 文件不落地 | system 硬约束 + 结束校验强制回退 |
| 工具参数被 max_tokens 截断 | 写文件失败 | 增大 max_tokens + 参数解析失败重试 |
| 循环无限 | 卡死 | max_rounds 硬上限 |
| 前后端子任务契约不一致 | 校验失败 | get_contract 工具 + 结束 validate_project |
| 落盘触发 reload | 断连 | §7 排除 generated/ |

回退策略：tool loop 失败或产物不完整 → 自动回退到现有"单步生成"路径，保证功能可用。

---

## 9. 实施步骤（增量，每步可验证）

1. **Step1** 定义 `ToolParam` / `ToolSpec` 类型与 `TOOL_REGISTRY` 数据（含 `to_openai_schema`）。
   - 产出：纯数据结构 + 单测。
2. **Step2** 实现 `dispatch_tool`：schema 校验、handler 分发、返回归一化结果。
   - 产出：可单测的调度层。
3. **Step3** 实现 `stream_tool_loop` 核心循环（含 SSE 收集、终止、超轮兜底）。
   - 产出：mock client 驱动的循环单测（模拟 tool_calls 序列）。
4. **Step4** 接入 `fullstack_generate_stream`：替换单次/拆解分支为 tool loop。
   - 产出：端到端生成走真工具循环。
5. **Step5** 前端对接 `file_written` 事件，文件树实时高亮。
6. **Step6** 修复 Failed to fetch（reload 排除 generated/）。
7. **Step7** 端到端验证：商城系统生成，观察逐文件落盘 + 无断连。

---

## 10. 测试思路

- **工具校验**：合法/非法路径（绝对、`..`、逃逸白名单）、超大小、非法 JSON Schema。
- **dispatch**：已注册/未注册工具、参数缺失、handler 抛错 → 归一化 `{"ok":false,"report":...}`。
- **循环**：mock AsyncOpenAI，依次返回 `[write_file, read_file, write_file, finalize]` 断言
  工具被依次执行、结果回灌、正确终止；返回无限 tool_calls 时断言 `max_rounds` 截断。
- **强制规则**：mock 模型只回正文不调工具 → 断言结束校验把状态标记为失败并回退。
- **端到端**：真实 GLM 生成商城，断言 `generated/<run_id>/` 具备 5 必需文件、SSE 无断连。