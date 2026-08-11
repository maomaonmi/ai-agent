"""
Day 69 验证脚本: 运行 LangGraph 智能体并通过 MCP 协议动态调用外部微服务工具
"""

import os
from huggingface_hub import MCPClient
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import StateGraph, START, END
from typing import Annotated, TypedDict
from langgraph.graph.message import add_messages
from numpy._core.numerictypes import typeDict
import openai
from torch import Type

# 引入我们的 MCP 客户端管理器
from mcp_client_manager import MCPClientManager

#1. 启动并连接MCP服务端
mcp_manager = MCPClientManager("mcp_server_custom.py")
mcp_manager.start_and_init()

#2. 定义 LangGraph State
class AgentState(typeDict):
    messgages: Annotated[list, add_messages]
#3. 初始化LLM
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")
llm = ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")

# 4. 手动将 MCP 工具构造为 OpenAI Function Calling Schema 给 LLM
openai_tools = []
for t in mcp_manager.tools_schema:
    openai_tools.append({
        "type": "function",
        "function": {
            "name": t["name"],
            "description": t["description"],
            "parameters": t["inputSchema"]
        }
    })
llm_with_mcp = llm.bind_tools(openai_tools)

#5. 定义节点
def agent_node(state: AgentState):
    print("\n[Node: Agent] 🧠 正在思考需求...")
    res = llm_with_mcp.invoke(state["messgages"])
    return {"messgages": [res]}

def mcp_tools_executor_node(state: AgentState):
    print("[Node: MCP Executor] 🔌 正在转发工具调用给 MCP Server 进程...")
    last_msg = state["messages"][-1]
    output = []

    for tool_call in last_msg.tool_calls:
        tool_name = tool_call["name"]
        tool_args = tool_call["args"]

        # 真正的物理转发：通过 MCP 客户端把请求发送给 mcp_server_custom.py
        result_text = mcp_manager.call_tool(tool_name, tool_args)

        output.append(ToolMessage(
            tool_call_id=tool_call["id"],
            content=result_text))
    return {"messages": output}

# 6. 构建图
workflow = StateGraph(AgentState)
workflow.add_node("agent", agent_node)
workflow.add_node("mcp_tools", mcp_tools_executor_node)

workflow.add_edge(START, "agent")
workflow.add_conditional_edges(
    "agent",
    lambda s: "mcp_tools" if s["messages"][-1].tool_calls else END,
    {"mcp_tools": "mcp_tools", END: END}
)
workflow.add_edge("mcp_tools", "agent")

app = workflow.compile()

#7. 测试运行
if __name__ == "__main__":
    try:
        query = "请帮我检查一下当前服务器的物理 CPU、内存占用率，以及 Git 仓库状态。"
        print(f"👤 用户提问: {query}\n")

        result = app.invoke({"messages": [HumanMessage(content=query)]})
        print(f"\n🤖 AI 最终回复:\n{result['messages'][-1].content}")
    finally:
        mcp_manager.close()