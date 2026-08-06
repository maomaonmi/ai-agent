"""
Day 37: 动态用户自定义 Agent 接入与自主规划系统 (Dynamic Custom-Agent Plan-and-Execute)
启动方式: uvicorn day37_dynamic_custom_agents:app --reload --port 8000
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

from tavily import TavilyClient

# ==========================================
# 1. API 配置
# ==========================================
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")
TAVILY_KEY = os.getenv("TAVILY_API_KEY", "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")

llm_chat = ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")
tavily_client = TavilyClient(api_key=TAVILY_KEY)


# ==========================================
# 2. 数据模型契约 (支持动态 Agent 描述)
# ==========================================
class CustomAgentConfig(BaseModel):
    id: str = Field(description="Agent 唯一标识, 如 'security_auditor'")
    name: str = Field(description="Agent 展示名称, 如 '🛡️ 网页安全与加密专家'")
    description: str = Field(description="功能描述，供 Planner 识别何时指派任务")
    system_prompt: str = Field(description="该自定义 Agent 的核心人设与指令")

class Task(BaseModel):
    id: int
    description: str
    assigned_agent_id: str = Field(description="指派的目标 Agent ID")
    agent_display_name: str = Field(description="专家展示名称及图标")
    status: Literal["pending", "in_progress", "completed", "failed"] = "pending"
    result: Optional[str] = None

class ChatRequest(BaseModel):
    message: str
    # 【核心】：用户可以在请求中动态传入他们自己定义的 Agent 数组！
    custom_agents: Optional[List[CustomAgentConfig]] = None

class PlanExecuteState(TypedDict):
    input_goal: str
    plan: List[Task]
    completed_steps: List[Task]
    # 【核心】：存放系统内置 + 用户动态传入的所有可用 Agent
    available_agents: Dict[str, CustomAgentConfig]
    current_task: Optional[Task]
    final_response: str


# ==========================================
# 3. 系统默认预置的专家库
# ==========================================
SYSTEM_BUILTIN_AGENTS: Dict[str, CustomAgentConfig] = {
    "web_search_agent": CustomAgentConfig(
        id="web_search_agent",
        name="🌐 联网搜索专家",
        description="擅长在全网搜集最新的实时资讯、客观事实、市场报价与权威报告",
        system_prompt="你是一位资深全网情报搜集专家。"
    ),
    "deep_thinker_agent": CustomAgentConfig(
        id="deep_thinker_agent",
        name="🧠 R1 深度思考专家",
        description="擅长处理复杂物理/数学推理、多维度风险对比、权衡利弊与深层因果分析",
        system_prompt="你是一位诺贝尔奖级别的理论推演与风险评估专家。"
    ),
    "data_analyst_agent": CustomAgentConfig(
        id="data_analyst_agent",
        name="📊 数据分析专家",
        description="擅长提炼核心指标、整理 Markdown 标准对比表格、算账与整理数据总结",
        system_prompt="你是一位顶级数据分析师，极其擅长输出规范的 Markdown 表格与指标分析。"
    )
}


# ==========================================
# 4. 节点逻辑 (Planner ➔ Executor ➔ RePlanner)
# ==========================================

def planner_node(state: PlanExecuteState):
    """
    Planner (主管)：扫描当前注册表里所有的 Agent (内置 + 自定义)，动态指派 Task
    """
    print("\n[Node: Planner] 📝 扫描动态专家库，拆解任务并指派...")
    goal = state["input_goal"]
    agents = state["available_agents"]

    # 动态组装给 Planner 看的专家菜单
    agent_menu_lines = []
    for agent_id, config in agents.items():
        agent_menu_lines.append(f"- ID: '{config.id}' | 名称: '{config.name}' | 擅长领域: {config.description}")
    agent_menu_str = "\n".join(agent_menu_lines)

    prompt = f"""你是一个首席项目调度主管。
请将用户的巨型目标拆解为 3-4 个按顺序执行的子任务。

【目前可用专家团队名册 (包含系统专家与用户自定义专家)】：
{agent_menu_str}

目标：{goal}

