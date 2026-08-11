"""
Day 69: Agent 规划器 ➔ MCP 发现层 ➔ Skill 引擎 ➔ MCP 上下文池 闭环协作工作流
启动方式: python day69_skill_mcp_workflow.py
"""

import json
import re
import time
from typing import Annotated, TypedDict, List, Dict, Optional, Literal, Any
from pydantic import BaseModel, Field
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END

# ==========================================
# 1. 数据契约定义 (Skill & MCP & State)
# ==========================================

# Why 用 SkillCapsule 而非 Skill：胶囊封装"技能元数据+策略+标准步骤"三件套，
# 与 MCP 发现层裸 tools 区分，语义更清晰
class SkillCapsule(BaseModel):
    id: str
    name: str
    pattern: str # pipeline | inversion | reviewer | generator | tool_wrapper
    trigger_condition: str
    policy: Dict[str, Any] # 降级策略、优先策略等
    standard_steps: List[str]

class MCPDiscoveryBundle(BaseModel):
    tools: List[Dict[str, str]]
    resources: List[Dict[str, str]]
    prompts: List[Dict[str, str]]

# Why 用 TypedDict 而非 BaseModel：LangGraph StateGraph 节点入参按 dict 下标访问
# (state["user_instruction"])，BaseModel 走属性访问会触发 AttributeError
class TravelWorkflowState(TypedDict, total=False):
    user_instruction: str
    task_dag: List[str]                       # Step 1: 规划器生成的任务图
    mcp_bundle: Optional[MCPDiscoveryBundle]  # Step 2: 发现层拉取的工具/资源
    active_skill: Optional[SkillCapsule]      # Step 3: 绑定的 Skill
    execution_result: Dict[str, Any]          # Step 3: 执行产出
    approval_status: str                      # Step 4: 审批与状态
    is_completed: bool                        # 闭环标志

llm = ChatOpenAI(
    model = "deepseek-chat",
    api_key = "sk-6d31f71ec3514f6785e28fa00ea03199",
    base_url = "https://api.deepseek.com"
)

# 模拟预置的 SKILL.md (包含经济舱优先与降级改签高铁策略)
TRAVEL_SKILL = SkillCapsule(
    id = "travel_management_skill",
    name="✈️ 差旅管理与报销 Skill",
    pattern="pipeline",
    trigger_condition="当用户提出差旅预定、机票酒店或出差报销，机票查询、高铁改签等相关问题时",
    policy={
        "cabin_priority": "economy", # 经济舱优先
        "fallback_strategy": "high_speed_rail", # 遇无票降级改签高铁
        "max_price_limit": 1000
    },
    standard_steps=[
        "1. 查询机票余票 (遵循经济舱优先原则)",
        "2. 若无票或超支，触发降级策略：改签高铁",
        "3. 提交差旅审批与报销单"
    ]
)

# ==========================================
# 2. Step 1: Agent 规划器节点 (Agent Planner)
# ==========================================
def step1_agent_planner(state: TravelWorkflowState):
    print("\n[Step 1: Agent 规划器] 🧠 正在理解用户指令并生成任务图 (DAG)...")
    instruction = state["user_instruction"]

    prompt = f"""你是一个差旅规划主管。请你将用户指令拆解为 Task 清单。
    指令: {instruction}
    请输出 JSON 列表格式：["步骤1", "步骤2", "步骤3"]
    """
    res = llm.invoke([HumanMessage(content=prompt)])
    try:
        tasks = json.loads(re.sub(r"```json|```", "", res.content).strip())
    except Exception:
        tasks = ["1. 查询航班行程", "2. 预定车机票", "3. 填写报销流程"]

    print(f"  └─ 成功生成任务图: {tasks}")
    return {"task_dag": tasks}

# ==========================================
# 3. Step 2: MCP 发现层节点 (MCP Discovery)
# ==========================================
def step2_mcp_discovery(state: TravelWorkflowState):
    print("\n[Step 2: MCP 发现层] 🔌 正在动态拉取可用的 MCP Tools / Resources / Prompts...")
    
    # 模拟从 MCP Server 发现的底层工具、文档和模板
    discovered_bundle = MCPDiscoveryBundle(
        tools = [
            {"name": "flight_booking_api", "description": "航班查询与预定接口"},
            {"name": "train_booking_api", "description": "高铁/动车查询与预定接口"},
            {"name": "hotel_booking_api", "description": "酒店查询与预定预订接口"}
        ],
        resources = [
            {"uri": "company://travel_policy.md", "title": "公司 2026 差旅管理规章制度"}
        ],
        prompts = [
            {"name": "reimbursement_template", "description": "标准财务报销单模版"}
        ]
    )

    print(f"  └─ 动态加载了 {len(discovered_bundle.tools)} 个工具与 {len(discovered_bundle.resources)} 篇差旅规章")
    return {"mcp_bundle": discovered_bundle}

