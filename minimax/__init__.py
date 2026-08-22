"""MiniMax 供应商自包含接入包。

Why: main.py/App.py 已过载（432KB/311KB），MiniMax 主链路（Anthropic Messages 协议、
Interleaved Thinking 工具循环、服务端联网搜索、主动缓存）全部收敛在本包内，
main.py/App.py 只做薄分发调用，不 import 本包以外的业务符号。

架构红线（见 .trae/specs/integrate-minimax-provider/spec.md）：
1. 本包禁止 import main.py / App.py 的内部符号（单向依赖）。
2. 能力判断一律走 model_settings.capabilities_for_model()，禁止字符串嗅探。
3. API Key 走 settings 持久化 + public() 脱敏，禁止明文回传前端。
"""

from .constants import (
    ANTHROPIC_BASE_URL,
    OPENAI_COMPAT_BASE_URL,
    MODEL_M3,
    IMAGE_MODEL_ID,
    VIDEO_MODEL_ID,
    VIDEO_MODEL_ID_HAILUO,
    WEB_SEARCH_TOOL,
)
from .client import MiniMaxClient, MiniMaxAPIError
from .caching import apply_cache_breakpoints, supports_active_cache
from .research import generate_minimax_research_events

__all__ = [
    "ANTHROPIC_BASE_URL",
    "OPENAI_COMPAT_BASE_URL",
    "MODEL_M3",
    "IMAGE_MODEL_ID",
    "VIDEO_MODEL_ID",
    "WEB_SEARCH_TOOL",
    "MiniMaxClient",
    "MiniMaxAPIError",
    "apply_cache_breakpoints",
    "supports_active_cache",
    "generate_minimax_research_events",
]
