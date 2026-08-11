"""MCP 进程池管理器：asyncio 子进程 + JSON-RPC over stdio。

Why 异步重写：参考实现 `MCP&Skills/mcp_client_manager.py` 用同步阻塞 readline，
在 uvicorn 事件循环中会冻结所有 SSE 流（本项目断流前车之鉴）。
本模块全部基于 asyncio 子进程，读循环后台任务化，调用按 id 分发到 pending future。

关键策略：
- 命名空间隔离：工具名统一改写为 mcp__<server_id>__<tool>，防与内置 TOOL_REGISTRY 撞名。
- 崩溃自愈：读循环检测 EOF/异常退出 → 指数退避重启（1s/2s/4s，上限 max_restart）。
- 调用超时：tools/call 默认 30s wait_for，超时返回结构化错误而非挂起。
- Windows 兼容：npx 在 Windows 实为 npx.cmd，CreateProcess 无法直接执行批处理，
  需经 cmd /c 启动（见 _resolve_launch）。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger("app.mcp")

MCP_PROTOCOL_VERSION = "2024-11-05"
TOOL_NAME_PREFIX = "mcp__"
# Why: 注入工具的 schema 总字符数设上限，防止装多个 server 后 system prompt 爆炸。
DEFAULT_TOOL_SCHEMA_BUDGET_CHARS = 30000

ALLOWED_COMMANDS = {"npx", "uvx", "python", "node", "cmd", "npm"}


def make_tool_name(server_id: str, tool_name: str) -> str:
    return f"{TOOL_NAME_PREFIX}{server_id}__{tool_name}"


def parse_tool_name(name: str) -> tuple[str, str] | None:
    """mcp__<server>__<tool> → (server_id, tool)；非 MCP 工具名返回 None。"""
    if not name.startswith(TOOL_NAME_PREFIX):
        return None
    rest = name[len(TOOL_NAME_PREFIX):]
    server, sep, tool = rest.partition("__")
    if not sep or not server or not tool:
        return None
    return server, tool


def _resolve_launch(command: str, args: list[str]) -> tuple[list[str], bool]:
    """返回 (argv, use_shell)。

    Why: Windows 上 npx/npm 本质是 .cmd 批处理，CreateProcess 不能直接执行，
    必须经 cmd /c；uvx/pip 随 uv/Python 分发为原生 .exe，可直接 exec。
    shutil.which 在不同 Python 版本可能返回不带后缀的路径，
    因此先按命令名白名单包装 Node 系工具，再兜底检测 .cmd/.bat 后缀更可靠。
    POSIX 与原生 exe（python/node/uvx）走 create_subprocess_exec 即可。
    """
    resolved = shutil.which(command) or command
    if os.name == "nt":
        cmd_lower = command.lower()
        if cmd_lower in {"npx", "npm"}:
            return [resolved, *args], True
        if resolved.lower().endswith((".cmd", ".bat")):
            return [resolved, *args], True
    return [resolved, *args], False


class McpServerProcess:
    """单个 MCP server 的 stdio 子进程封装。"""

    def __init__(
        self,
        server_id: str,
        command: str,
        args: list[str],
        env: dict[str, str],
        *,
        call_timeout: float = 30.0,
        max_restart: int = 3,
        on_state_change: Callable[[], None] | None = None,
    ) -> None:
        self.server_id = server_id
        self.command = command
        self.args = list(args)
        self.env = dict(env)
        self.call_timeout = call_timeout
        self.max_restart = max_restart
        self._on_state_change = on_state_change

        self.process: asyncio.subprocess.Process | None = None
        self.status: str = "stopped"  # pending/ready/error/stopped
        self.tools: list[dict[str, Any]] = []
        self.restart_count = 0
        self.last_error: str = ""
        # Why: stderr 不能吞掉，npx 拉包失败/凭证错误全在这里；循环保留供 UI 详情排查。
        self.stderr_lines: deque[str] = deque(maxlen=50)

        self._req_id = 0
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._write_lock = asyncio.Lock()
        self._read_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._stopping = False

    # ── 生命周期 ────────────────────────────────────────────────────────

    async def start(self) -> None:
        """拉起子进程 → initialize 握手 → notifications/initialized → tools/list。"""
        self._stopping = False
        self.status = "pending"
        self._notify()
        argv, use_shell = _resolve_launch(self.command, self.args)
        child_env = {**os.environ, **self.env}
        try:
            if use_shell:
                # Why: .cmd 必须经 cmd.exe；list2cmdline 负责 Windows 引号转义。
                self.process = await asyncio.create_subprocess_shell(
                    subprocess.list2cmdline(argv),
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=child_env,
                )
            else:
                self.process = await asyncio.create_subprocess_exec(
                    *argv,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=child_env,
                )
        except (OSError, FileNotFoundError) as exc:
            self.status = "error"
            self.last_error = f"进程拉起失败：{exc}"
            logger.error("[mcp] %s 拉起失败: %s", self.server_id, exc)
            self._notify()
            return

        self._read_task = asyncio.create_task(self._read_loop())
        self._stderr_task = asyncio.create_task(self._stderr_loop())

        try:
            await self._request(
                "initialize",
                {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "ai-agent-host", "version": "1.0"},
                },
            )
            await self._notify_initialized()
            resp = await self._request("tools/list", {})
            self.tools = list(resp.get("result", {}).get("tools", []))
            self.status = "ready"
            self.last_error = ""
            logger.info(
                "[mcp] %s 就绪，发现 %d 个工具", self.server_id, len(self.tools)
            )
        except (TimeoutError, RuntimeError, json.JSONDecodeError) as exc:
            self.status = "error"
            stderr_tail = self._stderr_tail()
            self.last_error = f"握手失败：{exc}"
            if stderr_tail:
                self.last_error += f"\nstderr 尾部：\n{stderr_tail}"
                logger.error("[mcp] %s 握手失败: %s\nstderr tail:\n%s", self.server_id, exc, stderr_tail)
            else:
                logger.error("[mcp] %s 握手失败: %s", self.server_id, exc)
            await self._kill_process()
        self._notify()

    async def stop(self) -> None:
        """terminate → 5s 宽限 → kill。"""
        self._stopping = True
        self.status = "stopped"
        await self._kill_process()
        self._fail_all_pending(RuntimeError("server stopped"))
        self._notify()

    async def _kill_process(self) -> None:
        proc = self.process
        self.process = None
        if proc is None:
            return
        try:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5.0)
            except TimeoutError:
                proc.kill()
                await proc.wait()
        except ProcessLookupError:
            pass

    # ── 工具调用 ────────────────────────────────────────────────────────

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        if self.status != "ready":
            return json.dumps(
                {"ok": False, "error": f"MCP server {self.server_id} 未就绪（{self.status}）"},
                ensure_ascii=False,
            )
        try:
            resp = await self._request(
                "tools/call", {"name": name, "arguments": arguments}
            )
        except TimeoutError:
            return json.dumps(
                {"ok": False, "error": f"MCP 工具 {name} 调用超时（{self.call_timeout}s）"},
                ensure_ascii=False,
            )
        if "error" in resp:
            return json.dumps({"ok": False, "error": str(resp["error"])}, ensure_ascii=False)
        content = resp.get("result", {}).get("content", [])
        text = "\n".join(
            item.get("text", "") for item in content if isinstance(item, dict)
        )
        return text or json.dumps(resp.get("result", {}), ensure_ascii=False)

    # ── JSON-RPC 收发 ───────────────────────────────────────────────────

    def _next_id(self) -> int:
        self._req_id += 1
        return self._req_id

    async def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if self.process is None or self.process.stdin is None:
            raise RuntimeError("进程未运行")
        req_id = self._next_id()
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending[req_id] = future
        payload = json.dumps(
            {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params},
            ensure_ascii=False,
        )
        async with self._write_lock:
            self.process.stdin.write(payload.encode("utf-8") + b"\n")
            await self.process.stdin.drain()
        try:
            return await asyncio.wait_for(future, timeout=self.call_timeout)
        except TimeoutError:
            self._pending.pop(req_id, None)
            raise

    async def _notify_initialized(self) -> None:
        if self.process is None or self.process.stdin is None:
            return
        payload = json.dumps(
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            ensure_ascii=False,
        )
        async with self._write_lock:
            self.process.stdin.write(payload.encode("utf-8") + b"\n")
            await self.process.stdin.drain()

    async def _read_loop(self) -> None:
        """按 id 分发响应到 pending future；EOF 视为崩溃，触发自愈重启。"""
        assert self.process is not None and self.process.stdout is not None
        proc = self.process
        try:
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                try:
                    msg = json.loads(line.decode("utf-8", errors="replace").strip())
                except json.JSONDecodeError:
                    continue
                req_id = msg.get("id")
                if req_id is not None and req_id in self._pending:
                    self._pending.pop(req_id).set_result(msg)
        except (ConnectionResetError, BrokenPipeError, ValueError) as exc:
            logger.warning("[mcp] %s 读循环异常: %s", self.server_id, exc)
        finally:
            if not self._stopping:
                await self._on_crash()

    async def _stderr_loop(self) -> None:
        assert self.process is not None and self.process.stderr is not None
        proc = self.process
        try:
            while True:
                line = await proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").rstrip()
                self.stderr_lines.append(text)
                logger.debug("[mcp][%s][stderr] %s", self.server_id, text)
        except (ConnectionResetError, ValueError):
            pass

    def _stderr_tail(self, n: int = 10) -> str:
        """Why: 进程崩溃/握手失败时把 stderr 尾部带出来，否则只有"进程意外退出"完全没法定位原因。"""
        tail = list(self.stderr_lines)[-n:]
        return "\n".join(tail)

    async def _on_crash(self) -> None:
        """指数退避重启（1s/2s/4s），超限置 error 等用户干预。"""
        stderr_tail = self._stderr_tail()
        self._fail_all_pending(RuntimeError("MCP server 进程意外退出"))
        self.process = None
        self.tools = []
        if self.restart_count >= self.max_restart:
            self.status = "error"
            self.last_error = f"连续崩溃 {self.restart_count} 次，已放弃自愈"
            if stderr_tail:
                self.last_error += f"\nstderr 尾部：\n{stderr_tail}"
            logger.error("[mcp] %s %s", self.server_id, self.last_error)
            self._notify()
            return
        delay = 2.0 ** self.restart_count
        self.restart_count += 1
        self.status = "pending"
        self.last_error = f"进程退出，{delay:.0f}s 后第 {self.restart_count} 次重启"
        if stderr_tail:
            self.last_error += f"\nstderr 尾部：\n{stderr_tail}"
            logger.warning("[mcp] %s %s\nstderr tail:\n%s", self.server_id, self.last_error, stderr_tail)
        else:
            logger.warning("[mcp] %s %s", self.server_id, self.last_error)
        self._notify()
        await asyncio.sleep(delay)
        if not self._stopping:
            await self.start()

    def _fail_all_pending(self, exc: Exception) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(exc)
        self._pending.clear()

    def _notify(self) -> None:
        if self._on_state_change is not None:
            try:
                self._on_state_change()
            except Exception:  # noqa: BLE001 - 回调异常不得影响进程管理主链路
                logger.exception("[mcp] 状态回调异常")

    def snapshot(self) -> dict[str, Any]:
        return {
            "server_id": self.server_id,
            "status": self.status,
            "tool_count": len(self.tools),
            "tools": [t.get("name", "") for t in self.tools],
            "restart_count": self.restart_count,
            "last_error": self.last_error,
            "stderr_tail": list(self.stderr_lines)[-10:],
        }


class McpProcessPool:
    """常驻进程池：对照 installed_mcps.json 做 diff 同步。"""

    def __init__(
        self,
        config_path: str | Path,
        *,
        call_timeout: float = 30.0,
        max_restart: int = 3,
        tool_schema_budget_chars: int = DEFAULT_TOOL_SCHEMA_BUDGET_CHARS,
    ) -> None:
        self.config_path = Path(config_path)
        self.call_timeout = call_timeout
        self.max_restart = max_restart
        self.tool_schema_budget_chars = tool_schema_budget_chars
        self.servers: dict[str, McpServerProcess] = {}

    # ── 配置读写 ────────────────────────────────────────────────────────

    def load_config(self) -> dict[str, Any]:
        if not self.config_path.exists():
            return {"mcpServers": {}}
        try:
            data = json.loads(self.config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.error("[mcp] 配置文件 JSON 损坏：%s", self.config_path)
            return {"mcpServers": {}}
        if not isinstance(data, dict) or not isinstance(data.get("mcpServers"), dict):
            return {"mcpServers": {}}
        return data

    def save_config(self, data: dict[str, Any]) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # ── 池同步 ──────────────────────────────────────────────────────────

    async def sync_from_config(self) -> None:
        """diff 同步：新增拉起 / 停用杀掉 / 配置变更重启。只动受影响的 server。"""
        config = self.load_config()["mcpServers"]
        desired = {sid: cfg for sid, cfg in config.items() if cfg.get("enabled", True)}

        for sid in list(self.servers):
            current = self.servers[sid]
            target = desired.get(sid)
            changed = target is not None and (
                target.get("command") != current.command
                or list(target.get("args", [])) != current.args
                or dict(target.get("env", {})) != current.env
            )
            if target is None or changed:
                await current.stop()
                del self.servers[sid]

        for sid, cfg in desired.items():
            if sid in self.servers:
                continue
            server = McpServerProcess(
                sid,
                str(cfg.get("command", "")),
                list(cfg.get("args", [])),
                dict(cfg.get("env", {})),
                call_timeout=self.call_timeout,
                max_restart=self.max_restart,
            )
            self.servers[sid] = server
            await server.start()
        # 等待所有进程进入 ready/error 终态，确保 lifespan 返回时工具可用
        for sid, server in self.servers.items():
            if server.status not in ("ready", "error"):
                await self.wait_ready(sid, timeout=15.0)

    async def wait_ready(self, server_id: str, timeout: float = 60.0) -> bool:
        """供安装后轮询：等待 server 进入 ready/error 终态。"""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            server = self.servers.get(server_id)
            if server is None:
                return False
            if server.status == "ready":
                return True
            if server.status == "error":
                return False
            await asyncio.sleep(0.5)
        return False

    async def shutdown_all(self) -> None:
        for server in list(self.servers.values()):
            await server.stop()
        self.servers.clear()

    # ── 工具注入与分发 ──────────────────────────────────────────────────

    def all_tool_specs(
        self, allowed_server_ids: set[str] | None = None
    ) -> list[dict[str, Any]]:
        """汇总 ready server 的 OpenAI function schema，带 token 预算护栏。

        allowed_server_ids=None 表示全部；传入集合实现会话级 custom 过滤。
        """
        specs: list[dict[str, Any]] = []
        budget = self.tool_schema_budget_chars
        used = 0
        for sid in sorted(self.servers):  # 排序保证注入顺序稳定，利于前缀缓存
            if allowed_server_ids is not None and sid not in allowed_server_ids:
                continue
            server = self.servers[sid]
            if server.status != "ready":
                continue
            for tool in server.tools:
                schema = {
                    "type": "function",
                    "function": {
                        "name": make_tool_name(sid, str(tool.get("name", ""))),
                        "description": str(tool.get("description", "")),
                        "parameters": tool.get("inputSchema")
                        or {"type": "object", "properties": {}},
                    },
                }
                cost = len(json.dumps(schema, ensure_ascii=False))
                if used + cost > budget:
                    logger.warning(
                        "[mcp] 工具 schema 超预算（%d chars），跳过 %s 及后续",
                        budget,
                        schema["function"]["name"],
                    )
                    return specs
                specs.append(schema)
                used += cost
        return specs

    async def dispatch(
        self,
        name: str,
        arguments: dict[str, Any],
        allowed_server_ids: set[str] | None = None,
    ) -> str:
        parsed = parse_tool_name(name)
        if parsed is None:
            return json.dumps({"ok": False, "error": f"非法 MCP 工具名：{name}"}, ensure_ascii=False)
        server_id, tool_name = parsed
        if allowed_server_ids is not None and server_id not in allowed_server_ids:
            return json.dumps(
                {"ok": False, "error": f"本会话未启用 MCP 插件 {server_id}"},
                ensure_ascii=False,
            )
        server = self.servers.get(server_id)
        if server is None:
            return json.dumps(
                {"ok": False, "error": f"MCP 插件 {server_id} 未安装或未启用"},
                ensure_ascii=False,
            )
        return await server.call_tool(tool_name, arguments)

    def server_status(self) -> list[dict[str, Any]]:
        return [self.servers[sid].snapshot() for sid in sorted(self.servers)]
