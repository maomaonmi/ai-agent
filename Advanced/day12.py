from typing import Annotated,TypedDict,Literal
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph,START,END
from langchain_core.messages import HumanMessage, BaseMessage, ToolMessage, SystemMessage
from langgraph.graph.message import add_messages
from langchain_core.tools import tool
from sentence_transformers import SentenceTransformer
from langgraph.checkpoint.memory import MemorySaver
import numpy as np
import uuid

memory_storage = MemorySaver()

embedding_model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')

knowledge_base = [
    "黑科技手机X屏幕碎裂维修费用为500元，需耗时2小时。",
    "如果黑科技手机X无法开机，请长按电源键和音量加键10秒强制重启。",
    "黑科技手机X的电池质保期为2年，非人为损坏可免费更换。",
    "黑科技手机X支持超快闪充，必须使用原装60W充电头。"
]
knowledge_embedding = embedding_model.encode(knowledge_base)

@tool
def tech_specialist_tool(query: str):
    """技术专家：负责检索手机维修手册、维修价格、故障处理方案。"""
    print(f"🛠️ [技术专家] 正在翻阅手册查找：{query}")
    query_embedding = embedding_model.encode([query])[0]
    norm_k = np.linalg.norm(knowledge_embedding,axis=1)
    norm_q = np.linalg.norm(query_embedding)
    similarities = np.dot(knowledge_embedding,query_embedding) / (norm_k * norm_q)
    best_index = np.argmax(similarities)
    return f"维修手册显示: {knowledge_base[best_index]}"

#定义工具
@tool
def get_user_balance(name: str):
    """查询指定用户的银行卡余额"""
    balances = {"张大炮": 100, "小王": 5000, "老李": 2000}
    return f"{name}的银行卡余额为{balances.get(name, '未知')}元。"

# 把工具放进列表
tools = [get_user_balance, tech_specialist_tool]
tool_map = {tool.name: tool for tool in tools}

# --- 1. 定义状态 (State) ---
# 这个 State 会在所有节点之间流转
class State(TypedDict):
    # add_messages 的意思是：新消息会自动追加到旧消息列表中
    messages: Annotated[list[BaseMessage], add_messages]

# --- 2. 初始化模型 ---
# LangGraph 通常配合 LangChain 的模型包装器使用
# 将工具绑定到模型上，模型就知道自己有这些“手”了
llm = ChatOpenAI(
    model="deepseek-chat",
    api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
    base_url="https://api.deepseek.com",
    streaming=True
)
llm_with_tools = llm.bind_tools(tools)


# --- 3. 定义节点 (Nodes) ---
def chatbot(state: State):
    """余额助手：负责处理余额查询，并在需要时查询维修手册。"""
    print("--- 🧠 AI 正在思考下一步... ---")
    agent_prompt = SystemMessage(content="""
你是一个余额与维修费用分析助手。

你可以使用两个工具：
1. get_user_balance：查询用户银行卡余额。
2. tech_specialist_tool：查询手机维修手册、维修费用、故障处理方案。

规则：
- 如果用户问余额，必须调用 get_user_balance。
- 如果用户问修手机、维修价格、够不够修、故障处理，必须调用 tech_specialist_tool。
- 如果用户的问题同时包含余额和维修费用，你需要两个工具都调用，然后综合判断余额是否足够。
- 不要凭空猜维修价格，维修相关信息必须先查维修手册。
""")
    return {"messages": [llm_with_tools.invoke([agent_prompt, *state["messages"]])]}

def tool_excutor(state: State):
    """执行工具的节点 (手动版，为了让你看清原理)"""
    print("--- 🛠️  正在执行工具调用... ---")
    last_message = state["messages"][-1]
    tool_outputs = []

    for tool_call in last_message.tool_calls:
        tool_name = tool_call["name"]
        args = tool_call["args"]
        selected_tool = tool_map[tool_name]
        result = selected_tool.invoke(args)

        tool_outputs.append(
            ToolMessage(
                tool_call_id = tool_call["id"],
                content = str(result)
            )
        )
    return {"messages": tool_outputs}

