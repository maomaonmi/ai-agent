# Agent Loop 状态机与 Prompt 模板设计

## 1. AgentState 数据结构

```python
from pydantic import BaseModel, Field
from typing import Literal


class ToolCallRecord(BaseModel):
    """单次工具调用记录。"""
    iteration: int
    tool_name: str
    tool_input: dict
    tool_output_summary: str
    elapsed_ms: int
    success: bool


class Observation(BaseModel):
    """单次 Observation，作为下一轮 LLM 的上下文。"""
    iteration: int
    tool_name: str
    summary: str          # 给 LLM 看的精简摘要（控制 token）
    payload: dict         # 原始结果，用于最终报告拼接与持久化


class AgentState(BaseModel):
    """Agent Loop 运行时状态。

    Why 用 Pydantic：后端已在 FastAPI/Pydantic 生态中，天然支持校验、序列化、
    持久化到 SessionSnapshot；同时避免用 any 字典导致字段漂移。
    """
    iteration: int = 0
    messages: list[dict] = Field(default_factory=list)
    observations: list[Observation] = Field(default_factory=list)
    tool_history: list[ToolCallRecord] = Field(default_factory=list)
    final_answer: str | None = None
    final_reasoning: str | None = None
    max_iterations: int = Field(default=5, ge=1, le=12)
    is_terminated: bool = False
    termination_reason: Literal["final_answer", "max_iterations", "error"] | None = None
    total_elapsed_ms: int = 0

    # 护栏
    single_tool_timeout_sec: int = 30
    total_timeout_sec: int = 600
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `iteration` | 当前轮次，从 1 开始。 |
| `messages` | 符合 OpenAI Chat Completions 格式的对话历史，包括 `system`、`user`、带 `tool_calls` 的 `assistant`、`tool`。 |
| `observations` | 每轮工具返回的 observation，供后续轮次引用。 |
| `tool_history` | 工具调用审计日志，用于事件 extras 与问题排查。 |
| `final_answer` / `final_reasoning` | 终止时的最终答案与推理摘要。 |
| `max_iterations` | 最大迭代轮次，默认 5，上限 12。 |
| `termination_reason` | 终止原因，用于前端展示与降级决策。 |
| `total_elapsed_ms` | 累计耗时，用于总超时判断。 |

---

## 2. ReAct 输出格式选择

**最终选择：选项 B —— Function Calling schema。**

### 理由

1. **原生兼容 OpenAI 兼容 API**：项目后端调用的是 OpenAI Chat Completions 协议，`tools` / `tool_choice` / `tool_calls` 是标准字段，无需手写 XML 解析器。
2. **结构化与可校验**：Function Calling 返回的是 JSON 参数，可直接用 Pydantic schema 校验，避免 XML 标签嵌套、转义、模型漏标签等问题。
3. **与现有代码风格一致**：后端已大量使用 Pydantic BaseModel 做请求/响应校验，工具 schema 直接用 JSON Schema 描述即可复用。
4. **前端事件解析更简单**：`tool_name` + `arguments` 天然对应事件里的 `tool_name` / `tool_input` 字段，无需从 XML 中提取。

### 降级策略

若某模型 Function Calling 质量差（本地小模型常见），可在调用层切换为 **forced JSON schema**：
- 关闭 `tools`，在 system prompt 里要求模型输出 JSON：`{"thought": "...", "action": {"name": "...", "arguments": {...}}}`。
- 后端用 `response_format={"type": "json_object"}` 或 JSON mode 强制解析。

该降级对上层 Agent Loop 透明，只需替换 `parse_llm_response()` 实现。

---

## 3. 工具 Schema 定义

所有工具参数使用 Pydantic 模型，运行时转换为 OpenAI Function schema。

```python
class WebSearchInput(BaseModel):
    queries: list[str] = Field(min_length=1, max_length=8)
    top_n: int = Field(default=10, ge=1, le=20)

class WebSearchOutput(BaseModel):
    results: list[dict]  # [{title, url, snippet, score?}]


class FetchInput(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=10)
    max_chars_per_page: int = Field(default=4000, ge=500, le=12000)

class FetchOutput(BaseModel):
    pages: list[dict]  # [{title, url, markdown, content}]


class ChunkInput(BaseModel):
    pages: list[dict]
    max_chunk_size: int = Field(default=800, ge=200, le=2000)
    overlap: int = Field(default=100, ge=0, le=400)

class ChunkOutput(BaseModel):
    chunks: list[dict]  # [{id, text, url, title}]


