import json
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

    mode: Literal["fast","standard","deep"]
    response: str

def router_node(state: GroundedState):
    user_msg = state["messages"][0].content
    print(f"\n[Node: Gateway] 🚦 分析意图: {user_msg}")
    
    #判词： 判断任务级别
    prompt = f"""
    分析用户问题，选择处理模式：
    1. 简单问候/闲聊 -> "fast"
    2. 明确的单条维修/价格查询，且不涉及多步推理 -> "standard"
    3. 涉及以下任意特征的，必须选 "deep"：
       - 需要对比多条资料（如：先做A还是B、哪个更划算）
       - 需要多步计算（如：钱够不够、多项费用加起来多少）
       - 问"能不能"且资料没直接说，需要推理
       - 问"为什么"/"原因"
       - 涉及优化、性价比、最优组合
       - 用户提供了自己的条件（余额、时间等）需要结合资料计算

    问题：{user_msg}
    只需回复标签名。
    """

    res = ChatOpenAI(
        model="deepseek-chat",
        api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
        base_url="https://api.deepseek.com"
    ).invoke([SystemMessage(content=prompt)])

    mode = res.content.lower().strip()

    # 关键词兜底兜底兜底：即使LLM判断错误，命中关键词也强制deep
    deep_keywords = ["还是", "还是说", "先", "能不能", "可以吗", "是否应该",
                     "为什么", "为什么", "够不够", "够吗", "性价比", "最优",
                     "组合", "结合", "同时", "先", "如果", "假设"]
    if any(kw in user_msg for kw in deep_keywords):
        mode = "deep"
        print(f"[Gateway] 🔑 关键词命中，强制启用深度思考模式")
    return {"mode": mode}


# ==========================================
# 2. 检索节点 (为每条资料打上 ID)
# ==========================================
def retrieval_node(state: GroundedState):
    print("[Node: Retrieval] 正在根据搜索词拉取资料...")
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

    print(f"  搜索关键词: {keywords}")
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
    print(f"  命中 {len(matched_docs)} 条资料")
    return {"retrieved_docs": numbered_docs, "retry_count": 0}

# ==========================================
# 3. 查询重写节点
# ==========================================
def query_rewriter_node(state: GroundedState):
    print("\n[Node: Rewriter] 正在将用户意图转化为多路搜索词...")
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
    print("[Node: Analyst] 正在撰写带引用的报告...")
    mode = state.get("mode","standard")

    if mode == "deep":
        #切换到推理模型
        active_model = ChatOpenAI(
            model="deepseek-reasoner",
            api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
            base_url="https://api.deepseek.com"
        )
        print("[Node: Analyst] 🧠 正在启动【深度思考模式】...")
    else:
        #切换到客服模型
        active_llm = ChatOpenAI(
            model="deepseek-chat",
            api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
            base_url="https://api.deepseek.com"
        )
        print("[Node: Analyst] ⚡ 正在使用【标准模式】...")

    context_str = "\n".join([f"资料 [{d['id']}]: {d['text']}" for d in state['retrieved_docs']])
    feedback = f"\n注意：上次回复漏掉了引用或引用错误：{state['correction_feedback']}" if state.get('correction_feedback') else ""

    system_prompt = f"""
    你是一个严谨的客服专家。请根据以下【参考资料】回答用户问题。
    【参考资料】：
    {context_str}
    【强制要求】：
    1. 每一句包含事实的陈述都必须在末尾标注资料编号，例如：修屏幕需要500元 [1]。
    2. 精确回答用户所问：用户问什么就答什么，不要遗漏资料中已有的相关信息（即使用户没有主动问，若该信息与答案直接相关则必须包含）。
    3. 若资料中缺少用户询问的某些信息，直接回复"资料中未提及该信息"。
    4. 对于多部分问题，逐一作答，不要遗漏任一部分。
    5. 禁止添加资料外的任何推测、建议或下一步行动。
    6. 文末必须列出【参考来源】列表。
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
    print("[Node: Auditor] 正在进行语义级证据审计...")
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
注意：只要声明被证据库内容支持，即视为通过。不接受因"信息不够完整"或"未补充额外细节"而产生的"冲突"判定。
【待核对清单】：
{chr(10).join(audit_tasks)}
请判断：如果有任何一个声明与其证据不符，请回复"冲突：具体原因"。
如果全部完全吻合，请回复 "PASS"。
"""
    audit_res = ChatOpenAI(
        model="deepseek-chat",
        api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
        base_url="https://api.deepseek.com"
    ).invoke([SystemMessage(content=audit_prompt)])

    if "PASS" in audit_res.content:
        print("语义审计通过，证据链真实可靠！")
        return {"correction_feedback": ""}
    else:
        print(f"审计发现冲突: {audit_res.content}")
        return {"correction_feedback": f"语义审计失败: {audit_res.content}"}

# ==========================================
# 6. 构建图
# ==========================================
MAX_RETRIES = 3

def should_continue(state: GroundedState):
    if state.get("retry_count", 0) >= MAX_RETRIES:
        print(f"重试次数已达上限 ({MAX_RETRIES} 次)，强制结束。")
        return "max_retries"
    if state.get("correction_feedback"):
        return "retry"
    return "pass"

