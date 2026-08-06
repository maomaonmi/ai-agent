"""
商场管理系统 - 用户认证路由
包含：用户注册、用户登录、获取当前用户信息
"""

import json
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

from utils.security import hash_password, verify_password, create_access_token, get_current_user_id


router = APIRouter(prefix="/api/auth", tags=["认证"])


# ==================== 数据库读写工具 ====================

def _db_path() -> str:
    return os.path.join(os.path.dirname(__file__), "..", "database.json")


def _read_db() -> dict:
    with open(_db_path(), "r", encoding="utf-8") as f:
        return json.load(f)


def _write_db(db: dict):
    with open(_db_path(), "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


def _find_member(db: dict, **kwargs) -> Optional[dict]:
    members = db.get("members", [])
    for m in members:
        match = True
        for k, v in kwargs.items():
            if m.get(k) != v:
                match = False
                break
        if match:
            return m
    return None


def _strip_password(member: dict) -> dict:
    """返回去除密码字段的用户信息副本"""
    info = {k: v for k, v in member.items() if k != "password_hash"}
    return info


# ==================== 请求模型 ====================

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, description="用户名")
    password: str = Field(..., min_length=6, description="密码")
    nickname: Optional[str] = Field(None, max_length=50, description="昵称")
    phone: Optional[str] = Field(None, max_length=20, description="手机号")
    email: Optional[str] = Field(None, max_length=100, description="邮箱")


class LoginRequest(BaseModel):
    username: str = Field(..., description="用户名或手机号")
    password: str = Field(..., description="密码")


# ==================== 路由 ====================

@router.post("/register")
def register(req: RegisterRequest):
    """
    用户注册
    - 校验用户名/手机号/邮箱唯一性
    - 密码哈希存储
    - 返回 JWT 令牌和用户信息
    """
    db = _read_db()
    members = db.setdefault("members", [])

    # 检查用户名唯一性
    if _find_member(db, username=req.username):
        raise HTTPException(status_code=409, detail="用户名已被注册")

    # 检查手机号唯一性
    if req.phone and _find_member(db, phone=req.phone):
        raise HTTPException(status_code=409, detail="手机号已被注册")

    # 检查邮箱唯一性
    if req.email and _find_member(db, email=req.email):
        raise HTTPException(status_code=409, detail="邮箱已被注册")

    # 生成密码哈希
    password_hash = hash_password(req.password)

    # 生成新 ID
    new_id = max((m["id"] for m in members), default=0) + 1

    # 构建用户记录
    now = datetime.utcnow().isoformat() + "Z"
    new_member = {
        "id": new_id,
        "username": req.username,
        "password_hash": password_hash,
        "nickname": req.nickname or req.username,
        "avatar": None,
        "phone": req.phone,
        "email": req.email,
        "gender": "unknown",
        "birthday": None,
        "points": 0,
        "level": 1,
        "is_active": True,
        "is_admin": False,
        "created_at": now,
        "updated_at": now,
    }

    members.append(new_member)
    db["members"] = members
    _write_db(db)

    # 生成 JWT 令牌
    token = create_access_token({"sub": str(new_member.id), "username": new_member["username"]})

    return {
        "success": True,
        "message": "注册成功",
        "data": {
            "token": token,
            "token_type": "Bearer",
            "user": _strip_password(new_member),
        },
    }


@router.post("/login")
def login(req: LoginRequest):
    """
    用户登录
    - 支持用户名或手机号登录
    - 校验密码
    - 返回 JWT 令牌和用户信息
    """
    db = _read_db()

    # 查找用户（支持用户名或手机号）
    member = _find_member(db, username=req.username)
    if not member:
        member = _find_member(db, phone=req.username)

    if not member:
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    # 检查账户状态
    if member.get("is_active") is False:
        raise HTTPException(status_code=403, detail="账户已被禁用，请联系管理员")

    # 校验密码
    if not verify_password(req.password, member["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    # 生成 JWT 令牌
    token = create_access_token({"sub": str(member["id"]), "username": member["username"]})

    return {
        "success": True,
        "message": "登录成功",
        "data": {
            "token": token,
            "token_type": "Bearer",
            "user": _strip_password(member),
        },
    }


@router.get("/me")
def get_current_user(request: Request):
    """
    获取当前登录用户信息
    - 从 Authorization 头中提取 Bearer 令牌
    - 验证令牌并返回用户信息
    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录或令牌已过期")

    token = auth_header[7:]
    user_id = get_current_user_id(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="未登录或令牌已过期")

    db = _read_db()
    member = _find_member(db, id=user_id)
    if not member:
        raise HTTPException(status_code=401, detail="用户不存在")

    if member.get("is_active") is False:
        raise HTTPException(status_code=403, detail="账户已被禁用")

    return {
        "success": True,
        "data": _strip_password(member),
    }
