"""MiniMax Interleaved Thinking 原生工具循环（Anthropic Messages 协议）。

Why 独立于 chat.py：GLM/千问的 MCP 是"预检轮 + 结果注入 system"模式（决策模型
与主模型分离）；MiniMax M3 支持 Anthropic 原生 tool_use + Interleaved Thinking，
由主模型自主决定"思考 → 调工具 → 再思考 → … → 作答"，工具语义与上下文完整性
远强于注入模式。本模块实现该多轮循环。

Interleaved Thinking 纪律（官方）：
- assistant 消息必须携带完整 content 块列表（thinking 含 signature / text / tool_use）
  回传历史，禁止只回传文本摘要；
- tool_result 以 user 角色 content 块回传，tool_use_id 一一对应。

事件契约：与 chat.py / GLM 直连对齐（node / reasoning_delta / token / usage / done /
error），外加 main.py 既有的 `event: mcp` 事件（mcp_tool_call / mcp_tool_result），
前端 MCP 进度组件零适配。
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from typing import Any, AsyncIterator, Awaitable, Callable, Iterator, Protocol

from .chat import (
    MemoryEngineLike,
    _RESPONSE_LIMITS,
    _output_ceiling,
    attachments_to_blocks,
    build_thinking_payload,
    convert_usage,
    extract_web_docs,
)
from .client import MiniMaxAPIError, MiniMaxClient
from .constants import WEB_SEARCH_TOOL
from model_settings import capabilities_for_model
from .caching import apply_cache_breakpoints

logger = logging.getLogger("minimax.agent_loop")

# 默认工具循环上限：防模型无限自我调用（与 settings.tool_call_rounds 对齐由调用方注入）。
# Do not let the per-model setting turn an interactive request into an
# unbounded agent run.  A very high value (the current default is 200) can
# spend the entire response budget on repeated thinking/tool calls and leave
# the user with an empty final answer.
DEFAULT_MAX_ROUNDS = 12
MAX_INTERACTIVE_ROUNDS = 6
PRE_TOOL_THINKING_BUDGET = 1_024
POST_TOOL_THINKING_BUDGET = 1_536
FINAL_THINKING_BUDGET = 1_024
# 工具结果回传截断（与 main.run_mcp_tool_preround 的 8000 字符一致）。
TOOL_RESULT_MAX_CHARS = 8_000

# Anthropic 工具名约束：^[a-zA-Z0-9_-]{1,64}$
_TOOL_NAME_RE = re.compile(r"[a-zA-Z0-9_-]{1,64}")
_UNSAFE_CHAR_RE = re.compile(r"[^a-zA-Z0-9_-]")


def sanitize_tool_name(name: str) -> str:
    """MCP 工具名（mcp__server__tool）→ Anthropic 合法工具名。

    Why: 超长/含非法字符的名字会被 Anthropic 协议 400；用内容 hash 后缀防截断撞名。
    """
    if _TOOL_NAME_RE.fullmatch(name):
        return name
    digest = hashlib.md5(name.encode("utf-8")).hexdigest()[:8]
    base = _UNSAFE_CHAR_RE.sub("_", name)[:55]
    return f"{base}_{digest}"


def openai_tools_to_anthropic(specs: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """OpenAI function specs（mcp_pool.all_tool_specs 产物）→ Anthropic tools。

    Returns:
        (anthropic_tools, name_map)：name_map 为 sanitize 名 → 原始名 的还原表，
        dispatch 时用原始名调用 MCP 池。
    """
    tools: list[dict[str, Any]] = []
    name_map: dict[str, str] = {}
    for spec in specs:
        fn = spec.get("function") if isinstance(spec, dict) else None
        if not isinstance(fn, dict) or not fn.get("name"):
            continue
        raw_name = str(fn["name"])
        safe_name = sanitize_tool_name(raw_name)
        name_map[safe_name] = raw_name
        tools.append({
            "name": safe_name,
            "description": str(fn.get("description") or ""),
            "input_schema": fn.get("parameters") or {"type": "object", "properties": {}},
        })
    return tools, name_map


class StreamAssembler:
    """把 client.stream_message 的增量事件重组为完整 assistant content 块。

    Why 必须完整重建：Interleaved Thinking 纪律要求 assistant 历史携带完整块列表
    （thinking 块含 signature、tool_use 块含完整 input JSON），增量 delta 直接丢弃
    会导致下一轮请求 400。
    """

    def __init__(self) -> None:
        self._blocks: dict[int, dict[str, Any]] = {}
        self._json_parts: dict[int, list[str]] = {}
        self._final_blocks: list[dict[str, Any]] = []
        self.stop_reason: str | None = None
        self.usage: dict[str, Any] = {}

    def feed(self, evt: dict[str, Any]) -> None:
        evt_type = evt.get("type", "")
        if evt_type == "content_block_start":
            # client 对 server_tool_use / web_search_tool_result 已产完整块事件，
            # 但 assembler 只服务 tool 循环重建，这两类不参与回传，跳过。
            pass
        elif evt_type == "thinking_delta":
            idx = self._current_index(evt)
            block = self._blocks.setdefault(idx, {"type": "thinking", "thinking": "", "signature": ""})
            block["thinking"] += str(evt.get("text") or "")
        elif evt_type == "signature_delta":
            block = self._blocks.setdefault(0, {"type": "thinking", "thinking": "", "signature": ""})
            block["signature"] += str(evt.get("text") or "")
        elif evt_type == "text_delta":
            idx = self._current_index(evt)
            block = self._blocks.setdefault(idx, {"type": "text", "text": ""})
            block["text"] += str(evt.get("text") or "")
        elif evt_type == "tool_use":
            block = evt.get("block") or {}
            self._final_blocks.append({
                "type": "tool_use",
                "id": str(block.get("id") or ""),
                "name": str(block.get("name") or ""),
                "input": block.get("input") or {},
            })
        elif evt_type == "message_delta":
            self.stop_reason = evt.get("stop_reason") or self.stop_reason
            if evt.get("usage"):
                self.usage.update(evt["usage"])

    def _current_index(self, evt: dict[str, Any]) -> int:
        # Why: client 已透传 content_block 的真实 index；优先用 evt["index"]。
        # 兜底规则：thinking/signature 默认 0，text/tool_use 序号靠后。
        if "index" in evt:
            return int(evt["index"])
        et = evt.get("type", "")
        if et in {"thinking_delta", "signature_delta"}:
            return 0
        if et == "text_delta":
            return 1
        return 1

    def blocks(self) -> list[dict[str, Any]]:
        """完整 content 块列表（thinking 在前、text 在后、tool_use 末尾追加）。"""
        ordered: list[dict[str, Any]] = []
        thinking = self._blocks.get(0)
        text = self._blocks.get(1)
        if thinking and thinking.get("thinking"):
            ordered.append({"type": "thinking", "thinking": thinking["thinking"], "signature": thinking.get("signature") or ""})
        if text and text.get("text"):
            ordered.append({"type": "text", "text": text["text"]})
        ordered.extend(self._final_blocks)
        return ordered


# --------------------------------------------------------------------- 主循环

class ChatRequestLike(Protocol):
    message: str
    mode: str
    session_id: str | None
    attachments: list[Any]

    @property
    def runtime_settings(self) -> Any | None: ...


Dispatch = Callable[[str, dict[str, Any]], Awaitable[Any]]


def _sse(name: str, data: dict[str, Any]) -> str:
    return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def generate_minimax_agent_events(
    request: ChatRequestLike,
    settings: Any,
    *,
    wants_web: bool,
    use_deep: bool,
    memory_engine: MemoryEngineLike,
    openai_tool_specs: list[dict[str, Any]],
    dispatch: Dispatch,
    max_rounds: int | None = None,
) -> AsyncIterator[str]:
    """MiniMax 原生工具循环事件生成器（MCP 工具 + Interleaved Thinking）。

    流程：首轮由模型自主决定是否 tool_use → dispatch 执行 → tool_result 回传
    → 模型继续（可再调工具）→ end_turn 输出最终答案。中间轮的 thinking/text
    同样推流（前端可见"边想边查"的交错过程）。
    """
    runtime = getattr(request, "runtime_settings", None)
    thinking = settings.thinking_enabled and (
        use_deep or request.mode == "deep" or getattr(runtime, "deep_thinking", "auto") == "on"
    )
    model_id = settings.model_id
    response_length = str(getattr(runtime, "response_length", "detailed") or "detailed")
    response_limit = _RESPONSE_LIMITS.get(response_length, settings.max_tokens)
    max_tokens = min(settings.max_tokens, response_limit, _output_ceiling(model_id))
    temperature = min(settings.temperature, 1.0)
    rounds_limit = min(
        max_rounds or settings.tool_call_rounds or DEFAULT_MAX_ROUNDS,
        MAX_INTERACTIVE_ROUNDS,
    )

    def staged_thinking_payload(budget_cap: int) -> dict[str, Any] | None:
        """Build a short thinking budget for one interleaved phase."""
        payload = build_thinking_payload(thinking, settings, max_tokens)
        if not payload:
            return None
        bounded = dict(payload)
        configured = int(bounded.get("budget_tokens") or budget_cap)
        bounded["budget_tokens"] = max(
            1_024,
            min(configured, budget_cap, max(1_024, max_tokens // 2)),
        )
        return bounded

    anthropic_tools, name_map = openai_tools_to_anthropic(openai_tool_specs)
    server_tools: list[dict[str, Any]] = list(anthropic_tools)

    answer_parts: list[str] = []
    reasoning_parts: list[str] = []
    total_usage: dict[str, Any] = {}
    web_docs: list[dict[str, Any]] = []
    last_stop_reason: str | None = None
    saw_tool_use = False

    def event(name: str, data: dict[str, Any]) -> str:
        return _sse(name, data)

    # Why: 能力位 gates web_search 注入。模型 catalog 都标 True，但运行时再校一次
    # ——避免 model_id 漂移 / 自定义模型时把 server tool 误塞给无 web 后端的小模型。
    if wants_web and capabilities_for_model(model_id).supports_server_web_search:
        server_tools.append(dict(WEB_SEARCH_TOOL))
    elif wants_web:
        # 模型不支持服务端联网 → 给前端明确提示节点（不走误导占位卡片）
        yield event("node", {
            "node_name": "web_search",
            "status": "skipped",
            "message": f"模型 {model_id} 不支持 MiniMax 服务端联网搜索（仅 Anthropic Messages 协议级）",
            "provider": "minimax",
            "native_search": False,
            "skipped_reason": "model_not_support_server_web_search",
            "timestamp_ms": int(time.time() * 1000),
        })

    try:
        yield event("node", {
            "node_name": f"MiniMax Agent · {model_id}",
            "status": "processing",
            "message": f"原生工具循环启动（工具 {len(anthropic_tools)} 个，use_deep={thinking}, wants_web={wants_web}）",
            "provider": "minimax",
            "wants_web": wants_web,
            "use_deep": thinking,
            "timestamp_ms": int(time.time() * 1000),
        })
        if wants_web:
            yield event("web_docs", {
                "docs": [{
                    "id": 0,
                    "title": "🌐 MiniMax 服务端搜索已启用（等待模型检索…）",
                    "url": "",
                    "content": "联网模式已开启，模型在推理中如需检索会自动调用并返回真实来源链接。",
                    "score": 0.0,
                    "native_search": True,
                }],
                "count": 1,
                "placeholder": True,
                "native_search": True,
            })

        # ---- L4 记忆滑窗 ----
        messages: list[dict[str, Any]] = []
        if request.session_id:
            try:
                memory_engine.push_chat_turn(request.session_id, "user", request.message)
                for turn in memory_engine.get_chat_window(request.session_id)[:-1]:
                    role = "user" if turn.get("role") == "user" else "assistant"
                    messages.append({"role": role, "content": str(turn.get("content") or "")})
            except Exception:
                logger.exception("[minimax] agent loop 记忆注入失败 sid=%s。", request.session_id)

        image_blocks = attachments_to_blocks(request.attachments or [])
        if image_blocks:
            messages.append({
                "role": "user",
                "content": [*image_blocks, {"type": "text", "text": request.message}],
            })
        else:
            messages.append({"role": "user", "content": request.message})

        _, tools_payload = apply_cache_breakpoints(model_id, system=None, tools=server_tools or None)
        # Why: 智能体对话走套餐 Key（tokenplan），普通 Key 仅供视频 H3。
        loop_key = (
            getattr(settings, "minimax_video_api_key", "")
            or getattr(settings, "api_key", "")
            or ""
        ).strip()
        client = MiniMaxClient(api_key=loop_key, base_url=settings.base_url)

        for round_no in range(1, rounds_limit + 1):
            assembler = StreamAssembler()
            round_thinking = staged_thinking_payload(
                PRE_TOOL_THINKING_BUDGET if round_no == 1 else POST_TOOL_THINKING_BUDGET,
            )
            stream: Iterator[dict] = client.stream_message(
                model=model_id,
                messages=messages,
                max_tokens=max_tokens,
                system=None,
                tools=tools_payload,
                thinking=round_thinking,
                temperature=temperature,
            )
            for evt in stream:
                evt_type = evt.get("type", "")
                assembler.feed(evt)
                if evt_type == "thinking_delta":
                    piece = str(evt.get("text") or "")
                    if piece:
                        reasoning_parts.append(piece)
                        yield event("reasoning_delta", {"reasoning_delta": piece})
                elif evt_type == "text_delta":
                    piece = str(evt.get("text") or "")
                    if piece:
                        answer_parts.append(piece)
                        yield event("token", {"token": piece})
                elif evt_type == "web_search_tool_result":
                    # Why 实时推送：每条 web_search_tool_result 独立 web_docs 事件，
                    # 前端可做"阅读了 X 个网页"实时计数（GLM/千问同款契约）。
                    new_docs = extract_web_docs(evt.get("block") or {})
                    if new_docs:
                        web_docs.extend(new_docs)
                        yield event("web_docs", {
                            "docs": new_docs,
                            "count": len(new_docs),
                            "total": len(web_docs),
                            "placeholder": False,
                            "native_search": True,
                        })
                        yield event("node", {
                            "node_name": "web_search",
                            "status": "completed",
                            "message": f"已返回 {len(new_docs)} 条来源（累计 {len(web_docs)} 条）",
                            "provider": "minimax",
                            "native_search": True,
                            "hit_count": len(new_docs),
                            "kept_count": len(web_docs),
                            "timestamp_ms": int(time.time() * 1000),
                        })
            if assembler.usage:
                total_usage.update(assembler.usage)
            last_stop_reason = assembler.stop_reason

            assistant_blocks = assembler.blocks()
            tool_use_blocks = [b for b in assistant_blocks if b.get("type") == "tool_use"]
            if assembler.stop_reason != "tool_use" or not tool_use_blocks:
                break  # end_turn：最终答案已流式输出完毕

            # Interleaved Thinking 纪律：assistant 完整块列表（thinking+text+tool_use）回传。
            saw_tool_use = True
            messages.append({"role": "assistant", "content": assistant_blocks})

            result_blocks: list[dict[str, Any]] = []
            for tb in tool_use_blocks:
                original_name = name_map.get(tb["name"], tb["name"])
                args = tb.get("input") or {}
                yield event("mcp", {"mcp_tool_call": original_name, "args": args, "round": round_no})
                try:
                    report = await dispatch(original_name, args)
                    preview = str(report).replace("\n", " ")[:200]
                    yield event("mcp", {"mcp_tool_result": original_name, "ok": True, "preview": preview, "round": round_no})
                except Exception as exc:
                    logger.exception("[minimax] agent loop 工具执行失败 tool=%s", original_name)
                    report = f"[工具调用失败] {exc}"
                    yield event("mcp", {"mcp_tool_result": original_name, "ok": False, "preview": str(exc)[:200], "round": round_no})
                result_blocks.append({
                    "type": "tool_result",
                    "tool_use_id": tb.get("id") or "",
                    "content": str(report)[:TOOL_RESULT_MAX_CHARS],
                })
            # tool_result 以 user 角色块回传（Anthropic 协议），与 assistant tool_use 一一对应。
            result_blocks.append({
                "type": "text",
                "text": (
                    "请基于刚返回的工具结果做一轮简短分析；如果信息已经足够，"
                    "就准备最终正文，只有缺少关键事实时才继续调用工具。"
                ),
            })
            messages.append({"role": "user", "content": result_blocks})
            yield event("node", {
                "node_name": "tool_round",
                "status": "completed",
                "message": f"第 {round_no} 轮工具执行完成（{len(tool_use_blocks)} 个调用），等待模型继续…",
                "provider": "minimax",
                "round": round_no,
                "timestamp_ms": int(time.time() * 1000),
            })

        final_answer = "".join(answer_parts)

        # A model may finish the last allowed tool round with stop_reason
        # ``tool_use`` (or only thinking) and never emit a text block.  Always
        # give it one tool-free turn to turn the gathered results into the
        # requested document/answer.  This is also the safety net for a
        # round-limit exit, so the frontend never receives "答案 0 字".
        if not final_answer.strip() or last_stop_reason == "tool_use" or (thinking and saw_tool_use):
            yield event("node", {
                "node_name": "final_answer",
                "status": "processing",
                "message": "工具结果已收集，正在整理最终正文",
                "provider": "minimax",
                "timestamp_ms": int(time.time() * 1000),
            })
            final_instruction = (
                "工具检索阶段已完成。请先用一段简短思考规划最终结构，"
                "然后直接输出用户要求的完整正文或文档内容；不要继续调用工具，也不要解释工具过程。"
            )
            final_messages = [*messages]
            # Keep the Anthropic message sequence valid when the last entry is
            # already the user tool_result message: append the instruction to
            # that message instead of creating two adjacent user messages.
            if final_messages and final_messages[-1].get("role") == "user":
                last_content = final_messages[-1].get("content")
                if isinstance(last_content, list):
                    final_messages[-1] = {
                        **final_messages[-1],
                        "content": [*last_content, {"type": "text", "text": final_instruction}],
                    }
                else:
                    final_messages[-1] = {
                        **final_messages[-1],
                        "content": f"{last_content or ''}\n\n{final_instruction}",
                    }
            else:
                final_messages.append({"role": "user", "content": final_instruction})
            try:
                final_stream: Iterator[dict] = client.stream_message(
                    model=model_id,
                    messages=final_messages,
                    max_tokens=max_tokens,
                    system=None,
                    tools=None,
                    thinking=staged_thinking_payload(FINAL_THINKING_BUDGET),
                    temperature=temperature,
                )
                final_assembler = StreamAssembler()
                for evt in final_stream:
                    evt_type = evt.get("type", "")
                    final_assembler.feed(evt)
                    if evt_type == "text_delta":
                        piece = str(evt.get("text") or "")
                        if piece:
                            answer_parts.append(piece)
                            yield event("token", {"token": piece})
                    elif evt_type == "thinking_delta":
                        # Finalization uses a short thinking phase so the
                        # frontend can show the final structure being planned.
                        piece = str(evt.get("text") or "")
                        if piece:
                            reasoning_parts.append(piece)
                            yield event("reasoning_delta", {"reasoning_delta": piece})
                if final_assembler.usage:
                    total_usage.update(final_assembler.usage)
                final_answer = "".join(answer_parts)
            except MiniMaxAPIError:
                logger.exception("[minimax] final answer synthesis failed")

        if not final_answer.strip():
            final_answer = "工具检索已完成，但模型未返回最终正文，请重试。"
        reasoning_len = sum(len(p) for p in reasoning_parts)
        frontend_usage = convert_usage(total_usage or None)

        yield event("node", {
            "node_name": f"MiniMax Agent · {model_id}",
            "status": "completed",
            "message": "工具循环结束",
            "provider": "minimax",
            "timestamp_ms": int(time.time() * 1000),
        })
        yield event("node", {
            "node_name": "chat",
            "status": "completed",
            "message": f"生成完成：答案 {len(final_answer)} 字" + (f"，推理过程 {reasoning_len} 字" if thinking else ""),
            "provider": "minimax",
            "answer_len": len(final_answer),
            "reasoning_len": reasoning_len if thinking else 0,
            "thinking": thinking,
            "timestamp_ms": int(time.time() * 1000),
        })
        if frontend_usage:
            yield event("usage", {"usage": frontend_usage})
        yield event("done", {
            "answer": final_answer,
            "reasoning_steps": 1 if reasoning_parts else 0,
            "mode": request.mode,
            "wants_web": wants_web,
            "native_search": wants_web,
            "model": model_id,
            "usage": frontend_usage,
            "web_docs": web_docs,  # Why 不再 fallback 占位：未命中时空数组，前端显示真实状态。
        })

        if request.session_id and final_answer:
            try:
                memory_engine.push_chat_turn(request.session_id, "assistant", final_answer)
                memory_engine.maybe_summarize(request.session_id, chat_mode=True)
            except Exception:
                logger.exception("[minimax] agent loop 后置落账失败 sid=%s。", request.session_id)

    except MiniMaxAPIError as exc:
        yield event("error", {"message": exc.message, "code": f"MINIMAX_{exc.status_code or 'REQUEST_ERROR'}"})
    except Exception as exc:
        logger.exception("[minimax] agent loop 异常")
        yield event("error", {"message": f"MiniMax 工具循环失败：{exc}", "code": "MINIMAX_AGENT_LOOP_ERROR"})
