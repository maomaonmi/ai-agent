"""MiniMax OpenAI 兼容端点适配器（LangGraph 多智能体链路 / Code 沙箱 / PPT / 写作复用）。

Why: agent / distributed_plan 走现有 LangGraph 链路（bind_tools 依赖 OpenAI 协议），
Code/PPT/写作也以 OpenAI 客户端调用——MiniMax OpenAI 兼容端点
（https://api.minimaxi.com/v1）让这些链路零架构改动接入。

协议要点：
- extra_body={"reasoning_split": True} 时思考内容分离到 reasoning_details 字段；
  不开启则 <think> 标签混在 content 里（strip_think_tags 兜底剥离）。
- Interleaved Thinking 纪律（多轮工具循环）：完整 response_message（含 tool_calls /
  reasoning_details）必须保留在消息历史——调用方职责，本模块提供 rebuild helpers。
"""

from __future__ import annotations

import re
from typing import Any

from model_settings import ModelSettings

from .constants import OPENAI_COMPAT_BASE_URL

_THINK_PATTERN = re.compile(r"<think>.*?</think>", re.DOTALL)
_OPEN_THINK_PATTERN = re.compile(r"<think>.*", re.DOTALL)
_OPEN_TAG = "<think>"
_CLOSE_TAG = "</think>"


def strip_think_tags(text: str) -> str:
    """剥离 MiniMax OpenAI 兼容路径混入 content 的 <think> 标签。

    兜底两条路径：完整 <think>...</think> 成对剥离；流式截断只剩开标签时丢弃其后内容。
    """
    if not text or "<think>" not in text:
        return text
    text = _THINK_PATTERN.sub("", text)
    # Why: 流式分片中闭标签还没到，开标签之后的内容全是思考——不能进入正文。
    text = _OPEN_THINK_PATTERN.sub("", text)
    return text.strip()


class ThinkTagStreamer:
    """流式 <think> 标签剥离器（跨 chunk 状态机）。

    Why: reasoning_split 未生效时，思考以 <think>...</think> 混入 content 分片；
    单片独立剥离无法处理"开标签与思考内容分属不同 chunk"的情况，必须维护
    in_think 状态。尾部出现标签真前缀（如 "<th"）时暂存到下个 chunk 再判定，
    防止标签本身被拆分后误放行。
    """

    def __init__(self) -> None:
        self._in_think = False
        self._pending = ""

    def feed(self, text: str) -> str:
        if not text:
            return ""
        data = self._pending + text
        self._pending = ""
        out: list[str] = []
        pos = 0
        while pos < len(data):
            if self._in_think:
                end = data.find(_CLOSE_TAG, pos)
                if end == -1:
                    # 尾部可能是 "</think>" 的真前缀 → 暂存待下片判定
                    self._pending = self._split_tag_prefix(data, pos, _CLOSE_TAG)
                    return "".join(out)
                self._in_think = False
                pos = end + len(_CLOSE_TAG)
            else:
                start = data.find(_OPEN_TAG, pos)
                if start == -1:
                    tail = self._split_tag_prefix(data, pos, _OPEN_TAG)
                    out.append(data[pos:len(data) - len(tail)])
                    self._pending = tail
                    break
                out.append(data[pos:start])
                self._in_think = True
                pos = start + len(_OPEN_TAG)
        return "".join(out)

    @staticmethod
    def _split_tag_prefix(data: str, pos: int, tag: str) -> str:
        """返回 data[pos:] 尾部中 tag 的最长真前缀（无则空串）。"""
        tail = data[pos:]
        limit = min(len(tail), len(tag) - 1)
        for size in range(limit, 0, -1):
            if tail.endswith(tag[:size]):
                return tail[-size:]
        return ""

    def flush(self) -> str:
        """流结束：残留 pending 若非完整标签则按正文放行。"""
        rest = self._pending
        self._pending = ""
        return "" if self._in_think else rest


def extract_reasoning(message: Any) -> str:
    """提取 reasoning_details 思考文本（reasoning_split=True 时生效）。"""
    details = getattr(message, "reasoning_details", None)
    if not details:
        raw = getattr(message, "model_extra", None) or {}
        details = raw.get("reasoning_details")
    if not details:
        return ""
    parts: list[str] = []
    for item in details:
        if isinstance(item, dict):
            parts.append(str(item.get("text", "")))
        else:
            parts.append(str(getattr(item, "text", "") or ""))
    return "".join(p for p in parts if p)


def openai_compat_credentials(settings: ModelSettings) -> tuple[str, str]:
    """返回 (api_key, base_url)：MiniMax OpenAI 兼容端点。"""
    return settings.api_key, OPENAI_COMPAT_BASE_URL


def build_create_kwargs(
    settings: ModelSettings,
    *,
    thinking_enabled: bool = True,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """构造 OpenAI 兼容 create_kwargs（不含 messages/model——调用方自行传）。

    Why 断言级约束：MiniMax 分支仅携带 reasoning_split，严禁混入 GLM/千问/DeepSeek
    协议参数（thinking/enable_thinking/thinking_budget/reasoning_effort），防 400。
    """
    kwargs: dict[str, Any] = {
        "max_tokens": settings.max_tokens,
        "temperature": settings.temperature,
        "extra_body": {"reasoning_split": True},
    }
    if not thinking_enabled:
        # 关闭思考：MiniMax OpenAI 路径无显式开关字段，仅停用思考分离并依赖 strip 兜底
        kwargs["extra_body"] = {}
    if extra:
        kwargs.update(extra)
    forbidden = {"thinking", "enable_thinking", "thinking_budget", "reasoning_effort"}
    leaked = forbidden & set(kwargs) | forbidden & set(kwargs.get("extra_body") or {})
    if leaked:
        raise ValueError(f"MiniMax OpenAI 兼容路径禁止携带他协议思考参数：{leaked}")
    return kwargs
