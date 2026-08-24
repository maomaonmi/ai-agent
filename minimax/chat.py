"""MiniMax 对话主链路（standard / deep / web / research 直连，Anthropic Messages 协议）。

事件契约与 main.generate_direct_chat_events（GLM/千问直连）完全对齐：
node / reasoning_delta / token / web_docs / usage / done / error——前端零适配。

Why 薄分发：main.py 仅解析 wants_web/use_deep 并注入 memory_engine 单例，
本模块禁止 import main.py（单向依赖红线，见包 docstring）。

Interleaved Thinking 说明：M3 会在一次回复中交替产出 thinking / text 块，
本生成器按到达顺序分别推 reasoning_delta / token 事件，前端时间轴自然交错。
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from types import SimpleNamespace
from typing import Any, Iterator, Protocol

from HOOK.token_usage_hook import observe_response
from model_settings import MODEL_CATALOG, ModelSettings

from .caching import apply_cache_breakpoints
from .client import MiniMaxAPIError, MiniMaxClient
from .constants import WEB_SEARCH_TOOL
from model_settings import capabilities_for_model

logger = logging.getLogger("minimax.chat")

# Why: 与 GLM/千问直连一致的回答长度档位；detailed 档直接用 settings.max_tokens。
_RESPONSE_LIMITS: dict[str, int] = {"brief": 2_000, "balanced": 8_000}

# Anthropic thinking 协议约束：budget_tokens ≥ 1024，且必须 < max_tokens。
_MIN_THINKING_BUDGET = 1024
_OUTPUT_RESERVE = 1024
# 未显式配置 thinking_budget 时的默认思考预算。
_DEFAULT_THINKING_BUDGET = 4096


def _output_ceiling(model_id: str) -> int:
    """从 MODEL_CATALOG 反查模型输出上限（未命中给 MiniMax 系安全默认 32K）。"""
    for variants in MODEL_CATALOG.values():
        for variant in variants:
            if str(variant.get("model_id", "")).lower() == (model_id or "").lower():
                return int(variant.get("output_context", 32_000))
    return 32_000


class ChatRequestLike(Protocol):
    """main.ChatRequest 结构子集（运行时 duck typing，杜绝循环 import）。"""

    message: str
    mode: str
    session_id: str | None
    attachments: list[Any]

    @property
    def runtime_settings(self) -> Any | None: ...


class MemoryEngineLike(Protocol):
    """memory_engine 单例的结构子集（main.py 注入实例）。"""

    def push_chat_turn(self, session_id: str, role: str, content: str) -> None: ...

    def get_chat_window(self, session_id: str, **kwargs: Any) -> list[dict[str, Any]]: ...

    def maybe_summarize(self, session_id: str, *, chat_mode: bool = False) -> None: ...


# --------------------------------------------------------------------- 附件

def attachments_to_blocks(attachments: list[Any]) -> list[dict[str, Any]]:
    """ChatAttachment 列表 → Anthropic image 块列表。

    Why 仅 image：MiniMax Anthropic 兼容层当前只接受 image 块；
    video/file 附件在入口即拒绝（入口门禁已按 supports_vision 挡掉非 M3 模型，
    这里再按附件类型精确拦截，避免 400 泛化错误）。
    """
    blocks: list[dict[str, Any]] = []
    for att in attachments:
        att_type = str(getattr(att, "type", "") or "")
        url = str(getattr(att, "url", "") or "")
        if att_type != "image_url":
            raise MiniMaxAPIError(f"MiniMax 当前不支持 {att_type} 类型附件，请移除后重试")
        if url.startswith("data:image/") and ";base64," in url:
            header, _, data = url.partition(",")
            media_type = header[len("data:"):].split(";", 1)[0] or "image/png"
            blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": data},
            })
        else:
            blocks.append({"type": "image", "source": {"type": "url", "url": url}})
    return blocks


# --------------------------------------------------------------------- 参数构造

def build_thinking_payload(
    use_deep: bool,
    settings: ModelSettings,
    max_tokens: int,
    default_budget: int = _DEFAULT_THINKING_BUDGET,
) -> dict[str, Any] | None:
    """深度思考 → Anthropic thinking 参数（budget 双侧 clamp）。

    Why clamp：budget < 1024 协议直接 400；budget ≥ max_tokens 会挤占正文输出
    （千问 thinking_budget 同问题前科）。上限保留 _OUTPUT_RESERVE 给正文。
    default_budget：调用方场景化默认值（research 用更大预算），用户显式配置优先。
    """
    if not use_deep:
        return None
    raw_budget = settings.thinking_budget or default_budget
    upper = max(max_tokens - _OUTPUT_RESERVE, _MIN_THINKING_BUDGET)
    budget = max(_MIN_THINKING_BUDGET, min(int(raw_budget), upper))
    return {"type": "enabled", "budget_tokens": budget}


def convert_usage(usage: dict[str, Any] | None) -> dict[str, Any] | None:
    """Anthropic usage（input_tokens/cache_read_input_tokens）→ 前端 OpenAI 风格契约。"""
    if not usage:
        return None
    prompt = int(usage.get("input_tokens") or usage.get("prompt_tokens") or 0)
    completion = int(usage.get("output_tokens") or usage.get("completion_tokens") or 0)
    cache_read = int(usage.get("cache_read_input_tokens") or 0)
    out: dict[str, Any] = {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
    }
    if cache_read:
        out["cache_read_input_tokens"] = cache_read
        out["prompt_tokens_details"] = {"cached_tokens": cache_read}
    return out


def extract_web_docs(block: dict[str, Any]) -> list[dict[str, Any]]:
    """web_search_tool_result 块 → 前端 web_docs 契约（与 Firecrawl 面板对齐）。

    Why 全局稳定 id：单次 extract 内 `len(docs)+1` 会让多次事件的 docs
    （id=1,2,3 各 5 条）前端 spread 追加后撞 React key。改用 url 哈希前 12
    位做全局稳定 id，前端 spread 追加可安全去重。
    """
    docs: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    def parse_json(value: Any) -> Any:
        if not isinstance(value, str):
            return value
        text = value.strip()
        if not text or text[0] not in "[{":
            return value
        try:
            return json.loads(text)
        except (TypeError, ValueError):
            return value

    def visit(value: Any, *, result_container: bool = False) -> None:
        value = parse_json(value)
        if isinstance(value, list):
            for child in value:
                visit(child, result_container=result_container)
            return
        if not isinstance(value, dict):
            return

        item_type = str(value.get("type") or "").lower()
        is_result = item_type in {"web_search_result", "search_result", "result"}
        is_result_wrapper = item_type in {"web_search_tool_result", "search_results", "results"}
        url = str(value.get("url") or value.get("link") or value.get("href") or "").strip()
        # `content` is the native Anthropic shape; results/search_results/items
        # are used by other MiniMax gateway versions.  In a known result
        # container, URL-bearing dictionaries are valid even without `type`.
        if url and (is_result or result_container):
            if url not in seen_urls:
                seen_urls.add(url)
                title = str(value.get("title") or value.get("name") or url).strip()
                snippet = (
                    value.get("snippet")
                    or value.get("description")
                    or value.get("content")
                    or value.get("text")
                    or value.get("page_age")
                    or ""
                )
                raw_score = value.get("score")
                try:
                    score = float(raw_score) if raw_score is not None else 1.0
                except (TypeError, ValueError):
                    score = 1.0
                docs.append({
                    "id": f"web-{hashlib.md5(url.encode('utf-8')).hexdigest()[:12]}",
                    "title": title,
                    "url": url,
                    "content": str(snippet),
                    "score": score,
                    "native_search": True,
                })

        for key in ("results", "search_results", "items"):
            if key in value:
                visit(value.get(key), result_container=True)
        # Some responses wrap the native result list one level deeper under
        # `content`; do not treat arbitrary metadata fields as sources.
        if "content" in value and not is_result:
            visit(value.get("content"), result_container=result_container or is_result_wrapper)

    visit(block)
    return docs


# --------------------------------------------------------------------- 主生成器

def generate_minimax_chat_events(
    request: ChatRequestLike,
    settings: ModelSettings,
    mcp_system_prompt: str | None = None,
    *,
    wants_web: bool,
    use_deep: bool,
    memory_engine: MemoryEngineLike,
    token_usage_tracker: Any = None,
) -> Iterator[str]:
    """MiniMax 直连事件生成器（同步，与 GLM/千问 direct 生成器同契约）。

    Args:
        wants_web / use_deep: main.py resolve_runtime_mode 的产物（薄分发注入）。
        memory_engine: main.py 单例注入（L4 滑窗读写）。
        token_usage_tracker: 兼容签名保留（记账走 observe_response 上下文）。
    """
    def event(name: str, data: dict[str, Any]) -> str:
        return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    runtime = getattr(request, "runtime_settings", None)
    # 思考开关合成逻辑与 GLM/千问直连完全一致（deep 模式 / 全局深思考开关 / runtime 覆盖）。
    thinking = settings.thinking_enabled and (
        use_deep or request.mode == "deep" or getattr(runtime, "deep_thinking", "auto") == "on"
    )

    model_id = settings.model_id
    response_length = str(getattr(runtime, "response_length", "detailed") or "detailed")
    response_limit = _RESPONSE_LIMITS.get(response_length, settings.max_tokens)
    # Why 双 clamp：回答档位限制 × 模型输出上限（M3 32K），防参数越界 400。
    max_tokens = min(settings.max_tokens, response_limit, _output_ceiling(model_id))
    # Anthropic temperature 上限 1.0（ModelSettings 允许到 2.0，需收口）。
    temperature = min(settings.temperature, 1.0)

    answer_parts: list[str] = []
    reasoning_parts: list[str] = []
    web_docs: list[dict[str, Any]] = []
    latest_usage: dict[str, Any] | None = None

    try:
        yield event("node", {
            "node_name": f"MiniMax · {model_id}",
            "status": "processing",
            "message": f"正在生成回答（use_deep={thinking}, wants_web={wants_web}）...",
            "provider": "minimax",
            "wants_web": wants_web,
            "use_deep": thinking,
            "timestamp_ms": int(time.time() * 1000),
        })
        if wants_web:
            yield event("node", {
                "node_name": "chat",
                "status": "processing",
                "message": "MiniMax 服务端联网搜索已启用（web_search_20250305 server tool）",
                "provider": "minimax",
                "native_search": True,
                "timestamp_ms": int(time.time() * 1000),
            })
            # 占位 web_docs 先行 → 前端联网面板必现（GLM/千问同款兜底策略）。
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

        # ---- L4 记忆滑窗：读历史 + 落当前轮（best-effort，失败降级无记忆）----
        messages: list[dict[str, Any]] = []
        if request.session_id:
            try:
                memory_engine.push_chat_turn(request.session_id, "user", request.message)
                for turn in memory_engine.get_chat_window(request.session_id)[:-1]:
                    role = "user" if turn.get("role") == "user" else "assistant"
                    messages.append({"role": role, "content": str(turn.get("content") or "")})
            except Exception:
                logger.exception("[minimax] 记忆滑窗注入失败 sid=%s，降级无记忆。", request.session_id)

        image_blocks = attachments_to_blocks(request.attachments or [])
        if image_blocks:
            messages.append({
                "role": "user",
                "content": [*image_blocks, {"type": "text", "text": request.message}],
            })
        else:
            messages.append({"role": "user", "content": request.message})

        # ---- system / tools 构造（含主动缓存断点注入）----
        system: str | None = mcp_system_prompt or None
        # Why: 能力位 gates web_search tool 注入。模型 catalog 默认全 True，
        # 但运行时再校一次——model_id 漂移 / 自定义模型时避免误注入。
        if wants_web and capabilities_for_model(model_id).supports_server_web_search:
            tools: list[dict[str, Any]] | None = [dict(WEB_SEARCH_TOOL)]
        elif wants_web:
            # 模型不支持服务端联网 → 显式提示节点（不走误导占位卡片）
            yield event("node", {
                "node_name": "web_search",
                "status": "skipped",
                "message": f"模型 {model_id} 不支持 MiniMax 服务端联网搜索（仅 Anthropic Messages 协议级）",
                "provider": "minimax",
                "native_search": False,
                "skipped_reason": "model_not_support_server_web_search",
                "timestamp_ms": int(time.time() * 1000),
            })
            tools = None
        else:
            tools = None
        system, tools = apply_cache_breakpoints(model_id, system=system, tools=tools)
        thinking_payload = build_thinking_payload(thinking, settings, max_tokens)

        # Why: 文本对话走套餐 Key（tokenplan），普通 Key 仅供视频 H3。
        chat_key = (settings.minimax_video_api_key or settings.api_key or "").strip()
        client = MiniMaxClient(api_key=chat_key, base_url=settings.base_url)
        stream = client.stream_message(
            model=model_id,
            messages=messages,
            max_tokens=max_tokens,
            system=system,
            tools=tools,
            thinking=thinking_payload,
            temperature=temperature,
        )
        for evt in stream:
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
                    yield event("token", {"token": piece})
            elif evt_type == "server_tool_use":
                query = str((evt.get("block") or {}).get("input", {}).get("query") or "")
                if query:
                    yield event("node", {
                        "node_name": "web_search",
                        "status": "processing",
                        "message": f"MiniMax 服务端搜索：{query}",
                        "provider": "minimax",
                        "native_search": True,
                        "timestamp_ms": int(time.time() * 1000),
                    })
            elif evt_type == "web_search_tool_result":
                # Why 实时推送：每条 web_search_tool_result 独立 web_docs 事件，
                # 前端可做"阅读了 X 个网页"实时计数（GLM/千问同款契约）。
                new_docs = extract_web_docs(evt.get("block") or {})
                if new_docs:
                    known_urls = {str(doc.get("url") or "") for doc in web_docs}
                    new_docs = [doc for doc in new_docs if str(doc.get("url") or "") not in known_urls]
                    if not new_docs:
                        continue
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
            elif evt_type in ("message_delta", "message_stop"):
                if evt.get("usage"):
                    latest_usage = dict(evt["usage"])

        final_answer = "".join(answer_parts)
        reasoning_len = sum(len(p) for p in reasoning_parts)
        frontend_usage = convert_usage(latest_usage)

        # token 记账：observe_response 兼容 input_tokens/output_tokens 键名提取。
        if latest_usage:
            try:
                observe_response(SimpleNamespace(model=model_id, usage=SimpleNamespace(**latest_usage)))
            except Exception:
                logger.exception("[minimax] token 记账失败（不影响回答流）。")

        yield event("node", {
            "node_name": f"MiniMax · {model_id}",
            "status": "completed",
            "message": "模型调用完成",
            "provider": "minimax",
            "timestamp_ms": int(time.time() * 1000),
        })
        yield event("node", {
            "node_name": "chat",
            "status": "completed",
            "message": (
                f"生成完成：答案 {len(final_answer)} 字"
                + (f"，推理过程 {reasoning_len} 字" if thinking else "")
            ),
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
            "web_docs": web_docs or (
                [{
                    "id": 0,
                    "title": "🌐 MiniMax 服务端搜索（模型按需检索）",
                    "url": "",
                    "content": "引用来源由模型在推理中自动检索并内联标注到回答正文。",
                    "native_search": True,
                    "score": 0.0,
                }]
                if wants_web else []
            ),
        })

        # ---- 记忆后置落账（best-effort）----
        if request.session_id and final_answer:
            try:
                memory_engine.push_chat_turn(request.session_id, "assistant", final_answer)
                memory_engine.maybe_summarize(request.session_id, chat_mode=True)
            except Exception:
                logger.exception("[minimax] direct chat 后置落账失败 sid=%s。", request.session_id)

    except MiniMaxAPIError as exc:
        yield event("error", {
            "message": exc.message,
            "code": f"MINIMAX_{exc.status_code or 'REQUEST_ERROR'}",
        })
    except Exception as exc:
        logger.exception("[minimax] 直连生成器异常")
        status = getattr(exc, "status_code", None)
        message = f"MiniMax 调用失败：{exc}"
        if status in {401, 403}:
            message = "MiniMax API 密钥无效或无权限"
        elif status == 429:
            message = "MiniMax 请求被限流或额度不足"
        yield event("error", {"message": message, "code": f"MINIMAX_{status or 'REQUEST_ERROR'}"})
