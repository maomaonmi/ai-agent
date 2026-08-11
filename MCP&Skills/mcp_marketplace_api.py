"""
MCP 插件市场后端管理 API
包含: 插件目录查询、用户配置安装、启用/暂停控制、动态 MCP 进程池管理
"""

import json
import os
import subprocess
import sys
from typing import List, Dict, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

CATALOG_FILE = "mcp_catalog.json"
INSTALLED_FILE = "installed_mcps.json"

app = FastAPI(title="MCP Marketplace API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class InstallMcpRequest(BaseModel):
    plugin_id: str
    env_values: Dict[str, str] # 用户填入的 API Key 等凭证

# 读取预置的市场目录
def load_catalog() -> List[dict]:
    if not os.path.exists(CATALOG_FILE):
        return []
    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

# 读取用户已安装的配置
def load_installed() -> Dict[str, dict]:
    if not os.path.exists(INSTALLED_FILE):
        return {}
    with open(INSTALLED_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_installed(installed_data: dict):
    with open(INSTALLED_FILE, "w", encoding="utf-8") as f:
        json.dump(installed_data, f, ensure_ascii=False, indent=2)

# 1. API: 获取 MCP 市场插件列表（标注安装状态）
@app.get("/api/mcp/marketplace")
async def get_marketplace():
    catalog = load_catalog()
    installed = load_installed()
    
    result = []
    for item in catalog:
        plugin_id = item["id"]
        item_copy = dict(item)
        item_copy["is_installed"] = plugin_id in installed
        item_copy["is_enabled"] = installed.get(plugin_id, {}).get("enabled", False)
        result.append(item_copy)
        
    return result

# 2. API: 安装并配置 MCP 插件
@app.post("/api/mcp/install")
async def install_plugin(req: InstallMcpRequest):
    catalog = load_catalog()
    target_plugin = next((p for p in catalog if p["id"] == req.plugin_id), None)
    
    if not target_plugin:
        raise HTTPException(status_code=404, detail="未找到该插件")
        
    installed = load_installed()
    
    # 记录用户的配置与凭证
    installed[req.plugin_id] = {
        "plugin_info": target_plugin,
        "env_values": req.env_values,
        "enabled": True,
        "installed_at": os.path.getmtime(CATALOG_FILE) if os.path.exists(CATALOG_FILE) else 0
    }
    
    save_installed(installed)
    print(f"✅ [MCP 市场] 成功安装并配置插件: {target_plugin['name']}")
    return {"status": "success", "message": f"已成功开启 {target_plugin['name']}"}

# 3. API: 切换插件使能状态 (启用/暂停)
@app.post("/api/mcp/toggle/{plugin_id}")
async def toggle_plugin(plugin_id: str):
    installed = load_installed()
    if plugin_id not in installed:
        raise HTTPException(status_code=404, detail="插件未安装")
        
    current_status = installed[plugin_id].get("enabled", True)
    installed[plugin_id]["enabled"] = not current_status
    save_installed(installed)
    
    return {"status": "success", "enabled": not current_status}

# 4. API: 卸载插件
@app.delete("/api/mcp/uninstall/{plugin_id}")
async def uninstall_plugin(plugin_id: str):
    installed = load_installed()
    if plugin_id in installed:
        del installed[plugin_id]
        save_installed(installed)
    return {"status": "success"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("mcp_marketplace_api:app", host="0.0.0.0", port=8000, reload=True)