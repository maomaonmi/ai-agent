"""
Day 36: 多智能体自主任务指派与规划系统 (Multi-Agent Plan-and-Execute)
启动方式: uvicorn day36_multi_agent_planning:app --reload --port 8000
"""
import json
import os
import re
import time
from typing import Annotated, TypedDict, List, Dict, Optional, Literal
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from openai import OpenAI
from langgraph.graph import StateGraph, START, END

# 引入我们第 32 天写的 Tavily 搜索精炼工具
from tavily import TavilyClient

# ==========================================
# 1. API 配置
# ==========================================
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")
TAVILY_KEY = os.getenv("TAVILY_API_KEY", "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")

llm_chat = ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")
tavily_client = TavilyClient(api_key=TAVILY_KEY)

# ==========================================
# 2. 核心数据模型 (Data Schema)
# ==========================================
Agent = Literal["web_search_agent","deep_think_agent","data_analyst_agent"]

class Task(BaseModel):
    id: int = Field(description="任务编号，如1，2，3")
    description: str =Field(description="任务具体执行内容")
    assigned_agent: Agent = Field(description="指派处理该任务的专家智能体")
    agent_display_name: str = Field(description="智能体展示名称，如 '🔍 联网搜索智能体'")
    status: Literal["pending", "in_progress", "completed", "failed"] = "pending"
    result: Optional[str] = None

class Plan(BaseModel):
    steps: List[Task]

class ChatRequest(BaseModel):
    message: str

class PlanExecutes(BaseModel):
    input_goal: str
    plan: List[Task]
    completed_steps: List[Task]
    current_step: Optional[Task]
    final_response: str

# ==========================================
# 3. 专家智能体能力库 (Sub-Agent Capabilities)
# ==========================================
def run_web_search_agent(task_desc: str) -> str:
    """专职 Agent 1: 🔍 联网搜索专家 (调用 Tavily)"""
    print(f"  └─ [Sub-Agent: 🔍 联网搜索专家] 正在全网检索: {task_desc}")
    try:
        res = tavily_client.search(task_desc, search_depth="basic", max_results=3)
        snippets = [f"- [{r.get('title','')} ({r.get('url','')}): {r.get('content','')[:150]}]" for r in res.get('results',[])]
        return "网络检索情报如下：\n" + "\n".join(snippets)
    except Exception as e:
        return f"网络检索遭遇异常，使用储备推演: {e}"

def run_deep_think_agent(task_desc: str) -> str:
    """专职 Agent 2: 🧠 R1 深度思考专家 (调用 DeepSeek-Reasoner)"""
    print(f"  └─ [Sub-Agent: 🧠 R1 深度思考专家] 正在开启长思维链分析: {task_desc}")
    client = OpenAI(api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")
    prompt = f"任务：{task_desc}\n已知前置情报背景：\n{context}\n请进行深度逻辑推演并给出专业结论。"

    resp = client.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user","content": prompt}]
    )
    reasoning = resp.choices[0].message.content or ""
    content = resp.choices[0].message.content or ""
    return f"【R1 深度思考过程 ({len(reasoning)}字)】：\n{reasoning[:200]}...\n\n【分析结论】:\n{content}"

def run_data_analyst_agent(task_desc: str) -> str:
    """专职 Agent 3: 📊 数据分析专家 (格式化与计算)"""
    print(f"  └─ [Sub-Agent: 📊 数据分析专家] 正在提炼数据与指标: {task_desc}")
    """专职 Agent 3: 📊 数据分析专家 (格式化与计算)"""
    print(f"  └─ [Sub-Agent: 📊 数据分析专家] 正在提炼数据与指标: {task_desc}")
    res = llm_chat.invoke([SystemMessage(content=prompt)])
    return res.content

# ==========================================
# 4. LangGraph 节点定义 (Planner ➔ Executor ➔ RePlanner)
# ==========================================
def planner_node(state: PlanExecuteState):
    """
    Planner (主管)：把大目标拆解成 3 个子任务，并为每个 Task 指派专属 Agent
    """
    print("\n[Node: Planner] 📝 正在拆解任务，并进行多智能体角色指派...")
    goal = state["input_goal"]

    prompt = f"""你是一个首席项目调度主管。
    请将用户的巨型目标拆解为 3 个按顺序执行的子任务，并从以下三位专家中选择最适合的人选：
    1. 'web_search_agent' (🔍 联网搜索专家: 适合搜集最新网络资讯、数据、行业报告)
    2. 'deep_thinker_agent' (🧠 R1 深度思考专家: 适合复杂因果分析、策略权衡、逻辑对比)
    3. 'data_analyst_agent' (📊 数据分析专家: 适合整理表格、算账、提取指标)

    目标：{goal}

    必须输出合法 JSON：
    {{
    "steps": [
        {{
        "id": 1,
        "description": "具体任务1描述",
        "assigned_agent": "web_search_agent",
        "agent_display_name": "🔍 联网搜索专家"
        }},
        {{
        "id": 2,
        "description": "具体任务2描述",
        "assigned_agent": "deep_thinker_agent",
        "agent_display_name": "🧠 R1 深度思考专家"
        }},
        {{
        "id": 3,
        "description": "具体任务3描述",
        "assigned_agent": "data_analyst_agent",
        "agent_display_name": "📊 数据分析专家"
        }}
    ]
    }}
    """

    res = llm_chat.invoke([SystemMessage(content=prompt)])
    clean_json = re.sub(r'```json|```', '', res.content).strip()
    plan_dict = json.loads(clean_json)

    tasks = [Task(**t) for t in plan_dict["steps"]]
    print(f"  └─ 成功生成 3 项子任务，已分别指派给对应的专家 Agent！")
    return {"plan": tasks, "completed_steps": []}


