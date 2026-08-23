"""MiniMax 原生深度调研引擎（research 模式专用，Anthropic Messages 协议）。

Why 两段式（阶段1搜索 → 阶段2写作）：MiniMax 服务端工具 Beta 实测行为变更——
单请求内多轮 web_search 后模型不再续写最终长报告（M3/M2.7 均复现：5-8 轮检索、
79 条来源，但正文 80-107 字即 end_turn；官方文档示例仅覆盖单轮搜索场景）。
对照实验证实与历史注入/thinking/system 长度/temperature 均无关。
两段式经真实 API 验证：阶段1 收 40 条材料，阶段2 塞材料写出 9821 字报告。

事件契约不变（node / reasoning_delta / token / web_docs / usage / done / error）
——前端 research 面板零适配。

依赖红线：禁止 import main.py（单向依赖，见包 docstring）。
"""

from __future__ import annotations

import itertools
import json
import logging
import time
from types import SimpleNamespace
from typing import Any, Iterator

from HOOK.token_usage_hook import observe_response
from model_settings import ModelSettings

from .caching import apply_cache_breakpoints
from .chat import (
    MemoryEngineLike,
    _output_ceiling,
    build_thinking_payload,
    convert_usage,
    extract_web_docs,
)
from .client import MiniMaxAPIError, MiniMaxClient
from .constants import WEB_SEARCH_TOOL

logger = logging.getLogger("minimax.research")

# 调研思考预算（阶段2 写作）：6K 是经验甜区——足够规划报告结构、又不至于过度推理。
_RESEARCH_THINKING_BUDGET = 6_144

# 阶段1 搜索输出上限：搜索阶段只产短进度文本，无需大预算。
_SEARCH_STAGE_MAX_TOKENS = 4_096

# 报告 token 下限：max_tokens 取用户配置 / ceiling / 8K 三者中最大值。
_MIN_REPORT_TOKENS = 8_000

# 阶段2 注入材料条数上限：控制 prompt 长度（每条含 400 字摘要）。
_MAX_MATERIALS = 20

# 单条材料摘要截断长度（字符）。
_MATERIAL_SNIPPET_CHARS = 400

# 阶段1 system：只搜索不写作。
# Why 独立模板：单阶段模板"第一步必须调 web_search + ≥4000 字"在多轮搜索后
# 触发服务端 Beta 行为异常（搜完即 end_turn 不写报告）；拆开后阶段1 无写作义务。
_SEARCH_SYSTEM_TEMPLATE = """你是一名专业调研助手。请围绕用户给定的研究主题进行系统性联网检索。

## 检索纪律
1. **至少进行 2 轮 web_search**——先泛搜建立全貌，再针对薄弱点精搜补齐。
2. 每轮搜索后用一句话简述进展与信息缺口，**无需撰写报告**。
3. 优先近期、权威来源；中英文检索词并用。{directives}"""

# 阶段2 system：纯写作（不传 tools，故无"必须调工具"类指令）。
_WRITING_SYSTEM_TEMPLATE = """你是一名专业深度调研分析师。基于用户提供的已检索材料，撰写结构化调研报告。

## 🔒 强约束（违反任一即视为失败）
0. **报告总长度 ≥ 4000 字（中文字符）**——禁止以"信息已充分"、"篇幅有限"等任何理由提前结束。
1. **每个关键论断必须带引用编号 [n]**，编号对应用户消息中的材料序号。
2. **禁止编造来源**——只能引用提供的材料；材料不足时明确说明信息缺口。
3. **禁止只输出章节标题骨架**——每个二级章节必须包含 200-400 字正文段落。

## 报告结构（Markdown，6 节齐全且每节都必须有 ≥300 字正文）
1. **核心结论**（≤200 字，直接给答案）
2. **背景与范围**（≥300 字：主题定义、研究边界、关键概念厘清）
3. **分节论述**（按子问题组织 3-6 节，每节 ≥400 字正文、至少 3-5 个完整段落，节末标注引用编号）
4. **数据与证据表**（如适用，≥300 字：关键数据表格 + 解读）
5. **分歧与不确定性**（≥300 字：来源冲突/证据不足之处如实说明）
6. **参考来源**（编号列表：[n] 标题 - URL，必须来自提供的材料）

## 输出要求
- 全文使用中文（专有名词/术语可保留英文）。
- 报告总长度 ≥ 4000 字（中文字符，不含 markdown 标记）。
- "分节论述"每节至少 3-5 个完整段落，禁止大纲式罗列。{directives}"""