# ==========================================
# 4. Step 3: Skill 引擎与执行节点 (Skill Engine)
# ==========================================
def step3_skill_exection_node(state: TravelWorkflowState):
    print("\n[Step 3: Skill 引擎与执行] ⚙️  正在加载【差旅管理 Skill】，绑定策略与触发降级判断...")

    # 绑定 Skill
    skill = TRAVEL_SKILL
    policy = skill.policy

    print(f"  └─ 成功绑定 Skill: {skill.name}")
    print(f"  ├─ 绑定策略：舱位偏好 = {policy['cabin_priority']} | 降级策略 = {policy['fallback_strategy']}")

    # 模拟机票预定情况（假定机票售罄，测试降级改签逻辑）
    flight_available = False #模拟无票情况

    if not flight_available:
        print("  ⚠️ [策略触发] 监测到下周三去上海机票无票/超支！")
        print(f"  🔄 [执行降级] 触发 Skill 降级策略 ➔ 自动切为【{policy['fallback_strategy']}】预订通道！")

        exec_result = {
            "booked_item": "下周三 G7001 高铁二等座（上海虹桥）",
            "status": "booked_fallback",
            "cost": 553,
            "policy_applied": "无票自动改签高铁策略"
        }
    else:
        exec_result = {
            "booked_item": "下周三 MU5188 经济舱",
            "status": "booked_primary",
            "cost": 890
        }
    return {
        "active_skill": skill,
        "execution_result": exec_result,
        "approval_status": "pending_approval"
    }

# ==========================================
# 5. Step 4: MCP 上下文池与闭环反馈 (MCP Context Pool)
# ==========================================
def step4_mcp_context_pool(state: TravelWorkflowState):
    print("\n[Step 4: MCP 上下文池] 💾 正在将执行结果与审批状态持久化，进行闭环反馈...")

    exec_res= state["execution_result"]

    # 模拟吧降级改签的结果反馈隔日 Agent 规划器
    feedback_str = f"已成功通过 [{exec_res['policy_applied']}] 预定了 【{exec_res['booked_item']}】, 费用为 {exec_res['cost']} 元, 报销单已自动创建。"

    print(f"  └─ 持久化完成！状态反馈回传给 Planner: {feedback_str}")

    return {
        "is_completed": True,
        "execution_result": {**exec_res, "final_summary": feedback_str}
    }

# ==========================================
# 6. 构建四步闭环 LangGraph
# ==========================================
workflow = StateGraph(TravelWorkflowState)
workflow.add_node("step1_planner", step1_agent_planner)
workflow.add_node("step2_mcp_discovery", step2_mcp_discovery)
workflow.add_node("step3_skill_exection", step3_skill_exection_node)
workflow.add_node("step4_mcp_context_pool", step4_mcp_context_pool)

#四步顺次执行
workflow.add_edge(START, "step1_planner")
workflow.add_edge("step1_planner", "step2_mcp_discovery")
workflow.add_edge("step2_mcp_discovery", "step3_skill_exection")
workflow.add_edge("step3_skill_exection", "step4_mcp_context_pool")

# 闭环反馈：若未完成可反馈回 Step1
workflow.add_conditional_edges(
    "step4_mcp_context_pool",
    lambda s: END if s.get("is_completed") else "step1_planner"
)

app_travel_flow = workflow.compile()

# ==========================================
# 测试运行
# ==========================================
if __name__ == "__main__":
    user_query = "订下周三去上海的机票并走报销"
    print(f"👤 用户指令: {user_query}")
    
    final_state = app_travel_flow.invoke({
        "user_instruction": user_query,
        "task_dag": [],
        "mcp_bundle": None,
        "active_skill": None,
        "execution_result": {},
        "approval_status": "none",
        "is_completed": False
    })
    
    print("\n" + "="*60)
    print("🏆 【闭环执行完成】最终汇报:")
    print("="*60)
    print(final_state["execution_result"]["final_summary"])
