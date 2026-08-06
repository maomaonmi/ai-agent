"""
FastAPI + SSE 架构的 LangGraph Agent 服务
工业级解耦架构：通过 SSE 协议将流式推理推送给前端

启动方式: uvicorn day31_Tavily:app --reload --port 8000
"""

import json
import re
import time
from typing import Annotated, TypedDict, List, Dict, Literal, Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from gradio.workflow import search_datasets
from pydantic import BaseModel

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from openai import OpenAI
from langgraph.graph import StateGraph, START, END

import os
from tavily import TavilyClient
from typing import List, Dict
import requests

from day32_deep_research_retrieval import (
    generate_sub_queries,
    fetch_mass_web_pages,
    chunk_documents,
    batch_rerank_chunks
)

#1. 初始化 Tavily
tavily = TavilyClient(api_key="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")

def advanced_web_search(query: str, top_k: int = 3) -> str:
    print(f"\n[Node: Search] 🌐 正在全网搜索关于'{query}'的最新情报...")

    #第一步：Tavily搜索（获取10条候选）
    search_result = tavily.search(query=query, search_depth="advanced", max_result=10)

    candidates = []
    for res in search_result['result']:
        candidates.append({
            "title": res['title'],
            "content": res['content'],
            "url": res['url']
        })

    # 第二步：使用Reranker进行精选（这里以硅基流动的API示例）
    print(f"[Node: Rerank] 🎯 正在对 {len(candidates)} 条数据进行重新筛选...")

    rerank_url = "https://api.siiliconflow.cn/v1/rerank"
    payload = {
        "model": "BAAI/bge-rerank-v2-m3",
        "query": query,
        "documents": [c['content'] for c in candidates],
        "top_n": top_k #只取最准的前3条
    }
    headers = {
        "Authorization": f"Bearer sk-uxbwkpqtfksnzpzkagxrmlpjxgzmajipleykmxaxiaxqwnkm",
        "Content-Type": "application/json"
    }

    response = requests.post(rerank_url, json=payload, headers=headers).json()

    #第三步： 组装最终参考资料
    final_docs = []
    for item in response['result']:
        idx = item["index"]
        doc = candidates[idx]
        final_docs.append(f"资料来自 [{doc['url']}]:\n{doc['content']}")

    return "\n\n---\n\n".join(final_docs)

# ==========================================
# 1. 状态定义
# ==========================================
class GroundedState(TypedDict):
    messages: Annotated[list[BaseMessage], lambda x, y: x + y]
    retrieved_docs: List[Dict]
    web_docs: List[Dict]  # 联网搜索结果
    final_answer: str
    correction_feedback: str
    retry_count: int
    mode: Literal["fast", "standard", "deep", "web"]
    reasoning: str  # deepseek-reasoner 的推理过程


# ==========================================
# 2. Pydantic 请求/响应模型
# ==========================================
class ChatRequest(BaseModel):
    message: str
    mode: Literal["standard", "deep", "web"] = "standard"


class NodeEvent(BaseModel):
    node_name: str
    status: str  # "processing", "completed"
    data: Optional[Dict] = None


class StreamResponse(BaseModel):
    event: str  # "node", "reasoning", "done", "error"
    data: dict


