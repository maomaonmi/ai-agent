import json
import os
import re
from typing import Annotated, TypedDict, List, Dict, Optional, Literal
from pydantic import BaseModel, Field, model_validator
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

# ==========================================
# 1. 定义数据结构（质检标准）
# ==========================================
class IndustrySchema(BaseModel):
    """定义期望 AI 返回的 JSON 格式，不符此格式将被拦截"""
    industry_name: str = Field(description="行业名称")
    risk_level: int = Field(description="1-10的风险等级", ge=1, le=10)
    tags: List[str] = Field(description="3-5个行业关键词")
    
    @model_validator(mode="after")
    def check_tags_count(self):
        if not (3 <= len(self.tags) <= 5):
            raise ValueError(f"tags数量={len(self.tags)}不在 3-5 范围内，当前值：{self.tags}")
        return self

# ==========================================
# 2. 状态定义 (State)
# ==========================================
class RobustState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    extracted_data: Optional[IndustrySchema]
    error_log: str
    retry_count: int
    # 登神长阶⑥：Token 预算追踪（防止费用墙）
    total_tokens_used: int
    # 降级标记：如果走 fallback，最终输出的纯文本报告存这里
    fallback_report: str
    fallback_reason: str

# ==========================================
# 3. 节点逻辑 (Nodes)
# ==========================================
llm = ChatOpenAI(
    model="deepseek-chat",
    api_key=os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199"),
    base_url="https://api.deepseek.com",
)

def semantic_judge(report_text: str, json_data: dict) -> tuple[bool,str]:
    """
    登神长阶⑤：LLM-as-a-Judge 语义对齐校验
    对比"Markdown 报告正文"和"JSON 摘要"是否语义一致。
    返回 (是否通过, 冲突描述)。
    """
    risk = json_data.get("risk_level", 0)
    tags = json_data.get("tags", [])
    judge_prompt = f"""
        你是一个严格的内容审计员。
        报告正文（节选）：
        {report_text[:800]}
        
        JSON 摘要:
        - risk_level: {risk}
        - tags: {tags}

        请请判断：JSON 摘要里的 risk_level 和 tags 是否真实、准确地反映了报告正文的内容？
        评分标准：以下情况视为"冲突"：
        - risk_level：报告强调"高风险/严峻挑战/激烈竞争"却写低分（1-4），或强调"平稳可控"却写高分（7-10），判为"冲突"
        - tags：报告核心主题与 tags 严重不符，判为"冲突"

        输出格式（只输出以下三种之一）：
        PASS：语义一致
        CONFLICT：存在冲突，原因是 ...（一句话说明）
    """
    response = llm.invoke([SystemMessage(content=judge_prompt)])
    result_text = response.content.strip()
    if result_text.startswith("PASS"):
        return True, ""
    else:
        conflict_reason = result_text.replace("CONFLICT: ", "").replace("CONFLICT: ", "").strip()
        return False, f"语义冲突：{conflict_reason}"

