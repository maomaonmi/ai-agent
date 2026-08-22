"""复现 research.py 4xx 降级后的真实 payload 跑 M2.7，看 server_tool_use 事件。"""

import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

API_KEY = "sk-cp-kwz3MCdKKXRpyBouzb8_1hdnNTG7Xjk3GPkMNtEp-ndzVcQG5am2xTUyGtHg1llQTOGIIwiH8EubDA_IMcCnNfWNqM7Z6Pg_Jrh98pP7T6b2vDzmsOUCTTc"
BASE_URL = "https://api.minimaxi.com/anthropic"
MODEL = "MiniMax-M2.7"

# 复现 research.py 真实 payload：list+cache+thinking=6K+无 tool_choice
SYSTEM_PROMPT = """你是一名专业深度调研分析师。请围绕用户给定的研究主题，完成一次系统性调研并输出结构化报告。

## 🔒 强约束（违反任一即视为失败）
0. 报告总长度 ≥ 4000 字
1. 第一步必须调用 web_search 工具
2. 至少进行 2 轮 web_search
3. 每个关键论断必须带引用编号
4. 禁止编造来源
5. 禁止只输出章节标题骨架"""

USER_QUERY = "调研主题：2026 年 AI Agent 行业的关键技术趋势与市场格局分析"


def dump_sse(label, payload):
    print(f"\n{'='*70}\n[{label}]\n{'='*70}")
    print(f"  system type: {'list' if isinstance(payload.get('system'), list) else 'string'}")
    print(f"  tool_choice: {payload.get('tool_choice', 'NOT SET')}")
    text_chars = 0
    block_types = []
    block_names = []
    tool_use_blocks = []
    server_tool_use_blocks = []
    web_search_results = []
    stop_reason = None
    final_usage = {}
    try:
        with httpx.Client(timeout=180.0) as http:
            with http.stream("POST", f"{BASE_URL}/v1/messages",
                             headers={"Authorization": f"Bearer {API_KEY}",
                                      "x-api-key": API_KEY,
                                      "anthropic-version": "2023-06-01",
                                      "Content-Type": "application/json"},
                             json=payload) as response:
                print(f"  HTTP: {response.status_code}")
                if response.status_code != 200:
                    body = response.read().decode("utf-8", errors="replace")
                    print(f"  ERROR: {body[:300]}")
                    return
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
                        if line == "data: [DONE]":
                            continue
                        try:
                            evt = json.loads(line[len("data:"):].strip())
                        except json.JSONDecodeError:
                            continue
                        etype = evt.get("type", "")
                        if etype == "content_block_start":
                            b = evt.get("content_block") or {}
                            block_types.append(b.get("type", "?"))
                            if b.get("name"):
                                block_names.append(b.get("name"))
                            if b.get("type") == "tool_use":
                                tool_use_blocks.append({"name": b.get("name"), "id": b.get("id", "")[:20]})
                            if b.get("type") == "server_tool_use":
                                server_tool_use_blocks.append({"name": b.get("name"), "id": b.get("id", "")[:20]})
                            if b.get("type") == "web_search_tool_result":
                                web_search_results.append(len(b.get("content", [])))
                        elif etype == "content_block_delta":
                            d = evt.get("delta") or {}
                            if d.get("type") == "text_delta":
                                text_chars += len(d.get("text", ""))
                        elif etype == "message_delta":
                            stop_reason = (evt.get("delta") or {}).get("stop_reason")
                            if evt.get("usage"):
                                final_usage.update(evt["usage"])
                        elif etype == "message_stop":
                            if evt.get("usage"):
                                final_usage.update(evt["usage"])
    except Exception as e:
        print(f"  EXC: {type(e).__name__}: {e}")
    print(f"\n  >>> 结果 <<<")
    print(f"  text_chars       = {text_chars}")
    print(f"  stop_reason      = {stop_reason}")
    print(f"  output_tokens    = {final_usage.get('output_tokens')}")
    print(f"  block_types      = {block_types}")
    print(f"  block_names      = {block_names}")
    print(f"  tool_use         = {len(tool_use_blocks)} 个: {tool_use_blocks[:3]}")
    print(f"  server_tool_use  = {len(server_tool_use_blocks)} 个: {server_tool_use_blocks[:3]}")
    print(f"  web_search_results = {web_search_results}（每块含多少 results）")


def main():
    web_search_tool = [{"type": "web_search_20250305", "name": "web_search"}]
    thinking_6k = {"type": "enabled", "budget_tokens": 6144}
    system_list = [{
        "type": "text",
        "text": SYSTEM_PROMPT,
        "cache_control": {"type": "ephemeral"},
    }]

    # ---- 复现 research.py 4xx 降级后的真实 payload ----
    # 真实路径：先 tool_choice=any 试 → 400 → 降级无 tool_choice
    payload_real = {
        "model": MODEL,
        "max_tokens": 16000,
        "stream": True,
        "system": system_list,  # list+cache（research.py 真实下发形态）
        "tools": web_search_tool,
        "thinking": thinking_6k,
        # ⚠️ 注意：没有 tool_choice（降级后）
        "messages": [{"role": "user", "content": USER_QUERY}],
    }
    dump_sse("research.py 真实降级后 payload：list+cache+thinking+无 tool_choice", payload_real)


if __name__ == "__main__":
    main()