def manager_node(state: State):
    """经理节点：先判断任务应该交给哪个角色处理。"""
    print("👔 [经理] 正在分配任务...")
    manager_prompt = SystemMessage(
    content="""
    你是一个任务分配经理，只负责判断用户请求应该交给谁处理。

    规则：
    1. 如果用户要查询余额、银行卡、账户金额，回复：BALANCE_AGENT
    2. 如果用户的问题同时包含余额查询和维修费用判断，也回复：BALANCE_AGENT
    3. 如果用户的问题只涉及维修、修理、故障、技术支持，回复：TECH_AGENT
    4. 如果是普通聊天（如问姓名、打招呼、说废话），请直接根据历史记录回答用户，不要带任何标签。
    5. 其他普通问题，回复：FINISH

    你只能回复上面三个标签之一，不要解释。
    """)
    response = llm.invoke([manager_prompt, *state["messages"]])
    return {"messages": [response]}

def tech_node(state: State):
    """技术员：负责处理纯维修请求。"""
    print("🛠️  [技术员] 正在处理维修请求...")
    tech_prompt = SystemMessage(content="""
    你是一个手机维修技术员。
    规则：
    - 只要用户询问维修、故障、修理、维修价格，就必须调用 tech_specialist_tool 查询维修手册。
    - 不要凭空回答维修价格或维修方案。
    - 如果用户没有提供手机型号，你必须询问用户，严禁擅自猜测或代入用户角色说话。
    """)
    response = llm_with_tools.invoke([tech_prompt, *state["messages"]])
    return {"messages": [response]}

# --- 4. 定义路由逻辑 (关键点！) ---
def manager_router(state: State) -> Literal["to_agent", "to_tech", "finish"]:
    """根据经理的分配结果，决定下一步去哪个节点。"""
    last_message = state["messages"][-1]
    content = last_message.content if isinstance(last_message.content, str) else ""
    user_message = state["messages"][0].content if isinstance(state["messages"][0].content, str) else ""

    if "BALANCE_AGENT" in content:
        return "to_agent"

    if "TECH_AGENT" in content:
        return "to_tech"

    if "FINISH" in content:
        return "finish"

    if any(keyword in user_message for keyword in ["余额", "银行卡", "账户", "够不够"]):
        return "to_agent"

    if any(keyword in user_message for keyword in ["维修", "修理", "修手机", "故障", "技术"]):
        return "to_tech"

    return "finish"


def agent_router(state: State) -> Literal["tools", "finish"]:
    """判断余额助手是否需要调用工具。"""
    last_message = state["messages"][-1]

    if getattr(last_message, "tool_calls", None):
        return "tools"

    return "finish"

# --- 5. 构建图 ---
# 创建一个状态图对象
workflow = StateGraph(State)

#添加节点
workflow.add_node("agent", chatbot)
workflow.add_node("tools", tool_excutor)
workflow.add_node("manager",manager_node)
workflow.add_node("tech",tech_node)

workflow.add_edge(START, "manager")

# 经理先判断任务类型，再分配给对应节点。
workflow.add_conditional_edges(
    "manager",
    manager_router,
    {
        "to_agent": "agent",   # 余额查询交给余额助手
        "to_tech": "tech",     # 维修/故障问题交给技术员
        "finish": END          # 其他情况直接结束
    }
)

# 余额助手回复后，判断是否需要执行工具。
workflow.add_conditional_edges(
    "agent",
    agent_router,
    {
        "tools": "tools",
        "finish": END
    }
)

# tools 节点跑完后，必须回到 agent 让它汇总信息
workflow.add_edge("tools", "agent")

# 技术员回复后，也要判断是否需要执行 RAG 工具
workflow.add_conditional_edges(
    "tech",
    agent_router,
    {
        "tools": "tools",
        "finish": END
    }
)

# 编译成可运行的应用
app = workflow.compile(checkpointer=memory_storage,interrupt_before=["tools"])

