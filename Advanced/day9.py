import json
from typing import Annotated,TypedDict,Literal
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph,START,END
from langchain_core.messages import AIMessage, HumanMessage, BaseMessage, ToolMessage
from langgraph.graph.message import add_messages
from langchain_core.tools import tool

#定义工具
@tool
def get_user_balance(name: str):
    """查询指定用户的银行卡余额"""
    balances = {"张大炮": 100, "小王": 5000, "老李": 2000}
    return f"{name}的银行卡余额为{balances.get(name, '未知')}元。"

# 把工具放进列表
tools = [get_user_balance]

# --- 1. 定义状态 (State) ---
# 这个 State 会在所有节点之间流转
class State(TypedDict):
    # add_messages 的意思是：新消息会自动追加到旧消息列表中
    messages: Annotated[list[BaseMessage], add_messages]

# --- 2. 初始化模型 ---
# LangGraph 通常配合 LangChain 的模型包装器使用
# 将工具绑定到模型上，模型就知道自己有这些“手”了
llm_with_tools = ChatOpenAI(
    model="deepseek-chat",
    api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
    base_url="https://api.deepseek.com"
).bind_tools(tools)

# --- 3. 定义节点 (Nodes) ---
def chatbot(state: State):
    """大脑节点"""
    print("--- 🧠 AI 正在思考下一步... ---")
    # 这里的 state["messages"] 包含了之前的对话历史
    return {"messages": [llm_with_tools.invoke(state["messages"])]}

def tool_excutor(state: State):
    """执行工具的节点 (手动版，为了让你看清原理)"""
    print("--- 🛠️  正在执行工具调用... ---")
    last_message = state["messages"][-1]
    tool_outputs = []

    for tool_call in last_message.tool_calls:
        #执行逻辑
        args = tool_call["args"]
        result = get_user_balance.invoke(args)
        # 构建 ToolMessage 返回
        tool_outputs.append(
            ToolMessage(
                tool_call_id = tool_call["id"],
                content = str(result)
            )
        )
    return {"messages": tool_outputs}

# --- 4. 定义路由逻辑 (关键点！) ---
def router(state:State) -> Literal["tools","__end__"]:
    """判断该去调工具还是该结束"""
    last_message = state["messages"][-1]
    # 如果 AI 的最后一条消息包含 tool_calls，就走 tools 分支
    if last_message.tool_calls:
        return "tools"
    # 否则直接结束
    return "__end__"

# --- 5. 构建图 ---
# 创建一个状态图对象
workflow = StateGraph(State)

#添加节点
workflow.add_node("agent", chatbot)
workflow.add_node("tools", tool_excutor)

workflow.add_edge(START, "agent")

# 【核心：添加条件边】
# 意思：当 agent 节点跑完后，去跑 router 函数。
# 根据 router 返回的字符串，决定去哪。
workflow.add_conditional_edges(
    "agent",
    router,
    {
        "tools": "tools",  # 如果返回 "tools"，去跑 tools 节点
        "__end__": END          # 如果返回 "__end__"，直接结束
    }
)

# tools 节点跑完后，必须回到 agent 让它汇总信息
workflow.add_edge("tools","agent")

# 编译成可运行的应用
app = workflow.compile()

# --- 5. 运行 ---
inputs = {"messages": [HumanMessage(content="我是张大炮，帮我查查余额")]}
for event in app.stream(inputs):
    # 这里能看到每个节点运行后的结果
    for node_name, values in event.items():
        print(f"节点 [{node_name}] 运行完毕")
        print("AI回复: ", values["messages"][-1].content)