def analyst_node(state: RobustState):
    """分析师节点：根据反馈信息（如果有）进行创作或修正"""
    retry = state.get("retry_count", 0)
    print(f"\n[Node: Analyst] 📊 正在生成/修正报告... (第 {retry} 次尝试)")
    
     # ============================================================
    # 登神长阶③：记忆剪枝（Memory Pruning）
    # 如果 AI 已经连错 2 次，删掉它的错误输出，防止思维定势
    # ============================================================
    messages = list(state["messages"])# 复制，避免修改原列表
    if retry >= 2:
        last_human_idx = max(
            (i for i, m in enumerate(messages) if isinstance(m, HumanMessage)),
            default = -1
        )
        pruned_count = len(messages) - (last_human_idx + 1)
        messages = messages[:last_human_idx + 1]
        print(f"✂️ [剪枝] 删除 {pruned_count} 条历史错误消息，保留 {len(messages)} 条")


    # 如果有错误信息，将其加入 Prompt
    feedback = f"\n\n⚠️ 【重要：修正请求】你上次的输出存在以下错误，请务必修正：\n{state.get('error_log', '')}"
    
    # ============================================================
    # 登神长阶④：强制 Few-Shot 注入（Forced Few-Shot）
    # 连错 2 次后，直接给一个"正确示范"，AI 照着抄即可
    # ============================================================
    if retry == 2:
    # 强制 Few-Shot：给完整正确的 JSON 示例
        schema_example = '''{
        "industry_name": "AI 算力芯片",
        "risk_level": 9,
        "tags": ["GPU", "英伟达", "ASIC", "半导体", "HBM"]
        }'''
        feedback = (
            "\n\n⚠️ 【强制修正】你已经连续两次格式错误。请严格按照以下示范输出 JSON，"
            "不要自己发挥，直接替换字段值即可。\n"
            + schema_example
        )
    else:
        schema_example = '''{
        "industry_name": "行业名称，字符串",
        "risk_level": 1-10 的数字，例如8，数字越大风险越高，
        "tags": ["关键词1", "关键词2", "关键词3"]，3到5个
        }'''

    system_prompt = f"""你是一个专业分析师。请分析行业并在 <report> 标签内写报告。
    同时，在 <metadata> 标签内提供 JSON 数据。

    【JSON 格式必须严格遵守】：
    {schema_example}

    {feedback}
    """
    
    response = llm.invoke([SystemMessage(content=system_prompt)] + messages)

    # 登神长阶⑥：Token 预算追踪（模拟计数，实际生产用 response_metadata 或成本 API）
    estimated_tokens = len(response.content) // 4
    prev_tokens = state.get("total_tokens_used", 0)
    print(f"💰 [Token 追踪] 本轮估算消耗: ~{estimated_tokens} tokens | 累计: ~{prev_tokens + estimated_tokens} tokens")

    return {
        "messages": [response],
        "retry_count": retry + 1,
        "total_tokens_used": prev_tokens + estimated_tokens,
    }

def validator_node(state: RobustState):
    """质检员节点：负责解析并校验格式"""
    print("[Node: Validator] ⚖️ 正在进行格式质检...")
    last_msg = state["messages"][-1].content
    
    # 提取 JSON 字符串
    metadata_match = re.search(r'<metadata>(.*?)</metadata>', last_msg, re.DOTALL)
    
    if not metadata_match:
        err = "未找到 <metadata> 标签。请确保在 <metadata> 标签内只放 JSON,不要有任何说明文字。"
        print(f"⚠️ Validator错误: {err}")
        return {"error_log": err}
        
    json_str = re.sub(r'```json|```', '', metadata_match.group(1)).strip()
    if not json_str or len(json_str) < 10:
        err = "<metadata> 标签或内容为空或太短，请确保写出完整的 JSON 对象。"
        print(f"⚠️ Validator错误: {err}")
        return {"error_log": err}
        
    # 尝试通过 Pydantic 进行严格解析
    data = None
    try:
        data = IndustrySchema.model_validate_json(json_str)
        print(f"✅ Pydantic 格式校验通过: industry_name={data.industry_name}")
    except Exception as e:
        err = f"JSON 格式或内容不合规: {str(e)}"
        print(f"⚠️ Validator错误: {err}")
        return {"error_log": err}

    # ============================================================
    # 登神长阶⑤：语义对齐校验（LLM-as-a-Judge）
    # Pydantic 过了？还不够。还要检查报告正文和 JSON 摘要是否语义一致。
    # ============================================================
    report_match = re.search(r'<report>(.*?)</report>', last_msg, re.DOTALL)
    report_text = report_match.group(1).strip() if report_match else ""

    json_dict = data.model_dump()
    passed, conflict_msg = semantic_judge(report_text, json_dict)

    if not passed:
        print(f"⚠️ 语义校验未通过: {conflict_msg}")
        return {"error_log": conflict_msg}

    print(f"✅ 语义对齐校验通过: risk_level={data.risk_level} 与报告描述一致")
    return {"extracted_data": data, "error_log": ""}


