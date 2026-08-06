import re
from typing import Annotated, TypedDict, List, Dict, Literal
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END

# ==========================================
# 1. 状态定义：增加"检索到的原始片段"字段
# ==========================================
class GroundedState(TypedDict):
    messages: Annotated[list[BaseMessage], lambda x, y: x + y]
    retrieved_docs: List[Dict]
    final_answer: str
    correction_feedback: str
    retry_count: int

# ==========================================
# 2. 检索节点 (为每条资料打上 ID)
# ==========================================
def retrieval_node(state: GroundedState):
    print("[Node: Retrieval] 🔍 正在根据搜索词拉取资料...")
    all_docs = [
        {"id": 1, "text": "黑科技手机X屏幕维修费500元，需2小时。"},
        {"id": 2, "text": "电池质保2年，非人为损坏免费更换。"},
        {"id": 3, "text": "主板维修需返厂，周期为15个工作日。"},
        {"id": 4, "text": "摄像头故障需更换，费用180元。"},
        {"id": 5, "text": "听筒无声可能是软件问题，重启无效后返厂检测。"},
        {"id": 6, "text": "内存升级128G，费用300元。"},
        {"id": 7, "text": "外壳划痕抛光服务50元。"},
        {"id": 8, "text": "进水维修需拆机清理，费用200元起。"}
    ]

    keywords = []
    for msg in state["messages"]:
        if msg.content.startswith("扩展搜索词"):
            raw = msg.content.replace("扩展搜索词：", "")
            keywords = [k.strip() for k in raw.split("，") if k.strip()]
            break

    if not keywords:
        print("  (未识别到关键词，返回全部资料)")
        numbered_docs = [{"id": i+1, "text": d["text"]} for i, d in enumerate(all_docs)]
        return {"retrieved_docs": numbered_docs, "retry_count": 0}

    print(f"  📌 搜索关键词: {keywords}")
    check_prompt = f"""以下是资料库候选条目（仅含text字段）:
{chr(10).join([f"[{d['id']}] {d['text']}" for d in all_docs])}

用户想了解: {state['messages'][0].content}
扩展关键词: {keywords}
请列出所有相关条目的id，用逗号分隔。"""

    res = ChatOpenAI(
        model="deepseek-chat",
        api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
        base_url="https://api.deepseek.com"
    ).invoke([SystemMessage(content=check_prompt)])

    ids_str = res.content.strip()
    matched_ids = []
    for part in ids_str.split(","):
        part = part.strip()
        for d in all_docs:
            if str(d["id"]) in part:
                matched_ids.append(d["id"])

    if not matched_ids:
        print("  (关键词未命中，返回全部资料)")
        numbered_docs = [{"id": i+1, "text": d["text"]} for i, d in enumerate(all_docs)]
        return {"retrieved_docs": numbered_docs, "retry_count": 0}

    matched_docs = [d for d in all_docs if d["id"] in matched_ids]
    numbered_docs = [{"id": i+1, "text": d["text"]} for i, d in enumerate(matched_docs)]
    print(f"  ✅ 命中 {len(matched_docs)} 条资料")
    return {"retrieved_docs": numbered_docs, "retry_count": 0}

# ==========================================
# 3. 查询重写节点
# ==========================================
def query_rewriter_node(state: GroundedState):
    """
    登神长阶：查询重写
    将用户模糊的问题转化为 3 个精准的搜索关键词
    """
    print("\n[Node: Rewriter] 🔄 正在将用户意图转化为多路搜索词...")
    user_msg = state["messages"][0].content

    prompt = f"""
    请针对用户的问题，生成3个用于检索维修手册的短关键词。
    用户问题：{user_msg}
    直接输出关键词，用逗号分隔。
    """
    res = ChatOpenAI(
        model="deepseek-chat",
        api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
        base_url="https://api.deepseek.com"
    ).invoke([SystemMessage(content=prompt), *state["messages"]])

    keywords = [k.strip() for k in res.content.split(",")]
    return {"messages": [SystemMessage(content=f"扩展搜索词：{'，'.join(keywords)}")]}

