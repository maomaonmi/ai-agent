"""
Day 37: 自定义智能体工厂后端引擎 (Agent Factory Engine)
包含: 智能体 CRUD 存储库 + ✨ 智能生成 Meta-API + Planner 动态调用接入

启动方式: uvicorn day37_agent_factory_engine:app --reload --port 8000
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
from langgraph.graph import StateGraph, START, END

# ==========================================
# 1. API 与 LLM 初始化
# ==========================================
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")
llm = ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")

AGENTS_FILE = "custom_agents_store.json"

# ==========================================
# 2. 数据模型 (Schema)
# ==========================================
class AgentConfig(BaseModel):
    id: str = Field(description="英文唯一标识名, 如 'code-auditor'")
    name: str = Field(description="智能体名称，带 Emoji, 如 '🛡️ 代码审计专家'")
    system_prompt: str = Field(description="角色提示词人设")
    is_callable: bool = Field(default=True, description="可被其他智能体调用")
    when_to_use: str = Field(description="何时调用：描述合适调用的场景与时机，供 Planner 匹配")
    tools: List[str] = Field(default_factory=list, description="勾选启用的工具: read, edit, terminal, web_search")
    created_at: float = Field(default_factory=time.time)

class GenerateAgentRequest(BaseModel):
    user_idea: str = Field(description="用户的一句话粗略想法，如 '帮我做一个写 Python 单元测试的智能体'")

class ChatPlanRequest(BaseModel):
    message: str

# ==========================================
# 3. 持久化存储库 (AgentStore)
# ==========================================
class AgentStore:
    @staticmethod
    def load_agents() -> Dict[str, AgentConfig]:
        if not os.path.exists(AGENTS_FILE):
            return {}
        try:
            with open(AGENTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return {k: AgentConfig(**v) for k, v in data.items()}
        except Exception:
            return {}

    @staticmethod
    def save_agent(agent: AgentConfig):
        agents = AgentStore.load_agents()
        agents[agent.id] = agent
        with open(AGENTS_FILE, "w", encoding="utf-8") as f:
            json.dump({k: v.dict() for k, v in agents.items()}, f, ensure_ascii=False, indent=2)

    @staticmethod
    def delete_agent(agent_id: str):
        agents = AgentStore.load_agents()
        if agent_id in agents:
            del agents[agent_id]
            with open(AGENTS_FILE, "w", encoding="utf-8") as f:
                json.dump({k: v.dict() for k, v in agents.items()}, f, ensure_ascii=False, indent=2)


# ==========================================
# 4. ✨ 智能生成元引擎 (Meta-Generator)
# ==========================================
def generate_agent_config(user_idea: str) -> AgentConfig:
    """调用大模型元提示词，将用户一句话想法转化为完整的 Agent JSON"""
    print(f"\n[Meta-Generator] ✨ 正在根据用户的粗略想法，智能生成 Agent 全套配置...")
    
    meta_prompt = f"""你是一位顶级 AI 智能体架构师。
请根据用户的粗略想法，生成一个结构完整的自定义 Agent 配置。

用户想法：{user_idea}

必须输出合法 JSON，包含以下字段：
{{
  "id": "规范的英文小写连字符标识，如 'pytest-expert'",
  "name": "带合适 Emoji 的中文名称，如 '🐍 Python 测试专家'",
  "system_prompt": "详细、专业、带约束的系统提示词，字数 100-300 字",
  "is_callable": true,
  "when_to_use": "详细描述其他调度 Agent 应该在什么场景、什么时机把任务分发给它，字数 30-80 字",
  "tools": ["read", "edit", "terminal", "web_search"]  // 从中挑选 1-3 个最适合的工具名称
}}
"""
    res = llm.invoke([SystemMessage(content=meta_prompt)])
    clean_json = re.sub(r'```json|```', '', res.content).strip()
    data = json.loads(clean_json)
    return AgentConfig(**data)


# ==========================================
# 5. Planner 动态集成本地智能体库
# ==========================================
class Task(BaseModel):
    id: int
    description: str
    assigned_agent_id: str
    agent_display_name: str
    status: Literal["pending", "completed"] = "pending"
    result: Optional[str] = None

class PlanExecuteState(TypedDict):
    input_goal: str
    plan: List[Task]
    completed_steps: List[Task]
    final_response: str

def planner_node(state: PlanExecuteState):
    print("\n[Node: Planner] 📝 正在载入本地存储的智能体库，动态规划分发...")
    
    # 从本地 json 存储中载入所有可被调用的 Agent
    custom_agents = AgentStore.load_agents()
    
    # 拼接菜单
    agent_menu = []
    # 默认内置组
    agent_menu.append("- ID: 'web_search_agent' | 名称: '🌐 联网搜索专家' | 时机: 需要在全网搜集最新资讯或资料时")
    agent_menu.append("- ID: 'deep_thinker_agent' | 名称: '🧠 R1 深度思考专家' | 时机: 需要复杂推理或逻辑对比时")
    
    # 用户通过工厂创建的自定义组
    for a in custom_agents.values():
        if a.is_callable:
            agent_menu.append(f"- ID: '{a.id}' | 名称: '{a.name}' | 时机: {a.when_to_use}")

    prompt = f"""你是一个首席项目调度主管。请将用户的目标拆解为 2-3 个按顺序执行的子任务。

