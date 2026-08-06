"""
Day 34: 动态多智能体协同平台与交互可视化引擎 (Multi-Agent Orchestration Platform)
启动方式: uvicorn day34_multi_agent_platform:app --reload --port 8000
"""

import json
import os
import time
from typing import Annotated, TypedDict, List, Dict, Optional, Literal
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END

# ==========================================
# 1. 契约定义：用户自定义 Agent 结构
# ==========================================
class CustomAgentConfig(BaseModel):
    id: str = Field(description="Agent 唯一标识，如'code_reviewer'")
    name: str = Field(description="Agent 展示名称，如'资深代码审计师'")
    description: str = Field(description="功能描述，供 Supervisor 识别何时分发任务")
    system_prompt: str = Field(description="核心人设与指令")

class ChatRequest(BaseModel):
    messages: str
    mode: Literal["auto_orchestrate", "direct"] = "auto_orchestrate"
    # 用户可以在前端动态传进来一堆他们自己定义的 Agent！
    custom_agents: Optional[List[CustomAgentConfig]] = None

# ==========================================
# 2. 状态定义 (State)
# ==========================================
class AgentTalkEvent(BaseModel):
    from_agent: str
    to_agent: str
    action: str
    content: str
    timestamp: float = Field(default_factory=time.time)

class MultiAgentState(TypedDict):
    messages: Annotated[list[BaseMessage], lambda x, y: x + y]
    #可用的 Agent 注册表
    available_agents: Dict[str: CustomAgentConfig]
    #记录 Agent 之间的对话和指派轨迹
    interaction_trace: List[Dict]
    # 当前指派的目标 Agent ID
    target_agent_id: Optional[str]
    #最终汇总回答
    final_response: str

# ==========================================
# 3. 预置的默认自定义 Agent 库
# ==========================================
DEFAULT_CUSTOM_AGENTS = {
    "physics_expert": CustomAgentConfig(
        id="physics_expert",
        name="⚛️ 理论物理学家",
        description="擅长解释黑洞、相对论、量子力学、宇宙学等深奥物理学概念",
        system_prompt="你是一位诺贝尔物理学级别的理论物理学。请用严禁但生动的学术语言解释物理概念，适当给出公式和物理机制。"
    ),
    "code_reviewer": CustomAgentConfig(
        id="code_reviewer",
        description="擅长审查 Python/C++/React 代码，查找潜在 Bug、性能瓶颈和安全漏洞",
        system_prompt="你是一位严苛的资深代码审计专家。请对用户提供的代码进行多维度审查，指出风险并给出优化后的重构代码。"
    ),
    "style_editor": CustomAgentConfig(
        id="style_editor",
        name="✍️ 首席文案润色官",
        description="擅长将硬核技术报告改写为通俗易懂、富有文采的高质量科普文章或推文",
        system_prompt="你是一位顶级科技媒体主编。请将复杂的专业报告改写为引人入胜、结构清晰、极具可读性的文章。"
    )
}

DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")
llm = ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")

# ==========================================
# 4. 节点逻辑 (Nodes)
# ==========================================

def supervisor_node(state: MultiAgentState):
    """
    Supervisor (主控大脑)：分析用户问题，对比可用 Agent 描述，决定指派给谁。
    """
    print("\n[Node: Supervisor] 👔 调度中心正在评估任务指派...")
    user_msg = state["messages"][0].content
    agents = state["available_agents"]

    # 组装 Agent 列表说明给 LLM 看
    agent_descriptions = "\n".join([
        f"- ID: {a.id} | 名称: {a.name} | 描述: {a.description}"
        for a in agents.values()
    ])

    prompt = f"""你是多智能体系统的调度主管 (Supervisor)。
根据用户的需求，从以下【可用智能体列表】中选择最合适的一个来处理任务。

【可用智能体列表】：
{agent_descriptions}
- ID: self | 名称: 调度主管直答 | 描述: 普通问候或无需专业 Agent 处理的问题

【用户需求】：{user_msg}

请直接输出你选择的 Agent ID (如 'physics_expert' 或 'self')，不要有任何多余字符。
"""
    res = llm.invoke([SystemMessage(content=prompt)])
    chosen_id = res.content.strip().lower()

    if chosen_id not in agents and chosen_id != "self":
        chosen_id = "self"

    target_name = agents[chosen_id].name if chosen_id in agents else "主控直答"
    
    # 记录交互轨迹
    trace = {
        "from_agent": "👔 Supervisor (调度大脑)",
        "to_agent": target_name,
        "action": f"分析意图后，决定将任务指派给【{target_name}】",
        "timestamp": time.time()
    }

    print(f"  └─ 决策结果: 指派给 -> {chosen_id} ({target_name})")

    return {
        "target_agent_id": chosen_id,
        "interaction_trace": state.get("interaction_trace", []) + [trace]
    }


