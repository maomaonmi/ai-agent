import json
import re
from typing import Annotated, TypedDict, List, Dict
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
import os

# ==========================================
# 1. 更加复杂的 State 定义
# ==========================================
class AnalystState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    reasoning: Annotated[list[str], add_messages]
    # 结构化结果：存放提取出的 JSON 数据
    extracted_data: Dict
    # 最终渲染好的 Markdown 报告
    final_report: str

# ==========================================
# 2. 深度分析大脑
# ==========================================
llm = ChatOpenAI(
    model="deepseek-chat",
    api_key=os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199"),
    base_url="https://api.deepseek.com",
)

# 【核心逻辑】结构化提示词
# 这种提示词的价值在于它定义了一个“模具”，AI 必须填入内容
STRUCTURED_PROMPT = """你是一个专业的全球行业分析师。
你的任务是根据用户提供的行业/公司，进行深度情报分析。

### 必须遵守的输出格式规范：
1. **思考过程**：请在 <think> 标签内进行逻辑拆解。
2. **正式报告**：请在 <report> 标签内书写。必须包含：
   - ## 行业概览（一段话简介）
   - **核心指标对比**（必须使用下方的标准 Markdown 表格格式，禁止省略任何一行）：

     ```
     | 指标名称 | 当前数值 | 趋势判断 |
     |---------|---------|---------|
     | 示例：年营收 | 示例：¥120亿 | 示例：↑ 同比增长 25% |
     | （实际填写） | （实际填写） | （实际填写） |
     ```

   - > [!IMPORTANT] 核心风险提示（分点列出 3-5 条）
3. **元数据摘要**：请在 <metadata> 标签内**只输出一个合法的 JSON 对象**，禁止写任何解释文字、禁止换行、禁止使用 Markdown 代码块包裹，直接写 `{"key": "value"}` 格式。包含：
   - "industry_name": 行业名称
   - "risk_level": 1-10 的数字
   - "tags": 关键词列表
"""

def analysis_node(state: AnalystState):
    print("\n[Node: Analyst] 📊 正在进行全球情报分析...")
    
    response = llm.invoke([
        SystemMessage(content=STRUCTURED_PROMPT),
        *state["messages"]
    ])
    
    raw_content = response.content
    
    # --- 登神长阶：多重标签解析逻辑 ---
    # 提取思考过程
    think = re.search(r'<think>(.*?)</think>', raw_content, re.DOTALL)
    # 提取正式报告
    report = re.search(r'<report>(.*?)</report>', raw_content, re.DOTALL)
    # 提取 JSON 元数据
    metadata_str = re.search(r'<metadata>(.*?)</metadata>', raw_content, re.DOTALL)
    
    extracted_json = {}
    if metadata_str:
        try:
            json_text = re.sub(r'```json|```', '', metadata_str.group(1)).strip()
            extracted_json = json.loads(json_text)
        except:
            pass

    # 兜底：如果 <metadata> 标签里没拿到有效 JSON，在整个响应里搜索 { ... } 逐个尝试
    if not extracted_json or "error" in extracted_json:
        fallback_matches = re.findall(r'\{[^{}]*\}', raw_content)
        for candidate in fallback_matches:
            try:
                candidate_clean = candidate.strip()
                # 跳过太短或没有冒号的（肯定不是有效 metadata JSON）
                if ':' not in candidate_clean or len(candidate_clean) < 20:
                    continue
                extracted_json = json.loads(candidate_clean)
                break
            except Exception:
                continue

    if not extracted_json or "error" in extracted_json:
        extracted_json = {"error": "JSON 解析失败，请检查 metadata 标签是否包含有效 JSON"}

    return {
        "reasoning": [think.group(1).strip()] if think else ["(无思考)"],
        "final_report": report.group(1).strip() if report else "报告生成失败",
        "extracted_data": extracted_json,
        "messages": [AIMessage(content="报告已生成，请查看。")]
    }

# ==========================================
# 3. 构建流程
# ==========================================
workflow = StateGraph(AnalystState)
workflow.add_node("analyst", analysis_node)
workflow.add_edge(START, "analyst")
workflow.add_edge("analyst", END)

app = workflow.compile()

# ==========================================
# 4. 测试运行：多元化分析场景
# ==========================================
if __name__ == "__main__":
    test_query = "请分析当前全球低轨卫星互联网行业（如 Starlink）的现状。"
    print(f"👤 用户指令: {test_query}")
    
    result = app.invoke({"messages": [HumanMessage(content=test_query)]})
    
    print("\n" + "="*50)
    print("💡 思考路径 (内部可见):")
    print(result["reasoning"][-1])
    
    print("\n" + "="*50)
    print("📜 最终生成报告 (前端展示):")
    print(result["final_report"])
    
    print("\n" + "="*50)
    print("💾 提取出的 JSON 数据 (存入数据库用):")
    print(json.dumps(result["extracted_data"], indent=2, ensure_ascii=False))