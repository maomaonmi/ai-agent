"""Windows 下为 uvicorn 提供 ProactorEventLoop 的 loop factory。

Why 必须用独立模块 + uvicorn 的 loop= 参数，而不是在 main.py 里打补丁：
uvicorn 在 reload=True 时用 multiprocessing spawn 生成子进程，子进程在
Server.run() 中会【先】调用 get_loop_factory() 解析事件循环、【后】才
import 目标 app 模块。因此 main.py 顶层打补丁来不及生效，仍然解析到
SelectorEventLoop。

SelectorEventLoop 不支持创建子进程（_make_subprocess_transport 直接抛
NotImplementedError），而 MCP 管理器依赖 create_subprocess_shell 拉起
stdio 子进程，必须把 loop 钉死为 ProactorEventLoop。

通过 uvicorn.run(..., loop="win_loop:proactor_loop_factory") 引用本模块，
get_loop_factory 用 import_from_string 在解析瞬间即时导入，时序无关。
"""

from __future__ import annotations

import asyncio
import sys


def proactor_loop_factory(
    use_subprocess: bool = False,
) -> asyncio.AbstractEventLoop:
    """返回事件循环【实例】。

    Why 返回实例而非类：uvicorn 对自定义 loop 字符串（不在 LOOP_FACTORIES 里）
    走 get_loop_factory 的 else 分支，直接【原样返回本函数】，不再调用；随后
    asyncio.run(loop_factory=...) 的 Runner 会调用本函数并用返回值作为运行环，
    因此这里必须返回已实例化的 loop，否则 Runner 拿到类会在 close() 时报
    "missing 1 required positional argument: 'self'"。
    """
    if sys.platform == "win32":
        # Proactor 是 Windows 上唯一支持子进程的环，且能力是 Selector 超集。
        return asyncio.ProactorEventLoop()
    # 非 Windows：回退给 uvicorn 默认 auto 逻辑（优先 uvloop，否则 Selector）。
    from uvicorn.loops.auto import auto_loop_factory

    loop_class = auto_loop_factory(use_subprocess=use_subprocess)
    return loop_class()