def sub_agent_execution_node(state: MultiAgentState):
    """
    子 Agent 执行节点：根据 Supervisor 指派的 ID，动态加载对应的 System Prompt 运行
    """
    target_id = state.get("target_agent_id")
    agents = state["available_agents"]
    user_msg = state["messages"][0].content

    # 如果是主管直答
    if target_id == "self" or target_id not in agents:
        print("[Node: SubAgent] 👔 Supervisor 正在直接回复用户...")
        res = llm.invoke(state["messages"])
        return {
            "final_response": res.content,
            "messages": [AIMessage(content=res.content)]
        }

    agent_config = agents[target_id]
    print(f"[Node: SubAgent] 🤖 动态激活智能体: 【{agent_config.name}】...")

    # 使用子 Agent 独特的 System Prompt 运行
    response = llm.invoke([
        SystemMessage(content=agent_config.system_prompt),
        HumanMessage(content=user_msg)
    ])

    # 记录子 Agent 将结果汇报给主控的轨迹
    trace = {
        "from_agent": agent_config.name,
        "to_agent": "👔 Supervisor (调度大脑)",
        "action": f"【{agent_config.name}】完成专项处理，已将专业报告提交给主控中心",
        "timestamp": time.time()
    }

    return {
        "final_response": response.content,
        "messages": [AIMessage(content=response.content)],
        "interaction_trace": state.get("interaction_trace", []) + [trace]
    }


# ==========================================
# 5. 构建 LangGraph
# ==========================================
workflow = StateGraph(MultiAgentState)

workflow.add_node("supervisor", supervisor_node)
workflow.add_node("sub_agent", sub_agent_execution_node)

workflow.add_edge(START, "supervisor")
workflow.add_edge("supervisor", "sub_agent")
workflow.add_edge("sub_agent", END)

langgraph_app = workflow.compile()


# ==========================================
# 6. SSE 流式传输 (包含 agent_talk 交互轨迹)
# ==========================================
async def generate_multi_agent_events(message: str, custom_agents: List[CustomAgentConfig]):
    def sse_format(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    try:
        # 合并默认 Agent 与 用户前端动态传入的自定义 Agent
        agent_registry = dict(DEFAULT_CUSTOM_AGENTS)
        if custom_agents:
            for ca in custom_agents:
                agent_registry[ca.id] = ca

        # 发送推送开始
        yield sse_format("system_status", {"message": "正在激活多智能体协同网络..."})

        inputs = {
            "messages": [HumanMessage(content=message)],
            "available_agents": agent_registry,
            "interaction_trace": [],
            "target_agent_id": None,
            "final_response": ""
        }

        pushed_traces_count = 0

        for event in langgraph_app.stream(inputs):
            for node_name, output in event.items():
                if output is None: continue

                # 【核心】：发现新的 Agent 间交互轨迹，立刻推送给前端 React 渲染协同卡片！
                traces = output.get("interaction_trace", [])
                while pushed_traces_count < len(traces):
                    t = traces[pushed_traces_count]
                    yield sse_format("agent_talk", {
                        "from_agent": t["from_agent"],
                        "to_agent": t["to_agent"],
                        "action": t["action"],
                        "timestamp": t["timestamp"]
                    })
                    pushed_traces_count += 1

                # 最终回答
                if "final_response" in output and output["final_response"]:
                    yield sse_format("final_answer", {
                        "answer": output["final_response"],
                        "handled_by": output.get("target_agent_id", "supervisor")
                    })

        yield sse_format("done", {"status": "success"})

    except Exception as e:
        yield sse_format("error", {"message": str(e)})


# ==========================================
# 7. FastAPI App
# ==========================================
app = FastAPI(title="Multi-Agent Platform API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/chat_multi_agent")
async def chat_multi_agent_endpoint(request: ChatRequest):
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="消息不能为空")

    return StreamingResponse(
        generate_multi_agent_events(request.message, request.custom_agents or []),
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
    print("🚀 启动 Day 34 多智能体协同与可视化平台 API")
    print("API 地址: http://127.0.0.1:8000/chat_multi_agent")
    print("="*60)
    uvicorn.run("day34_multi_agent_platform:app", host="0.0.0.0", port=8000, reload=True)