请根据任务性质，为每个 Task 从上述名册中挑选最契合的 'assigned_agent_id'。
必须输出合法 JSON 格式：
{{
  "steps": [
    {{
      "id": 1,
      "description": "具体任务1描述",
      "assigned_agent_id": "选定的 Agent ID",
      "agent_display_name": "选定的 Agent 名称与图标"
    }},
    ...
  ]
}}
"""
    res = llm_chat.invoke([SystemMessage(content=prompt)])
    clean_json = re.sub(r'```json|```', '', res.content).strip()
    plan_dict = json.loads(clean_json)
    
    tasks = [Task(**t) for t in plan_dict["steps"]]
    print(f"  └─ 成功生成 {len(tasks)} 项子任务，指派情况:")
    for t in tasks:
        print(f"     Task {t.id}: {t.description[:20]}... ➔ 指派给: {t.agent_display_name} ({t.assigned_agent_id})")
        
    return {"plan": tasks, "completed_steps": []}


def executor_node(state: PlanExecuteState):
    """
    Executor：根据 assigned_agent_id 动态分发执行逻辑
    """
    plan = state["plan"]
    pending_task = next((t for t in plan if t.status == "pending"), None)
    if not pending_task:
        return {}

    print(f"\n[Node: Executor] ⚡ 执行 Task {pending_task.id} ➔ 调用 【{pending_task.agent_display_name}】")
    pending_task.status = "in_progress"

    # 上下文累积
    context = "\n\n".join([
        f"--- 步骤 {t.id} [{t.agent_display_name}] 成果 ---\n{t.result}"
        for t in state["completed_steps"]
    ])

    agent_id = pending_task.assigned_agent_id
    agents_registry = state["available_agents"]

    # 1. 如果是内置的特化微服务工具
    if agent_id == "web_search_agent":
        try:
            search_res = tavily_client.search(query=pending_task.description, search_depth="basic", max_results=3)
            snippets = [f"- [{r.get('title')}]({r.get('url')}): {r.get('content')[:150]}" for r in search_res.get("results", [])]
            task_result = "网络检索情报：\n" + "\n".join(snippets)
        except Exception as e:
            task_result = f"检索遇到异常: {e}"

    elif agent_id == "deep_thinker_agent":
        client = OpenAI(api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")
        resp = client.chat.completions.create(
            model="deepseek-reasoner",
            messages=[{"role": "user", "content": f"任务: {pending_task.description}\n背景: {context}"}]
        )
        reasoning = resp.choices[0].message.reasoning_content or ""
        content = resp.choices[0].message.content or ""
        task_result = f"【R1 思考摘要】:\n{reasoning[:200]}...\n\n【推理结论】:\n{content}"

    # 2. 如果是用户自定义 Agent（或数据分析专家），使用其专属 system_prompt 动态运行！
    else:
        agent_config = agents_registry.get(agent_id, SYSTEM_BUILTIN_AGENTS["data_analyst_agent"])
        print(f"  └─ 动态加载自定义 System Prompt: '{agent_config.system_prompt[:30]}...'")
        
        # 融入你优化的四段式标准化输出要求
        custom_prompt = f"""{agent_config.system_prompt}

【任务内容】：{pending_task.description}
【前置上下文背景】：
{context}

【输出格式规范】：请输出包含：结论摘要、对比分析表格（如有）、详细分析、风险与限制表格的 Markdown 结构。"""

        res = llm_chat.invoke([SystemMessage(content=custom_prompt)])
        task_result = res.content

    pending_task.status = "completed"
    pending_task.result = task_result

    return {
        "current_task": pending_task,
        "completed_steps": state["completed_steps"] + [pending_task]
    }


def replanner_node(state: PlanExecuteState):
    """
    RePlanner：生成带有跨智能体执行总览表与标准 Markdown 格式的最终总结
    """
    completed_ids = {t.id for t in state["completed_steps"]}
    all_ids = {t.id for t in state["plan"]}

    if completed_ids >= all_ids:
        print("\n[Node: RePlanner] 🎉 所有子任务（包含自定义 Agent 任务）均已完成！生成终极报告...")
        
        # 组装跨智能体执行总览数据
        exec_summary_rows = "\n".join([
            f"| Task {t.id} | {t.description[:25]}... | {t.agent_display_name} | ✅ 已完成 |"
            for t in state["completed_steps"]
        ])
        
        results_str = "\n\n".join([
            f"### 步骤 {t.id} [{t.agent_display_name}]: {t.description}\n{t.result}"
            for t in state["completed_steps"]
        ])

        summary_prompt = f"""你是一个首席报告整合官。请根据以下各专家智能体的分工产出，整合一份结构严谨的最终报告。