class RerankInput(BaseModel):
    query: str = Field(min_length=1)
    chunks: list[dict] = Field(min_length=1)
    top_n: int = Field(default=10, ge=1, le=20)

class RerankOutput(BaseModel):
    top_chunks: list[dict]  # [{id, text, url, title, score}]


class FinalAnswerInput(BaseModel):
    answer: str = Field(min_length=1)
    reasoning: str = Field(default="")
    citations: list[dict] = Field(default_factory=list)
```

### 工具注册表

```python
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "执行关键词搜索，返回网页标题、URL 和摘要。适合在需要发现新来源时使用。",
            "parameters": WebSearchInput.model_json_schema(),
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch",
            "description": "抓取指定 URL 的完整页面内容。适合在 search 返回的 snippet 不够充分时使用。",
            "parameters": FetchInput.model_json_schema(),
        },
    },
    {
        "type": "function",
        "function": {
            "name": "chunk",
            "description": "对 fetch 得到的页面内容进行语义切片。",
            "parameters": ChunkInput.model_json_schema(),
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rerank",
            "description": "对切片结果按与用户问题的相关性重排，返回精选片段。",
            "parameters": RerankInput.model_json_schema(),
        },
    },
    {
        "type": "function",
        "function": {
            "name": "final_answer",
            "description": "当信息已足够回答用户问题时，调用此工具输出最终答案并结束循环。",
            "parameters": FinalAnswerInput.model_json_schema(),
        },
    },
]
```

### 工具与原有 pipeline 的映射

| 工具 | 复用函数 | 说明 |
|------|---------|------|
| `web_search` | `generate_sub_queries` + `fetch_mass_web_pages`（仅标题/摘要） | 保留搜索逻辑，但只返回轻量结果。 |
| `fetch` | `fetch_mass_web_pages` | 对指定 URL 做完整抓取。 |
| `chunk` | `chunk_documents` | 对 fetch 结果切片。 |
| `rerank` | `batch_rerank_chunks` | 对 chunks 重排。 |
| `final_answer` | 新终止器 | 触发循环退出，最终报告可用 `run_day33_deep_thinking_research` 润色。 |

---

## 4. System Prompt 模板

```markdown
You are a deep research agent. Your job is to help the user with complex, multi-step research questions.

You work in a loop of: Think → Action → Observe → Decide.

Rules:
1. Every turn you MUST first reason in `<thought>` about what you already know, what is missing, and what to do next.
2. After your thought, you MUST call exactly ONE tool via function calling.
3. Available tools: web_search, fetch, chunk, rerank, final_answer.
4. If the user's question is simple and already answered by your knowledge, call final_answer directly.
5. If you need more evidence, prefer calling web_search first; if search snippets are insufficient, use fetch to read full pages, then chunk and rerank to extract the best evidence.
6. You can iterate multiple times. Each iteration should make progress toward the answer.
7. When you have enough reliable information, call final_answer with a comprehensive, well-cited answer.
8. Do not call final_answer with placeholder text. The answer must be complete and useful.
9. If you reach the iteration limit without enough information, still call final_answer with the best answer you can provide and note the limitation.

Output format:
- Always output a `<thought>` first.
- Then make exactly one function call.
```

### Why 这么设计

- **强制 thought 在前**：满足 ReAct 的可观测性要求，前端可以展示每轮推理。
- **单工具调用**：降低循环复杂度，避免并行工具带来的状态合并问题。
- **final_answer 也是工具**：统一用 Function Calling 处理，终止条件就是 `tool_name == "final_answer"`。

---

## 5. 循环控制流程

```
初始化 AgentState
  ├─ messages ← [system, user(query)]
  ├─ iteration ← 0
  └─ max_iterations ← 5

循环：iteration < max_iterations 且未终止
  │
  ├─ iteration += 1
  │
  ├─ 发射 event: iteration_N_think / running
  ├─ LLM 调用（messages + tools）
  ├─ 解析 response：提取 thought + tool_call
  ├─ 发射 event: iteration_N_think / completed
  │       extras: thought_snippet
  │
  ├─ 判断 tool_name
  │   │
  │   ├─ final_answer
  │   │   ├─ 发射 event: iteration_N_final / running
  │   │   ├─ 设置 final_answer / final_reasoning
  │   │   ├─ 标记 is_terminated = true
  │   │   ├─ 发射 event: iteration_N_final / completed
  │   │   └─ break
  │   │
  │   └─ web_search / fetch / chunk / rerank
  │       ├─ 发射 event: iteration_N_search / running
  │       │       extras: tool_name, tool_input
  │       ├─ 执行工具（带 30s 超时）
  │       ├─ 发射 event: iteration_N_search / completed
  │       │
  │       ├─ 发射 event: iteration_N_observe / running
  │       ├─ 格式化 observation，追加到 messages/state
  │       └─ 发射 event: iteration_N_observe / completed
  │               extras: observation_summary
  │
  └─ 检查总超时 600s，若超限则 termination_reason = "error" 并 break

