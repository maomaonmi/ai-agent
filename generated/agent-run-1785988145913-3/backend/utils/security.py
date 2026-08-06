"""
商场管理系统 - 安全工具模块
包含：密码哈希、JWT 令牌生成与验证
"""

from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

# ==================== 配置 ====================

# JWT 密钥（生产环境应从环境变量读取）
SECRET_KEY = "mall-system-secret-key-change-in-production-2024"
ALGORITHM = "HS256"
# 令牌有效期：7 天
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7

# 密码哈希上下文（使用 bcrypt）
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ==================== 密码工具 ====================

def hash_password(plain_password: str) -> str:
    """对明文密码进行哈希，返回哈希字符串"""
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """校验明文密码与哈希密码是否匹配"""
    return pwd_context.verify(plain_password, hashed_password)


# ==================== JWT 令牌工具 ====================

def create_access_token(
    data: dict,
    expires_delta: Optional[timedelta] = None
) -> str:
    """
    生成 JWT 访问令牌

    Args:
        data: 要编码到令牌中的载荷数据（必须包含 sub 字段）
        expires_delta: 自定义过期时间，默认使用 ACCESS_TOKEN_EXPIRE_MINUTES

    Returns:
        编码后的 JWT 字符串
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow(),
    })
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Optional[dict]:
    """
    解码并验证 JWT 令牌

    Args:
        token: JWT 令牌字符串

    Returns:
        解码后的载荷字典，验证失败返回 None
    """
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def get_current_user_id(token: str) -> Optional[int]:
    """
    从 JWT 令牌中提取用户 ID

    Args:
        token: JWT 令牌字符串（可带 Bearer 前缀）

    Returns:
        用户 ID，失败返回 None
    """
    # 去除 Bearer 前缀
    if token.startswith("Bearer "):
        token = token[7:]
    payload = decode_access_token(token)
    if payload is None:
        return None
    user_id = payload.get("sub")
    if user_id is None:
        return None
    try:
        return int(user_id)
    except (ValueError, TypeError):
        return None
