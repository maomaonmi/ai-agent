"""mcp_manager 单元测试：假 MCP server（newline JSON-RPC over stdio）验证全生命周期。

Why 不用 pytest-asyncio：项目测试套件未引入该依赖，统一 asyncio.run 驱动，零新增依赖。
"""

from __future__ import annotations

import asyncio
import json
import sys
import textwrap
import time
from pathlib import Path

import pytest

from mcp_manager import (
    McpProcessPool,
    McpServerProcess,
    make_tool_name,
    parse_tool_name,
)

FAKE_SERVER = textwrap.dedent(
    """
    import sys, json, time

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        if "id" not in req:
            continue  # notification（如 initialized）无响应
        method = req.get("method")
        if method == "initialize":
            result = {"protocolVersion": "2024-11-05", "capabilities": {},
                      "serverInfo": {"name": "fake", "version": "0.1"}}
        elif method == "tools/list":
            result = {"tools": [
                {"name": "echo", "description": "回声",
                 "inputSchema": {"type": "object",
                                 "properties": {"text": {"type": "string"}},
                                 "required": ["text"]}},
                {"name": "sleep", "description": "沉睡",
                 "inputSchema": {"type": "object",
                                 "properties": {"seconds": {"type": "number"}}}},
            ]}
        elif method == "tools/call":
            params = req.get("params", {})
            if params.get("name") == "sleep":
                time.sleep(float(params.get("arguments", {}).get("seconds", 5)))
            text = str(params.get("arguments", {}).get("text", ""))
            result = {"content": [{"type": "text", "text": text}]}
        else:
            resp = {"jsonrpc": "2.0", "id": req["id"],
                    "error": {"code": -32601, "message": "unknown method"}}
            sys.stdout.write(json.dumps(resp) + "\\n")
            sys.stdout.flush()
            continue
        resp = {"jsonrpc": "2.0", "id": req["id"], "result": result}
        sys.stdout.write(json.dumps(resp) + "\\n")
        sys.stdout.flush()
    """
)


@pytest.fixture()
def fake_server_script(tmp_path: Path) -> Path:
    script = tmp_path / "fake_mcp_server.py"
    script.write_text(FAKE_SERVER, encoding="utf-8")
    return script