def executor_node(state: PlanExecuteState):
    """
    Executor (调度执行)：挑选第一个 pending 状态的 Task，转发给对应的 Sub-Agent 处理
    """
    plan = state["plan"]
    # 找到第一个等待执行的任务
    pending_task = next((t for t in plan if t.status == "pending"), None)
    if not pending_task:
        return {}

    print(f"\n[Node: Executor] ⚡ 正在调度 Task {pending_task.id} ➔ 指派给 【{pending_task.agent_display_name}】")
    pending_task.status = "in_progress"

    # 构建此前所有已完成 Task 的上下文累积
    context = "\n\n".join([
        f"--- 步骤 {t.id} [{t.agent_display_name}] 产出 ---\n{t.result}"
        for t in state["completed_steps"]
    ])

    # 路由分发给对应的专家 Agent
    agent_type = pending_task.assigned_agent
    if agent_type == "web_search_agent":
        task_result = run_web_search_agent(pending_task.description)
    elif agent_type == "deep_thinker_agent":
        task_result = run_deep_thinker_agent(pending_task.description, context)
    elif agent_type == "data_analyst_agent":
        task_result = run_data_analyst_agent(pending_task.description, context)
    else:
        task_result = run_web_search_agent(pending_task.description)

    pending_task.status = "completed"
    pending_task.result = task_result

    return {
        "current_task": pending_task,
        "completed_steps": state["completed_steps"] + [pending_task]
    }


def replanner_node(state: PlanExecuteState):
    """
    RePlanner：判断是否全部完成
    """
    completed_ids = {t.id for t in state["completed_steps"]}
    all_ids = {t.id for t in state["plan"]}

    if completed_ids >= all_ids:
        print("\n[Node: RePlanner] 🎉 所有多智能体子任务均已完成，正在生成终极汇总...")
        results_str = "\n\n".join([
            f"### 任务 {t.id} [{t.agent_display_name}]: {t.description}\n{t.result}"
            for t in state["completed_steps"]
        ])
        summary = llm_chat.invoke(f"目标：{state['input_goal']}\n各专家智能体分工产出如下：\n{results_str}\n\n请写一份结构完整的最终总结报告。")
        return {"final_response": summary.content}

    return {}

# ==========================================
# 5. 构建 LangGraph 图
# ==========================================
def should_continue_plan(state: PlanExecuteState) -> Literal["executor", "replan_check"]:
    completed_ids = {t.id for t in state["completed_steps"]}
    all_ids = {t.id for t in state["plan"]}

    if completed_ids >= all_ids:
        return "replan_check"
    return "executor"

workflow = StateGraph(PlanExecuteState)
workflow.add_node("planner", planner_node)
workflow.add_node("executor", executor_node)
workflow.add_node("replan_check", replanner_node)

workflow.add_edge(START,"planner")
workflow.add_edge("planner", "executor")

workflow.add_conditional_edge(
    "executor",
    should_continue_plan,
    {
        "executor": "executor",
        "replan_check": "planner"
    })

workflow.add_edge("replan_check", END)
app_graph = workflow.compile()

# ==========================================
# 6. SSE 流式传输 (多智能体指派与待办树推送)
# ==========================================
async def generate_plan_events(goal_message: str):
    def sse_format(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    try:
        inputs = {
            "input_goal": goal_message,
            "plan": [],
            "completed_steps": [],
            "current_task": None,
            "final_response": ""
        }

        yield sse_format("status", {"message": "正在分配多智能体专家团队并规划任务..."})

        for event in app_graph.stream(inputs):
            for node_name, output in event.items():
                if output is None: continue

                # 当 Planner 生成 Task List 时，推给前端渲染“带专家标签的待办树”
                if "plan" in output and output["plan"]:
                    plan_data = [t.dict() for t in output["plan"]]
                    yield sse_format("plan_created", {"tasks": plan_data})

                # 当某个 Task 执行完成时，推给前端更新该 Task 状态及产出
                if "completed_steps" in output and output["completed_steps"]:
                    last_task = output["completed_steps"][-1]
                    yield sse_format("task_updated", {
                        "task": last_task.dict()
                    })

                # 最终报告
                if "final_response" in output and output["final_response"]:
                    yield sse_format("final_report", {"report": output["final_response"]})

        yield sse_format("done", {"status": "success"})

    except Exception as e:
        yield sse_format("error", {"message": str(e)})


# ==========================================
# 7. FastAPI App
# ==========================================
app = FastAPI(title="Multi-Agent Plan-and-Execute API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/chat_plan")
async def chat_plan_endpoint(request: ChatRequest):
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="目标描述不能为空")

    return StreamingResponse(
        generate_plan_events(request.message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

if __name__ == "__main__":
    import uvicorn
    print("="*60)
    print("🚀 启动 Day 36 多智能体规划与分发 API")
    print("API 地址: http://127.0.0.1:8000/chat_plan")
    print("="*60)
    uvicorn.run("day36_multi_agent_planning:app", host="0.0.0.0", port=8000, reload=True)


