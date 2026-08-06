"""
Day 55: 全栈应用增量修改 API
启动: uvicorn day55_backend_fullstack:app --reload --port 8000
"""

import os
import re
import json
from typing import Dict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")
llm = ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")

app = FastAPI(title="Day 55 Fullstack Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

class FullstackModifyRequest(BaseModel):
    vfs: Dict[str, str]
    instruction: str

@app.post("/api/modify_fullstack")
async def modify_fullstack(req: FullstackModifyRequest):
    system_prompt = f"""
    你是一个高级全栈架构师。请根据用户的【修改要求】，同步跟新【全栈VFS工程】。
    【修改要求】：{req.instruction}

    【输出规范】：必须输出包含 frontend/ 和 backend/ 所有文件的合法 JSON：
    {{
    "frontend/index.html": "...",
    "frontend/styles.css": "...",
    "frontend/app.js": "...",
    "backend/server.py": "...",
    "backend/database.json": "..."
    }}
    若修改了前端的数据获取逻辑，必须同步更新 backend/ 里的 API 接口逻辑与 database.json 结构！
    """

    user_msg = f"【当前全栈 VFS】：\n{json.dumps(req.dumps(req.vfs, ensure_ascii=False, indent=2))}"

    try:
        response = llm.invoke([SystemMessage(content=system_prompt), HumanMessage(content=user_msg)])
        clean_json = re.sub(r'```json|```', '', response.content).strip()
        updated_vfs = json.loads(clean_json)
        return {"status": "success", "updated_vfs": updated_vfs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("day55_backend_fullstack:app", host="0.0.0.0", port=8000, reload=True)