def _write_config(config_path: Path, script: Path, *, enabled: bool = True) -> None:
    config_path.write_text(
        json.dumps(
            {
                "mcpServers": {
                    "fake": {
                        "command": sys.executable,
                        "args": [str(script)],
                        "env": {},
                        "enabled": enabled,
                        "installed_at": "2026-08-07T00:00:00",
                    }
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _run(coro):
    return asyncio.run(coro)


async def _make_pool(tmp_path: Path, script: Path, **kwargs) -> McpProcessPool:
    config_path = tmp_path / "installed_mcps.json"
    _write_config(config_path, script)
    pool = McpProcessPool(config_path, **kwargs)
    await pool.sync_from_config()
    assert await pool.wait_ready("fake", timeout=15), pool.server_status()
    return pool


# ── 工具名编解码 ────────────────────────────────────────────────────────


def test_tool_name_roundtrip():
    name = make_tool_name("github-mcp", "search_code")
    assert name == "mcp__github-mcp__search_code"
    assert parse_tool_name(name) == ("github-mcp", "search_code")
    assert parse_tool_name("write_file") is None
    assert parse_tool_name("mcp__onlyserver") is None


# ── 生命周期与调用 ──────────────────────────────────────────────────────


def test_handshake_list_tools_and_echo(tmp_path, fake_server_script):
    async def main():
        pool = await _make_pool(tmp_path, fake_server_script)
        try:
            status = pool.server_status()
            assert status[0]["status"] == "ready"
            assert status[0]["tool_count"] == 2

            result = await pool.dispatch(
                make_tool_name("fake", "echo"), {"text": "你好 MCP"}
            )
            assert result == "你好 MCP"
        finally:
            await pool.shutdown_all()
        assert pool.servers == {}

    _run(main())


def test_tool_specs_prefix_filter_and_budget(tmp_path, fake_server_script):
    async def main():
        pool = await _make_pool(tmp_path, fake_server_script)
        try:
            specs = pool.all_tool_specs()
            names = [s["function"]["name"] for s in specs]
            assert names == ["mcp__fake__echo", "mcp__fake__sleep"]

            # 会话级 custom 过滤：白名单外的 server 不注入
            assert pool.all_tool_specs(allowed_server_ids=set()) == []
            assert pool.all_tool_specs(allowed_server_ids={"fake"}) == specs

            # token 预算护栏：预算只够一个工具时截断
            pool.tool_schema_budget_chars = len(
                json.dumps(specs[0], ensure_ascii=False)
            ) + 10
            trimmed = pool.all_tool_specs()
            assert len(trimmed) == 1
        finally:
            await pool.shutdown_all()

    _run(main())


def test_dispatch_guards(tmp_path, fake_server_script):
    async def main():
        pool = await _make_pool(tmp_path, fake_server_script)
        try:
            bad_name = json.loads(await pool.dispatch("write_file", {}))
            assert bad_name["ok"] is False

            unknown = json.loads(await pool.dispatch("mcp__ghost__echo", {}))
            assert unknown["ok"] is False
            assert "未安装" in unknown["error"]

            # 会话级 off：allowed 为空集时 dispatch 同样拦截
            denied = json.loads(
                await pool.dispatch(
                    "mcp__fake__echo", {"text": "x"}, allowed_server_ids=set()
                )
            )
            assert denied["ok"] is False
            assert "未启用" in denied["error"]
        finally:
            await pool.shutdown_all()

    _run(main())


def test_call_timeout_returns_structured_error(tmp_path, fake_server_script):
    async def main():
        pool = await _make_pool(tmp_path, fake_server_script, call_timeout=0.5)
        try:
            result = json.loads(
                await pool.dispatch("mcp__fake__sleep", {"seconds": 5})
            )
            assert result["ok"] is False
            assert "超时" in result["error"]
            # 超时后 server 仍应可用（读循环未死）
            assert pool.servers["fake"].status == "ready"
        finally:
            await pool.shutdown_all()

    _run(main())


def test_crash_triggers_backoff_restart(tmp_path, fake_server_script):
    async def main():
        pool = await _make_pool(tmp_path, fake_server_script)
        try:
            server = pool.servers["fake"]
            assert server.process is not None
            server.process.kill()  # 模拟崩溃

            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if server.status == "ready" and server.restart_count >= 1:
                    break
                await asyncio.sleep(0.2)
            assert server.restart_count >= 1
            assert server.status == "ready"

            # 重启后工具仍可调用
            result = await pool.dispatch("mcp__fake__echo", {"text": "复活"})
            assert result == "复活"
        finally:
            await pool.shutdown_all()

    _run(main())


def test_sync_diff_add_remove(tmp_path, fake_server_script):
    async def main():
        pool = await _make_pool(tmp_path, fake_server_script)
        config_path = pool.config_path
        try:
            assert "fake" in pool.servers

            # 停用 → 同步后进程被杀并移除
            _write_config(config_path, fake_server_script, enabled=False)
            await pool.sync_from_config()
            assert pool.servers == {}

            # 重新启用 → 拉起新进程
            _write_config(config_path, fake_server_script, enabled=True)
            await pool.sync_from_config()
            assert await pool.wait_ready("fake", timeout=15)
        finally:
            await pool.shutdown_all()

    _run(main())


def test_broken_config_file_is_tolerated(tmp_path):
    config_path = tmp_path / "installed_mcps.json"
    config_path.write_text("{ 这不是合法 JSON", encoding="utf-8")
    pool = McpProcessPool(config_path)
    assert pool.load_config() == {"mcpServers": {}}
    _run(pool.sync_from_config())  # 不应抛异常
    assert pool.servers == {}
