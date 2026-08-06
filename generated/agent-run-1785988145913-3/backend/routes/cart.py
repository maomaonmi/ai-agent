"""
商场管理系统 - 购物车路由
包含：获取购物车列表、添加商品到购物车、修改购物车商品数量、删除购物车商品、清空购物车
"""

import json
import os
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

from utils.security import get_current_user_id


router = APIRouter(prefix="/api/cart", tags=["购物车"])


# ==================== 数据库读写工具 ====================

def _db_path() -> str:
    return os.path.join(os.path.dirname(__file__), "..", "database.json")


def _read_db() -> dict:
    with open(_db_path(), "r", encoding="utf-8") as f:
        return json.load(f)


def _write_db(db: dict):
    with open(_db_path(), "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


def _get_current_user(request: Request) -> dict:
    """从请求中获取当前登录用户，未登录则抛出 401"""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录或令牌已过期")
    token = auth_header[7:]
    user_id = get_current_user_id(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="未登录或令牌已过期")
    db = _read_db()
    members = db.get("members", [])
    member = next((m for m in members if m["id"] == user_id), None)
    if not member:
        raise HTTPException(status_code=401, detail="用户不存在")
    if member.get("is_active") is False:
        raise HTTPException(status_code=403, detail="账户已被禁用")
    return member


def _find_product(db: dict, product_id: int) -> Optional[dict]:
    """根据 ID 查找商品"""
    products = db.get("products", [])
    return next((p for p in products if p["id"] == product_id), None)


def _cart_item_to_dict(item: dict, product: dict) -> dict:
    """将购物车项序列化为前端友好的字典"""
    return {
        "id": item["id"],
        "member_id": item["member_id"],
        "product_id": item["product_id"],
        "quantity": item["quantity"],
        "checked": item.get("checked", True),
        "created_at": item["created_at"],
        "updated_at": item["updated_at"],
        "product": {
            "id": product["id"],
            "name": product.get("name", ""),
            "main_image": product.get("main_image"),
            "price": product.get("price", 0),
            "original_price": product.get("original_price"),
            "stock": product.get("stock", 0),
            "unit": product.get("unit", "件"),
            "is_on_sale": product.get("is_on_sale", True),
            "shop_id": product.get("shop_id"),
        },
    }


# ==================== 请求模型 ====================

class AddCartItemRequest(BaseModel):
    product_id: int = Field(..., description="商品ID")
    quantity: int = Field(1, ge=1, le=999, description="购买数量")


class UpdateCartItemRequest(BaseModel):
    quantity: Optional[int] = Field(None, ge=1, le=999, description="购买数量")
    checked: Optional[bool] = Field(None, description="是否选中")


class BatchCheckRequest(BaseModel):
    item_ids: List[int] = Field(..., description="购物车项ID列表")
    checked: bool = Field(..., description="选中状态")


# ==================== 路由 ====================

@router.get("")
def get_cart(request: Request):
    """
    获取当前用户的购物车列表
    - 需要登录
    - 返回购物车中所有商品及其详情
    """
    member = _get_current_user(request)
    db = _read_db()
    cart_items = db.get("cart_items", [])

    # 筛选当前用户的购物车项
    user_items = [item for item in cart_items if item["member_id"] == member["id"]]

    # 组装返回数据
    result = []
    for item in user_items:
        product = _find_product(db, item["product_id"])
        if product:
            result.append(_cart_item_to_dict(item, product))

    # 计算汇总信息
    total_count = sum(item["quantity"] for item in result)
    checked_items = [item for item in result if item["checked"]]
    checked_count = sum(item["quantity"] for item in checked_items)
    checked_amount = sum(
        item["product"]["price"] * item["quantity"]
        for item in checked_items
    )

    return {
        "success": True,
        "data": {
            "items": result,
            "total_count": total_count,
            "checked_count": checked_count,
            "checked_amount": round(checked_amount, 2),
        },
    }


@router.post("")
def add_to_cart(request: Request, req: AddCartItemRequest):
    """
    添加商品到购物车
    - 如果商品已在购物车中，则累加数量
    - 校验商品是否存在、是否上架、库存是否充足
    """
    member = _get_current_user(request)
    db = _read_db()

    # 校验商品
    product = _find_product(db, req.product_id)
    if not product:
        raise HTTPException(status_code=404, detail=f"商品不存在 (id={req.product_id})")
    if not product.get("is_on_sale", True):
        raise HTTPException(status_code=400, detail="该商品已下架")

    cart_items = db.setdefault("cart_items", [])

    # 查找是否已在购物车中
    existing = next(
        (item for item in cart_items
         if item["member_id"] == member["id"] and item["product_id"] == req.product_id),
        None,
    )

    now = datetime.utcnow().isoformat() + "Z"

    if existing:
        # 累加数量
        new_quantity = existing["quantity"] + req.quantity
        # 校验库存
        if new_quantity > product.get("stock", 0):
            raise HTTPException(
                status_code=400,
                detail=f"库存不足，当前库存: {product.get('stock', 0)}",
            )
        existing["quantity"] = new_quantity
        existing["updated_at"] = now
        cart_item = existing
    else:
        # 校验库存
        if req.quantity > product.get("stock", 0):
            raise HTTPException(
                status_code=400,
                detail=f"库存不足，当前库存: {product.get('stock', 0)}",
            )
        # 新增购物车项
        new_id = max((item["id"] for item in cart_items), default=0) + 1
        cart_item = {
            "id": new_id,
            "member_id": member["id"],
            "product_id": req.product_id,
            "quantity": req.quantity,
            "checked": True,
            "created_at": now,
            "updated_at": now,
        }
        cart_items.append(cart_item)

    db["cart_items"] = cart_items
    _write_db(db)

    return {
        "success": True,
        "message": "已添加到购物车",
        "data": _cart_item_to_dict(cart_item, product),
    }


@router.put("/{item_id}")
def update_cart_item(request: Request, item_id: int, req: UpdateCartItemRequest):
    """
    修改购物车商品数量或选中状态
    - 支持修改数量和选中状态
    - 校验库存
    """
    member = _get_current_user(request)
    db = _read_db()
    cart_items = db.get("cart_items", [])

    # 查找购物车项
    cart_item = next(
        (item for item in cart_items
         if item["id"] == item_id and item["member_id"] == member["id"]),
        None,
    )
    if not cart_item:
        raise HTTPException(status_code=404, detail="购物车项不存在")

    # 修改数量
    if req.quantity is not None:
        product = _find_product(db, cart_item["product_id"])
        if product and req.quantity > product.get("stock", 0):
            raise HTTPException(
                status_code=400,
                detail=f"库存不足，当前库存: {product.get('stock', 0)}",
            )
        cart_item["quantity"] = req.quantity

    # 修改选中状态
    if req.checked is not None:
        cart_item["checked"] = req.checked

    cart_item["updated_at"] = datetime.utcnow().isoformat() + "Z"
    db["cart_items"] = cart_items
    _write_db(db)

    product = _find_product(db, cart_item["product_id"])
    return {
        "success": True,
        "message": "购物车已更新",
        "data": _cart_item_to_dict(cart_item, product) if product else {"id": cart_item["id"]},
    }


@router.put("/batch-check")
def batch_check_items(request: Request, req: BatchCheckRequest):
    """
    批量设置购物车项的选中状态
    """
    member = _get_current_user(request)
    db = _read_db()
    cart_items = db.get("cart_items", [])
    now = datetime.utcnow().isoformat() + "Z"

    updated_count = 0
    for item in cart_items:
        if item["member_id"] == member["id"] and item["id"] in req.item_ids:
            item["checked"] = req.checked
            item["updated_at"] = now
            updated_count += 1

    db["cart_items"] = cart_items
    _write_db(db)

    return {
        "success": True,
        "message": f"已更新 {updated_count} 项选中状态",
        "data": {"updated_count": updated_count},
    }


@router.delete("/{item_id}")
def remove_cart_item(request: Request, item_id: int):
    """
    删除购物车中的某个商品
    """
    member = _get_current_user(request)
    db = _read_db()
    cart_items = db.get("cart_items", [])

    # 查找并删除
    original_len = len(cart_items)
    cart_items = [
        item for item in cart_items
        if not (item["id"] == item_id and item["member_id"] == member["id"])
    ]

    if len(cart_items) == original_len:
        raise HTTPException(status_code=404, detail="购物车项不存在")

    db["cart_items"] = cart_items
    _write_db(db)

    return {
        "success": True,
        "message": "已从购物车移除",
    }


@router.delete("")
def clear_cart(request: Request):
    """
    清空当前用户的购物车
    """
    member = _get_current_user(request)
    db = _read_db()
    cart_items = db.get("cart_items", [])

    original_len = len(cart_items)
    cart_items = [
        item for item in cart_items
        if item["member_id"] != member["id"]
    ]
    removed_count = original_len - len(cart_items)

    db["cart_items"] = cart_items
    _write_db(db)

    return {
        "success": True,
        "message": f"已清空购物车，共移除 {removed_count} 件商品",
    }
