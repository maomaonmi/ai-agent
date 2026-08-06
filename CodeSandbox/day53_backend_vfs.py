"""
Day 53: 多文件 VFS 智能生成与增量修改 Backend API
启动: uvicorn day53_backend_vfs:app --reload --port 8000
"""

import os
import re
import json
from typing import Dict, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")
llm = ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")

app = FastAPI(title="Day 53 Multi-File VFS Backend API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.post("/api/modify_vfs")
async def modify_vfs(req: ModifyVFSRequest):
    if not req.vfs or not req.instruction.strip():
        raise HTTPException(status_code=400, detail="VFS 或指令不能为空")

    element_ctx = ""
    if req.target_element:
        element_ctx = f"【目标选中 DOM 元素】：<{req.target_element.get('tagName')}> {req.target_element.get('outerHTML')}"

    system_prompt = f"""
    你是一个高级多文件前端代码架构师。
    你的任务是根据用糊的【修改要求】，对提供的【多文件项目 VFS】进行精准增量修改。
    【用户修改要求】：{req.instruction}

    【输出格式规范】
    必须输出合法的JSON对象，包含项目中所有文件（更新后的或保持原样的）：
    {{
        "index.html": "...完整的 html...",
        "style.css": "...完整的 css...",
        "script.js": "...完整的 js..."
    }}
    严禁在 JSON 以外夹带任何解释性文字！
    """

    user_msg = f"【当前多文件项目 VFS】：\n{json.dumps(req.vfs, ensure_encoding=False, indent=3)}"

    try:
        response = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_msg)
        ])

        clean_json = re.sub(r'```json|```', '', response.content).strip()
        updated_vfs = json.loads(clean_json)

        return {
            "status": "success",
            "updated_vfs": updated_vfs
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"VFS 修改失败: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("day53_backend_vfs:app", host="0.0.0.0", port=8000, reload=True)