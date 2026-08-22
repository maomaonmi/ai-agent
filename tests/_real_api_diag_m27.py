"""真实 M2.7 API 调用诊断：不绕任何 wrapper，直接 hit 端点看 stop_reason。

目标：确认 M2.7 在 list 形式 system vs string 形式 system 下的实际行为差异。

运行：python tests/_real_api_diag_m27.py
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

API_KEY = "sk-cp-kwz3MCdKKXRpyBouzb8_1hdnNTG7Xjk3GPkMNtEp-ndzVcQG5am2xTUyGtHg1llQTOGIIwiH8EubDA_IMcCnNfWNqM7Z6Pg_Jrh98pP7T6b2vDzmsOUCTTc"
BASE_URL = "https://api.minimaxi.com/anthropic"
MODEL = "MiniMax-M2.7"

SYSTEM_PROMPT = """你是一名专业深度调研分析师。请围绕用户给定的研究主题，完成一次系统性调研并输出结构化报告。

## 🔒 强约束（违反任一即视为失败）
0. **报告总长度 ≥ 4000 字（中文字符）**——禁止以"信息已充分"、"篇幅有限"、"已达成研究目标"等任何理由提前结束。
1. **第一步必须调用 web_search 工具**——禁止在未调用 web_search 的情况下直接撰写报告。
2. **至少进行 2 轮 web_search**——先泛搜建立全貌，再针对薄弱点精搜补齐。
3. **每个关键论断必须带引用编号 [n]**，引用编号对应文末"参考来源"列表。
4. **禁止编造来源**——搜索结果不足时必须明确说明信息缺口。
5. **禁止只输出章节标题骨架**——每个二级章节必须包含 200-400 字正文段落。