【目前可调用的所有专家团队名册（包含系统内置与用户自定义智能体）】：
{chr(10).join(agent_menu)}

目标：{state['input_goal']}

请根据任务性质，为每个 Task 指派最合适的 Agent ID。
必须输出 JSON 格式：
{{
  "steps": [
    {{
      "id": 1,
      "description": "任务描述",
      "assigned_agent_id": "选定的 Agent ID",
      "agent_display_name": "选定的 Agent 名称与图标"
    }}
  ]
}}
"""
    res = llm.invoke([SystemMessage(content=prompt)])
    clean_json = re.sub(r'```json|```', '', res.content).strip()
    plan_dict = json.loads(clean_json)
    
    tasks = [Task(**t) for t in plan_dict["steps"]]
    return {"plan": tasks, "completed_steps": []}

def executor_node(state: PlanExecuteState):
    plan = state["plan"]
    pending_task = next((t for t in plan if t.status == "pending"), None)
    if not pending_task: return {}

    print(f"\n[Node: Executor] ⚡ 执行 Task {pending_task.id} ➔ 调用 【{pending_task.agent_display_name}】")
    pending_task.status = "in_progress"

    # 获取自定义 Agent 的配置
    custom_agents = AgentStore.load_agents()
    agent_id = pending_task.assigned_agent_id

    if agent_id in custom_agents:
        agent_cfg = custom_agents[agent_id]
        print(f"  └─ 加载自定义 Prompt: {agent_cfg.system_prompt[:30]}... | 工具策略: {agent_cfg.tools}")
        prompt = f"{agent_cfg.system_prompt}\n\n请执行任务：{pending_task.description}"
        res = llm.invoke([SystemMessage(content=prompt)])
        task_result = res.content
    else:
        # 系统默认处理
        res = llm.invoke([HumanMessage(content=f"请执行任务: {pending_task.description}")])
        task_result = res.content

    pending_task.status = "completed"
    pending_task.result = task_result
    return {"completed_steps": state["completed_steps"] + [pending_task]}

def replanner_node(state: PlanExecuteState):
    if len(state["completed_steps"]) >= len(state["plan"]):
        summary = llm.invoke(f"目标：{state['input_goal']}\n成果如下：\n{state['completed_steps']}\n请总结。")
        return {"final_response": summary.content}
    return {}

workflow = StateGraph(PlanExecuteState)
workflow.add_node("planner", planner_node)
workflow.add_node("executor", executor_node)
workflow.add_node("replan_check", replanner_node)

workflow.add_edge(START, "planner")
workflow.add_edge("planner", "executor")
workflow.add_conditional_edges("executor", lambda s: "replan_check" if len(s["completed_steps"]) >= len(s["plan"]) else "executor")
workflow.add_edge("replan_check", END)
app_graph = workflow.compile()


# ==========================================
# 6. FastAPI Web 接口层
# ==========================================
app = FastAPI(title="Agent Factory Engine API", version="1.0.0")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

# --- 接口 1: 获取当前所有自定义 Agent 列表 ---
@app.get("/api/agents")
async def get_agents():
    return list(AgentStore.load_agents().values())

# --- 接口 2: 手动保存一个新的 Agent ---
@app.post("/api/agents")
async def save_agent(agent: AgentConfig):
    AgentStore.save_agent(agent)
    return {"status": "success", "agent": agent}

# --- 接口 3: 删除指定 Agent ---
@app.delete("/api/agents/{agent_id}")
async def delete_agent(agent_id: str):
    AgentStore.delete_agent(agent_id)
    return {"status": "success", "deleted": agent_id}

# --- 接口 4: ✨ 智能生成 Agent 配置 ---
@app.post("/api/agents/generate")
async def generate_agent(req: GenerateAgentRequest):
    if not req.user_idea.strip():
        raise HTTPException(status_code=400, detail="想法不能为空")
    try:
        config = generate_agent_config(req.user_idea)
        return config
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- 接口 5: 规划对话端点 ---
@app.post("/chat_plan")
async def chat_plan_endpoint(request: ChatPlanRequest):
    def sse_format(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    async def generate_events():
        inputs = {"input_goal": request.message, "plan": [], "completed_steps": [], "final_response": ""}
        for event in app_graph.stream(inputs):
            for node_name, output in event.items():
                if "plan" in output:
                    yield sse_format("plan_created", {"tasks": [t.dict() for t in output["plan"]]})
                if "completed_steps" in output and output["completed_steps"]:
                    yield sse_format("task_updated", {"task": output["completed_steps"][-1].dict()})
                if "final_response" in output and output["final_response"]:
                    yield sse_format("final_report", {"report": output["final_response"]})
        yield sse_format("done", {"status": "success"})

    return StreamingResponse(generate_events(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    print("="*60)
    print("🚀 Day 37 智能体工厂后端引擎启动成功！")
    print("接口文档: http://127.0.0.1:8000/docs")
    print("="*60)
    uvicorn.run("day37_agent_factory_engine:app", host="0.0.0.0", port=8000, reload=True)