def _format_search_directives(research_options: dict[str, Any] | None) -> str:
    """把 maxDepth 翻译为阶段1 检索轮次指令。"""
    opts = research_options or {}
    max_depth = int(opts.get("maxDepth") or 0)
    if 1 <= max_depth <= 12:
        # 经验映射：depth ≤4 浅调研（2-3 轮），5-8 标准（4-6 轮），≥9 深度（6-10 轮）。
        rounds = 3 if max_depth <= 4 else (6 if max_depth <= 8 else 10)
        return f"\n4. 本主题目标检索轮次：约 {rounds} 轮。"
    return ""


def _format_writing_directives(research_options: dict[str, Any] | None) -> str:
    """把 maxUrls 翻译为阶段2 引用规模指令。"""
    opts = research_options or {}
    max_urls = int(opts.get("maxUrls") or 0)
    if 1 <= max_urls <= 1000:
        return f"\n- 参考来源规模：{min(max_urls, 30)} 条以内（重质量不重数量）。"
    return ""


def _merge_usage(a: dict[str, Any] | None, b: dict[str, Any] | None) -> dict[str, Any] | None:
    """两阶段 usage 合并：数值字段求和，其余取阶段2。"""
    if not a:
        return dict(b) if b else None
    if not b:
        return dict(a)
    merged = dict(a)
    for key, val in b.items():
        if isinstance(val, (int, float)) and isinstance(merged.get(key), (int, float)):
            merged[key] = merged[key] + val
        else:
            merged[key] = val
    return merged


