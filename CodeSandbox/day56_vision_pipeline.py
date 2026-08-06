"""
Day 56: 多模态视觉接力与多模型路由 API
启动方式: uvicorn day56_vision_pipeline:app --reload --port 8000
"""

import os
import re
import json
import base64
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage

# API Keys
DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")
# 用于视觉识别的模型（这里以通义千问 Qwen-VL 或 OpenAI 兼容接口为例）
VISION_KEY = os.getenv("DASHSCOPE_API_KEY", "sk-xxx") # 或使用 GPT-4o / Qwen-VL

# 1. 文本/代码专用模型 (DeepSeek)
llm_coder = ChatOpenAI(
    model="deepseek-chat",
    api_key=DEEPSEEK_KEY,
    base_url="https://api.deepseek.com"
)

# 2. 视觉多模态专用模型 (Qwen-VL / GPT-4o)
llm_vision = ChatOpenAI(
    model="qwen-vl-max", # 或 gpt-4o
    api_key=VISION_KEY,
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
)

app = FastAPI(title="Day 56 Vision-to-Code Pipeline API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class VisionToCodeRequest(BaseModel):
    image_base64: str                  # 图片 Base64
    user_prompt: Optional[str] = ""    # 用户额外补充说明

# ==========================================
# 阶段一：视觉模型提取 UI 设计规范 (Vision Spec Extraction)
# ==========================================
def extract_ui_spec_from_image(image_base64: str, user_prompt: str) -> Dict[str, Any]:
    print("\n[Stage 1: 视觉模型] 👁️  正在通过 Qwen-VL/GPT-4o 分析 UI 图像结构...")
    
    system_prompt = """你是一个顶级 UI/UX 设计解析专家。
请仔细观察用户上传的网页/App 截图，提取出精准的页面设计规范。

必须输出合法 JSON 格式：
{
  "theme_colors": ["主色调Hex", "背景色Hex", "文字颜色Hex"],
  "layout_structure": "描述页面布局（如顶部导航栏+左侧边栏+右侧内容卡片列表）",
  "components": [
    {"type": "button/input/table/card", "label": "组件文本", "position": "组件位置描述"}
  ],
  "functionality_guess": "根据界面推测的核心业务功能（如学生信息管理/商品下单）"
}
"""
    
    # 构造带有 Base64 图片的多模态 Message
    image_url = f"data:image/jpeg;base64,{image_base64}"
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=[
            {"type": "text", "text": f"用户补充说明：{user_prompt}\n请提取该 UI 截图的设计规范。"},
            {"type": "image_url", "image_url": {"url": image_url}}
        ])
    ]
    
    response = llm_vision.invoke(messages)
    clean_json = re.sub(r'```json|```', '', response.content).strip()
    spec = json.loads(clean_json)
    print(f"  └─ 视觉解析成功！识别到主色调: {spec.get('theme_colors')}, 组件数: {len(spec.get('components', []))}")
    return spec

# ==========================================
# 阶段二：接力传递给 Day 55 TDD 代码与测试引擎
# ==========================================
def generate_fullstack_from_spec(ui_spec: Dict[str, Any], user_prompt: str) -> Dict[str, Any]:
    print("\n[Stage 2: 代码引擎] ⚡ 正在将 UI 规范接力给 DeepSeek-V3 生成全栈工程与测试断言...")
    
    system_prompt = f"""你是一个高级全栈开发与 TDD 测试工程师。
请根据以下【UI 视觉设计规范】，生成符合 1:1 还原的全栈多文件 VFS 代码，并确保包含可被 Playwright 校验的 DOM id。

【UI 视觉设计规范】：
{json.dumps(ui_spec, ensure_ascii=False, indent=2)}

额外需求：{user_prompt}

必须输出包含 frontend/ 和 backend/ 所有文件的合法 JSON：
{{
  "frontend/index.html": "...",
  "frontend/styles.css": "...",
  "frontend/app.js": "...",
  "backend/server.py": "...",
  "backend/database.json": "..."
}}
"""
    response = llm_coder.invoke([SystemMessage(content=system_prompt)])
    clean_json = re.sub(r'```json|```', '', response.content).strip()
    vfs_data = json.loads(clean_json)
    return vfs_data

# ==========================================
# API 端点：看图直出全栈代码
# ==========================================
@app.post("/api/generate_from_vision")
async def generate_from_vision_endpoint(req: VisionToCodeRequest):
    if not req.image_base64:
        raise HTTPException(status_code=400, detail="图片数据不能为空")
        
    try:
        # 1. 第一阶段：视觉多模态抽取 Spec
        ui_spec = extract_ui_spec_from_image(req.image_base64, req.user_prompt)
        
        # 2. 第二阶段：DeepSeek 接力生成全栈 VFS 代码
        fullstack_vfs = generate_fullstack_from_spec(ui_spec, req.user_prompt)
        
        # 3. 第三阶段：自动触发你 Day 55 写的 Playwright TDD 验收！
        # (此处直接把 fullstack_vfs 传入你的 tdd_agent_graph 跑测试)
        
        return {
            "status": "success",
            "ui_spec": ui_spec,
            "vfs": fullstack_vfs
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("day56_vision_pipeline:app", host="0.0.0.0", port=8000, reload=True)