import re
from typing import Annotated, TypedDict, List, Dict, Literal
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END

# ==========================================
# 1. 状态定义：增加“检索到的原始片段”字段
# ==========================================
class GroundedState(TypedDict):
    messages: Annotated[list[BaseMessage], lambda x, y: x + y]
    # 存储带编号的检索结果：[{"id": 1, "content": "...", "source": "维修手册"}]
    retrieved_docs: List[Dict]
    # 最终报告
    final_answer: str
    # 校验失败的反馈
    correction_feedback: str

# ==========================================
# 2. 模拟检索节点 (为每条资料打上 ID)
# ==========================================
def retrieval_node(state: GroundedState):
    print("\n[Node: Retrieval] 🔍 正在检索并对证据进行编号...")
    # 模拟从向量数据库拿到的 3 条资料
    raw_docs = [
        "黑科技手机X屏幕维修费500元，需2小时。",
        "电池质保2年，非人为损坏免费更换。",
        "主板维修需返厂，周期为15个工作日。"
    ]
    # 关键：给每条资料打上数字 ID
    numbered_docs = [{"id": i+1, "text": doc} for i, doc in enumerate(raw_docs)]
    return {"retrieved_docs": numbered_docs}

# ==========================================
# 3. 带引用的分析节点
# ==========================================
def grounded_analyst_node(state: GroundedState):
    print("[Node: Analyst] ✍️  正在撰写带引用的报告...")
    
    # 将编号后的文档拼成 Prompt 可读的格式
    context_str = "\n".join([f"资料 [{d['id']}]: {d['text']}" for d in state['retrieved_docs']])
    
    feedback = f"\n⚠️ 注意：上次回复漏掉了引用或引用错误：{state['correction_feedback']}" if state.get('correction_feedback') else ""

    system_prompt = f"""你是一个严谨的客服专家。
    请根据以下【参考资料】回答用户问题。
    
    【参考资料】：
    {context_str}

    【强制要求】：
    1. 每一句包含事实的陈述都必须在末尾标注资料编号，例如：修屏幕需要500元 [1]。
    2. 如果资料中没有提到相关信息，请直接说明，严禁瞎编。
    3. 文末必须列出【参考来源】列表。
    {feedback}
    """
    
    response = ChatOpenAI(model="deepseek-chat", api_key = "sk-6d31f71ec3514f6785e28fa00ea03199", base_url="https://api.deepseek.com").invoke([
        SystemMessage(content=system_prompt),
        *state["messages"]
    ])
    return {"messages": [response], "final_answer": response.content}

# ==========================================
# 4. 引用校验节点 (The Grounding Guard)
# ==========================================
def semantic_citation_auditor(state: GroundedState):
    """
    登神长阶：语义级证据审计
    利用 LLM 检查每一处引用是否真实支撑声明
    """
    print("[Node: Auditor] 🕵️ 正在进行语义级证据审计...")
    answer = state["final_answer"]
    docs = {str(d['id']): d['text'] for d in state['retrieved_docs']}

    # 1. 提取所有声明和引用对
    # 比如：[("屏幕维修费是500元", "1"), ("电池质保2年", "2")]
    pairs = re.findall(r'([^。！？]*?)\[(\d+)\]',answer)

    if not pairs:
        return {"correction_feedback": "未发现引用标注，请在事实性陈述后添加 [n]。"}
    
    audit_tasks = []
    for claim,doc_id in pairs:
        evidence = docs.get(doc_id,"未知")
        audit_tasks.append(f"声明: {claim.strip()}\n证据库[{doc_id}]: {evidence}")

    # 2. 呼叫“裁判 AI”进行批量审计
    audit_prompt = f"""
    你是首席审计官。请核对以下声明是否能由其标注的证据库内容真实支撑。

    【待核对清单】：
    {chr(10).join(audit_tasks)}

    请判断：如果有任何一个声明与其证据不符（或证据里没提到），请回复”冲突：具体原因“。
    如果全部完全吻合，请回复 ”PASS“。
    """

    # 这里的推理开销较小，可以用快速模型
    audit_res = ChatOpenAI(model="deepseek-chat", api_key="sk-6d31f71ec3514f6785e28fa00ea03199", base_url="https://api.deepseek.com").invoke([SystemMessage(content=audit_prompt)])

    if "PASS" in audit_res.content:
        print("✅ 语义审计通过,证据链真实可靠！")
        return {"correction_feedback": ""}
    else:
        print(f"❌ 审计发现冲突: {audit_res.content}")
        return {"correction_feedback": f"语义审计失败: {audit_res.content}"}

# ==========================================
# 5. 构建图：这里体现“回流修正”
# ==========================================
def should_continue(state: GroundedState) -> Literal["analyst", "__end__"]:
    if state.get("correction_feedback"):
        return "analyst" # 没引对？滚回去重写
    return "__end__"

workflow = StateGraph(GroundedState)
workflow.add_node("retrieve", retrieval_node)
workflow.add_node("analyst", grounded_analyst_node)
workflow.add_node("validator", semantic_citation_auditor)

workflow.add_edge(START, "retrieve")
workflow.add_edge("retrieve", "analyst")
workflow.add_edge("analyst", "validator")
workflow.add_conditional_edges("validator", should_continue)

app = workflow.compile()

result = app.invoke({"messages": [HumanMessage(content="你好，我想了解维修相关信息。")]})
print("\nAI回复:", result.get("final_answer", ""))