def generate_minimax_research_events(
    query: str,
    session_id: str | None,
    settings: ModelSettings,
    memory_engine: MemoryEngineLike,
    research_options: dict[str, Any] | None = None,
) -> Iterator[str]:
    """MiniMax 原生调研事件生成器（两段式，同步生成器，SSE 字符串逐事件产出）。

    Args:
        query: 用户研究主题。
        session_id: 会话 ID（L4 记忆滑窗读写）。
        settings: 当前激活的 MiniMax ModelSettings。
        memory_engine: main.py 单例注入。
        research_options: 前端参数（maxDepth→阶段1轮次 / maxUrls→阶段2引用规模）。
    """
    def event(name: str, data: dict[str, Any]) -> str:
        return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    model_id = settings.model_id
    ceiling = _output_ceiling(model_id)
    report_max_tokens = max(min(settings.max_tokens, ceiling), _MIN_REPORT_TOKENS)
    # 阶段2 思考预算：用户显式配置优先，否则调研默认 6K。
    thinking_payload = build_thinking_payload(
        True, settings, report_max_tokens, default_budget=_RESEARCH_THINKING_BUDGET
    )

    # ---- L4 记忆：落用户轮 + 读窗口（best-effort，两阶段共享历史前缀）----
    history_messages: list[dict[str, Any]] = []
    if session_id:
        try:
            memory_engine.push_chat_turn(session_id, "user", query)
            for turn in memory_engine.get_chat_window(session_id)[:-1]:
                role = "user" if turn.get("role") == "user" else "assistant"
                content = str(turn.get("content") or "")
                if content:
                    history_messages.append({"role": role, "content": content})
        except Exception:
            logger.exception("[minimax-research] 记忆滑窗注入失败 sid=%s，降级无记忆。", session_id)

    # Why: 文本生成/搜索走套餐 Key（tokenplan），普通 Key 仅供视频 H3。
    research_key = (settings.minimax_video_api_key or settings.api_key or "").strip()
    client = MiniMaxClient(api_key=research_key, base_url=settings.base_url)

    web_docs: list[dict[str, Any]] = []
    raw_materials: list[dict[str, str]] = []
    search_rounds = 0
    stage1_usage: dict[str, Any] | None = None
    stage2_usage: dict[str, Any] | None = None
    reasoning_parts: list[str] = []
    answer_parts: list[str] = []
    final_stop_reason: str | None = None

    try:
        yield event("research_process", {
            "stage": "planning",
            "status": "running",
            "message": "🤔 MiniMax 原生调研启动：规划检索策略...",
        })
        yield event("node", {
            "node_name": f"MiniMax 原生调研 · {model_id}",
            "status": "processing",
            "message": "调研任务启动：规划检索策略（两段式：先检索后写作）...",
            "provider": "minimax",
            "native_search": True,
            "timestamp_ms": int(time.time() * 1000),
        })

        # ================= 阶段1：搜索收集材料 =================
        search_system = _SEARCH_SYSTEM_TEMPLATE.format(
            directives=_format_search_directives(research_options)
        )
        tools: list[dict[str, Any]] = [dict(WEB_SEARCH_TOOL)]
        # Why 阶段1 不启用 thinking：搜索任务无写作义务，模型不会跳过工具；
        #   省下的输出预算全给搜索轮次。tool_choice="any" 仍做首轮协议级兜底。
        # Why 用 _open_stream 闭包：MiniMax 400 错误在迭代首个 SSE 事件时才暴露
        #   （stream_message 返回生成器，HTTP 请求在迭代时发出），必须把迭代也
        #   包进 try 才能捕获并降级重试。
        def _open_stream1(choice: str | None):
            return client.stream_message(
                model=model_id,
                messages=history_messages + [{"role": "user", "content": query}],
                max_tokens=_SEARCH_STAGE_MAX_TOKENS,
                system=search_system,
                tools=tools,
                tool_choice=choice,
                temperature=min(settings.temperature, 1.0),
            )

        try:
            stream1 = _open_stream1("any")
            stream1_iter = iter(stream1)
            try:
                first_evt = next(stream1_iter)
            except StopIteration:
                first_evt = None
            if first_evt is not None:
                stream1 = itertools.chain([first_evt], stream1_iter)
            else:
                stream1 = stream1_iter
        except MiniMaxAPIError as exc:
            # Why: 兼容层拒收 tool_choice 只返 "invalid params"，任何 4xx 一律降级重试。
            if exc.status_code in (400, 422):
                logger.warning(
                    "[minimax-research] 阶段1 兼容层 4xx 拒收（status=%s），降级无 tool_choice 重试 model=%s",
                    exc.status_code, model_id,
                )
                stream1 = _open_stream1(None)
            else:
                raise

        for evt in stream1:
            evt_type = evt.get("type", "")
            if evt_type == "server_tool_use":
                block = evt.get("block") or {}
                query_text = str((block.get("input") or {}).get("query") or "")
                search_rounds += 1
                if search_rounds == 1:
                    yield event("research_process", {
                        "stage": "searching",
                        "status": "running",
                        "message": "🔍 深度搜索中...",
                    })
                yield event("node", {
                    "node_name": "web_search",
                    "status": "processing",
                    "message": f"第 {search_rounds} 轮检索：{query_text or '（模型自主检索）'}",
                    "provider": "minimax",
                    "native_search": True,
                    "round": search_rounds,
                    "timestamp_ms": int(time.time() * 1000),
                })
            elif evt_type == "web_search_tool_result":
                block = evt.get("block") or {}
                docs = extract_web_docs(block)
                web_docs.extend(docs)
                # 阶段2 材料：保留原始摘要（extract_web_docs 只留 title/url）。
                for item in block.get("content") or []:
                    if isinstance(item, dict) and item.get("type") == "web_search_result":
                        raw_materials.append({
                            "title": str(item.get("title") or ""),
                            "url": str(item.get("url") or ""),
                            "snippet": str(item.get("content") or "")[:_MATERIAL_SNIPPET_CHARS],
                        })
                if docs:
                    yield event("web_docs", {"docs": docs, "count": len(docs)})
                    yield event("node", {
                        "node_name": "web_search",
                        "status": "completed",
                        "message": f"第 {search_rounds} 轮检索完成：命中 {len(docs)} 条结果",
                        "provider": "minimax",
                        "native_search": True,
                        "hit_count": len(docs),
                        "timestamp_ms": int(time.time() * 1000),
                    })
            elif evt_type in ("message_delta", "message_stop"):
                if evt.get("usage"):
                    stage1_usage = _merge_usage(stage1_usage, dict(evt["usage"]))
            # Why: 阶段1 的 text_delta（搜索进度短语）不推前端 token——
            #   避免污染阶段2 报告流。

        logger.info(
            "[minimax-research] 阶段1 完成 model=%s search_rounds=%d web_docs=%d materials=%d",
            model_id, search_rounds, len(web_docs), len(raw_materials),
        )
        if search_rounds == 0:
            yield event("node", {
                "node_name": "web_search",
                "status": "skipped",
                "message": (
                    f"⚠️ 模型 {model_id} 未发起 web_search 调用——"
                    f"该模型可能在 Anthropic Messages 协议下不支持 web_search_20250305，"
                    f"建议切换到 M3 或在引擎选择中改用 Firecrawl/自研引擎"
                ),
                "provider": "minimax",
                "native_search": True,
                "skipped_reason": "model_did_not_invoke_web_search",
                "timestamp_ms": int(time.time() * 1000),
            })

        # ================= 阶段2：塞材料写报告 =================
        writing_system = _WRITING_SYSTEM_TEMPLATE.format(
            directives=_format_writing_directives(research_options)
        )
        materials = raw_materials[:_MAX_MATERIALS]
        if materials:
            material_lines = [
                f"[{i}] {m['title']}\n    URL: {m['url']}\n    摘要: {m['snippet']}"
                for i, m in enumerate(materials, 1)
            ]
            user_content = (
                f"研究主题：{query}\n\n"
                f"以下是已检索到的 {len(materials)} 条网络材料：\n"
                + "\n".join(material_lines)
                + "\n\n请基于以上材料撰写完整调研报告（≥4000 字，6 节齐全，"
                  "引用编号 [n] 对应材料序号）。"
            )
        else:
            # 阶段1 零材料兜底：明确告知信息缺口，禁止编造。
            user_content = (
                f"研究主题：{query}\n\n"
                "（未检索到任何网络材料）请基于自身知识撰写报告，"
                "并在「分歧与不确定性」一节明确说明未能联网取证。"
            )
        # Why: 材料序号 [1..n] 与 web_docs 前 n 条同序（同一收集顺序截取）。

        _writing_emitted = False
        stream2 = client.stream_message(
            model=model_id,
            messages=history_messages + [{"role": "user", "content": user_content}],
            max_tokens=report_max_tokens,
            system=writing_system,
            thinking=thinking_payload,
            temperature=min(settings.temperature, 1.0),
        )
        for evt in stream2:
            evt_type = evt.get("type", "")
            if evt_type == "thinking_delta":
                piece = str(evt.get("text") or "")
                if piece:
                    reasoning_parts.append(piece)
                    yield event("reasoning_delta", {"reasoning_delta": piece})
            elif evt_type == "text_delta":
                piece = str(evt.get("text") or "")
                if piece:
                    answer_parts.append(piece)
                    if not _writing_emitted:
                        _writing_emitted = True
                        yield event("research_process", {
                            "stage": "writing",
                            "status": "running",
                            "message": "📝 撰写报告中...",
                        })
                    yield event("token", {"token": piece})
            elif evt_type in ("message_delta", "message_stop"):
                if evt.get("usage"):
                    stage2_usage = _merge_usage(stage2_usage, dict(evt["usage"]))
                if evt_type == "message_delta":
                    sr = evt.get("stop_reason")
                    if sr:
                        final_stop_reason = sr

        final_answer = "".join(answer_parts)
        reasoning_len = sum(len(p) for p in reasoning_parts)
        merged_usage = _merge_usage(stage1_usage, stage2_usage)
        frontend_usage = convert_usage(merged_usage)

        # Why: 诊断保留——两段式下阶段2 stop_reason 仍是"提前结束 vs 截断"的唯一信号。
        output_tokens = (stage2_usage or {}).get("output_tokens") or (stage2_usage or {}).get("completion_tokens")
        logger.info(
            "[minimax-research] DONE model=%s answer_chars=%d search_rounds=%d "
            "web_docs=%d reasoning_chars=%d stop_reason=%s output_tokens=%s",
            model_id, len(final_answer), search_rounds, len(web_docs),
            reasoning_len, final_stop_reason, output_tokens,
        )
        if len(final_answer) < 2000:
            logger.warning(
                "[minimax-research] 报告字数过低：%d 字（期望 ≥4000）model=%s stop_reason=%s "
                "output_tokens=%s——若 stop_reason=end_turn 表明模型主动提前结束，"
                "若 max_tokens 表明被截断需调大 max_tokens。",
                len(final_answer), model_id, final_stop_reason, output_tokens,
            )

        if merged_usage:
            try:
                observe_response(SimpleNamespace(model=model_id, usage=SimpleNamespace(**merged_usage)))
            except Exception:
                logger.exception("[minimax-research] token 记账失败（不影响报告流）。")

        yield event("research_process", {
            "stage": "complete",
            "status": "done",
            "message": "✅ MiniMax 原生调研报告生成完成",
        })
        yield event("node", {
            "node_name": f"MiniMax 原生调研 · {model_id}",
            "status": "completed",
            "message": (
                f"调研完成：报告 {len(final_answer)} 字，检索 {search_rounds} 轮，"
                f"引用来源 {len(web_docs)} 条，推理过程 {reasoning_len} 字"
            ),
            "provider": "minimax",
            "native_search": True,
            "answer_len": len(final_answer),
            "search_rounds": search_rounds,
            "hit_count": len(web_docs),
            "reasoning_len": reasoning_len,
            "timestamp_ms": int(time.time() * 1000),
        })
        if frontend_usage:
            yield event("usage", {"usage": frontend_usage})
        yield event("done", {
            "total_pages": search_rounds,
            "total_chunks": len(web_docs),
            "top_chunks": web_docs,
        })
        full_reasoning = "".join(reasoning_parts)
        yield event("research_reason_done", {
            "reasoning": full_reasoning,
            "report": final_answer,
            "reasoning_time": 0.0,
        })
        # 兼容 chat 链路（ChatInterface 调 onDone 拿 answer）。
        yield event("done", {
            "answer": final_answer,
            "reasoning_steps": 1 if reasoning_parts else 0,
            "mode": "research",
            "wants_web": True,
            "native_search": True,
            "engine": "minimax",
            "model": model_id,
            "usage": frontend_usage,
            "web_docs": web_docs,
        })

        # ---- 记忆后置落账（best-effort）----
        if session_id and final_answer:
            try:
                memory_engine.push_chat_turn(session_id, "assistant", final_answer)
                memory_engine.maybe_summarize(session_id, chat_mode=True)
            except Exception:
                logger.exception("[minimax-research] 后置落账失败 sid=%s。", session_id)

    except MiniMaxAPIError as exc:
        yield event("error", {
            "message": exc.message,
            "code": f"MINIMAX_{exc.status_code or 'REQUEST_ERROR'}",
        })
    except Exception as exc:
        logger.exception("[minimax-research] 调研生成器异常")
        status = getattr(exc, "status_code", None)
        message = f"MiniMax 调研失败：{exc}"
        if status in {401, 403}:
            message = "MiniMax API 密钥无效或无权限"
        elif status == 429:
            message = "MiniMax 请求被限流或额度不足"
        yield event("error", {"message": message, "code": f"MINIMAX_{status or 'REQUEST_ERROR'}"})