workflow = StateGraph(GroundedState)
workflow.add_node("retrieve", retrieval_node)
workflow.add_node("rewrite", query_rewriter_node)
workflow.add_node("analyst", grounded_analyst_node)
workflow.add_node("validator", semantic_citation_auditor)

workflow.add_edge(START, "rewrite")
workflow.add_edge("rewrite", "retrieve")
workflow.add_edge("retrieve", "analyst")
workflow.add_edge("analyst", "validator")
workflow.add_conditional_edges(
    "validator",
    should_continue,
    {
        "retry": "analyst",
        "max_retries": END,
        "pass": END,
    },
)

app = workflow.compile()

# ==========================================
# 7. 回归测试：黄金数据集评测
# ==========================================
def run_judge_standalone(query: str, agent_answer: str, docs: list) -> dict:
    docs_str = "\n".join([f"[{d['id']}] {d['text']}" for d in docs])
    judge_prompt = f"""
你是一个严苛的AI质量审计员，请根据【参考资料】评估【AI回答】的质量。
评分标准：
1. 事实性 (Factuality)：回答中的每一句事实陈述是否都有资料支撑，且没有说错资料中的内容？
2. 引用 (Citations)：每句事实陈述是否标注了 [n] 来源？
3. 诚实性 (Honesty)：资料没提的内容，AI 是否明确说"未提及"？

重要扣分原则：
- 多说了资料中没有的内容，扣分
- 引用标注错误，扣分
- 资料中有的相关信息但没回答，扣分

不扣分的情形：
- 额外补充了资料支持的细节（即使用户没主动问）
- 回答简洁但完整覆盖了用户所问

【用户问题】：{query}
【参考资料】：{docs_str}
【AI回答】：{agent_answer}

请直接输出JSON格式，score 必须是 1 到 10 之间的整数：
{{
    "score": 整数分数,
    "reason": "扣分或加分理由，重点说明多说了还是少说了",
    "hallucination": "是否存在幻觉(yes/no)"
}}
"""
    res = ChatOpenAI(
        model="deepseek-chat",
        api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
        base_url="https://api.deepseek.com"
    ).invoke(judge_prompt)
    raw = json.loads(res.content)
    raw["score"] = max(1, min(10, int(raw["score"])))
    return raw

GOLDEN_DATASET = [
    # {"q": "屏幕多少钱？",              "ref": "资料1: 500元"},
    # {"q": "你们这能升级内存吗？要多久？",  "ref": "资料2: 内存升级128G，费用300元。"},
    # {"q": "屏幕维修和主板维修哪个更久？",          "ref": "资料3: 15个工作日"},
    # {"q": "摄像头故障怎么修？",          "ref": "资料4: 180元"},
    # {"q": "听筒无声怎么解决？",          "ref": "资料5: 重启无效后返厂检测"},
    # {"q": "400 元能同时修听筒和换外壳吗？",     "ref": "资料6: 300元"},
    # {"q": "外壳划痕抛光多少钱？",         "ref": "资料7: 50元"},
    # {"q": "我手机掉水里了，修一下贵吗？",  "ref": "资料8: 进水维修200元起，需拆机清理。"},
    {"q": "我是张大炮（余额100），我不仅屏幕碎了（500元），听筒还没声了。但我急着在 3 小时后用手机开视频会议。请结合资料给我一个最合理的应急方案。如果我借到 500 元，我是该先修屏幕还是修听筒？为什么？", "ref": "资料9: 视频会议需要看屏幕和听声音。屏幕维修要 2 小时，修完刚好能开会。听筒坏了可以用耳机替代。"},
    {"q": "我手机掉水里了，但我现在赶时间。我能不能先不拆机，只做个外壳划痕抛光，等过几天有空了再来大修？", "ref": "资料10: 进水不拆机清理，主板会腐蚀。抛光是纯外观，不修主板会导致手机彻底报废。"},
    {"q": "我有 500 元，想给手机做个‘全身大翻新’，把屏幕、内存、外壳全都弄成最好的，钱够吗？如果不够，最高性价比的组合是什么？", "ref": "资料11: 屏幕是功能核心，内存是性能核心，划痕只是美观。"},
]

print("\n" + "=" * 50)
print("开始回归测试，共 {} 道题".format(len(GOLDEN_DATASET)))
print("=" * 50)

scores = []
for case in GOLDEN_DATASET:
    print(f"\n▶ 题目: {case['q']}")
    response = app.invoke({"messages": [HumanMessage(content=case["q"])]})
    answer = response["final_answer"]
    docs = response["retrieved_docs"]

    print(f"\nAI回答:\n{answer}\n")

    score_data = run_judge_standalone(case["q"], answer, docs)
    scores.append(score_data["score"])

    print(f"  得分: {score_data['score']}/10 | 幻觉: {score_data['hallucination']}")
    print(f"  理由: {score_data['reason']}")

avg_score = sum(scores) / len(scores)
print(f"\n{'=' * 50}")
print(f"本次模型版本平均分: {avg_score:.2f}/10")
print(f"{'=' * 50}")
