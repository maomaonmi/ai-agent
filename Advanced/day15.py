import os
import re
import json
from typing import Annotated, TypedDict, Literal, List
from operator import add
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage, SystemMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.tools import tool
from langchain_community.tools.tavily_search import TavilySearchResults  # noqa: F401  仅作为可选依赖示例

# ==========================================
# 1. 登神长阶：状态定义 (State)
# ==========================================

class DeepThinkingState(TypedDict):
    # 标准对话轨道：只存最终答案和工具消息
    messages: Annotated[list[BaseMessage], add_messages]
    # 推理轨迹轨道：专门存放 AI 的“内心独白” (<think> 标签内容)
    # 注意：add_messages 只能处理 BaseMessage，字符串列表必须用 operator.add 拼接
    reasoning_history: Annotated[list[str], add]


# 别名：原代码使用 AgentState 但只定义了 DeepThinkingState，加别名避免改 3 处引用
AgentState = DeepThinkingState

# ==========================================
# 2. 外部工具定义 (Tools)
# ==========================================
@tool
def complex_calculation(expression: str) -> str:
    """用于执行复杂的数学运算。expression 必须是合法的 Python 算术表达式字符串，例如 '(10 + 2) / 2' 或 '2 ** 10'。"""
    try:
        result = eval(expression, {"__builtins__": {}}, {})
        return f"计算结果为: {result}"
    except Exception as e:
        return f"计算失败: {e}"


tools = [complex_calculation]
tool_map = {t.name: t for t in tools}

# ==========================================
# 3. 核心大脑配置
# ==========================================
# 注意：deepseek-reasoner (R1) 官方不保证支持 bind_tools，
# 这里切到 deepseek-chat (V3) 保证工具调用可用；
# 真正的“R1 思考 + V3 执行”双模型路由属于 Day 38 的 Plan-and-Execute 范畴。
llm = ChatOpenAI(
    model="deepseek-chat",
    api_key=os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199"),
    base_url="https://api.deepseek.com",
)
llm_with_tools = llm.bind_tools(tools)

# ==========================================
# 4. 节点逻辑 (Nodes) - 核心手术环节
# ==========================================

def call_model(state: AgentState):
    """
    大脑节点：调用模型并进行“脱壳手术”
    """
    print("\n[Node: Agent] 🧠 正在深度思考...")
    
    # 获取完整的上下文
    prompt = [SystemMessage(content="""
                        你是一个结构化思考助手。回答数学或逻辑问题时，格式必须严格遵循以下范例：
                        【范例 - 问：(1) x + y = 10 (2) x - y = 2，求 x】
                        **问题拆解**
                        - 已知条件：方程①、方程②
                        - 求解目标：x 的值
                        - 方法：两式相加消除 y

                        **执行步骤**
                        1. 方程① + 方程②：2x = 12
                        2. 两边除以 2：x = 6

                        **验证**：代入原式 6 + 4 = 10 ✅，6 - 4 = 2 ✅
                        **最终答案**：x = 6
                        你必须先在 <think>...</think> 标签内写出"问题拆解 → 执行步骤 → 验证"的完整推理过程，然后再用 Markdown 结构化输出"最终答案"。
                        不要在最终回答里重复描述"我的思考过程是..."这类废话，直接给出格式化的分析即可。
                        ---""")]
    response = llm_with_tools.invoke(prompt + state["messages"])

    # --- 核心手术逻辑：分离 Think 和 Content ---
    full_text = response.content
    think_content = ""
    final_answer = full_text

    # 兼容处理：有些模型通过 reasoning_content 字段返回，有些通过 <think> 标签返回
    # 方案 A: 尝试获取官方推理字段 (部分 API 支持)
    if hasattr(response, "additional_kwargs") and "reasoning_content" in response.additional_kwargs:
        think_content = response.additional_kwargs["reasoning_content"]
    # 方案 B: 正则表达式截取标签 (通用方案)
    else:
        match = re.search(r"<think>(.*?)</think>", full_text, re.DOTALL)
        if match:
            think_content = match.group(1).strip()
            final_answer = re.sub(r"<think>.*?</think>", "", full_text, flags=re.DOTALL).strip()

    # 如果 final_answer 被抠成了空字符串（AI 只有思考没有回答），给一个默认引导词
    if not final_answer and response.tool_calls:
        final_answer = "正在执行工具调用以获取数据..."

    # 构建一个纯净的响应
    pure_response = AIMessage(
        content = final_answer,
        tool_calls = response.tool_calls,
        id = response.id
    )

    return {
        "messages": [pure_response],
        "reasoning_history": [think_content] if think_content else ["(此步无深度思考)"],
    }

def execute_tools(state: DeepThinkingState):
    """
        执行器节点：只负责跑工具，此时接收到的消息已经是“净化”后的
    """
    print("[Node: Tools] 🛠️  正在执行工具...")
    last_message = state["messages"][-1]
    outputs: list = []

    for tool_call in last_message.tool_calls:
        tool_obj = tool_map[tool_call["name"]]
        content = tool_obj.invoke(tool_call["args"])
        outputs.append(ToolMessage(tool_call_id=tool_call["id"], content=str(content)))

    return {
        "messages": outputs,
    }

# ==========================================
# 5. 路由逻辑 (Router)
# ==========================================
def route_after_agent(state: AgentState) -> Literal["tools", "__end__"]:
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    else:
        return "__end__"
    
# ==========================================
# 6. 构建长阶图 (Graph)
# ==========================================
builder = StateGraph(AgentState)
builder.add_node("agent", call_model)
builder.add_node("tools", execute_tools)

builder.add_edge(START, "agent")
builder.add_conditional_edges(
    "agent",
    route_after_agent,
    {
        "tools": "tools",
        "__end__": END,
    },
)
builder.add_edge("tools", "agent")

# 暂不加持久化记忆，先保证单次“深思”逻辑通畅
app = builder.compile()

# ==========================================
# 7. 测试启动器
# ==========================================

if __name__ == "__main__":
    test_query = "已知 x + y = 10，且 x - y = 2，请通过计算器求出 x 的值。"
    print(f"👤 用户提问: {test_query}")

    initial_state: AgentState = {
        "messages": [HumanMessage(content=test_query)],
        "reasoning_history": [],
    }
    for event in app.stream(initial_state):
        for node_name, output in event.items():
            # 展示双轨成果
            if node_name == "agent":
                print(f"\n --- 💡 AI 思考过程 ---")
                reasoning = output.get("reasoning_history") or []
                if reasoning:
                    print(reasoning[-1])
                print(f"--- 🤖 AI 最终回复 ---")
                msgs = output.get("messages") or []
                if msgs:
                    last = msgs[-1]
                    content = last.content if hasattr(last, "content") else str(last)
                    print(content)
