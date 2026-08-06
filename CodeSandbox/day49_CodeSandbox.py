"""
Day 49: Code 模式最小骨架
------------------------
核心流程:
1. 用户输入需求 -> POST /api/generate
2. 后端调用 LLM,要求只输出一份完整的 HTML(内嵌 CSS/JS)
3. 用 SSE (text/event-stream) 把生成过程流式推给前端
4. 前端把最终代码写入 iframe.srcdoc,浏览器自动渲染

运行方式:
  pip install fastapi uvicorn openai --break-system-packages
  export OPENAI_API_KEY=你的key   # 或改成 DeepSeek/其他兼容 OpenAI 协议的 base_url
  uvicorn app:app --reload --port 8000
"""

import os
import json
import asyncio
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

# 挂载前端静态文件
app.mount("/static", StaticFiles(directory="static", html=True), name="static")

# ---- LLM 客户端 ----
# 换成 DeepSeek / Kimi / GLM 只需改 base_url 和 model 名字
client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY", "sk-placeholder"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
)

MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o-mini")

# ---- 系统提示词:这是 Code 模式的"独家秘方"起点 ----
SYSTEM_PROMPT = """你是一个专业的前端代码生成助手。

严格规则:
1. 只输出一份完整的、可以直接在浏览器运行的 HTML 文件。
2. CSS 写在 <style> 标签内,JS 写在 <script> 标签内,全部内嵌在同一个 HTML 文件里。
3. 不要输出任何解释性文字、不要用 Markdown 代码块包裹(不要出现 ```html 这种标记)。
4. 输出必须以 <!DOCTYPE html> 开头,以 </html> 结尾。
5. 代码要能独立运行,不依赖外部文件。可以使用 CDN 引入的库(如 https://cdnjs.cloudflare.com)。
"""


async def generate_code_stream(user_prompt: str):
    """调用 LLM 流式生成代码,并以 SSE 格式逐块推送"""

    accumulated = ""

    stream = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        stream=True,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            accumulated += delta
            # 每次推送的是"目前累积的完整代码",而不是增量
            # 这样前端可以直接整体替换 iframe 内容,逻辑更简单
            payload = json.dumps({
                "type": "code_update",
                "code": accumulated,
                "done": False,
            })
            yield f"data: {payload}\n\n"
            # 轻微延迟避免推送过于密集(可按需调整或去掉)
            await asyncio.sleep(0.01)

    # 生成结束,发送完成信号
    final_payload = json.dumps({
        "type": "code_update",
        "code": accumulated,
        "done": True,
    })
    yield f"data: {final_payload}\n\n"


@app.post("/api/generate")
async def generate(request: Request):
    body = await request.json()
    user_prompt = body.get("prompt", "")

    if not user_prompt.strip():
        return {"error": "prompt 不能为空"}

    return StreamingResponse(
        generate_code_stream(user_prompt),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/")
async def root():
    return {"status": "ok", "message": "访问 /static/index.html 使用界面"}