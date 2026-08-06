from pydantic import BaseModel, Field
from typing import List, Optional

# 单个子任务模型
class Task(BaseModel):
    id: int
    description: str                              # 任务描述，如 "搜集 2026 医疗 AI 监管政策"
    assigned_agent: str = "web_researcher"        # 指派给哪个 Agent 跑
    status: str = "pending"                       # pending / in_progress / completed / failed
    result: Optional[str] = None                  # 执行结果

# 规划器生成的计划表
class Plan(BaseModel):
    steps: List[Task]

# 升级后的 PlanState
class PlanExecuteState(TypedDict):
    input_goal: str                               # 用户的最终大目标
    plan: List[Task]                              # 当前剩余/全部任务列表
    completed_steps: List[Task]                   # 已完成的任务历史
    final_response: str                           # 汇总结论
    
def planner_node(state: PlanExecuteState):
    """
    1. Planner 节点：负责将用户的大目标拆解为具体的 3-5 个 Task
    """
    print("\n[Node: Planner] 📝 正在拆解巨型任务，规划执行路径...")
    goal = state["input_goal"]
    
    prompt = f"""你是一个高级项目经理。请将用户的最终目标拆解为3 个按顺序执行的子任务。
    目标：{goal}
    
    必须输出 JSON 格式：
    {{
      “steps": [
        {{"id": 1, "description": "子任务1描述", "assigned_agent": "researcher"}},
    {{"id": 2, "description": "子任务2描述", "assigned_agent": "analyst"}},
    {{"id": 3, "description": "子任务3描述", "assigned_agent": "writer"}}
      ]
    }}
    """
    
    res = llm.invoke([SystemMessages(content=prompt])
    # 解析JSON生成的Task列表
    plan_data = json.loads(clean_json_str(res.content))
    tasks = [Task(**t) fot t in plan_data["steps"]]
    
    return {"plan": tasks, "completed_steps": []}
    
def executor_mode(state: PlanExecuteState):
    """
    2. Task Executor 节点：拿出当前 pending 的第一个任务去执行
    """
    plan = state["plan"]
    #找到第一个还没做的任务
    current_task = next((t for t in plan if t.status == "pending"), None)
    if not current_task:
        return {}
    print(f"\n[Node:Executor] ⚡ 正在执行 Task [{current_task.id}]: {current_task.description}...")
    current_task.status = "in_progress"
    
    #结合之前已完成任务的成果进行上下文推演
    context = "\n".join([f"已完成步骤 {t.id} [{t.description}] 成果： {t.result}" for t in state["completed_steps"]])
    
    exec_prompt = f"任务： {current_task.description}\n前置背景： {context}\n请执行该任务并给出简练总结。"
    res = llm.invoke([SystemMessages(content=exec_prompt])
    
    current_task.status = "completed"
    current_task.result = res.content
    
    return {
      "completed_steps": state["completed_steps"] + [current_task]
    }

def replanner_node(state: PlanExecuteState):
    """
    3. Re-Planner 节点：检查任务是否全部完成，决定是继续循环还是总结退出
    """
    completed_ids = {t.id for t in state["completed_steps"]}
    all_ids = {t.id for t in state["plan"]}
    
    if completed_ids >= all_ids:
        print("\n[Node: RePlanner] 🎉 所有规划子任务均已完成！进入最终汇总...")
        # 生成最终总结
        all_results = "\n\n".join([f"### 步骤 {t.id}: {t.description}\n{t.result}" for t in state["completed_steps"]])
        summary_res = llm.invoke(f"根据以下分步执行成果，汇总一份终极报告：\n{all_results}")
        return {"final_response": summary_res.content}
        
    print(f"\n[Node: RePlanner] 🔄 剩余任务未完成，准备推进下一环节...")
    return {}

