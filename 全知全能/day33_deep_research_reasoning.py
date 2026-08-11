import os
import json
import time
from typing import List, Dict, Any, Optional
from openai import OpenAI
from langchain_core.messages import HumanMessage, SystemMessage

# 引入我们 Day 32 写好的深度检索管道
from 全知全能.day32_deep_research_retrieval import run_deep_retrieval_pipeline

DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")
client = OpenAI(api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")

def run_day33_deep_thinking_research(
    user_query: str,
    output_instruction: Optional[str] = None,
    history: Optional[List[Dict[str, str]]] = None,
):
    """Deep Research + 深度思考融合引擎。

    Why 分离参数：
      - user_query：纯用户问题，传给 day32 做搜索词和 rerank，避免"最终报告输出要求..."污染搜索
      - output_instruction：报告格式要求，只拼进 R1 的 system prompt，不影响检索
      - history：会话历史，传给 day32 解析指代词（"类似的""上面提到的"）
    """
    print(f"\n==================================================")
    print(f"🚀 启动 Day 33: Deep Research + 深度思考融合引擎")
    print(f"==================================================")

    # 1. 触发 Day 32：180条切片 -> Top 10 精粹（传纯 query + history）
    golden_chunks = run_deep_retrieval_pipeline(user_query, history=history)

    # 2. 组装格式化参考资料
    context_blocks = []
    for c in golden_chunks:
        context_blocks.append(
            f"【资料 [{c['id']}]】 (相关度得分: {c['score']})\n"
            f"标题: {c['title']}\n"
            f"链接: {c['url']}\n"
            f"内容: {c['text']}"
        )
    context_str = "\n\n".join(context_blocks)

    # 3. 构建给 R1 推理模型的系统 Prompt
    # Why：output_instruction 只拼这里，不进搜索词；没有则用默认规范。
    output_rule = output_instruction or (
        "1. 深入剖析：不仅要回答\"是不是\"，还要结合资料解释背后的原理、历史背景或技术细节。\n"
        "2. 严谨引用：每一个核心事实必须在末尾标注资料编号，例如：[1] 或 [2]。\n"
        "3. 事实客观：如果资料中提到了现实与理论的差异（例如科学与电影艺术处理的平衡），请分点对比说明。"
    )
    system_prompt = f"""你是一个顶级的科学与技术深度研究员。
请根据下面提供的【精选全网研究资料】，对用户的问题进行极其深入、严密、客观的解答。

【精选全网研究资料】:
{context_str}

【回答规范】:
{output_rule}
"""

    print(f"\n[Node: DeepThinker] 🧠 正在将 10 条高纯度资料送入 DeepSeek-R1 开启长思维链推理...")

    # 4. 调用 DeepSeek-R1 (deepseek-reasoner)，记录耗时
    start_time = time.time()
    response = client.chat.completions.create(
        model="deepseek-reasoner",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_query}
        ]
    )
    reasoning_time = round(time.time() - start_time, 1)

    # 5. 提取"内心独白 (<think>)"与"最终深度报告"
    reasoning_content = response.choices[0].message.reasoning_content
    final_content = response.choices[0].message.content

    print(f"\n" + "="*50)
    print(f"💡 【DeepSeek-R1 深度思考脉络】 ({len(reasoning_content)} 字, 耗时 {reasoning_time}s):")
    print("="*50)
    print(reasoning_content[:600] + "\n... (中间思考过程已省略) ...\n")

    print("="*50)
    print(f"📜 【最终 Deep Research 报告】:")
    print("="*50)
    print(final_content)

    return {
        "golden_chunks": golden_chunks,
        "reasoning": reasoning_content,
        "report": final_content,
        "reasoning_time": reasoning_time
    }

if __name__ == "__main__":
    query = "卡冈图雅是按照现实中黑洞的原型设计的吗"
    run_day33_deep_thinking_research(query)
