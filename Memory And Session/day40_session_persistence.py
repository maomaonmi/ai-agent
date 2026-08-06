"""
Day 40: 历史会话与硬盘级记忆持久化管理引擎 (SQLite Session & Memory Manager)
启动方式: uvicorn day40_session_persistence:app --reload --port 8000
"""

import json
import os
import sqlite3
import time
import uuid
from typing import Annotated, TypedDict, List, Dict, Optional, Literal
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
# 引入 LangGraph 官方 SQLite 检查点持久化存储器
from langgraph.checkpoint.sqlite import SqliteSaver

DEEPSEEK_KEY = os.getenv("DEEPSEEK_API_KEY", "sk-6d31f71ec3514f6785e28fa00ea03199")
llm_chat = ChatOpenAI(model="deepseek-chat", api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com")

DB_FILE = "agent_sessions.db"

# ==========================================
# 1. 本地会话元数据表 (SQLite 管理会话列表)
# ==========================================
def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            title TEXT,
            mode TEXT,
            updated_at REAL
        )
    """)
    conn.commit()
    conn.close()

init_db()

class SessionMeta(BaseModel):
    session_id: str
    title: str
    mode: str
    updated_at: float = Field(default_factory=time.time)

class CreateSessionRequest(BaseModel):
    mode: Literal["standard", "deep", "web", "plan"] = "standard"
    title: Optional[str] = "新会话"

# ==========================================
# 2. 会话 CRUD 操作
# ==========================================
class SessionManager:
    @staticmethod
    def create_session(mode: str, title: str = "新会话") -> SessionMeta:
        sid = f"session_{uuid.uuid4().hex[:8]}"
        now = time.time()
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO sessions (session_id, title, mode, updated_at) VALUES (?, ?, ?, ?)",
            (sid, title, mode, now)
        )
        conn.commit()
        conn.close()
        return SessionMeta(session_id=sid, title=title, mode=mode, updated_at=now)

    @staticmethod
    def list_sessions() -> List[SessionMeta]:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("SELECT session_id, title, mode, updated_at FROM sessions ORDER BY updated_at DESC")
        rows = cursor.fetchall()
        conn.close()
        return [SessionMeta(session_id=r[0], title=r[1], mode=r[2], updated_at=r[3]) for r in rows]

    @staticmethod
    def update_session(sid: str, title: Optional[str] = None, mode: Optional[str] = None):
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        now = time.time()
        if title and mode:
            cursor.execute("UPDATE sessions SET title=?, mode=?, updated_at=? WHERE session_id=?", (title, mode, now, sid))
        elif title:
            cursor.execute("UPDATE sessions SET title=?, updated_at=? WHERE session_id=?", (title, now, sid))
        elif mode:
            cursor.execute("UPDATE sessions SET mode=?, updated_at=? WHERE session_id=?", (mode, now, sid))
        conn.commit()
        conn.close()

    @staticmethod
    def delete_session(sid: str):
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE session_id=?", (sid,))
        conn.commit()
        conn.close()


# ==========================================
# 3. 自动根据首句生成简短会话标题
# ==========================================
def generate_session_title(first_message: str) -> str:
    try:
        res = llm_chat.invoke([
            SystemMessage(content="请将用户的这句话提炼为一个 4-8 个字的简短主题标题（例如：'前端架构方案调研'）。不要标点，直接输出标题。"),
            HumanMessage(content=first_message)
        ])
        title = res.content.strip().replace("\"", "").replace("'", "")
        return title[:12]
    except Exception:
        return first_message[:8]


# ==========================================
# 4. FastAPI REST APIs
# ==========================================
app = FastAPI(title="Day 40 Session Persistence API", version="1.0.0")

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

# --- 接口 1: 获取所有历史会话列表 ---
@app.get("/api/sessions")
async def get_sessions():
    return SessionManager.list_sessions()

# --- 接口 2: 创建新会话 ---
@app.post("/api/sessions")
async def create_session(req: CreateSessionRequest):
    session = SessionManager.create_session(mode=req.mode, title=req.title or "新会话")
    return session

# --- 接口 3: 删除指定会话 ---
@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    SessionManager.delete_session(session_id)
    return {"status": "success", "deleted": session_id}

# --- 接口 4: 获取某个会话的历史消息 (用于网页恢复) ---
@app.get("/api/sessions/{session_id}/history")
async def get_session_history(session_id: str):
    # 利用 SqliteCheckpointer 恢复 LangGraph 消息
    with sqlite3.connect("langgraph_memory.db") as conn:
        checkpointer = SqliteSaver(conn)
        config = {"configurable": {"thread_id": session_id}}
        state = checkpointer.get(config)
        if state and "channel_values" in state and "messages" in state["channel_values"]:
            msgs = state["channel_values"]["messages"]
            formatted = []
            for m in msgs:
                if isinstance(m, HumanMessage):
                    formatted.append({"role": "user", "content": m.content})
                elif isinstance(m, AIMessage) and m.content:
                    if m.content not in ["BALANCE_AGENT", "TECH_AGENT", "FINISH"]:
                        formatted.append({"role": "assistant", "content": m.content})
            return {"history": formatted}
    return {"history": []}


# ==========================================
# 5. 请求模型与 SSE 管道接口
# ==========================================
class SessionChatRequest(BaseModel):
    session_id: str
    message: str
    mode: Literal["standard", "deep", "web", "plan"] = "standard"


# (此处保持你已有的 LangGraph 定义，编译时挂载 SqliteSaver)
# with sqlite3.connect("langgraph_memory.db", check_same_thread=False) as conn:
#     memory_storage = SqliteSaver(conn)
#     app_graph = workflow.compile(checkpointer=memory_storage)

@app.post("/chat_session")
async def chat_session_endpoint(req: SessionChatRequest):
    # 1. 如果这是会话的第一句话，自动更新会话标题！
    sessions = SessionManager.list_sessions()
    target_session = next((s for s in sessions if s.session_id == req.session_id), None)
    
    if target_session and target_session.title == "新会话":
        new_title = generate_session_title(req.message)
        SessionManager.update_session(req.session_id, title=new_title, mode=req.mode)

    # 2. 将 session_id 作为 thread_id 传入 LangGraph！
    config = {"configurable": {"thread_id": req.session_id}}
    
    # ... 发送 SSE 事件，所有对话历史自动存入 sqlite 硬盘 ...
    return {"status": "success", "session_id": req.session_id}


if __name__ == "__main__":
    import uvicorn
    print("="*60)
    print("🚀 Day 40 多会话与 SQLite 持久化记忆引擎启动成功！")
    print("地址: http://127.0.0.1:8000/docs")
    print("="*60)
    uvicorn.run("day40_session_persistence:app", host="0.0.0.0", port=8000, reload=True)

