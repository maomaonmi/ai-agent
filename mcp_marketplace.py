"""MCP 市场配置加载与安全校验。

安全约束（对应计划 §4.3）：
- GET 类接口永不返回完整 env 值（掩码处理）；PUT 时掩码字段保留原值。
- 配置文件保存时校验 command 白名单（npx/uvx/python/node），拒绝任意可执行路径。
- env_schema 必填项服务端校验。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ALLOWED_COMMANDS = {"npx", "uvx", "python", "node"}

MASK = "***"
MASK_KEEP_PREFIX = 4


def load_catalog(catalog_path: str | Path) -> list[dict[str, Any]]:
    path = Path(catalog_path)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def mask_secret(value: str) -> str:
    """ghp_abcdefgh → ghp_***；短值全掩码。"""
    if not isinstance(value, str) or not value:
        return ""
    if len(value) <= MASK_KEEP_PREFIX:
        return MASK
    return value[:MASK_KEEP_PREFIX] + MASK


def is_masked(value: str) -> bool:
    return isinstance(value, str) and value.endswith(MASK)


def mask_config_env(server_cfg: dict[str, Any]) -> dict[str, Any]:
    """返回 env 已脱敏的 server 配置副本（供 GET 接口）。"""
    masked = dict(server_cfg)
    env = masked.get("env")
    if isinstance(env, dict):
        masked["env"] = {k: mask_secret(str(v)) for k, v in env.items()}
    return masked


def merge_masked_env(
    old_env: dict[str, str], new_env: dict[str, str]
) -> dict[str, str]:
    """PUT 配置时：未修改的掩码字段保留原值，其余采用新值。"""
    merged = dict(old_env)
    for key, value in new_env.items():
        if is_masked(str(value)) and key in old_env:
            continue
        merged[key] = str(value)
    return merged


def validate_env_against_schema(
    env_schema: list[dict[str, Any]], env_values: dict[str, str]
) -> list[str]:
    """安装时必填项校验，返回错误列表（空 = 通过）。"""
    errors: list[str] = []
    for field in env_schema:
        if not isinstance(field, dict):
            continue
        key = str(field.get("key", ""))
        required = bool(field.get("required", True))
        if required and not str(env_values.get(key, "")).strip():
            errors.append(f"缺少必填凭证：{field.get('label') or key}")
    return errors


def validate_mcp_config(data: Any) -> list[str]:
    """JSON 编辑器保存前的结构 + 命令白名单校验，返回错误列表（空 = 通过）。"""
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["顶层必须是 JSON 对象"]
    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        return ["缺少 mcpServers 对象"]
    for sid, cfg in servers.items():
        if not isinstance(cfg, dict):
            errors.append(f"{sid}：配置必须是对象")
            continue
        command = cfg.get("command")
        if not isinstance(command, str) or not command.strip():
            errors.append(f"{sid}：command 缺失或非字符串")
        elif command not in ALLOWED_COMMANDS:
            # Why: JSON 自由编辑必须防任意可执行路径注入。
            errors.append(
                f"{sid}：command 仅允许 {'/'.join(sorted(ALLOWED_COMMANDS))}，收到 {command!r}"
            )
        args = cfg.get("args", [])
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            errors.append(f"{sid}：args 必须是字符串数组")
        env = cfg.get("env", {})
        if not isinstance(env, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in env.items()
        ):
            errors.append(f"{sid}：env 必须是字符串键值对对象")
        if "enabled" in cfg and not isinstance(cfg["enabled"], bool):
            errors.append(f"{sid}：enabled 必须是布尔值")
    return errors
