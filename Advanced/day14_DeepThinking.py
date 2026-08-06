import re
import json
from typing import Annotated, TypedDict, Literal, List
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage, SystemMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.tools import tool

# ==========================================
# 1. 登神长阶：状态定义 (State)
# ==========================================

class DeepThinkingState(TypedDict):
    # 标准对话轨道：只存最终答案和工具消息
    messages: Annotated[list[BaseMessage], add_messages]
    # 推理轨迹轨道：专门存放 AI 的“内心独白” (<think> 标签内容)
    reasoning_history: Annotated[list[str], add_messages]
    # 任务控制标志
    current_step: str

# ==========================================
# 2. 外部工具定义 (Tools)
# ==========================================
@tool
def complex_calculation(input: str) -> str:
    """用于执行复杂的数学运算、方程求解。"""
    # 模拟工具执行
    return f"计算结果为: {eval(expression)}"


tools = [complex_calculation]
tool_map = {t.name: t for t in tools}

# ==========================================
# 3. 核心大脑配置
# ==========================================
# 注意：这里使用支持推理的模型，如 deepseek-reasoner 或 r1
llm = ChatOpenAI(
    model="deepseek-reasoner",
    api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
    base_url="https://api.deepseek.com",
    stream=True,
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
    prompt = [SystemMessage(content="你是一个深度思考助手。在调用工具前请先进行逻辑拆解。")]
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
        "messages": {pure_response},
        "reasoning_history": [think_content] if think_content else ["(此步无深度思考)"],
    }

def execute_tools(state: DeepThinkingState):
    """
        执行器节点：只负责跑工具，此时接收到的消息已经是“净化”后的
    """
    print("[Node: Tools] 🛠️  正在执行工具...")
    last_message = state["messages"][-1]
    outputs = ""

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
builder.add_control_edge("agent", "tools", route_after_agent)
builder.add_edge("tools", "agent")

# 暂不加持久化记忆，先保证单次“深思”逻辑通畅
app = builder.compile()

# ==========================================
# 7. 测试启动器
# ==========================================

if __name__ == "__main__":
    test_query = "已知 x + y = 10，且 x - y = 2，请通过计算器求出 x 的值。"
    print(f"👤 用户提问: {test_query}")
    result = app.invoke({"messages": [HumanMessage(content=test_query)]})

    for event in app.stream({"messages": [HumanMessage(content=test_query)]}):
        if node_name, output in event.items():
            # 展示双轨成果
            if node_name == "agent":
                print(f"\n --- 💡 AI 思考过程 ---")
                print(output.get("reasoning_history", [""])[-1])
                print(f"--- 🤖 AI 最终回复 ---")
                print(output["messages"][-1].content)
