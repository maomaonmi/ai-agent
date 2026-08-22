"""真实 M2.7 API SSE 帧完整 dump——看 content_block 真实 type 是什么。"""

import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

API_KEY = "sk-cp-kwz3MCdKKXRpyBouzb8_1hdnNTG7Xjk3GPkMNtEp-ndzVcQG5am2xTUyGtHg1llQTOGIIwiH8EubDA_IMcCnNfWNqM7Z6Pg_Jrh98pP7T6b2vDzmsOUCTTc"
BASE_URL = "https://api.minimaxi.com/anthropic"
MODEL = "MiniMax-M2.7"

SYSTEM_PROMPT = "你是一名深度调研分析师。请用 web_search 工具调研'2026 AI Agent 行业趋势'，完成 4000+ 字报告。"
USER_QUERY = "调研主题：2026 年 AI Agent 行业的关键技术趋势与市场格局"


def dump_sse(system_value, label):
    print(f"\n{'='*70}\n[{label}]\n{'='*70}")
    payload = {
        "model": MODEL,
        "max_tokens": 16000,
        "stream": True,
        "system": system_value,
        "tools": [{"type": "web_search_20250305", "name": "web_search"}],
        "messages": [{"role": "user", "content": USER_QUERY}],
    }
    text_parts = []
    block_types_seen = {}  # index -> btype
    block_names_seen = {}  # index -> name (if any)
    block_inputs = {}      # index -> accumulated input json
    stop_reason = None
    final_usage = {}
    with httpx.Client(timeout=180.0) as http:
        with http.stream("POST", f"{BASE_URL}/v1/messages",
                         headers={"Authorization": f"Bearer {API_KEY}",
                                  "x-api-key": API_KEY,
                                  "anthropic-version": "2023-06-01",
                                  "Content-Type": "application/json"},
                         json=payload) as response:
            print(f"  HTTP status: {response.status_code}")
            if response.status_code != 200:
                body = response.read().decode("utf-8", errors="replace")
                print(f"  ERROR body: {body[:500]}")
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
                        idx = evt.get("index")
                        block = evt.get("content_block") or {}
                        btype = block.get("type", "?")
                        bname = block.get("name", "")
                        block_types_seen[idx] = btype
                        if bname:
                            block_names_seen[idx] = bname
                        print(f"  [content_block_start] idx={idx} type={btype} name={bname} "
                              f"input={json.dumps(block.get('input', {}), ensure_ascii=False)[:80]}")
                    elif etype == "content_block_delta":
                        delta = evt.get("delta") or {}
                        dtype = delta.get("type", "?")
                        if dtype == "text_delta":
                            text_parts.append(delta.get("text", ""))
                        elif dtype == "input_json_delta":
                            idx = evt.get("index")
                            block_inputs.setdefault(idx, []).append(delta.get("partial_json", ""))
                    elif etype == "content_block_stop":
                        idx = evt.get("index")
                        if idx in block_inputs:
                            full_input = "".join(block_inputs[idx])
                            print(f"  [content_block_stop] idx={idx} accumulated input={full_input[:120]}")
                    elif etype == "message_delta":
                        stop_reason = (evt.get("delta") or {}).get("stop_reason")
                        if evt.get("usage"):
                            final_usage.update(evt["usage"])
                    elif etype == "message_stop":
                        if evt.get("usage"):
                            final_usage.update(evt["usage"])
    text_chars = sum(len(t) for t in text_parts)
    print(f"\n  >>> 摘要 <<<")
    print(f"  text_chars     = {text_chars}")
    print(f"  stop_reason    = {stop_reason}")
    print(f"  output_tokens  = {final_usage.get('output_tokens')}")
    print(f"  block types    = {block_types_seen}")
    print(f"  block names    = {block_names_seen}")


def main():
    dump_sse(SYSTEM_PROMPT, "M2.7 + string system + web_search 工具（看真实 content_block type）")


if __name__ == "__main__":
    main()
