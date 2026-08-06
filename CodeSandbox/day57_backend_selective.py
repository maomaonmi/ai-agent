"""
Day 57: 支持 @file 指定文件 Token 剪枝与精准修改 API
启动: uvicorn day57_backend_selective:app --reload --port 8000
"""

import os
import re
import json
from typing import Dict, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")
llm = ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")

app = FastAPI(title="Day 57 Selective Context Code Modification API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

class SelectiveModifyRequest(BaseModel):
    vfs: Dict[str, str] # 全量多文件 VFS
    instruction: str # 用户的修改要求
    mentioned_files: Optional[List[str]] = [] # 用户用 @ 指定的文件清单

def build_pruned_vfs_prompt(vfs: Dict[str, str], mentioned_files: List[str]) -> str:
    """
    【核心剪枝函数】：
    若用户指定了 @file，则对未提及的文件进行源码剔除（仅留文件路径说明），降低 90% Token！
    """
    if not mentioned_files:
        #如果未指定，传全量 VFS
        return json.dumps(vfs, ensure_ascii=False, indent=2)

    pruned_vfs = {}
    for filepath, content in vfs.items():
        if filepath in mentioned_files:
            #目标文件：发送全量源码
            pruned_vfs[filepath] = content
        else:
            # 非目标文件：占位剪枝（保留路径说明，剔除源码以降低 90% Token）
            pruned_vfs[filepath] = f"// [已为您裁剪该文件源码以提升性能与准确度，请勿改动此文件]: {filepath}"

    return json.dumps(pruned_vfs, ensure_ascii=False, indent=2)

@app.post("/api/modify_selective")
async def modify_selective(req: SelectiveModifyRequest):
    if not req.vfs or not req.instruction.strip():
        raise HTTPException(status_code=400, detail="VFS 与修改指令不能为空")

    #1. 构造剪枝后的VFS文本
    prund_vfs_json = build_pruned_vfs_prompt(req.vfs,req.mentioned_files or [])

    #约束提示词
    focus_rule = ""
    if req.mentioned_files:
        focus_rule = f"【重点约束】：用户明确指定仅修改以下文件：{req.mentioned_files}。请确保补丁仅作用于这些文件，严禁变动未提及的文件！"

    system_prompt = f"""
    你是一个高级代码 Patch 引擎。请根据用户的【修改要求】，对【已剪枝的 VFS】进行精准的增量 Patch修改。

    【修改要求】：{req.instruction}
    {focus_rule}

    【输出规范】：必须包含被修改文件的完整多文件 JSON 对象：
    {{
        "frontend": "...修改后的代码..."
    }}
    只能输出合法的 JSON，严禁夹带任何 Markdown 解释文字！
    """

    user_msg = f"【多文件 VFS 上下文】：\n{prund_vfs_json}"

    try:
        response = llm.invoke([SystemMessage(content=system_prompt),HumanMessage(content=user_msg)])
        clean_json = re.sub(r'```json|```', '', response.content).strip()
        updated_vfs = json.loads(clean_json)

        # 3. 将 AI 修改的局部文件合并回全量 VFS
        final_vfs = dict(req.vfs)
        for filepath, content in updated_vfs.items():
            final_vfs[filepath] = content
        
        return {
            "status": "success",
            "updated_vfs": final_vfs,
            "modified_files": list(updated_vfs.keys())
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("day57_backend_selective:app", host="0.0.0.0", port=8000, reload=True)

