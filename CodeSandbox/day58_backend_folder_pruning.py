"""
Day 58: 支持文件夹级 (@folder) 匹配与 Token 剪枝 API
启动: uvicorn day58_backend_folder_pruning:app --reload --port 8000
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

app = FastAPI(title="Day 58 Folder-Level Pruning API")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

class FolderModifyRequest(BaseModel):
    vfs: Dict[str, str]
    instruction: str
    mentioned_folders: Optional[List[str]] = [] # 包含文件路径或文件夹路径 (如 'src/components/')

def is_file_in_mentioned_paths(filepath: str, mentioned_paths: List[str]) -> bool:
    """
    【核心判断】：判断某个文件是否属于被选中的文件，或者属于被选中的文件夹下！
    """
    if not mentioned_paths:
        return True
    for p in mentioned_paths:
        # 完全匹配文件或属于该文件夹子路径
        if filepath == p or filepath.startswith(p if p.endswith('/') else f"{p}/"):
            return True
    return False

def build_folder_pruned_vfs(vfs: Dict[str, str], mentioned_paths: List[str]) -> str:
    if not mentioned_paths:
        return json.dumps(vfs, ensure_ascii=False, indent=2)

    pruned_vfs = {}
    for filepath,content in vfs.items():
        if is_file_in_mentioned_paths(filepath, mentioned_paths):
            pruned_vfs[filepath] = content #属于聚焦目录：发送全量源码
        else:
            pruned_vfs[filepath] = f"//[已被剪枝的非聚焦文件]: {filepath}" #占位剪枝

    return json.dumps(pruned_vfs, ensure_ascii=False, indent=2)

@app.post("/api/modify_folder_pruned")
async def modify_folder_endpoint(req: FolderModifyRequest):
    pruned_vfs_str = build_folder_pruned_vfs(req.vfs, req.mentioned_folders or [])

    system_prompt = f"""
    你是一个高级多文件代码 Patch 引擎。
    用户提问：{req.instruction}
    指定的聚焦路径：{req.mentioned_paths}

    必须输出包含修改后文件的 JSON 对象：
    {{
    "src/components/Button.tsx": "...更新后的源码..."
    }}
    """
    try:
        res = llm.invoke([SystemMessage(content=system_prompt), HumanMessage(content=f"VFS:\n{pruned_vfs_str}")])
        clean_json = re.sub(r"```json|```", "", res.content.strip()) # 移除 JSON 格式化
        updated_files = json.loads(clean_json)

        final_vfs = dict(req.vfs)
        for filepath, content in updated_files.items():
            final_vfs[filepath] = content

        return {"status": "success", "vfs": final_vfs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"修改失败：{str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("day58_backend_folder_pruning:app", host="0.0.0.0", port=8000, reload=True)

