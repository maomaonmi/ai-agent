"""验证两段式调研链路：阶段1搜索收集材料 → 阶段2塞材料写长报告。

若阶段2 text_chars ≥ 3000，则两段式方案可行，research.py 按此改造。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

API_KEY = "sk-cp-kwz3MCdKKXRpyBouzb8_1hdnNTG7Xjk3GPkMNtEp-ndzVcQG5am2xTUyGtHg1llQTOGIIwiH8EubDA_IMcCnNfWNqM7Z6Pg_Jrh98pP7T6b2vDzmsOUCTTc"
BASE_URL = "https://api.minimaxi.com/anthropic"
MODEL = "MiniMax-M3"

USER_QUERY = "人工智能陪伴型机器人是否会取代人类女性作为伴侣的作用，2038年是否会出现像底特律变人中的场景"

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "x-api-key": API_KEY,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
}


def stream(payload: dict):
    """跑一次流式请求，返回 (text, blocks, search_results, stop_reason)。"""
    text_parts: list[str] = []
    blocks: list[str] = []
    search_results: list[dict] = []
    stop_reason = None
    with httpx.Client(timeout=300.0) as http:
        with http.stream("POST", f"{BASE_URL}/v1/messages", headers=HEADERS, json=payload) as response:
            if response.status_code != 200:
                print("  HTTP ERROR:", response.status_code,
                      response.read().decode("utf-8", errors="replace")[:200])
                return "", [], [], None
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
                    etype = evt.get("type", "")
                    if etype == "content_block_start":
                        b = evt.get("content_block") or {}
                        bt = b.get("type", "?")
                        blocks.append(bt)
                        if bt == "web_search_tool_result":
                            for item in b.get("content") or []:
                                if isinstance(item, dict):
                                    search_results.append({
                                        "title": str(item.get("title") or ""),
                                        "url": str(item.get("url") or ""),
                                        "snippet": str(item.get("content") or "")[:400],
                                    })
                    elif etype == "content_block_delta":
                        d = evt.get("delta") or {}
                        if d.get("type") == "text_delta":
                            text_parts.append(d.get("text", ""))
                    elif etype == "message_delta":
                        stop_reason = (evt.get("delta") or {}).get("stop_reason")
    return "".join(text_parts), blocks, search_results, stop_reason


def main() -> None:
    web_tool = [{"type": "web_search_20250305", "name": "web_search"}]

    # ---- 阶段1：只搜索，不要求写报告 ----
    print("=" * 70)
    print("[阶段1] 搜索收集材料")
    print("=" * 70)
    text1, blocks1, docs, sr1 = stream({
        "model": MODEL, "max_tokens": 8192, "stream": True,
        "system": "你是调研助手。请围绕用户主题进行 3-5 轮 web_search 检索，"
                  "每轮搜索后简短说明进展即可，无需撰写报告。",
        "tools": web_tool,
        "messages": [{"role": "user", "content": USER_QUERY}],
    })
    print(f"  阶段1：text={len(text1)} 字，search_results={len(docs)} 条，stop={sr1}")

    if not docs:
        print("  阶段1 无搜索结果，终止")
        return

    # ---- 阶段2：塞材料写报告 ----
    print("\n" + "=" * 70)
    print(f"[阶段2] 塞 {len(docs)} 条材料写 4000 字报告")
    print("=" * 70)
    material_lines = []
    for i, d in enumerate(docs[:20], 1):  # 控制 prompt 长度：最多 20 条
        material_lines.append(f"[{i}] {d['title']}\n    URL: {d['url']}\n    摘要: {d['snippet']}")
    materials = "\n".join(material_lines)

    # Why: 阶段2 不传 tools，system 用纯写作指令（完整模板含"第一步必须调
    #   web_search"，无 tools 时会造成指令冲突）。
    text2, blocks2, _, sr2 = stream({
        "model": MODEL, "max_tokens": 16000, "stream": True,
        "system": (
            "你是专业深度调研分析师。基于用户提供的已检索材料撰写结构化调研报告。\n"
            "## 强约束\n"
            "0. 报告总长度 ≥ 4000 字（中文字符），禁止以任何理由提前结束。\n"
            "1. 每个关键论断带引用编号 [n]，对应材料序号。\n"
            "2. 禁止只输出章节标题骨架，每节必须 200-400 字正文。\n"
            "## 报告结构（Markdown，6 节齐全且每节 ≥300 字正文）\n"
            "1. 核心结论（≤200 字）\n2. 背景与范围（≥300 字）\n"
            "3. 分节论述（3-6 节，每节 ≥400 字、3-5 个完整段落）\n"
            "4. 数据与证据表（≥300 字）\n5. 分歧与不确定性（≥300 字）\n"
            "6. 参考来源（[n] 标题 - URL）"
        ),
        "thinking": {"type": "enabled", "budget_tokens": 6144},
        "messages": [{
            "role": "user",
            "content": (
                f"研究主题：{USER_QUERY}\n\n"
                f"以下是已检索到的 {min(len(docs), 20)} 条网络材料：\n{materials}\n\n"
                "请基于以上材料撰写完整调研报告（≥4000 字，6 节齐全，带引用编号 [n] 对应材料序号）。"
            ),
        }],
    })
    print(f"  阶段2：text={len(text2)} 字，stop={sr2}")
    print(f"  报告前 400 字：{text2[:400]!r}")
    print(f"\n>>> 结论：两段式 {'可行' if len(text2) >= 3000 else '不可行'}"
          f"（阶段2 {len(text2)} 字）")


if __name__ == "__main__":
    main()
