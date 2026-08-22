"""M2.7 调研链路根因诊断脚本（mock 模式，不调真实 API）。

复现 M2.7 "6 轮 web_search 后只写 75 字就停"的事件流，验证：
1. research.py 是否正确消费 message_delta 的 stop_reason
2. message_stop 的 usage.output_tokens 是否被记录
3. answer_parts 累加逻辑是否有截断
4. 诊断日志能否把"end_turn vs max_tokens"区分开

运行：python tests/_diag_m27_research.py
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from minimax import research as mm_research
from minimax.client import MiniMaxClient
from model_settings import ModelSettings


class FakeClient:
    """模拟 M2.7 真实事件流：6 轮 web_search → 只写 75 字 → end_turn。

    这是用户报告的"bug 现场"复现：
    - 6 轮 server_tool_use（搜索）+ 6 轮 web_search_tool_result（来源）
    - 1 个 thinking_delta
    - 1 个 text_delta，只输出 75 字
    - message_delta stop_reason=end_turn（关键！）
    - message_stop usage.output_tokens=27（约 75 中文字 + reasoning + 函数调用）
    """

    def __init__(self, api_key, base_url="x", timeout=1.0):
        self.api_key = api_key

    def stream_message(self, **kwargs):
        # 模拟 client.py 的归一化逻辑（list → string 提取 text）
        sys_in = kwargs.get("system")
        if isinstance(sys_in, list):
            text_chunks = []
            for block in sys_in:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_chunks.append(str(block.get("text") or ""))
            kwargs["system"] = "\n\n".join(t for t in text_chunks if t)
            print(f"[FakeClient] ✓ 模拟 client.py 归一化：list[{len(sys_in)}] → string[{len(kwargs['system'])}]")

        # 验证请求参数
        print("=" * 60)
        print("[FakeClient] 收到 stream_message 调用，参数：")
        print(f"  model          = {kwargs.get('model')}")
        print(f"  max_tokens     = {kwargs.get('max_tokens')}")
        print(f"  tool_choice    = {kwargs.get('tool_choice')}")
        print(f"  thinking       = {kwargs.get('thinking')}")
        print(f"  tools 数量     = {len(kwargs.get('tools') or [])}")
        sys_prompt = kwargs.get("system") or ""
        sys_type = "string" if isinstance(sys_prompt, str) else f"{type(sys_prompt).__name__}[{len(sys_prompt) if hasattr(sys_prompt, '__len__') else '?'}]"
        print(f"  system 类型    = {sys_type}")
        print(f"  system 长度    = {len(sys_prompt) if hasattr(sys_prompt, '__len__') else '?'} 字符")
        if isinstance(sys_prompt, str) and len(sys_prompt) > 100:
            print(f"  system 前 200 字 = {sys_prompt[:200]}")
            if "第一步必须调用" in sys_prompt:
                print("  ✓ system 含'第一步必须调用 web_search'强约束")
            if "4000" in sys_prompt:
                print("  ✓ system 含'4000 字'字数要求")
            if "禁止" in sys_prompt and "信息已充分" in sys_prompt:
                print("  ✓ system 含'禁止以信息已充分为由提前结束'硬约束")
        elif not sys_prompt:
            print("  ✗✗✗ system 为空——M2.7 兼容层可能丢弃 list 形式 system（修复后应不为空）")
        print()

        # 模拟 M2.7 实际行为：6 轮 web_search，每轮 10 条来源
        for i in range(1, 7):
            yield {
                "type": "server_tool_use",
                "block": {
                    "id": f"toolu_{i}",
                    "name": "web_search",
                    "input": {"query": f"研究主题子问题 {i}"},
                },
            }
            yield {
                "type": "web_search_tool_result",
                "block": {
                    "tool_use_id": f"toolu_{i}",
                    "content": [
                        {
                            "type": "web_search_result",
                            "url": f"https://example.com/source-{i}-{j}",
                            "title": f"来源 {i}-{j}",
                            "encrypted_content": "x" * 100,
                        }
                        for j in range(1, 11)
                    ],
                },
            }

        # 1 段 thinking（模型做了 6 轮检索后的总结思考）
        yield {
            "type": "thinking_delta",
            "index": 0,
            "text": "已检索 6 轮共 60 条来源，信息已充分，可以撰写报告。",
        }

        # 关键：只写 75 字就停（用户报告的真实现象）
        yield {
            "type": "text_delta",
            "index": 1,
            "text": "经过多轮检索，主题已较为清晰。核心结论为 X、Y、Z。详细分节论述见下文。",
        }

        # 关键：message_delta 携带 stop_reason=end_turn
        # 这是定位"模型为何提前结束"的唯一信号
        yield {
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn"},
            "usage": {
                "input_tokens": 850,
                "output_tokens": 27,
                "cache_read_input_tokens": 0,
            },
        }

        # message_stop 携带最终 usage
        yield {
            "type": "message_stop",
            "usage": {
                "input_tokens": 850,
                "output_tokens": 27,
            },
        }


def main():
    # 替换 client 为 FakeClient
    mm_research.MiniMaxClient = FakeClient

    settings = ModelSettings(
        provider="minimax",
        api_format="anthropic_messages",
        base_url="https://api.minimaxi.com/anthropic",
        model_id="MiniMax-M2.7",
        api_key="fake-key-for-diagnosis",
        max_tokens=16000,
        thinking_budget=None,  # 走默认 6K
    )

    class FakeMemory:
        def push_chat_turn(self, *a, **kw): pass
        def get_chat_window(self, *a, **kw): return []
        def maybe_summarize(self, *a, **kw): pass

    print("=" * 60)
    print("开始模拟 M2.7 调研链路（不调真实 API）...")
    print("=" * 60)
    print()

    events = []
    for ev in mm_research.generate_minimax_research_events(
        query="测试主题：M2.7 调研字数过低根因诊断",
        session_id="diag-session",
        settings=settings,
        memory_engine=FakeMemory(),
        research_options={"maxDepth": 8, "maxUrls": 60},
    ):
        events.append(ev)

    # 解析最终 done 事件
    import json
    done_answer = ""
    done_data = None
    for ev in events:
        # 格式: "event: done\ndata: {...}\n\n"
        if "event: done" in ev:
            for line in ev.split("\n"):
                if line.startswith("data:"):
                    data = json.loads(line[len("data:"):].strip())
                    if "answer" in data:
                        done_answer = data["answer"]
                        done_data = data
                    elif "total_chunks" in data and "top_chunks" in data:
                        # 第一个 done 事件：top_chunks
                        print(f"[第一个 done] total_chunks={data.get('total_chunks')}, "
                              f"total_pages={data.get('total_pages')}")
                        print()

    print("=" * 60)
    print("【根因诊断结果】")
    print("=" * 60)
    print(f"最终报告字数: {len(done_answer)} 字符")
    print(f"报告前 100 字: {done_answer[:100]}")
    print()
    print("如果诊断代码生效，后端日志应包含：")
    print('  [minimax-research] DONE model=MiniMax-M2.7 answer_chars=75 '
          'search_rounds=6 web_docs=60 stop_reason=end_turn output_tokens=27')
    print('  [minimax-research] 报告字数过低：75 字（期望 ≥4000）...')
    print()
    print("✓ 若 stop_reason=end_turn + output_tokens≈27 → 根因：M2.7 模型行为，"
          "信息已充分就停，需强化 prompt 或加续写")
    print("✓ 若 stop_reason=max_tokens + output_tokens≈9000+ → 根因：文本预算不足，"
          "需调大 max_tokens")
    print("✓ 若 stop_reason 字段缺失/None → 根因：client.py 或 research.py 字段被吞，"
          "需修复事件透传链路")


if __name__ == "__main__":
    main()