循环结束
  ├─ 若未终止且未到 final_answer：
  │   └─ 强制调用一次 final_answer（best effort）
  ├─ 发射最终事件：done + research_reason_done
  └─ 记忆落账（同现有 generate_deep_research_events）
```

### 终止条件

1. LLM 调用 `final_answer` → 正常终止。
2. `iteration >= max_iterations` → 强制最终答案后终止。
3. 总耗时超过 600s → 错误终止。
4. 连续解析失败达到 2 次 → 错误终止。

### 错误处理

| 场景 | 处理 |
|------|------|
| 工具执行超时（30s） | observation 里说明超时，LLM 决定是否重试或换工具。 |
| 工具执行异常 | observation 里带错误摘要，不中断循环。 |
| LLM 输出无法解析 | 重试一次，并提示 "请严格使用 function calling 格式"；仍失败则 termination_reason="error"。 |
| 总超时 600s | 立即中断循环，返回当前 best effort 结果或错误事件。 |
| 单轮超时但非总超时 | 仅把该轮标记为失败 observation，循环继续。 |

---

## 6. 事件发射点

所有事件使用 SSE `research_process`，与前端 `ResearchProcessEvent` 契约对齐。

### 事件字段

```python
{
    "stage": "iteration_N_think",   # 或 search / observe / final
    "status": "running",             # 或 completed
    "message": "人类可读描述",
    "extras": {
        "iteration": 1,
        "tool_name": "web_search",
        "tool_input": {"queries": [...]},
        "observation_summary": "搜索到 8 条结果",
        "thought_snippet": "需要确认 2024 年数据...",
    }
}
```

### 发射节点明细

| 节点 | stage | status | extras 字段 | Why |
|------|-------|--------|------------|-----|
| 开始生成 thought | `iteration_N_think` | `running` | `iteration` | 让用户知道进入新一轮思考。 |
| thought 生成完成 | `iteration_N_think` | `completed` | `iteration`, `thought_snippet` | 前端可展开查看推理。 |
| 开始执行工具 | `iteration_N_search` | `running` | `iteration`, `tool_name`, `tool_input` | 面板显示正在用什么工具。 |
| 工具执行完成 | `iteration_N_search` | `completed` | `iteration`, `tool_name`, `tool_output_count` | 工具调用审计。 |
| 开始生成 observation | `iteration_N_observe` | `running` | `iteration` | 短暂状态，通常与 search completed 连续发出。 |
| observation 生成完成 | `iteration_N_observe` | `completed` | `iteration`, `observation_summary` | 给下一轮 LLM 的输入摘要。 |
| 开始生成最终答案 | `iteration_N_final` | `running` | `iteration` | 进入终止阶段。 |
| 最终答案生成完成 | `iteration_N_final` | `completed` | `iteration`, `answer_len` | 循环结束。 |

### 与现有事件的对齐

- 旧 `fanout/fetch/chunk/rerank/reason` 阶段被 `iteration_N_*` 取代。
- `NodeProgressPanel` 仍复用：后端把 `research_process` 翻译成 `NodeEvent`，`node_name` 可取 `iteration_N_think` 等原始 stage 值。
- 最终 `done` / `research_reason_done` 事件与现有自研链路保持一致，保证前端报告渲染逻辑无需重写。

---

## 7. 关键实现提示

1. **不要改动 day32/day33 内部逻辑**：仅把它们包装成工具函数，通过 `configure_retrieval_keys` 注入 key。
2. **消息裁剪**：每轮 LLM 调用前，若 messages 超出模型上下文，优先裁剪早期 observation，保留 system、user 和最近 2 轮完整上下文。
3. **Observation token 控制**：rerank 后的 top_chunks 给 LLM 时做摘要（保留 `text` 前 800 字符 + URL），避免一次性撑爆上下文。
4. **持久化**：每轮事件发生后更新 `ChatMessage.nodeProgress`，保存到 `SessionSnapshot`，刷新/重启后可恢复。
5. **降级保留**：Agent Loop 失败或配置关闭时，仍可走 `_firecrawl_deep_research_job` 或固定 Pipeline，入口参数保持不变。
