from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional

from backend.controllers.auth_controller import (
    get_password_hash,
    authenticate_user,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from backend.models import users

router = APIRouter(prefix="/api/auth", tags=["认证"])


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=32, description="用户名")
    password: str = Field(..., min_length=6, max_length=64, description="密码")
    email: str = Field(..., description="邮箱地址")
    phone: Optional[str] = Field(None, description="手机号码")


class LoginRequest(BaseModel):
    username: str = Field(..., description="用户名")
    password: str = Field(..., description="密码")


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., description="刷新令牌")


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserInfoResponse(BaseModel):
    id: int
    username: str
    email: str
    phone: Optional[str]
    role: str


@router.post("/register", response_model=UserInfoResponse, summary="用户注册")
def register(request: RegisterRequest):
    """处理用户注册请求，创建新用户并返回用户信息"""
    # 检查用户名是否已存在
    for user in users:
        if user.get("username") == request.username:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="用户名已存在",
            )
    # 检查邮箱是否已存在
    for user in users:
        if user.get("email") == request.email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="邮箱已被注册",
            )
    # 生成新用户ID
    new_id = max((u["id"] for u in users), default=0) + 1
    # 创建用户记录
    new_user = {
        "id": new_id,
        "username": request.username,
        "hashed_password": get_password_hash(request.password),
        "email": request.email,
        "phone": request.phone,
        "role": "customer",
        "is_active": True,
        "created_at": "",
    }
    users.append(new_user)
    # 返回用户信息（不包含密码）
    return {
        "id": new_user["id"],
        "username": new_user["username"],
        "email": new_user["email"],
        "phone": new_user["phone"],
        "role": new_user["role"],
    }


@router.post("/login", response_model=TokenResponse, summary="用户登录")
def login(request: LoginRequest):
    """处理用户登录请求，验证成功后返回JWT令牌对"""
    user = authenticate_user(users, request.username, request.password)
    token_data = {"sub": user["username"], "user_id": user["id"], "role": user["role"]}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


@router.post("/refresh", response_model=TokenResponse, summary="刷新令牌")
def refresh_token(request: RefreshRequest):
    """使用刷新令牌获取新的令牌对"""
    payload = decode_token(request.refresh_token)
    # 验证是否为刷新令牌
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="无效的刷新令牌",
        )
    # 提取用户信息生成新令牌
    token_data = {
        "sub": payload.get("sub"),
        "user_id": payload.get("user_id"),
        "role": payload.get("role"),
    }
    new_access_token = create_access_token(token_data)
    new_refresh_token = create_refresh_token(token_data)
    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
    }


@router.get("/me", response_model=UserInfoResponse, summary="获取当前用户信息")
def get_current_user(authorization: str):
    """通过Bearer令牌获取当前登录用户的详细信息"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少或格式错误的认证头",
        )
    token = authorization.split(" ")[1]
    payload = decode_token(token)
    # 验证是否为访问令牌
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="请使用访问令牌",
        )
    username = payload.get("sub")
    # 在用户列表中查找对应用户
    user = None
    for u in users:
        if u.get("username") == username:
            user = u
            break
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户不存在",
        )
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "phone": user["phone"],
        "role": user["role"],
    }