目标：{state['input_goal']}

【跨智能体执行总览表】：
| 任务编号 | 任务简述 | 负责智能体 | 状态 |
|---|---|---|---|
{exec_summary_rows}

【各专家产出明细】：
{results_str}

【报告输出规范】：
1. 结论摘要
2. 跨智能体执行总览表
3. 详细分析（整合各步骤核心结论）
4. 风险与限制表格
5. 必须保留 Markdown 表格与 LaTeX 物理/数学公式结构（如适用）。
"""
        summary = llm_chat.invoke([SystemMessage(content=summary_prompt)])
        return {"final_response": summary.content}

    return {}


# ==========================================
# 5. 构建 LangGraph 图
# ==========================================
def should_continue_plan(state: PlanExecuteState) -> Literal["executor", "replan_check"]:
    completed_ids = {t.id for t in state.get("completed_steps", [])}
    all_ids = {t.id for t in state.get("plan", [])}
    if completed_ids >= all_ids and len(all_ids) > 0:
        return "replan_check"
    return "executor"

workflow = StateGraph(PlanExecuteState)

workflow.add_node("planner", planner_node)
workflow.add_node("executor", executor_node)
workflow.add_node("replan_check", replanner_node)

workflow.add_edge(START, "planner")
workflow.add_edge("planner", "executor")
workflow.add_conditional_edges("executor", should_continue_plan, {"executor": "executor", "replan_check": "replan_check"})
workflow.add_edge("replan_check", END)

app_graph = workflow.compile()


# ==========================================
# 6. SSE 流式传输
# ==========================================
async def generate_plan_events(goal_message: str, custom_agents: List[CustomAgentConfig]):
    def sse_format(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    try:
        # 【核心】：将内置专家与用户前端传入的自定义专家合并
        agents_registry = dict(SYSTEM_BUILTIN_AGENTS)
        if custom_agents:
            for ca in custom_agents:
                agents_registry[ca.id] = ca

        yield sse_format("status", {"message": f"动态挂载了 {len(agents_registry)} 位专家智能体，正在规划执行路径..."})

        inputs = {
            "input_goal": goal_message,
            "plan": [],
            "completed_steps": [],
            "available_agents": agents_registry,
            "current_task": None,
            "final_response": ""
        }

        for event in app_graph.stream(inputs):
            for node_name, output in event.items():
                if output is None: continue

                if "plan" in output and output["plan"]:
                    plan_data = [t.dict() for t in output["plan"]]
                    yield sse_format("plan_created", {"tasks": plan_data})

                if "completed_steps" in output and output["completed_steps"]:
                    last_task = output["completed_steps"][-1]
                    yield sse_format("task_updated", {"task": last_task.dict()})

                if "final_response" in output and output["final_response"]:
                    yield sse_format("final_report", {"report": output["final_response"]})

        yield sse_format("done", {"status": "success"})

    except Exception as e:
        yield sse_format("error", {"message": str(e)})


# ==========================================
# 7. FastAPI 应用入口
# ==========================================
app = FastAPI(title="Dynamic Custom Agent Plan-and-Execute API", version="1.0.0")

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
        generate_plan_events(request.message, request.custom_agents or []),
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
    print("🚀 启动 Day 37 动态自定义 Agent 规划平台 API")
    print("地址: http://127.0.0.1:8000/chat_plan")
    print("="*60)
    uvicorn.run("day37_dynamic_custom_agents:app", host="0.0.0.0", port=8000, reload=True)
