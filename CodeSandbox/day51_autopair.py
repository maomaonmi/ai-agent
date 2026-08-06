"""
Day 50: 自修复循环
------------------
在 Day 49 的基础上新增：
- /api/fix 接口：接收「原代码 + 报错信息」，让模型只修复问题，不重写整个文件
- 把 /api/generate 和 /api/fix 共用的"调用 LLM 并流式返回"逻辑抽成一个函数

运行方式和 Day 49 完全一致：
  uvicorn app:app --reload --port 8000
"""

import os
import json
import asyncio
from typing import AsyncGenerator
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static", html=True), name="static")

client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY", "sk-placeholder"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
)

MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o-mini")


# ---------------- 生成模式的系统提示词 ----------------
GENERATE_SYSTEM_PROMPT = """你是一个专业的前端代码生成助手。

严格规则:
1. 只输出一份完整的、可以直接在浏览器运行的 HTML 文件。
2. CSS 写在 <style> 标签内,JS 写在 <script> 标签内,全部内嵌在同一个 HTML 文件里。
3. 不要输出任何解释性文字、不要用 Markdown 代码块包裹(不要出现 ```html 这种标记)。
4. 输出必须以 <!DOCTYPE html> 开头,以 </html> 结尾。
5. 代码要能独立运行,不依赖外部文件。可以使用 CDN 引入的库(如 https://cdnjs.cloudflare.com)。
"""

# ---------------- 修复模式的系统提示词（今天新增的核心）----------------
FIX_SYSTEM_PROMPT = """你是一个专业的前端代码修复助手。

你会收到两部分输入：
1. 一份完整的 HTML 代码（可能包含内嵌 CSS/JS）
2. 该代码在浏览器中实际运行时产生的报错信息

严格规则：
1. 只修复导致报错的具体问题，不要重写整个文件、不要改变原有的设计风格和已实现的功能。
2. 如果报错信息指向了明确的行号或变量名，优先做最小范围的改动。
3. 输出规则与生成模式完全一致：
   - 只输出修复后的完整 HTML 代码本身，不要任何解释文字
   - 不要用 Markdown 代码块包裹（不要出现 ```html 这种标记）
   - 必须以 <!DOCTYPE html> 开头，以 </html> 结尾
4. 如果报错信息不足以精确定位问题，基于代码逻辑做出最合理的推断和修复。
"""


# ---------------- 迭代修改模式的系统提示词（Day 51 新增）----------------
MODIFY_SYSTEM_PROMPT = """你是一个专业的前端代码迭代助手。

你会收到两部分输入：
1. 当前完整的 HTML 代码（可能包含内嵌 CSS/JS）
2. 用户提出的一条修改指令（比如"把按钮颜色改成红色"、"加一个删除按钮"）

严格规则：
1. 只根据这条指令做增量修改，不要重写整个文件，不要改变指令之外的任何已有功能、样式和布局。
2. 如果指令和现有代码存在冲突，或指令表述不够清晰，做出最合理的推断，优先保证现有功能不被破坏。
3. 输出规则与生成/修复模式完全一致：
   - 只输出修改后的完整 HTML 代码本身，不要任何解释文字
   - 不要用 Markdown 代码块包裹（不要出现 ```html 这种标记）
   - 必须以 <!DOCTYPE html> 开头，以 </html> 结尾
"""


def _sse_payload(code: str, done: bool) -> str:
    """统一 SSE 消息格式，生成和修复两个接口共用"""
    payload = json.dumps({"type": "code_update", "code": code, "done": done})
    return f"data: {payload}\n\n"


async def stream_llm_response(messages: list) -> AsyncGenerator[str, None]:
    """
    公共的"调用 LLM 并流式吐出 SSE"逻辑。
    /api/generate 和 /api/fix 都调这个函数，只是传入的 messages 不同。
    """
    accumulated = ""

    stream = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=messages,
        stream=True,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            accumulated += delta
            yield _sse_payload(accumulated, done=False)
            await asyncio.sleep(0.01)

    yield _sse_payload(accumulated, done=True)


@app.post("/api/generate")
async def generate(request: Request):
    body = await request.json()
    user_prompt = body.get("prompt", "")

    if not user_prompt.strip():
        return {"error": "prompt 不能为空"}

    messages = [
        {"role": "system", "content": GENERATE_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    return StreamingResponse(
        stream_llm_response(messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.post("/api/fix")
async def fix(request: Request):
    """
    今天新增的核心接口。
    输入：{ "code": "原始 HTML 代码", "error": "浏览器捕获到的报错信息" }
    输出：和 /api/generate 一样的 SSE 流，前端可以直接复用同一套解析逻辑
    """
    body = await request.json()
    code = body.get("code", "")
    error = body.get("error", "")

    if not code.strip():
        return {"error": "code 不能为空"}

    user_message = (
        f"以下代码在浏览器中运行时报错，请修复。\n\n"
        f"【报错信息】\n{error}\n\n"
        f"【原始代码】\n{code}"
    )

    messages = [
        {"role": "system", "content": FIX_SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]

    return StreamingResponse(
        stream_llm_response(messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.post("/api/modify")
async def modify(request: Request):
    """
    Day 51 新增的核心接口。
    输入：{ "code": "当前完整代码", "instruction": "一句修改指令" }
    输出：和 /api/generate、/api/fix 完全一样的 SSE 流，前端可以复用同一套解析逻辑。
    """
    body = await request.json()
    code = body.get("code", "")
    instruction = body.get("instruction", "")

    if not code.strip() or not instruction.strip():
        return {"error": "code 和 instruction 都不能为空"}

    user_message = (
        f"当前代码如下：\n\n{code}\n\n"
        f"请根据这条指令进行修改：\n{instruction}"
    )

    messages = [
        {"role": "system", "content": MODIFY_SYSTEM_PROMPT},
        {"role": "user", "content": user_message},
    ]

    return StreamingResponse(
        stream_llm_response(messages),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@app.get("/")
async def root():
    return {"status": "ok", "message": "访问 /static/index.html 或跑 frontend-tsx"}