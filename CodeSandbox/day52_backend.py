"""
Day 52: 结合目标 DOM 元素上下文的精准增量修改 API
启动: uvicorn day52_backend:app --reload --port 8000
"""

import os
import re
from typing import Optional, Dict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "")
llm = ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")

app = FastAPI(title="Day 52 Code Modification API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

class TargetElement(BaseModel):
    tagName: str
    className: str
    id: str
    outerHTML: str

class ModifyRequest(BaseModel):
    current_code: str
    instruction: str
    target_element: Optional[TargetElement] = None

@app.post("/api/modify")
async def modify_code_endpoint(req: ModifyRequest):
    if not req.current_code.strip() or not req.instruction.strip():
        return HTTPException(status_code=400, detail="current_code 和 instruction 都不能为空")

    #1. 组装针对特定 DOM 元素的精准定位和提示词
    element_context = ""
    if req.target_element:
        element_context = f"""
        【目标元素DOM定位】：
        - 标签： <req.target_element.tagName>
        - Class: <req.target_element.className>
        - ID: <req.target_element.id>
        - 选中代码片段：{req.target_element.outerHTML}

    用户要求【仅针对上述选中的 DOM 元素】及其直接关联样式进行修改。
    """
    system_prompt = f"""你是一个极其精密的 HTML/CSS/JS 代码增量修改引擎。
    【用户修改要求】：{req.instruction}
    {element_context}

    【约束规范】：
    1. 仔细阅读【当前完整代码】，精确定位到用户要求修改或选中的 DOM 元素及其 CSS/JS 位置。
    2. 仅对需要修改的部分进行 Surgical（手术式）改动，保持其他无关页面的布局、节点和逻辑 100% 原封不动！
    3. 必须输出完整的、可以直接在 iframe 中运行的 HTML 代码。不要有任何解释文字或 Markdown 代码块标记以外的内容。
    """

    user_message= f"【当前完整代码】：\n{req.current_code}"

    try:
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_message)
        ])

        #提取 clean HTML
        raw_output = response.content
        clean_code = re.sub(r'```html|```', '', raw_output).strip()

        return {
            "status": "success",
            "modified_code": clean_code
        }
    except Exception as e:
        return HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("day52_backend:app", host="0.0.0.0", port=8000, reload=True)

