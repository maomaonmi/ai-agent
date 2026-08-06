import json
import re
import sys
import threading
import time
from typing import Annotated, TypedDict, List, Dict, Literal
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from openai import OpenAI
from langgraph.graph import StateGraph, START, END
import gradio as gr


# ==========================================
# 1. 状态定义
# ==========================================
class GroundedState(TypedDict):
    messages: Annotated[list[BaseMessage], lambda x, y: x + y]
    retrieved_docs: List[Dict]
    final_answer: str
    correction_feedback: str
    retry_count: int
    mode: Literal["fast", "standard", "deep"]
    reasoning: str  # deepseek-reasoner 的推理过程


# ==========================================
# 2. 路由节点（仅在 UI 未强制指定模式时生效）
# ==========================================
def router_node(state: GroundedState):
    user_msg = state["messages"][0].content
    # 如果 state 中已有明确 mode（来自 UI 强制开关），跳过路由判断
    if state.get("mode") in ("deep", "standard", "fast"):
        print(f"[Node: Gateway] **UI强制模式**: {state['mode']}，跳过路由判断")
        return {}

    print(f"\n[Node: Gateway] **分析意图**: {user_msg}")
    prompt = f"""
    分析用户问题，选择处理模式：
    1. 简单问候/闲聊 -> "fast"
    2. 明确的单条维修/价格查询，且不涉及多步推理 -> "standard"
    3. 涉及以下任意特征的，必须选 "deep"：
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
# 3. 查询重写节点
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
# 4. 检索节点
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
# 5. 带引用的分析节点（深度思考 / 标准模式）
# ==========================================
def get_llm(mode: str):
    if mode == "deep":
        client = OpenAI(
            api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
            base_url="https://api.deepseek.com"
        )
        return client  # 特殊处理：deep 模式返回原生 client
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
        # 原生 OpenAI 调用 deepseek-reasoner，保留 reasoning 字段
        client = llm  # get_llm 返回原生 OpenAI client
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
# 6. 语义级证据审计节点
# ==========================================
def semantic_citation_auditor(state: GroundedState):
    print("[Node: Auditor] 正在进行语义级证据审计...")
    answer = state["final_answer"]
    docs_list = state["retrieved_docs"]
    docs_dict = {str(d['id']): d['text'] for d in docs_list}
    user_query = state["messages"][0].content

    check_prompt = f"问题: {user_query}\n资料: {docs_list}\n这些资料能完整回答问题吗？只需回复 YES 或 NO。"
    res = ChatOpenAI(
        model="deepseek-chat",
        api_key="sk-6d31f71ec3514f6785e28fa00ea03199",
        base_url="https://api.deepseek.com"
    ).invoke([SystemMessage(content=check_prompt)])

    if "NO" in res.content:
        return {"correction_feedback": "检索资料不足以完整回答问题，请触发重新搜索。"}

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
# 7. 构建 LangGraph
# ==========================================
MAX_RETRIES = 3


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


app = None  # 懒加载：首次请求时才编译


def get_app():
    global app
    if app is None:
        workflow = StateGraph(GroundedState)
        workflow.add_node("router", router_node)
        workflow.add_node("rewrite", query_rewriter_node)
        workflow.add_node("retrieve", retrieval_node)
        workflow.add_node("analyst", grounded_analyst_node)
        workflow.add_node("validator", semantic_citation_auditor)

        workflow.add_edge(START, "router")
        workflow.add_edge("router", "rewrite")
        workflow.add_edge("rewrite", "retrieve")
        workflow.add_edge("retrieve", "analyst")
        workflow.add_edge("analyst", "validator")
        workflow.add_conditional_edges(
            "validator",
            should_continue,
            {"retry": "analyst", "max_retries": END, "pass": END},
        )
        app = workflow.compile()
        print("[System] LangGraph 编译完成")
    return app


# ==========================================
# 8. Gradio 聊天回调（定义在 app 之后）
# ==========================================

def chat_interface(user_input: str, chat_history: list, force_deep_mode: bool):
    mode = "deep" if force_deep_mode else "standard"
    print(f"\n[Gradio] **MODE**: {mode} | 问题: {user_input}")

    inputs = {
        "messages": [HumanMessage(content=user_input)],
        "mode": mode,
        "reasoning": "",
        "retry_count": 0,
    }

    final_response = ""
    all_reasoning = [] if mode == "deep" else ""
    reason_display = "*(深度思考模式未启用)*"

    # 双重保险：防止 validator 永不通过导致 stream 无限循环
    max_stream_steps = 30  # 最大流步数（analyst + validator 算一组，30 组足够）
    stream_step = 0
    start_time = time.time()
    max_seconds = 120      # 超时 2 分钟强制结束

    for event in get_app().stream(inputs):
        stream_step += 1
        print(f"[chat_interface] step={stream_step}, event_keys={list(event.keys())}")
        for node_name, output in event.items():
            if output is None:
                continue
            if "final_answer" in output and output["final_answer"]:
                final_response = output["final_answer"]
                print(f"[chat_interface] ✓ 捕获 final_answer ({len(output['final_answer'])} 字)")
            if mode == "deep" and "reasoning" in output and output["reasoning"]:
                all_reasoning.append(output["reasoning"])
                print(f"[chat_interface] ✓ 捕获 reasoning (第 {len(all_reasoning)} 次)")

        # 安全检查：超时或步数超限则强制退出
        if stream_step >= max_stream_steps:
            print(f"[chat_interface] 达到最大步数 {max_stream_steps}，强制退出流循环")
            break
        if time.time() - start_time > max_seconds:
            print(f"[chat_interface] 运行超过 {max_seconds} 秒，超时强制退出")
            break

    print(f"[chat_interface] 流结束，共 {stream_step} 步，final_response={len(final_response)} 字")

    if mode == "deep" and all_reasoning:
        reason_display = f"## 🧠 深度思考过程（共 {len(all_reasoning)} 次尝试）\n\n---\n\n"
        for i, r in enumerate(all_reasoning, 1):
            reason_display += f"**第 {i} 次尝试**\n\n{r}\n\n---\n\n"
    elif mode == "deep":
        reason_display = "*（推理过程为空，模型未返回 thinking 内容）*"

    chat_history.append({"role": "user", "content": user_input})
    chat_history.append({"role": "assistant", "content": final_response})

    print(f"[chat_interface] ✅ 函数返回完成，history长度={len(chat_history)}")
    return chat_history, reason_display


# ==========================================
# 9. Gradio 界面
# ==========================================
with gr.Blocks(title="登神长阶 - 手机管家 Pro") as demo:
    gr.Markdown("# 👔 手机管家专家诊断系统")
    gr.Markdown("*基于 LangGraph 多节点推理 + DeepSeek R1 深度思考*")

    with gr.Row(equal_height=False):
        # ---------- 左侧：对话区 ----------
        with gr.Column(scale=3):
            chatbot_ui = gr.Chatbot(
                label="💬 对话历史",
                height=520,
            )
            with gr.Row():
                msg_input = gr.Textbox(
                    label="输入您的问题",
                    placeholder="例如：我只有100元，该怎么修屏幕？",
                    scale=4,
                    lines=2
                )
                send_btn = gr.Button("发送", variant="primary", scale=1)

            # 处理状态显示组件
            status_text = gr.HTML(
                value='<div style="color: #666; font-size: 14px; margin-top: 8px;">✨ 准备就绪，请输入您的问题</div>',
                elem_id="status-display"
            )

        # ---------- 右侧：控制面板 ----------
        with gr.Column(scale=1, min_width=280):
            gr.Markdown("### 🔧 控制面板")
            mode_selector = gr.Radio(
                ["标准模式 (快速)", "深度思考模式 (R1)"],
                value="标准模式 (快速)",
                label="选择回答模式"
            )
            gr.Markdown(
                "**💡 说明**：标准模式响应快，适合简单查询；深度思考模式会调用 R1 模型并展示推理过程，适合复杂问题。"
            )
            gr.Markdown("---")

            with gr.Accordion("🧠 推理过程展示", open=False, visible=True) as reason_accordion:
                reasoning_display = gr.Markdown(
                    value="*点击发送后，深度思考的推理过程将在此展开...*",
                    elem_id="reasoning-box"
                )
            reasoning_display.scale = 0

            clear_btn = gr.Button("🗑️ 清空对话", variant="secondary")

    def on_send(user_msg, history, mode_radio):
        if not user_msg.strip():
            return (
                history,
                "",
                "*(深度思考模式未启用)*",
                '<div style="color: orange; font-size: 14px;">⚠️ 请输入问题后再发送</div>'
            )

        force_deep = (mode_radio == "深度思考模式 (R1)")
        history, reason_text = chat_interface(user_msg, history, force_deep)
        return (
            history,
            "",
            reason_text,
            '<div style="color: green; font-size: 14px;">✅ 处理完成！</div>'
        )

    send_btn.click(
        on_send,
        inputs=[msg_input, chatbot_ui, mode_selector],
        outputs=[chatbot_ui, msg_input, reasoning_display, status_text]
    )
    msg_input.submit(
        on_send,
        inputs=[msg_input, chatbot_ui, mode_selector],
        outputs=[chatbot_ui, msg_input, reasoning_display, status_text]
    )

    clear_btn.click(
        lambda: ([], "", "*(深度思考模式未启用)*", '<div style="color: #666; font-size: 14px;">✨ 准备就绪'),
        outputs=[chatbot_ui, msg_input, reasoning_display, status_text]
    )

def main():
    get_app()  # 预热：首次编译图
    print("[System] Gradio 启动中，请访问 http://127.0.0.1:7862", flush=True)
    t = threading.Thread(target=demo.launch, kwargs={
        "server_name": "127.0.0.1",
        "server_port": 7862,
        "inbrowser": True,
        "share": False,
    }, daemon=True)
    t.start()
    t.join()  # 等待用户 Ctrl+C


if __name__ == "__main__":
    main()
