"""
Day 42+: 生产级 Agent Hook (生命周期拦截器) 引擎
演示：如何在零侵入核心代码的前提下，注入【隐私脱敏】与【高危命令拦截】逻辑
"""

import re
import asyncio
from enum import Enum
from typing import Callable, List, Dict, Any, Optional
from dataclasses import dataclass, field

# ==========================================
# 1. 定义 Hook 生命周期锚点类型
# ==========================================
class HookType(str, Enum):
    """Hook 生命周期锚点类型"""
    ON_SESSION_START = "on_session_start"
    BEFORE_LLM_CALL = "before_llm_call"
    AFTER_LLM_CALL = "after_llm_call"
    BEFORE_TOOL_CALL = "before_tool_call"
    AFTER_TOOL_CALL = "after_tool_call"
    ON_ERROR = "on_error"

# ==========================================
# 2. Hook 上下文载体 (在各节点传递的数据包)
# ==========================================
@dataclass
class HookContext:
    session_id: str
    event_type: HookType
    # 可变数据负荷（HOOK 函数可以修改里面的内容）
    data: Dict[str, Any] = field(default_factory=dict)
    # 控制日志： 是否取消后续执行
    is_cancelled: bool = False
    cancel_reason: Optional[str] = None

# ==========================================
# 3. Hook 注册中心 (Hook Registry)
# ==========================================
class HookRegistry:
    def __init__(self):
        # 存储映射关系: { HookType.BEFORE_LLM_CALL: [func1, func2, ...] }
        self.hooks: Dict[HookType, List[Callable[[HookContext], None]]] = {
            hook_type: [] for hook_type in HookType
        }

    def register(self, hook_type: HookType):
        """装饰器：方便用户注册自定义 Hook"""
        def decorator(func: Callable[[HookContext], None]):
            self.hooks[hook_type].append(func)
            print(f"🪝 [Hook 注册] 成功挂载处理器 '{func.__name__}' 到锚点 [{hook_type.value}]")
            return func
        return decorator

    def trigger(self, hook_type: HookType, context: HookContext):
        """核心引擎调用的触发入口"""
        handlers = self.hooks.get(hook_type, [])
        for handler in handlers:
            if context.is_cancelled:
                print(f"⚠️ [Hook 拦截] 后续 Hook 已被阻断，原因: {context.cancel_reason}")
                break
            try:
                # 执行外部注入的 Hook 函数
                handler(context)
            except Exception as e:
                print(f"❌ [Hook 异常] 执行 '{handler.__name__}' 报错: {e}")
                if hook_type != HookType.ON_ERROR:
                    context.data["error"] = str(e)
        return context

# ==========================================
# 4. 模拟 Agent 核心执行引擎 (零修改，只留触发点)
# ==========================================
class CoreAgentEngine:
    def __init__(self,hook_registry: HookRegistry):
        self.hooks = hook_registry

    def run_cycle(self, session_id: str, user_prompt: str):
        print(f"\n==========================================")
        print(f"🚀 [Agent Engine] 启动主循环，Session: {session_id}")
        print(f"==========================================")

        # --------------------------------------------------
        # 触发点 1: BEFORE_LLM_CALL (发送给 LLM 前)
        # --------------------------------------------------
        ctx = HookContext(
            session_id=session_id,
            event_type=HookType.BEFORE_LLM_CALL,
            data={"prompt": user_prompt}
        )
        ctx = self.hooks.trigger(HookType.BEFORE_LLM_CALL, ctx)

        if ctx.is_cancelled:
            print(f"🛑 [Engine] 请求被 Hook 拦截，不发送给 LLM！原因: {ctx.cancel_reason}")
            return
        
        #拿到可能被 Hook 脱敏/修改后的 Prompt
        processed_prompt = ctx.data["prompt"]
        print(f"📡 [LLM Request] 发送给大模型的真实 Prompt: '{processed_prompt}'")

        # 模拟 LLM 决策，想要执行一个终端命令
        mock_tool_command = "rm -rf /workspace/important_data"
        print(f"🧠 [LLM Response] 决策调用终端命令: '{mock_tool_command}'")

        # --------------------------------------------------
        # 触发点 2: BEFORE_TOOL_CALL (执行工具前)
        # --------------------------------------------------
        tool_ctx = HookContext(
            session_id=session_id,
            event_type=HookType.BEFORE_TOOL_CALL,
            data={"tool_name": "terminal","command": mock_tool_command}
        )
        tool_ctx = self.hooks.trigger(HookType.BEFORE_TOOL_CALL, tool_ctx)

        if tool_ctx.is_cancelled:
            print(f"🛑 [Engine] 高危工具调用被 Hook 安全拦截！原因: {tool_ctx.cancel_reason}")
            return

        print(f"⚡ [Tool Exec] 正在安全执行工具: {tool_ctx.data['command']}")

# ==========================================
# 5. 用户/开发者编写的自定义 Hook (业务逻辑注入)
# ==========================================

#全局初始化 HOOK 注册中心
global_hook_registry = HookRegistry()

# --- 自定义 Hook 1: 敏感隐私数据自动脱敏 (PII Masking) ---
@global_hook_registry.register(HookType.BEFORE_LLM_CALL)
def pii_masking_hook(ctx: HookContext):
    raw_prompt = ctx.data.get("prompt", "")
    # 正则识别中国大陆手机号并脱敏
    masked_prompt = re.sub(r'1[3-9]\d{9}', '[隐私手机号已自动屏蔽]', raw_prompt)
    
    
    if raw_prompt != masked_prompt:
        print("  └─ 🪝 [Hook 动作] 检测到敏感手机号，已进行自动物理脱敏！")
        ctx.data["prompt"] = masked_prompt
#2. 自定义 Hook 2: 高危 Linux 命令防火墙 (Risky Command Firewall) ——————
@global_hook_registry.register(HookType.BEFORE_TOOL_CALL)
def command_firewall_hook(ctx: HookContext):
    cmd = ctx.data.get("command", "")
    # 黑名单检测
    dangerous_pattern = [r"rm\s+-rf", r"mkfs", r"dd\s+if=", r"shutdown"]

    for pattern in dangerous_pattern:
        if re.search(pattern, cmd):
            print(f"  └─ 🪝 [Hook 动作] 警告！捕获到匹配黑名单的高危指令 '{pattern}'！")
            ctx.is_cancelled = True
            ctx.cancel_reason = f"触发高危安全策略：禁止执行包含 '{pattern}' 的毁灭性指令！"
            break

# ==========================================
# 6. 测试运行
# ==========================================
if __name__ == "__main__":
    # 初始化核心引擎
    engine = CoreAgentEngine(hook_registry=global_hook_registry)
    
    # 测试场景 1: 输入包含手机号，测试隐私 Hook 脱敏
    user_input_1 = "你好，我的手机号是 13812345678，帮我查询我的账单。"
    engine.run_cycle("session_001", user_input_1)

    # 测试场景 2: 模拟 AI 试图跑高危删除命令，测试安全 Hook 阻断
    user_input_2 = "帮我清理一下磁盘垃圾。"
    engine.run_cycle("session_002", user_input_2)



