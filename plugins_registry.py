"""内置能力插件（Plugins 页签）：非 MCP 协议的本地工具启停管理。

Why 与 MCP 区分：MCP 是外部进程协议插件，Plugins 是 App.py TOOL_REGISTRY 里的
本地内置工具。核心写文件链路工具（write_file 等）锁定不可禁用——禁用它们会让
code 模式直接残废，属于明显的 footgun；只有"辅助增强类"工具开放启停。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

# 开放启停的内置插件（tool_name 对应 App.py TOOL_REGISTRY 键）
BUILTIN_PLUGINS: list[dict[str, Any]] = [
    {
        "id": "run_terminal",
        "name": "终端命令提案",
        "icon": "⌨️",
        "tool_name": "run_terminal",
        "modes": ["code"],
        "description": "允许 Agent 登记启动后端等白名单终端命令，经你审批后执行。",
    },
    {
        "id": "validate_project",
        "name": "项目契约校验",
        "icon": "🧪",
        "tool_name": "validate_project",
        "modes": ["code"],
        "description": "允许 Agent 自查全栈契约（5 必需文件 + JS 语法 + 数据库结构）。",
    },
    {
        "id": "get_contract",
        "name": "前后端契约摘要",
        "icon": "🔗",
        "tool_name": "get_contract",
        "modes": ["code"],
        "description": "允许 Agent 提取路由/fetch/字段摘要以对齐前后端契约。",
    },
]

# 锁定工具（仅展示，不可禁用）：禁用会直接破坏 code 模式主链路。
LOCKED_TOOLS: list[dict[str, str]] = [
    {"tool_name": "write_file", "reason": "写文件主链路"},
    {"tool_name": "delete_file", "reason": "写文件主链路"},
    {"tool_name": "set_database", "reason": "写文件主链路"},
    {"tool_name": "read_file", "reason": "读上下文主链路"},
    {"tool_name": "list_files", "reason": "读上下文主链路"},
    {"tool_name": "finalize", "reason": "结束工具循环必需"},
]

_PLUGIN_IDS = {p["id"] for p in BUILTIN_PLUGINS}


class PluginsStore:
    """plugins 启停状态持久化（config/plugins_state.json，缺省全启用）。"""

    def __init__(self, state_path: str | Path) -> None:
        self.state_path = Path(state_path)

    def load_state(self) -> dict[str, bool]:
        if not self.state_path.exists():
            return {}
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
        return {k: bool(v) for k, v in data.items() if k in _PLUGIN_IDS}

    def save_state(self, state: dict[str, bool]) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        cleaned = {k: bool(v) for k, v in state.items() if k in _PLUGIN_IDS}
        self.state_path.write_text(
            json.dumps(cleaned, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def is_enabled(self, plugin_id: str) -> bool:
        return self.load_state().get(plugin_id, True)

    def set_enabled(self, plugin_id: str, enabled: bool) -> None:
        if plugin_id not in _PLUGIN_IDS:
            raise KeyError(plugin_id)
        state = self.load_state()
        state[plugin_id] = enabled
        self.save_state(state)

    def disabled_tools(self) -> set[str]:
        """返回被禁用插件对应的 TOOL_REGISTRY 工具名集合（供工具编排过滤）。"""
        state = self.load_state()
        return {
            p["tool_name"]
            for p in BUILTIN_PLUGINS
            if not state.get(p["id"], True)
        }

    def public_list(self) -> list[dict[str, Any]]:
        state = self.load_state()
        return [
            {
                **{k: v for k, v in p.items() if k != "tool_name"},
                "tool_name": p["tool_name"],
                "enabled": state.get(p["id"], True),
            }
            for p in BUILTIN_PLUGINS
        ]