# config = {"configurable": {"thread_id": "123"}}

# # --- 第一次运行 ---
# inputs = {"messages": [HumanMessage(content="我是张大炮")]}
# app.invoke(inputs,config=config)

# # 第二次运行（即使你隔了很久，只要 thread_id 一样）
# inputs2 = {"messages": [HumanMessage(content="我刚才说我叫什么？")]}
# response = app.invoke(inputs2,config=config)

# # 在第二次运行之后加入这行
# snapshot = app.get_state(config)
# print("--- 内存中的所有历史记录 ---")
# for m in snapshot.values["messages"]:
#     print(f"{type(m).__name__}: {m.content}")

# for event in app.stream(inputs2, config=config):
#     # 这里能看到每个节点运行后的结果
#     for node_name, values in event.items():
#         print(f"节点 [{node_name}] 运行完毕")
#         print("AI回复: ", values["messages"][-1].content)


# 为本次对话生成一个唯一的线索ID（实际开发中可以从数据库读用户的ID）
thread_id = "user_001" 
config = {"configurable": {"thread_id": thread_id}}

print(f"--- 👔 手机管家已上线 (Thread ID: {thread_id}) ---")
print("--- (输入 'quit' 退出) ---")

while True:
    user_input = input("\n👤 用户: ")
    if user_input.lower() in ["quit", "exit"]:
        print("再见！")
        break

    # for msg, metadata in app.stream(
    #     {"messages": [HumanMessage(content=user_input)]},
    #     config=config,
    #     stream_mode="messages"# 开启消息流模式
    # ):
    #     # 只要是 AI 正在说话，就打印它的内容
    #     if msg.content:
    #         print(msg.content,end="|",flush=True)

    # --- 核心：只运行一次流 ---
    # 我们使用 updates 模式来监控节点运行，
    # 如果你想看“蹦字”，建议在节点内部处理，或者后续学习更高级的集合模式。
    # 为了保证逻辑不出错，我们先回归最稳的“节点流”
    for event in app.stream({"messages": [HumanMessage(content=user_input)]}, config=config):
        for node_name, values in event.items():
            print(f"📍 [系统消息] 节点 {node_name} 运行完毕")

            # 获取该节点产生的最后一条消息
            if "messages" in values:
                # 只打印 AI 最终说的人话，不打印那些 BALANCE_AGENT 等标签
                last_msg = values["messages"][-1]
                if hasattr(last_msg, "content") and last_msg.content:
                    if last_msg.content not in ["BALANCE_AGENT", "TECH_AGENT", "FINISH"]:
                        print(f"🤖 AI: {last_msg.content}")
            else:
                # 如果是拦截或其他特殊节点，我们打印一条系统提示
                print(f"📍 [系统] 流程运行至: {node_name}")

    # --- 关键：检查是否被拦截了 ---
    snapshot = app.get_state(config)
    # 如果下一个节点是 tools，说明正在等审批
    if snapshot.next:
        next_node = snapshot.next[0]
        if next_node == "tools":
            print("\n⚠️  [安全警告] Agent 申请查看您的个人隐私数据（余额）。")
            choice = input("👉 是否授权？(yes/no): ")

        if choice.lower() == "yes":
            # 如果同意，我们传 None 进去，告诉 AI：接着刚才的地方继续跑
            print("✅ 授权通过，正在查询...")
            for event in app.stream(None,config=config):
                for node_name,values in event.items():
                    if isinstance(values,dict) and "messages" in values:
                        content = values["messages"][-1].content
                        if content not in ["BALANCE_AGENT","TECH_AGENT","FINISH"]:
                            print(f"🤖 AI: {content}")
        else:
            print("❌ 授权拒绝，正在结束对话...")
            # 如果拒绝，我们可以手动往记忆里塞一条“用户拒绝了”的消息，让 AI 死心
            app.update_state(config,{"messages": [HumanMessage(content="用户拒绝了授权，请礼貌的告知用户你无法继续操作。")]})
            # 让它继续跑一下，输出告别语
            app.invoke(None,config=config)