# ==========================================
# 4. 带引用的分析节点
# ==========================================
def grounded_analyst_node(state: GroundedState):
    print("[Node: Analyst] ✍️  正在撰写带引用的报告...")

    context_str = "\n".join([f"资料 [{d['id']}]: {d['text']}" for d in state['retrieved_docs']])
    feedback = f"\n⚠️ 注意：上次回复漏掉了引用或引用错误：{state['correction_feedback']}" if state.get('correction_feedback') else ""

    system_prompt = f"""
    你是一个严谨的客服专家。请根据以下【参考资料】回答用户问题。
    【参考资料】：
    {context_str}
    【强制要求】：
    1. 每一句包含事实的陈述都必须在末尾标注资料编号，例如：修屏幕需要500元 [1]。
    2. 如果资料中没有提到相关信息，请直接说明，严禁瞎编。
    3. 文末必须列出【参考来源】列表。
    {feedback}
    """
    response = ChatOpenAI(
        model="deepseek-chat",
        api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
        base_url="https://api.deepseek.com"
    ).invoke([
        SystemMessage(content=system_prompt),
        *state["messages"]
    ])
    return {"messages": [response], "final_answer": response.content, "retry_count": state.get("retry_count", 0) + 1}

# ==========================================
# 5. 语义级证据审计节点
# ==========================================
def semantic_citation_auditor(state: GroundedState):
    print("[Node: Auditor] 🕵️ 正在进行语义级证据审计...")
    answer = state["final_answer"]
    docs_list = state["retrieved_docs"]
    docs_dict = {str(d['id']): d['text'] for d in docs_list}
    user_query = state["messages"][0].content

    # 充分性检查
    check_prompt = f"问题: {user_query}\n资料: {docs_list}\n这些资料能完整回答问题吗？只需回复 YES 或 NO。"
    res = ChatOpenAI(
        model="deepseek-chat",
        api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
        base_url="https://api.deepseek.com"
    ).invoke([SystemMessage(content=check_prompt)])

    if "NO" in res.content:
        return {"correction_feedback": "检索资料不足以完整回答问题，请触发重新搜索。"}

    # 引用提取
    pairs = re.findall(r'([^。！？]*?)\[(\d+)\]', answer)
    if not pairs:
        return {"correction_feedback": "未发现引用标注，请在事实性陈述后添加 [n]。"}

    audit_tasks = []
    for claim, doc_id in pairs:
        evidence = docs_dict.get(doc_id, "未知")
        audit_tasks.append(f"声明: {claim.strip()}\n证据库[{doc_id}]: {evidence}")

    # 语义审计
    audit_prompt = f"""
    你是首席审计官。请核对以下声明是否能由其标注的证据库内容真实支撑。
    【待核对清单】：
    {chr(10).join(audit_tasks)}
    请判断：如果有任何一个声明与其证据不符（或证据里没提到），请回复"冲突：具体原因"。
    如果全部完全吻合，请回复 "PASS"。
    """
    audit_res = ChatOpenAI(
        model="deepseek-chat",
        api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
        base_url="https://api.deepseek.com"
    ).invoke([SystemMessage(content=audit_prompt)])

    if "PASS" in audit_res.content:
        print("✅ 语义审计通过，证据链真实可靠！")
        return {"correction_feedback": ""}
    else:
        print(f"❌ 审计发现冲突: {audit_res.content}")
        return {"correction_feedback": f"语义审计失败: {audit_res.content}"}

# ==========================================
# 6. 构建图
# ==========================================
MAX_RETRIES = 3

def should_continue(state: GroundedState) -> Literal["analyst", "__end__"]:
    if state.get("retry_count", 0) >= MAX_RETRIES:
        print(f"⚠️ 重试次数已达上限 ({MAX_RETRIES} 次)，强制结束。")
        return "__end__"
    if state.get("correction_feedback"):
        return "analyst"
    return "__end__"

workflow = StateGraph(GroundedState)
workflow.add_node("retrieve", retrieval_node)
workflow.add_node("rewrite", query_rewriter_node)
workflow.add_node("analyst", grounded_analyst_node)
workflow.add_node("validator", semantic_citation_auditor)

workflow.add_edge(START, "rewrite")
workflow.add_edge("rewrite", "retrieve")
workflow.add_edge("retrieve", "analyst")
workflow.add_edge("analyst", "validator")
workflow.add_conditional_edges("validator", should_continue)

app = workflow.compile()

result = app.invoke({"messages": [HumanMessage(content="那个...我想问一下，搞一下那个东西要等多久啊？我余额只有 100 块。")]})
print("\nAI回复:", result.get("final_answer", ""))