# ==========================================
# 3. 路由节点（仅在 UI 未强制指定模式时生效）
# ==========================================
def router_node(state: GroundedState):
    user_msg = state["messages"][0].content
    if state.get("mode") in ("deep", "standard", "fast", "web"):
        print(f"[Node: Gateway] **UI强制模式**: {state['mode']}，跳过路由判断")
        return {}

    print(f"\n[Node: Gateway] **分析意图**: {user_msg}")
    prompt = f"""
    分析用户问题，选择处理模式：
    1. 简单问候/闲聊 -> "fast"
    2. 需要最新网络信息/新闻/实时数据 -> "web"
    3. 明确的单条维修/价格查询，且不涉及多步推理 -> "standard"
    4. 涉及以下任意特征的，必须选 "deep"：
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
    deep_keywords = ["还是", "还是说", "先", "能不能", "可以吗", "是否应该",
                     "为什么", "够不够", "够吗", "性价比", "最优",
                     "组合", "结合", "同时", "如果", "假设"]
    if any(kw in user_msg for kw in deep_keywords):
        mode = "deep"
        print(f"[Gateway] **关键词命中**，强制启用深度思考模式")
    return {"mode": mode}


# ==========================================
# 4. 查询重写节点
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
# 5. 检索节点（本地知识库）
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
    请列出所有相关条目的id，用逗号分隔。
    """
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
# 5b. 联网搜索节点（Tavily + Reranker）
# ==========================================
def web_search_node(state: GroundedState):
    """使用 Tavily 进行全网搜索，通过 Reranker 精选结果"""
    print("[Node: WebSearch] 🌐 正在全网搜索...")
    user_query = state["messages"][0].content

    # 第一步：Tavily 搜索（获取10条候选）
    try:
        search_result = tavily.search(query=user_query, search_depth="advanced", max_result=10)
    except Exception as e:
        print(f"[Node: WebSearch] Tavily 搜索失败: {e}")
        return {"web_docs": [], "final_answer": "联网搜索服务暂时不可用，请稍后再试。"}

    candidates = []
    for res in search_result.get('results', []):
        candidates.append({
            "title": res.get('title', ''),
            "content": res.get('content', ''),
            "url": res.get('url', ''),
            "score": 0
        })

    if not candidates:
        print("[Node: WebSearch] 未找到搜索结果")
        return {"web_docs": [], "final_answer": "未找到相关网络资料。"}

    # 第二步：Reranker 精选
    print(f"[Node: Rerank] 🎯 正在对 {len(candidates)} 条数据进行重新筛选...")
    try:
        rerank_url = "https://api.siiliconflow.cn/v1/rerank"
        payload = {
            "model": "BAAI/bge-rerank-v2-m3",
            "query": user_query,
            "documents": [c['content'] for c in candidates],
            "top_n": 5
        }
        headers = {
            "Authorization": "Bearer sk-uxbwkpqtfksnzpzkagxrmlpjxgzmajipleykmxaxiaxqwnkm",
            "Content-Type": "application/json"
        }
        response = requests.post(rerank_url, json=payload, headers=headers, timeout=30).json()
        
        final_docs = []
        for item in response.get('results', []):
            idx = item.get("index", 0)
            if idx < len(candidates):
                doc = candidates[idx]
                final_docs.append({
                    "id": len(final_docs) + 1,
                    "title": doc['title'],
                    "content": doc['content'],
                    "url": doc['url'],
                    "score": item.get("relevance_score", 0)
                })
    except Exception as e:
        print(f"[Node: Rerank] Reranker 调用失败: {e}，使用原始顺序")
        final_docs = [
            {"id": i+1, "title": c['title'], "content": c['content'], "url": c['url'], "score": 1.0 - i*0.1}
            for i, c in enumerate(candidates[:5])
        ]

    print(f"[Node: WebSearch] 筛选完成，保留 {len(final_docs)} 条最相关结果")
    return {"web_docs": final_docs}


# ==========================================
# 6b. 联网分析节点
# ==========================================
def web_analyst_node(state: GroundedState):
    """基于联网搜索结果进行分析"""
    print("[Node: WebAnalyst] 🌐 正在分析联网搜索结果...")
    web_docs = state.get("web_docs", [])
    user_query = state["messages"][0].content

    if not web_docs:
        return {"final_answer": "未找到相关网络资料。"}

    # 构建上下文
    context_str = "\n".join([
        f"【资料 {d['id']}】来源: {d['title']}\n链接: {d['url']}\n内容: {d['content']}"
        for d in web_docs
    ])

    system_prompt = f"""你是一个专业的网络搜索助手。请根据以下【网络搜索结果】回答用户问题。

    【用户问题】：{user_query}

    【搜索结果】：
    {context_str}

    【回答要求】：
    1. 基于搜索结果如实回答，不要添加搜索结果中没有的信息
    2. 如果搜索结果不足以完整回答，可以说明"根据搜索结果，..."
    3. 在回答中标注信息来源，例如：（来源：XXX）
    4. 如果有多个相关结果，可以对比说明
    5. 给出相关链接供用户进一步查看
    """

    response = ChatOpenAI(
        model="deepseek-chat",
        api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
        base_url="https://api.deepseek.com"
    ).invoke([SystemMessage(content=system_prompt), *state["messages"]])

    return {
        # 不更新 messages，避免与 rewrite/retrieve 冲突
        "final_answer": response.content,
        "retry_count": 0
    }


