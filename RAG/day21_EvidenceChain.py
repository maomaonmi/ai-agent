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
def citation_validator_node(state: GroundedState):
    print("[Node: Validator] ⚖️ 正在校验证据链...")
    answer = state["final_answer"]
    docs = state["retrieved_docs"]
    
    # 1. 检查是否有 [n] 这种格式的引用
    citations = re.findall(r'\[(\d+)\]', answer)
    if not citations:
        return {"correction_feedback": "你的回答中没有任何引用标注，请在事实末尾加上 [n]。"}
    
    # 2. 检查引用的编号是否超出了检索到的范围
    max_id = len(docs)
    for c in citations:
        if int(c) > max_id:
            return {"correction_feedback": f"你引用了不存在的编号 [{c}]，目前只有 1-{max_id} 号资料。"}
            
    # 3. (进阶) 语义校验：检查 [1] 标注的那句话，是不是真的在 [1] 号资料里有体现
    # 这里通常再调一次 LLM 来审判
    
    print("✅ 证据链校验通过！")
    return {"correction_feedback": ""}
    

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
workflow.add_node("validator", citation_validator_node)

workflow.add_edge(START, "retrieve")
workflow.add_edge("retrieve", "analyst")
workflow.add_edge("analyst", "validator")
workflow.add_conditional_edges("validator", should_continue)

app = workflow.compile()

result = app.invoke({"messages": [HumanMessage(content="你好，我想了解维修相关信息。")]})
print("\nAI回复:", result.get("final_answer", ""))