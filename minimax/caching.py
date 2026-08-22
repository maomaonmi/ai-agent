"""MiniMax 主动缓存（cache_control）策略。

官方事实：
- 被动缓存：全系列自动生效（前缀匹配：工具定义→system→messages），无需参数。
- 主动缓存：仅 Anthropic 协议显式 cache_control；**仅 M2.7/M2.5 系列支持，M3 不支持**。
- 5min 过期自动续期；单请求最多 4 个断点；20 块回溯窗口。

本包策略：最多 2 个断点——tools 尾项 + system 尾块，由能力位 supports_active_cache 门控。
"""

from __future__ import annotations

from model_settings import capabilities_for_model

from .constants import MAX_CACHE_BREAKPOINTS


def supports_active_cache(model_id: str) -> bool:
    """当前模型是否支持主动缓存（M3 返回 False——请求携带 cache_control 会报错）。"""
    return capabilities_for_model(model_id).supports_active_cache


def apply_cache_breakpoints(
    model_id: str,
    *,
    system: str | list[dict] | None,
    tools: list[dict] | None,
) -> tuple[str | list[dict] | None, list[dict] | None]:
    """按能力位注入 cache_control 断点，返回 (system, tools)。

    Why 断点位置：缓存前缀按 tools → system → messages 层级构建；把断点放在
    tools 尾项与 system 尾块，静态前缀整体可被缓存，滑窗历史与最新用户消息留在尾部。
    M3 / 无静态内容时不注入（返回原值），保证请求体永不携带非法字段。
    """
    if not supports_active_cache(model_id):
        return system, tools

    # system 尾块断点（仅当 system 为块列表且非空；纯字符串转块列表后打点）
    if isinstance(system, str) and system.strip():
        system = [
            {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}},
        ]
    elif isinstance(system, list) and system:
        system = [dict(block) for block in system]
        last = system[-1]
        if "cache_control" not in last:
            last["cache_control"] = {"type": "ephemeral"}

    # tools 尾项断点
    if tools:
        tools = [dict(tool) for tool in tools]
        last_tool = tools[-1]
        if "cache_control" not in last_tool:
            last_tool["cache_control"] = {"type": "ephemeral"}

    # 防御：断点数不超过官方上限（本策略最多 2，冗余保护）
    assert MAX_CACHE_BREAKPOINTS >= 2, "官方断点上限收缩，需复核缓存策略"
    return system, tools
