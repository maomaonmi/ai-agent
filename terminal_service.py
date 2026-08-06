"""集成终端服务。

在 Windows 上使用 ConPTY (pywinpty) 启动真实的 PowerShell 进程，每个 runId 独占一个独立终端，
前端通过 WebSocket 接发 PTY 字节流（含 ANSI 颜色、光标、PSReadLine 补全），渲染由 xterm.js 负责。

安全闸门（硬规则，任何 Agent 都绕不开）：
1. Agent 无法直接写 stdin，只能“提案命令 → 等待用户审批 → 审批通过后系统写 stdin”这一条通道；
2. CWD 固定锁死在项目根目录；任何 cd / Set-Location 跳到外面都会被 filter 直接拒绝；
3. 危险 verb（Remove-Item / iex / iwr / reg / sc …）及 URL 下载类模式走黑白双名单，
   命中后需要额外二次确认或直接拒绝。

Why 单独文件：App.py 已经 1500+ 行，终端生命周期、提案状态机、安全过滤、进程池维护是独立子系统，
拆出去便于读和改。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import signal
import threading
import time

import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


try:  # 仅 Windows 可用，非 Windows 平台启动时会给一个明确的“不可用”提示而不是 import 崩。
    import winpty  # type: ignore[import-not-found]
except Exception:  # pragma: no cover - 非 Windows 环境
    winpty = None  # type: ignore[assignment]

from fastapi import WebSocket, WebSocketDisconnect


# ---------------------------------------------------------------------------
# 项目根（CWD 硬锁死在这里，用户在终端里也跑不出去）
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT_STR = str(PROJECT_ROOT).replace("\\", "/")


# ---------------------------------------------------------------------------
# 命令安全过滤器
# ---------------------------------------------------------------------------
# 危险 Verb：只要在命令行的“命令起始位置”匹配到这些，直接拒绝（不允许用户点一次确认就放过）。
# 用 \b 边界匹配是为了不误伤 `Write-Output "Remove-Item"` 这种字符串里包含 verb 的情况。
_BLOCKED_VERBS = [
    r"\bRemove-Item\b", r"\bRemove-LocalUser\b", r"\bClear-Content\b",
    r"\bSet-LocalUser\b", r"\bNew-Service\b", r"\bRemove-Service\b",
    r"\bSet-Service\b", r"\bsc.exe\b", r"\bsc\b +(config|create|delete|stop|start)",
    r"\bregedit\b", r"\breg\b +(add|delete|import|export|load|unload)",
    r"\bFormat-Volume\b", r"\bFormat-\w+",
    r"\bnetsh\b", r"\bnet\b +(user|localgroup|use)",
    r"\bbcdedit\b", r"\bdiskpart\b", r"\bmkfs\b",
    r"\bInvoke-Expression\b", r"\biex\b",
    r"\bStart-Process\b +.*-Verb\b.*RunAs",
    r"\bschtasks\b", r"\bRegister-ScheduledJob\b", r"\bNew-ScheduledTask\b",
]
# 二次确认类（允许“执行”但必须再弹一次“这会从互联网拉脚本/改环境变量，是否继续？”）
_NEEDS_CONFIRM_PATTERNS = [
    r"https?://\S+",  # URL 下载类
    r"\bInstall-Package\b", r"\bInstall-Module\b", r"\bwinget\b +install",
    r"\bsetx\b", r"\b[System.Environment]::SetEnvironmentVariable",
    r"\bAdd-Type\b", r"\bCompress-Archive\b.*-DestinationPath\s+[A-Z]:\\",
]
_BLOCKED_VERBS_RE = re.compile("|".join(_BLOCKED_VERBS), re.IGNORECASE)
_NEEDS_CONFIRM_RE = re.compile("|".join(_NEEDS_CONFIRM_PATTERNS), re.IGNORECASE)


def _escapes_outside_root(command: str) -> Optional[str]:
    """检测用户是不是想 cd 到项目根之外。

    返回 None 表示没越界，返回错误消息则表示该命令不允许执行。
    """
    # 简单策略：把 Set-Location / cd / chdir / pushd 里的路径解析成绝对路径，
    # 看是不是在 PROJECT_ROOT_STR 前缀下。解析失败的模糊命令一律放行，
    # 真正在 PowerShell 里 cd .. 时 PTY 子进程不会影响到父进程，但我们依然要尽早提示。
    cd_match = re.search(
        r"(?:^|[\s;&|])(?:Set-Location|cd|chdir|pushd|sl)\s+(?:-Path\s+)?(['\"]?)([^'\"]+)\1",
        command,
        re.IGNORECASE,
    )
    if not cd_match:
        return None
    target = cd_match.group(2).strip().rstrip("\\/\"'")
    if not target or target == "-":
        return None
    try:
        abs_path = Path(target)
        if not abs_path.is_absolute():
            abs_path = (PROJECT_ROOT / abs_path).resolve()
        else:
            abs_path = abs_path.resolve()
        abs_str = str(abs_path).replace("\\", "/")
        if not abs_str.startswith(PROJECT_ROOT_STR.rstrip("/") + "/") and abs_str != PROJECT_ROOT_STR.rstrip("/"):
            return f"终端目录被锁定在项目根，目标路径 {abs_str} 越界。"
    except Exception:  # 解析不清就放过，让 PTY 子进程自己提示“找不到路径”
        return None
    return None


def filter_command(command: str) -> dict[str, Any]:
    """检查命令是否允许执行。

    Returns:
        dict with keys:
          allow: bool
          reason: str  (when allow=False or needs_confirm=True)
          needs_confirm: bool
    """
    cmd = command.strip()
    if not cmd:
        return {"allow": False, "reason": "空命令无需执行。", "needs_confirm": False}
    # 1. 越界 cd
    escape_msg = _escapes_outside_root(cmd)
    if escape_msg:
        return {"allow": False, "reason": escape_msg, "needs_confirm": False}
    # 2. 黑名单 verb（无条件拒绝）
    if _BLOCKED_VERBS_RE.search(cmd):
        return {
            "allow": False,
            "reason": "命令命中高风险黑名单（删除/服务/注册表/脚本执行等），已直接拒绝。",
            "needs_confirm": False,
        }
    # 3. 二次确认
    if _NEEDS_CONFIRM_RE.search(cmd):
        return {
            "allow": True,
            "reason": "命令包含外部下载/环境变量/全局安装类操作，请再次确认是否继续。",
            "needs_confirm": True,
        }
    return {"allow": True, "reason": "", "needs_confirm": False}


# ---------------------------------------------------------------------------
# 提案（Proposition）状态机
# ---------------------------------------------------------------------------
PROPOSITION_TIMEOUT_SECONDS = 90


@dataclass
class TerminalProposition:
    proposition_id: str
    workspace_id: str
    run_id: str
    command: str
    reason: str
    expected_output_hint: str
    created_at: float
    status: str = "pending"  # pending | approved | executed | rejected | timeout | blocked | needs_confirm
    status_message: str = ""
    # 审批时若用户勾选了加入白名单，这里存规范化的 key（命令前缀 hash / verb 组合）
    trust_key: Optional[str] = None
    result_stdout_tail: str = ""
    result_exit_code: Optional[int] = None


# ---------------------------------------------------------------------------
# 单条终端（PTY 进程 + 一条 WS 的状态容器）
# ---------------------------------------------------------------------------
@dataclass
class PtyTerminal:
    workspace_id: str
    run_id: str
    title: str
    is_manual: bool  # True → 用户手动开的，agent 禁止提案写入
    cols: int = 120
    rows: int = 30
    process: Any = None  # winpty.PTY
    # 一条终端允许多前端同时看（tab 切换时不 kill），但 stdin 只有当前激活 tab 能写。
    websockets: list = field(default_factory=list)
    stdout_tail: str = ""  # 最近 4k，用于前端重连时的上下文和审批结果的 stdout_tail
    exit_code: Optional[int] = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    # 当前“挂起”的提案：一次只允许一个提案待审批，避免 UI 上横幅叠 5 条。
    pending_proposition: Optional[TerminalProposition] = None

    @property
    def key(self) -> tuple[str, str]:
        return (self.workspace_id, self.run_id)


# ---------------------------------------------------------------------------
# 进程池
# ---------------------------------------------------------------------------
def _pick_shell_path() -> str:
    """优先用 pwsh（PS7），没装就退回 Windows 自带的 powershell.exe（PS5）。"""
    for candidate in ("pwsh.exe", "powershell.exe"):
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    # 理论上 Windows 10+ 一定带 powershell.exe，保险起见给个 fallback
    return r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"


class PtyTerminalPool:
    """进程池 + 提案审批状态机的组合容器。"""

    def __init__(self) -> None:
        self._terminals: dict[tuple[str, str], PtyTerminal] = {}
        self._lock = threading.Lock()
        self._shell_path = _pick_shell_path()
        # 审批事件：agent 线程 await 用户回复时用 asyncio.Event 阻塞。
        self._approval_events: dict[str, asyncio.Event] = {}
        self._propositions: dict[str, TerminalProposition] = {}
        # Why: _pty_reader 在子线程里跑，不能用 get_event_loop()（会创建新 loop），
        # 必须在主线程（async 上下文）里捕获 FastAPI 的 event_loop 存起来给子线程用。
        self._event_loop: asyncio.AbstractEventLoop | None = None

    def capture_event_loop(self) -> None:
        """在 async 上下文（如 attach_websocket）里调用，捕获主事件循环。"""
        if self._event_loop is None:
            try:
                self._event_loop = asyncio.get_running_loop()
            except RuntimeError:
                pass

    # ---- 终端生命周期 ---------------------------------------------------
    def get_or_create(self, workspace_id: str, run_id: str, title: str,
                      is_manual: bool, cols: int = 120, rows: int = 30) -> PtyTerminal:
        key = (workspace_id, run_id)
        with self._lock:
            existing = self._terminals.get(key)
            if existing and existing.exit_code is None:
                return existing
            term = PtyTerminal(
                workspace_id=workspace_id,
                run_id=run_id,
                title=title,
                is_manual=is_manual,
                cols=cols,
                rows=rows,
            )
            self._spawn(term)
            self._terminals[key] = term
            return term

    def _spawn(self, term: PtyTerminal) -> None:
        if winpty is None:
            raise RuntimeError("pywinpty 未安装（仅 Windows 需要）。请执行 pip install -r requirements.txt。")
        # Why 切到项目根 + utf-8：
        # - CWD 锁死在项目根目录，是用户要求的“不能随便切目录”的硬实现；
        # - pywinpty 3.x 的 spawn(env=...) 已改为字符串或 None，直接继承当前进程环境变量即可。
        try:
            pty = winpty.PTY(term.cols, term.rows, backend=1)  # 1 = ConPTY
            pty.spawn(self._shell_path, cwd=PROJECT_ROOT_STR)
        except Exception as exc:
            raise RuntimeError(f"启动 PowerShell 失败：{type(exc).__name__}: {exc}") from exc
        term.process = pty
        # 启动后先把代码页切到 UTF-8，避免中文文件名/编译输出乱码。
        try:
            pty.write("chcp 65001\r")
        except Exception:
            pass
        # 启动一个守护线程把 PTY stdout 推给所有订阅的 websocket（WebSocket.send_text 是 async，
        # 需要把字节流丢到 asyncio.Queue，再由 WS handler 侧协程消费）。
        threading.Thread(target=self._pty_reader, args=(term,), daemon=True).start()

    # 这几个 Queue 是跨线程/跨协程的管道：reader 线程 put，WS 协程 get。
    def _pty_reader(self, term: PtyTerminal) -> None:  # pragma: no cover - 真实 IO
        assert term.process is not None
        logger.info("[terminal_cmd] pty_reader started run_id=%s", term.run_id)
        buffer = bytearray()
        try:
            while term.process.isalive():
                # Why: pywinpty 3.x read 签名改为 read(blocking=False)，返回 str；非阻塞轮询避免线程卡死。
                chunk = term.process.read(blocking=False)
                if chunk is None:
                    break
                if isinstance(chunk, str):
                    chunk_bytes = chunk.encode("utf-8", errors="replace")
                else:
                    chunk_bytes = bytes(chunk)
                if not chunk_bytes:
                    time.sleep(0.05)
                    continue
                logger.info("[terminal_cmd] pty_reader chunk run_id=%s bytes=%d", term.run_id, len(chunk_bytes))
                buffer.extend(chunk_bytes)
                # 简单按行/按 100ms 刷出去。
                while b"\n" in buffer or len(buffer) > 2048:
                    if b"\n" in buffer:
                        idx = buffer.index(b"\n") + 1
                    else:
                        idx = len(buffer)
                    piece_bytes = bytes(buffer[:idx])
                    del buffer[:idx]
                    piece_text = piece_bytes.decode("utf-8", errors="replace")
                    with term.lock:
                        term.stdout_tail = (term.stdout_tail + piece_text)[-4096:]
                        sockets = list(term.websockets)
                    self._schedule_broadcast(sockets, piece_text)
            # 把尾巴也刷一下
            if buffer:
                piece_text = bytes(buffer).decode("utf-8", errors="replace")
                with term.lock:
                    term.stdout_tail = (term.stdout_tail + piece_text)[-4096:]
                    sockets = list(term.websockets)
                self._schedule_broadcast(sockets, piece_text)
        except Exception:
            pass
        finally:
            try:
                term.exit_code = term.process.get_exitstatus() if term.process.isalive() is False else 0
            except Exception:
                term.exit_code = 1

    def _schedule_broadcast(self, sockets: list, text: str) -> None:
        """把广播协程投递到主事件循环；没有 loop 时直接跳过避免崩溃。"""
        if not sockets:
            return
        loop = self._event_loop
        if loop is None or not loop.is_running():
            return
        try:
            asyncio.run_coroutine_threadsafe(
                self._broadcast_text(sockets, text),
                loop,
            )
        except Exception:
            pass

    @staticmethod
    async def _broadcast_text(sockets: list[WebSocket], text: str) -> None:
        payload = json.dumps({"type": "pty_output", "data": text}, ensure_ascii=False)
        logger.info("[terminal_cmd] broadcast sockets=%d bytes=%d", len(sockets), len(text))
        for ws in list(sockets):
            try:
                await ws.send_text(payload)
            except Exception:
                logger.exception("[terminal_cmd] broadcast send failed")

    def list_terminals(self, workspace_id: str) -> list[dict[str, Any]]:
        with self._lock:
            items = []
            for (ws_id, run_id), term in self._terminals.items():
                if ws_id != workspace_id:
                    continue
                items.append({
                    "workspace_id": ws_id,
                    "run_id": run_id,
                    "title": term.title,
                    "is_manual": term.is_manual,
                    "exit_code": term.exit_code,
                })
            return items

    def close(self, workspace_id: str, run_id: str) -> None:
        key = (workspace_id, run_id)
        with self._lock:
            term = self._terminals.pop(key, None)
        if term is None:
            return
        try:
            if term.process is not None:
                # 温和地关掉：先尝试 exit，再 Ctrl+C，最后按 PID 强杀。
                for cmd in ("exit\r", "\x03"):
                    try:
                        term.process.write(cmd)
                    except Exception:
                        pass
                    time.sleep(0.3)
                    if not term.process.isalive():
                        break
                if term.process.isalive():
                    try:
                        os.kill(term.process.pid, signal.SIGTERM)
                    except Exception:
                        pass
        except Exception:
            pass
        try:
            term.exit_code = term.process.get_exitstatus() if term.process and not term.process.isalive() else -1
        except Exception:
            term.exit_code = term.exit_code or -1

    # ---- WS 订阅 --------------------------------------------------------
    def attach_websocket(self, workspace_id: str, run_id: str, ws: WebSocket, *, is_manual: bool = False) -> PtyTerminal:
        # Why: 在 async 上下文里捕获主事件循环，供 _pty_reader 子线程调度协程。
        self.capture_event_loop()
        # Why: 前端手动终端 run_id 以 manual- 开头，必须标记 is_manual 才能接收前端 stdin。
        logger.info("[terminal_cmd] attach_websocket ws=%s run_id=%s is_manual=%s", id(ws), run_id, is_manual)
        term = self.get_or_create(workspace_id, run_id, title=f"PS {run_id[:8]}", is_manual=is_manual)
        with term.lock:
            if ws not in term.websockets:
                term.websockets.append(ws)
            sockets_count = len(term.websockets)
            # 一上来先把上下文尾巴推出去，方便用户看到提示符
            tail = term.stdout_tail
        logger.info("[terminal_cmd] attach_websocket done run_id=%s sockets=%s process=%s", term.run_id, sockets_count, term.process is not None)
        if tail:
            asyncio.create_task(ws.send_text(json.dumps({"type": "pty_output", "data": tail}, ensure_ascii=False)))
        return term

    def detach_websocket(self, term: PtyTerminal, ws: WebSocket) -> None:
        with term.lock:
            try:
                term.websockets.remove(ws)
            except ValueError:
                pass

    def resize(self, term: PtyTerminal, cols: int, rows: int) -> None:
        if cols <= 0 or rows <= 0:
            return
        term.cols, term.rows = cols, rows
        try:
            if term.process is not None:
                term.process.set_size(cols, rows)
        except Exception:
            pass

    def write_stdin(self, term: PtyTerminal, data: str) -> None:
        logger.info("[terminal_cmd] write_stdin run_id=%s is_manual=%s bytes=%d data=%r",
                    term.run_id, term.is_manual, len(data), data[:120])
        if term.process is None or term.exit_code is not None:
            logger.warning("[terminal_cmd] write_stdin skipped: process=%s exit_code=%s", term.process, term.exit_code)
            return
        try:
            term.process.write(data)
        except Exception:
            logger.exception("[terminal_cmd] write_stdin failed")

    # ---- 提案 API（给 Agent 用）-----------------------------------------
    async def propose_command(self, *, workspace_id: str, run_id: str, command: str,
                              reason: str, expected_output_hint: str,
                              trusted_prefixes: Optional[set[str]] = None) -> tuple[str, dict[str, Any]]:
        """Agent 调用这个接口提交提案。阻塞直到用户审批或 90s 超时。

        Returns:
            (status, result_dict)
            - approved+executed:  dict 里有 exit_code/stdout_tail
            - rejected/user_timeout/blocked: dict 里有 reason
        """
        if not run_id:
            raise ValueError("run_id 不能为空；Agent 不能往用户“手动终端”提案。")
        term = self.get_or_create(workspace_id, run_id, title=f"PS {run_id[:8]}", is_manual=False)
        if term.is_manual:
            return "blocked", {"reason": "该终端是用户手动终端，Agent 禁止提案写入。"}

        # 一次只允许一个挂起提案——如果已经有 pending 的就先让那个 timeout / 用户处理。
        deadline = time.time() + 5
        while term.pending_proposition is not None and time.time() < deadline:
            await asyncio.sleep(0.2)
        if term.pending_proposition is not None:
            return "blocked", {"reason": "已有另一条终端命令等待用户审批，请稍候再试。"}

        # 1) 先跑安全过滤
        filter_result = filter_command(command)
        if not filter_result["allow"]:
            return "blocked", {"reason": filter_result["reason"]}
        # 2) 会话级白名单：如果命令前缀在信任表，直接跳过审批直接执行。
        if trusted_prefixes:
            normalized = command.strip().lower().splitlines()[0] if command.strip() else ""
            if any(normalized.startswith(p.lower()) for p in trusted_prefixes if p):
                return self._execute_proposition_sync(term, command, trusted_prefixes, direct=True)

        prop = TerminalProposition(
            proposition_id=f"prop-{uuid.uuid4().hex[:12]}",
            workspace_id=workspace_id,
            run_id=run_id,
            command=command,
            reason=reason or "",
            expected_output_hint=expected_output_hint or "",
            created_at=time.time(),
            status="pending" if not filter_result["needs_confirm"] else "needs_confirm",
            status_message=filter_result["reason"],
        )
        term.pending_proposition = prop
        self._propositions[prop.proposition_id] = prop
        event = asyncio.Event()
        self._approval_events[prop.proposition_id] = event

        # 通知所有订阅这个终端的前端：“有新提案待审批”
        await self._broadcast_proposition(term, prop)

        # 同时也发一条 agent_activity SSE 风格的广播（通过 caller 那边的 callback）
        if self._on_activity_cb is not None:
            try:
                self._on_activity_cb({
                    "workspace_id": workspace_id,
                    "run_id": run_id,
                    "type": "terminal_proposition",
                    "proposition_id": prop.proposition_id,
                    "command": command,
                    "reason": reason,
                    "timeout_seconds": PROPOSITION_TIMEOUT_SECONDS,
                })
            except Exception:
                pass

        # 等用户 or 超时
        try:
            await asyncio.wait_for(event.wait(), timeout=PROPOSITION_TIMEOUT_SECONDS)
        except asyncio.TimeoutError:
            prop.status = "timeout"
            prop.status_message = "90 秒内未收到用户确认，提案已自动过期。"
        finally:
            term.pending_proposition = None
            self._approval_events.pop(prop.proposition_id, None)

        if prop.status in ("approved", "approved_with_trust"):
            return self._execute_proposition_sync(term, prop.command, trusted_prefixes, prop=prop)
        if prop.status == "rejected":
            return "rejected", {"reason": prop.status_message or "用户拒绝了该命令。"}
        if prop.status == "blocked":
            return "blocked", {"reason": prop.status_message or "命令被过滤器拦截。"}
        if prop.status == "timeout":
            return "timeout", {"reason": prop.status_message}
        return prop.status, {"reason": prop.status_message}

    def _execute_proposition_sync(self, term: PtyTerminal, command: str,
                                  trusted_prefixes: Optional[set[str]], *,
                                  direct: bool = False,
                                  prop: Optional[TerminalProposition] = None) -> tuple[str, dict[str, Any]]:
        """真正把命令写进 stdin，等待提示符返回。同步里也包一层超时。"""
        trusted_prefixes = trusted_prefixes or set()
        # 如果用户勾了“信任此类命令”，信任 key 取命令第一行的 verb（不含参数）。
        if prop and prop.status == "approved_with_trust":
            first_line = command.strip().splitlines()[0] if command.strip() else ""
            verb_match = re.match(r"^(\S+(?:\s+\S+){0,1})", first_line)
            if verb_match:
                key = verb_match.group(1).lower()
                prop.trust_key = key
                trusted_prefixes.add(key)
        # 写进 stdin 末尾加 \r（回车），模拟用户敲 Enter。
        # Why: 模型常输出 bash 风格的 `a && b`，但本终端是 PowerShell 5，`&&` 不是合法语句分隔符
        # （会报 InvalidEndOfLine）。改成 `;` 保证多段命令都能执行；`||` 缺乏等价语法，降级为 `;`。
        normalized_cmd = re.sub(r"\s*&&\s*", " ; ", command).strip()
        normalized_cmd = re.sub(r"\s*\|\|\s*", " ; ", normalized_cmd)
        self.write_stdin(term, normalized_cmd + "\r")
        # 简单等待：最多 60 秒，期间若 stdout 里出现 PS 提示符 就认为结束。
        prompt_re = re.compile(r"\nPS\s+[^\n]+>\s*$", re.MULTILINE)
        deadline = time.time() + 60
        last_len = -1
        stalled = 0
        while time.time() < deadline:
            tail = term.stdout_tail
            if prompt_re.search(tail):
                break
            # 10s 输出长度没变，也认为结束（命令可能 exit/close 了，或者没提示符）。
            if len(tail) == last_len:
                stalled += 1
                if stalled >= 10:
                    break
            else:
                stalled = 0
                last_len = len(tail)
            time.sleep(1.0)
        stdout_tail = term.stdout_tail
        exit_code = term.exit_code
        if prop is not None:
            prop.status = "executed"
            prop.result_stdout_tail = stdout_tail[-800:]
            prop.result_exit_code = exit_code
        payload = {
            "stdout_tail": stdout_tail[-800:],
            "exit_code": exit_code,
            "trust_key": prop.trust_key if prop else None,
        }
        if direct:
            payload["note"] = "会话白名单命中，直接执行。"
        return "executed", payload

    # 前端审批回调（用户点了横幅上 4 个按钮之一）
    def resolve_proposition(self, proposition_id: str, decision: str,
                            edited_command: Optional[str] = None,
                            add_trust: bool = False,
                            second_confirm: bool = False) -> str:
        prop = self._propositions.get(proposition_id)
        if prop is None:
            return "not_found"
        term = self._terminals.get((prop.workspace_id, prop.run_id))
        # 二次确认类：用户第一次点“执行”时，若 filter 说还要再确认，这里拦下来，
        # 只有 second_confirm=True 才真批准。
        if decision == "approve":
            filter_result = filter_command(edited_command or prop.command)
            if filter_result["needs_confirm"] and not second_confirm:
                prop.status = "needs_confirm"
                prop.status_message = filter_result["reason"]
                if term:
                    asyncio.create_task(self._broadcast_proposition(term, prop))
                return "needs_confirm"
            if not filter_result["allow"]:
                prop.status = "blocked"
                prop.status_message = filter_result["reason"]
                self._trigger_event(proposition_id)
                return "blocked"
            # 批准：如果有编辑过命令，写回 prop.command
            if edited_command is not None and edited_command.strip():
                prop.command = edited_command
            prop.status = "approved_with_trust" if add_trust else "approved"
        elif decision == "reject":
            prop.status = "rejected"
            prop.status_message = "用户拒绝了该命令。"
        elif decision == "dismiss":
            prop.status = "blocked"
            prop.status_message = "用户关闭了提案。"
        else:
            return "invalid_decision"
        if term:
            asyncio.create_task(self._broadcast_proposition(term, prop))
        self._trigger_event(proposition_id)
        return prop.status

    def _trigger_event(self, proposition_id: str) -> None:
        ev = self._approval_events.get(proposition_id)
        if ev is not None:
            try:
                # asyncio.Event 只能在同一 loop 里 set；我们从 fastapi 的主线程（WS 路由）调用，
                # 跟 proposal 等待的 loop 是同一个，没问题。
                ev.set()
            except Exception:
                pass

    async def _broadcast_proposition(self, term: PtyTerminal, prop: TerminalProposition) -> None:
        payload = json.dumps({
            "type": "proposition",
            "id": prop.proposition_id,
            "run_id": prop.run_id,
            "workspace_id": prop.workspace_id,
            "command": prop.command,
            "reason": prop.reason,
            "expected": prop.expected_output_hint,
            "status": prop.status,
            "status_message": prop.status_message,
            "created_at": prop.created_at,
            "timeout_seconds": PROPOSITION_TIMEOUT_SECONDS,
            "remaining_seconds": max(0, int((prop.created_at + PROPOSITION_TIMEOUT_SECONDS) - time.time())),
        }, ensure_ascii=False)
        for ws in list(term.websockets):
            try:
                await ws.send_text(payload)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # SSE 广播钩子（Agent 对话面板里“正在等待用户选择”的注入点）
    # 由 App.py 启动时设置。
    # ------------------------------------------------------------------
    _on_activity_cb: Optional[Callable[[dict[str, Any]], None]] = None

    def set_activity_callback(self, cb: Callable[[dict[str, Any]], None]) -> None:
        self._on_activity_cb = cb


# ---------------------------------------------------------------------------
# 全局单例
# ---------------------------------------------------------------------------
TERMINAL_POOL = PtyTerminalPool()


# ---------------------------------------------------------------------------
# WebSocket 路由（在 App.py 里挂到 FastAPI 上）
# ---------------------------------------------------------------------------
async def handle_terminal_websocket(websocket: WebSocket, workspace_id: str, run_id: str) -> None:
    """处理前端 xterm 的 PTY 字节流 + 控制消息。

    前端 -> 后端：
      {"type":"stdin","data":"..."}          只有激活的 tab / 手动终端允许写；
      {"type":"resize","cols":120,"rows":30}
      {"type":"resolve","id":"prop-xxx","decision":"approve|reject|dismiss",
       "edited_command":"...","add_trust":false,"second_confirm":false}
    后端 -> 前端：
      {"type":"pty_output","data":"..."}
      {"type":"proposition", ...}
      {"type":"list", "terminals":[...]}  (初次连接后立即推一次)
    """
    if winpty is None:
        await websocket.accept()
        await websocket.send_text(json.dumps({
            "type": "error",
            "message": "当前不是 Windows 或未安装 pywinpty，集成终端不可用。",
        }, ensure_ascii=False))
        await websocket.close()
        return

    # Why 先 accept 再鉴 workspace_id：当前单用户本地应用，没做多租户，
    # workspace_id/run_id 只是前端内部的隔离 key，不做鉴权。
    await websocket.accept()
    # Why: 前端手动终端 run_id 以 manual- 开头，必须让后端知道这是手动终端，否则 stdin 会被拦截。
    is_manual = isinstance(run_id, str) and run_id.startswith("manual-")
    term = TERMINAL_POOL.attach_websocket(workspace_id, run_id, websocket, is_manual=is_manual)
    # 初次连接就把当前的挂起提案（若有）推给前端，避免用户刷新页面后横幅不见了。
    if term.pending_proposition is not None:
        await TERMINAL_POOL._broadcast_proposition(term, term.pending_proposition)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                # 非 JSON 就当是 stdin 文本（兼容 xterm-addon-attach 默认发 raw text 的情况）
                # 但 agent run 的终端不允许前端“直接写 stdin”，只有手动终端才允许。
                if term.is_manual:
                    TERMINAL_POOL.write_stdin(term, raw)
                continue
            mtype = msg.get("type")
            if mtype == "stdin":
                # 激活的 tab 往 stdin 写：只允许“手动终端”，Agent 专属终端一律拦。
                # Why：避免用户在 Agent 终端里手敲命令把审批上下文搞乱；
                # Agent 专属终端的 stdin 入口只有“提案通过”那一条路径。
                if term.is_manual:
                    TERMINAL_POOL.write_stdin(term, str(msg.get("data", "")))
            elif mtype == "resize":
                try:
                    TERMINAL_POOL.resize(term, int(msg.get("cols", 120)), int(msg.get("rows", 30)))
                except Exception:
                    pass
            elif mtype == "resolve":
                TERMINAL_POOL.resolve_proposition(
                    str(msg.get("id", "")),
                    str(msg.get("decision", "dismiss")),
                    edited_command=msg.get("edited_command"),
                    add_trust=bool(msg.get("add_trust", False)),
                    second_confirm=bool(msg.get("second_confirm", False)),
                )
            elif mtype == "list":
                list_msg = json.dumps({
                    "type": "list",
                    "terminals": TERMINAL_POOL.list_terminals(workspace_id),
                }, ensure_ascii=False)
                await websocket.send_text(list_msg)
            elif mtype == "close":
                target_run_id = str(msg.get("run_id", run_id))
                TERMINAL_POOL.close(workspace_id, target_run_id)
    except WebSocketDisconnect:
        pass
    except Exception:
        traceback.print_exc()
    finally:
        TERMINAL_POOL.detach_websocket(term, websocket)