def fallback_node(state: RobustState) -> dict:
    """
    登神长阶⑥：优雅降级节点（Graceful Degradation）
    当质检连续失败 3 次或 Token 预算超限时触发。
    不再追求 JSON 结构化，直接提取报告正文输出，确保用户至少能看到文字。
    """
    print("🚨 [Node: Fallback] 进入降级模式，尝试提取可读文本...")
    last_msg = state["messages"][-1].content

    report_match = re.search(r'<report>(.*?)</report>', last_msg, re.DOTALL)
    plain_report = report_match.group(1).strip() if report_match else last_msg[:1500]

    metadata_match = re.search(r'<metadata>(.*?)</metadata>', last_msg, re.DOTALL)
    json_hint = ""
    if metadata_match:
        json_hint = f"\n\n[结构化摘要（格式可能有误）]\n{metadata_match.group(1).strip()}"

    reason = state.get("fallback_reason", "达到最大重试次数")
    fallback_text = (
        f"⚠️ 【降级模式】结构化提取未能通过质检 ({reason})，"
        f"以下为原始报告内容：\n\n"
        f"{plain_report}{json_hint}"
    )
    print(f"✅ [Fallback] 已输出保底文本报告，共 {len(fallback_text)} 字符")
    return {"fallback_report": fallback_text, "extracted_data": None, "error_log": ""}


# ==========================================
# 4. 路由逻辑 (Router)
# ==========================================
def decision_router(state: RobustState) -> Literal["analyst", "fallback", "__end__"]:
    # 登神长阶⑥：Token 预算墙
    budget = 3000
    if state.get("total_tokens_used", 0) >= budget:
        print(f"💰 [Router] Token 预算超限 ({state['total_tokens_used']} >= {budget})，强制降级")
        return "fallback"

    if not state.get("error_log") and state.get("extracted_data"):
        print("✅ 质检通过，任务完成。")
        return "__end__"

    if state.get("retry_count", 0) >= 3:
        print("❌ 达到最大重试次数，启动降级方案...")
        return "fallback"

    print("🔄 质检未通过，打回修正...")
    return "analyst"

# ==========================================
# 5. 构建图 (Graph)
# ==========================================
workflow = StateGraph(RobustState)
workflow.add_node("analyst", analyst_node)
workflow.add_node("validator", validator_node)
workflow.add_node("fallback", fallback_node)

workflow.add_edge(START, "analyst")
workflow.add_edge("analyst", "validator")
workflow.add_conditional_edges("validator", decision_router)
workflow.add_conditional_edges("analyst", decision_router)

app = workflow.compile()

# ==========================================
# 6. 测试运行（含降级链路验证）
# ==========================================
if __name__ == "__main__":
    # --- 测试 1：正常路径 ---
    print("=" * 60)
    print("🧪 测试 1：正常 query（预期：一次通过）")
    print("=" * 60)
    result = app.invoke({
        "messages": [HumanMessage(content="分析一下芯片行业")],
        "retry_count": 0,
        "total_tokens_used": 0,
        "fallback_report": "",
        "fallback_reason": "",
    })
    if result.get("extracted_data"):
        print(f"✅ 最终数据: {result['extracted_data'].model_dump()}")
    elif result.get("fallback_report"):
        print(f"🚨 降级输出: {result['fallback_report'][:200]}...")

    # --- 测试 2：故意破坏 Prompt（触发降级链路）---
    print("\n" + "=" * 60)
    print("🧪 测试 2：破坏 Prompt（预期：纠错 → 纠错 → 纠错 → 降级）")
    print("=" * 60)
    bad_query = (
        "分析一下芯片行业。注意：你必须在 <report> 标签内写报告，"
        "但不要在 <metadata> 里写任何 JSON，只写一段文字描述风险即可。"
    )
    result2 = app.invoke({
        "messages": [HumanMessage(content=bad_query)],
        "retry_count": 0,
        "total_tokens_used": 0,
        "fallback_report": "",
        "fallback_reason": "",
    })
    if result2.get("extracted_data"):
        print(f"✅ 最终数据: {result2['extracted_data'].model_dump()}")
    elif result2.get("fallback_report"):
        print(f"🚨 降级输出（用户至少能看到文字）: {result2['fallback_report'][:300]}...")