# ==========================================
# 6. 带引用的分析节点（深度思考 / 标准模式）
# ==========================================
def get_llm(mode: str):
    if mode == "deep":
        client = OpenAI(
            api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
            base_url="https://api.deepseek.com"
        )
        return client
    return ChatOpenAI(
        model="deepseek-chat",
        api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
        base_url="https://api.deepseek.com"
    )


def grounded_analyst_node(state: GroundedState):
    mode = state.get("mode", "standard")
    if mode == "deep":
        print("[Node: Analyst] **深度思考模式** 正在启动...")
    else:
        print("[Node: Analyst] 正在使用【标准模式】...")

    context_str = "\n".join([f"资料 [{d['id']}]: {d['text']}" for d in state['retrieved_docs']])
    feedback = f"\n注意：上次回复漏掉了引用或引用错误：{state['correction_feedback']}" if state.get('correction_feedback') else ""

    system_prompt = f"""你是一个严谨的客服专家。请根据以下【参考资料】回答用户问题。
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
    llm = get_llm(mode)

    reasoning = ""
    response_ai = None
    if mode == "deep":
        client = llm
        msgs = []
        for m in state["messages"]:
            if isinstance(m, SystemMessage):
                msgs.append({"role": "system", "content": m.content})
            elif isinstance(m, HumanMessage):
                msgs.append({"role": "user", "content": m.content})
            elif isinstance(m, AIMessage):
                msgs.append({"role": "assistant", "content": m.content})
        resp = client.chat.completions.create(
            model="deepseek-reasoner",
            messages=[{"role": "system", "content": system_prompt}] + msgs,
        )
        reasoning = resp.choices[0].message.reasoning_content or ""
        final_text = resp.choices[0].message.content or ""
        response_ai = AIMessage(content=final_text)
        print(f"[Node: Analyst] **深度思考** 收到推理过程 {len(reasoning)} 字")
    else:
        response_ai = llm.invoke([SystemMessage(content=system_prompt), *state["messages"]])

    return {
        "messages": state["messages"] + [response_ai],
        "final_answer": response_ai.content,
        "reasoning": reasoning,
        "retry_count": state.get("retry_count", 0) + 1
    }


# ==========================================
# 7. 语义级证据审计节点
# ==========================================
def semantic_citation_auditor(state: GroundedState):
    print("[Node: Auditor] 正在进行语义级证据审计...")
    answer = state["final_answer"]
    docs_list = state["retrieved_docs"]
    docs_dict = {str(d['id']): d['text'] for d in docs_list}
    user_query = state["messages"][0].content

    # 跳过"资料能否回答"的判断（会导致无限重试），直接检查引用格式
    pairs = re.findall(r'([^。！？\n]*?)\[(\d+)\]', answer)
    if not pairs:
        return {"correction_feedback": "未发现引用标注，请在事实性陈述后添加 [n]。"}

    audit_tasks = []
    for claim, doc_id in pairs:
        evidence = docs_dict.get(doc_id, "未知")
        audit_tasks.append(f"声明: {claim.strip()}\n证据库[{doc_id}]: {evidence}")

    audit_prompt = f"""你是首席审计官。请严格按以下规则判断声明是否被证据库支撑：
    规则1：只要声明中的具体数字/事实与证据库内容一致，就视为支撑，无需在意"是否说全了其他信息"。
    规则2：如果声明与证据矛盾（数字不对、方向相反），才判为冲突。
    规则3：对于"在/超出预算内"这类判断，只要引用了对应费用的证据，即视为支撑。
    【待核对清单】：
    {chr(10).join(audit_tasks)}
    判断：有任何一个冲突 → 回复"冲突：原因"。没有任何冲突 → 回复"PASS"。"""
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
# 8. 构建 LangGraph
# ==========================================
MAX_RETRIES = 5


def should_continue(state: GroundedState):
    rc = state.get("retry_count", 0)
    fb = state.get("correction_feedback", "")
    print(f"[should_continue] retry_count={rc}, feedback={repr(fb[:60])}")

    if fb:
        print(f"[should_continue] → retry (feedback={repr(fb[:60])})")
        return "retry"
    if rc >= MAX_RETRIES:
        print(f"[should_continue] → max_retries (次数已达上限)")
        return "max_retries"
    print("[should_continue] → pass (审计通过)")
    return "pass"


langgraph_app = None  # 懒加载


def get_langgraph_app():
    global langgraph_app
    if langgraph_app is None:
        workflow = StateGraph(GroundedState)
        
        # 基础节点
        workflow.add_node("router", router_node)
        workflow.add_node("rewrite", query_rewriter_node)
        workflow.add_node("retrieve", retrieval_node)
        workflow.add_node("analyst", grounded_analyst_node)
        workflow.add_node("validator", semantic_citation_auditor)
        
        # 联网搜索节点
        workflow.add_node("web_search", web_search_node)
        workflow.add_node("web_analyst", web_analyst_node)

        # 路由条件：根据 mode 选择流程
        def route_mode(state: GroundedState):
            mode = state.get("mode", "standard")
            if mode == "web":
                return "web_search"
            return "standard_flow"
        
        # 启动 -> 路由
        workflow.add_edge(START, "router")
        
        # 路由条件分支
        workflow.add_conditional_edges(
            "router",
            route_mode,
            {
                "standard_flow": "rewrite",  # 标准/深度模式走本地知识库流程
                "web_search": "web_search",  # 联网模式直接搜索
            }
        )
        
        # 标准/深度模式流程
        workflow.add_edge("rewrite", "retrieve")
        workflow.add_edge("retrieve", "analyst")
        workflow.add_edge("analyst", "validator")
        workflow.add_conditional_edges(
            "validator",
            should_continue,
            {"retry": "analyst", "max_retries": END, "pass": END},
        )
        
        # 联网模式结束
        workflow.add_edge("web_search", "web_analyst")
        workflow.add_edge("web_analyst", END)

        langgraph_app = workflow.compile()
        print("[System] LangGraph 编译完成")
    return langgraph_app


# ==========================================
# 9. SSE 流式聊天端点
# ==========================================
async def generate_chat_events(message: str, mode: str):
    """
    生成 SSE 事件流
    事件类型:
    - node: 节点处理开始/结束
    - reasoning: deep 模式的推理过程
    - web_docs: 联网搜索结果（web 模式）
    - done: 最终回答
    - error: 错误信息
    """
    
    def sse_format(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data)}\n\n"
    
    try:
        # 发送开始事件
        yield sse_format("node", {
            "node_name": "start",
            "status": "processing",
            "message": "开始处理请求..." if mode != "web" else "正在联网搜索..."
        })

        inputs = {
            "messages": [HumanMessage(content=message)],
            "mode": mode,
            "reasoning": "",
            "retry_count": 0,
            "web_docs": [],
        }

        final_response = ""
        all_reasoning = []
        web_docs_result = []
        max_stream_steps = 30
        stream_step = 0
        start_time = time.time()
        max_seconds = 120

        # 遍历 LangGraph 流
        for event in get_langgraph_app().stream(inputs):
            stream_step += 1
            print(f"[SSE] step={stream_step}, event_keys={list(event.keys())}")

            # 处理每个节点的输出
            for node_name, output in event.items():
                if output is None:
                    continue

                # 发送节点处理中事件
                yield sse_format("node", {
                    "node_name": node_name,
                    "status": "completed",
                    "output": _summarize_output(output)
                })

                # 捕获联网搜索结果
                if "web_docs" in output and output["web_docs"]:
                    web_docs_result = output["web_docs"]
                    yield sse_format("web_docs", {
                        "docs": web_docs_result,
                        "count": len(web_docs_result)
                    })

                # 捕获最终回答
                if "final_answer" in output and output["final_answer"]:
                    final_response = output["final_answer"]

                # 捕获深度思考推理过程
                if mode == "deep" and "reasoning" in output and output["reasoning"]:
                    all_reasoning.append(output["reasoning"])
                    yield sse_format("reasoning", {
                        "reasoning": output["reasoning"],
                        "index": len(all_reasoning)
                    })

            # 安全检查
            if stream_step >= max_stream_steps:
                yield sse_format("error", {"message": f"达到最大步数 {max_stream_steps}"})
                break
            if time.time() - start_time > max_seconds:
                yield sse_format("error", {"message": f"运行超过 {max_seconds} 秒超时"})
                break

        # 发送完成事件
        yield sse_format("done", {
            "answer": final_response,
            "reasoning_steps": len(all_reasoning),
            "mode": mode,
            "web_docs": web_docs_result
        })

    except Exception as e:
        yield sse_format("error", {"message": str(e)})


def _summarize_output(output: dict) -> dict:
    """将节点输出转换为可序列化的摘要"""
    summary = {}
    if "final_answer" in output and output["final_answer"]:
        summary["final_answer"] = output["final_answer"][:200] + "..." if len(output["final_answer"]) > 200 else output["final_answer"]
    if "retrieved_docs" in output:
        summary["docs_count"] = len(output["retrieved_docs"])
    if "mode" in output:
        summary["mode"] = output["mode"]
    if "correction_feedback" in output:
        summary["feedback"] = output["correction_feedback"]
    if "reasoning" in output and output["reasoning"]:
        summary["has_reasoning"] = True
        summary["reasoning_length"] = len(output["reasoning"])
    return summary


# ==========================================
# 10. FastAPI 应用
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    print("[FastAPI] 启动中，预热 LangGraph...")
    get_langgraph_app()
    print("[FastAPI] 启动完成，服务已就绪")
    yield
    print("[FastAPI] 关闭中...")


app = FastAPI(
    title="LangGraph Agent API",
    description="基于 LangGraph 的智能客服 Agent，支持 SSE 流式输出",
    version="1.0.0",
    lifespan=lifespan
)

# CORS 中间件，允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/chat")
async def chat_stream(request: ChatRequest):
    """
    SSE 流式聊天端点
    
    请求体:
    - message: 用户消息
    - mode: "standard" | "deep" (默认 standard)
    
    SSE 事件:
    - node: 节点处理状态
    - reasoning: 深度思考推理过程 (仅 deep 模式)
    - done: 最终回答
    - error: 错误信息
    """
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="消息不能为空")

    return StreamingResponse(
        generate_chat_events(request.message, request.mode),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲
        }
    )


@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {
        "status": "ok",
        "service": "LangGraph Agent API",
        "version": "1.0.0"
    }


@app.get("/")
async def root():
    """根路径欢迎信息"""
    return {
        "message": "LangGraph Agent API",
        "docs": "/docs",
        "health": "/health",
        "chat": "/chat (POST)"
    }


# ==========================================
# 11. 启动入口
# ==========================================
if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("启动 FastAPI Agent 服务")
    print("=" * 60)
    print("API 文档: http://127.0.0.1:8000/docs")
    print("聊天端点: POST http://127.0.0.1:8000/chat")
    print("健康检查: GET http://127.0.0.1:8000/health")
    print("=" * 60)
    uvicorn.run(
        "day30_fastapi:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