撰写正文时必须写满全部章节才允许结束，禁止以"信息已充分"为由提前结束。"""

USER_QUERY = "调研主题：2026 年 AI Agent 行业的关键技术趋势与市场格局分析（请用 6 轮 web_search 多角度调研）"


def call_minimax(system_value, label, *, tool_choice="any", thinking=None, tools=None,
                 use_cache=False):
    """打一次真实 API，返回 (text_chars, stop_reason, output_tokens, error)。"""
    print(f"\n{'='*70}")
    print(f"[测试 {label}]")
    print(f"  system 类型: {'list' if isinstance(system_value, list) else 'string'}, "
          f"长度: {len(system_value) if isinstance(system_value, str) else len(system_value)}")
    print(f"  tool_choice: {tool_choice}")
    print(f"  thinking: {thinking}")
    print(f"  use_cache: {use_cache}")
    print(f"{'='*70}")

    if use_cache and isinstance(system_value, str):
        system_value = [{"type": "text", "text": system_value, "cache_control": {"type": "ephemeral"}}]

    payload = {
        "model": MODEL,
        "max_tokens": 16000,
        "stream": True,
        "system": system_value,
        "messages": [
            {"role": "user", "content": USER_QUERY},
        ],
    }
    if thinking:
        payload["thinking"] = thinking
    if tools:
        payload["tools"] = tools
        if tool_choice is not None:
            payload["tool_choice"] = tool_choice

    text_parts = []
    thinking_parts = []
    search_rounds = 0
    stop_reason = None
    final_usage = {}
    error_msg = None
    last_evt_type = None

    try:
        with httpx.Client(timeout=180.0) as http:
            with http.stream("POST", f"{BASE_URL}/v1/messages",
                             headers={
                                 "Authorization": f"Bearer {API_KEY}",
                                 "x-api-key": API_KEY,
                                 "anthropic-version": "2023-06-01",
                                 "Content-Type": "application/json",
                             },
                             json=payload) as response:
                if response.status_code != 200:
                    body = response.read().decode("utf-8", errors="replace")
                    return (0, None, None, f"HTTP {response.status_code}: {body[:300]}")
                buf = bytearray()
                for raw_chunk in response.iter_bytes():
                    if not raw_chunk:
                        continue
                    buf.extend(raw_chunk)
                    while True:
                        nl = buf.find(b"\n")
                        if nl == -1:
                            break
                        line = bytes(buf[:nl]).decode("utf-8", errors="replace").rstrip("\r\n")
                        del buf[:nl + 1]
                        if not line or not line.startswith("data:"):
                            continue
                        try:
                            evt = json.loads(line[len("data:"):].strip())
                        except json.JSONDecodeError:
                            continue
                        evt_type = evt.get("type", "")
                        last_evt_type = evt_type
                        if evt_type == "content_block_start":
                            block = evt.get("content_block") or {}
                            if block.get("type") == "server_tool_use":
                                search_rounds += 1
                                print(f"  [server_tool_use] 第 {search_rounds} 轮搜索: "
                                      f"{(block.get('input') or {}).get('query', '?')[:50]}")
                        elif evt_type == "content_block_delta":
                            delta = evt.get("delta") or {}
                            if delta.get("type") == "text_delta":
                                text_parts.append(delta.get("text", ""))
                            elif delta.get("type") == "thinking_delta":
                                thinking_parts.append(delta.get("thinking", ""))
                        elif evt_type == "message_delta":
                            stop_reason = (evt.get("delta") or {}).get("stop_reason")
                            if evt.get("usage"):
                                final_usage.update(evt["usage"])
                                print(f"  [message_delta] stop_reason={stop_reason} usage={evt.get('usage')}")
                        elif evt_type == "message_stop":
                            if evt.get("usage"):
                                final_usage.update(evt["usage"])
                            print(f"  [message_stop] final usage={final_usage}")
    except Exception as e:
        error_msg = f"{type(e).__name__}: {e}"

    text_chars = sum(len(t) for t in text_parts)
    thinking_chars = sum(len(t) for t in thinking_parts)
    print(f"\n  >>> 结果摘要 <<<")
    print(f"  text_chars        = {text_chars}")
    print(f"  thinking_chars    = {thinking_chars}")
    print(f"  search_rounds     = {search_rounds}")
    print(f"  stop_reason       = {stop_reason}")
    print(f"  output_tokens     = {final_usage.get('output_tokens')}")
    print(f"  last_evt_type     = {last_evt_type}")
    if error_msg:
        print(f"  ERROR             = {error_msg}")
    return (text_chars, stop_reason, final_usage.get("output_tokens"), error_msg)


def main():
    web_search_tool = [{"type": "web_search_20250305", "name": "web_search"}]
    thinking_6k = {"type": "enabled", "budget_tokens": 6144}

    # 先跑 E baseline（最简单）——排除是 system 格式导致的 400
    rE = call_minimax(
        system_value=SYSTEM_PROMPT,
        label="E: string + 无 tool_choice + 无 thinking（baseline）",
        tool_choice=None,
        thinking=None,
        tools=web_search_tool,
    )

    # 再跑 C（修复后形态）
    rC = call_minimax(
        system_value=SYSTEM_PROMPT,
        label="C: string + tool_choice=dict + thinking",
        tool_choice={"type": "any"},
        thinking=thinking_6k,
        tools=web_search_tool,
    )

    # 最后跑 A（修复前 list 形式）
    rA = call_minimax(
        system_value=[
            {"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}
        ],
        label="A: list+cache + tool_choice=str + thinking",
        tool_choice="any",
        thinking=thinking_6k,
        tools=web_search_tool,
    )

    print("\n" + "="*70)
    print("【对比结论】")
    print("="*70)
    print(f"  E (string+无tc+无think): text={rE[0]:>5}  stop={rE[1]}  out_tok={rE[2]}")
    print(f"  C (string+tc=dict):      text={rC[0]:>5}  stop={rC[1]}  out_tok={rC[2]}")
    print(f"  A (list+cache+tc=str):   text={rA[0]:>5}  stop={rA[1]}  out_tok={rA[2]}")
    for label, r in [("E", rE), ("C", rC), ("A", rA)]:
        if r[3]:
            print(f"  {label} ERROR: {r[3][:200]}")


if __name__ == "__main__":
    main()
