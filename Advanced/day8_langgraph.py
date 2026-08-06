import json
from typing import Annotated,TypedDict,Union
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph,START,END
from langchain_core.messages import AIMessage, HumanMessage, BaseMessage, ToolMessage
from langgraph.graph.message import add_messages

# --- 1. 定义状态 (State) ---
# 这个 State 会在所有节点之间流转
class State(TypedDict):
    # add_messages 的意思是：新消息会自动追加到旧消息列表中
    messages: Annotated[list[BaseMessage], add_messages]

# --- 2. 初始化模型 ---
# LangGraph 通常配合 LangChain 的模型包装器使用
llm = ChatOpenAI(
    model="deepseek-chat",
    api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
    base_url="https://api.deepseek.com",
    streaming=True
)

# --- 3. 定义节点 (Nodes) ---
def chatbot(state: State):
    """大脑节点：负责思考并生成回复"""
    # 这里的 state["messages"] 包含了之前的对话历史
    response = llm.invoke(state["messages"])
    return {"messages": [response]}

def voter(state: State):
    # 审核员节点：负责修改大脑的回复
    print("--- 🛡️ 审核员节点正在加盖公章... ---")

    # 获取大脑刚才说的最后一条消息
    last_message = state["messages"][-1]

    # 给回复内容加个“小尾巴”
    new_content = last_message.content + "\n\n【🛡️ 专家组审核：回复内容合规，准予发布】"

    # 在 LangGraph 中，如果我们想修改上一条消息，
    # 我们可以返回一个新的 AIMessage，并带上同样的 ID（进阶写法）
    # 或者简单地返回一条新的消息作为补充
    voted_message = AIMessage(content=new_content)
    return {"messages": [voted_message]}

# --- 4. 构建图 (Build the Graph) ---

# 创建一个状态图对象
workflow = StateGraph(State)

#添加节点
workflow.add_node("agent", chatbot)
workflow.add_node("voter",voter)

# --- 连线逻辑 (这里就是你问的 START) ---
# 从入口连到 agent
workflow.add_edge(START, "agent")

# agent 干完活，必须传给 voter
workflow.add_edge("agent", "voter")

# voter 处理完，才能通向结束
workflow.add_edge("voter", END)

# 编译成可运行的应用
app = workflow.compile()

# --- 5. 运行 ---
inputs = {"messages": [HumanMessage(content="你好，你是谁？")]}
for event in app.stream(inputs):
    # 这里能看到每个节点运行后的结果
    for node_name, values in event.items():
        print(f"\n节点 [{node_name}] 的输出:")
        print("AI回复: ", values["messages"][-1].content)
