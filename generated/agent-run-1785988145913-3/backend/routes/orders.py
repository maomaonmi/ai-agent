"""
商场管理系统 - 订单路由
包含：创建订单、获取订单列表、获取订单详情、取消订单、删除订单
"""

import json
import os
import uuid
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel, Field

from utils.security import get_current_user_id


router = APIRouter(prefix="/api/orders", tags=["订单"])


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


def _find_shop(db: dict, shop_id: int) -> Optional[dict]:
    """根据 ID 查找商铺"""
    shops = db.get("shops", [])
    return next((s for s in shops if s["id"] == shop_id), None)


def _generate_order_no() -> str:
    """生成唯一订单编号: 年月日时分秒 + 6位随机数"""
    now = datetime.utcnow()
    date_part = now.strftime("%Y%m%d%H%M%S")
    unique_part = uuid.uuid4().hex[:6].upper()
    return f"ORD{date_part}{unique_part}"


def _order_to_dict(order: dict, include_items: bool = True) -> dict:
    """将订单序列化为前端友好的字典"""
    result = {
        "id": order["id"],
        "order_no": order["order_no"],
        "member_id": order["member_id"],
        "shop_id": order["shop_id"],
        "status": order["status"],
        "payment_method": order.get("payment_method"),
        "payment_time": order.get("payment_time"),
        "total_amount": order["total_amount"],
        "discount_amount": order.get("discount_amount", 0),
        "pay_amount": order.get("pay_amount", 0),
        "points_used": order.get("points_used", 0),
        "points_earned": order.get("points_earned", 0),
        "receiver_name": order.get("receiver_name"),
        "receiver_phone": order.get("receiver_phone"),
        "receiver_address": order.get("receiver_address"),
        "remark": order.get("remark"),
        "created_at": order["created_at"],
        "updated_at": order["updated_at"],
    }
    if include_items:
        result["order_items"] = order.get("order_items", [])
    return result


# ==================== 请求模型 ====================

class CreateOrderRequest(BaseModel):
    cart_item_ids: Optional[List[int]] = Field(None, description="购物车项ID列表，为空则使用所有选中项")
    payment_method: Optional[str] = Field(None, description="支付方式: wechat/alipay/cash/card")
    receiver_name: str = Field(..., min_length=1, max_length=50, description="收货人姓名")
    receiver_phone: str = Field(..., min_length=1, max_length=20, description="收货人电话")
    receiver_address: str = Field(..., min_length=1, max_length=255, description="收货地址")
    remark: Optional[str] = Field(None, description="订单备注")
    points_used: int = Field(0, ge=0, description="使用积分数量")


class CancelOrderRequest(BaseModel):
    reason: Optional[str] = Field(None, description="取消原因")


class UpdateOrderStatusRequest(BaseModel):
    status: str = Field(..., description="目标状态: paid/shipped/delivered/cancelled/refunded")


# ==================== 路由 ====================

@router.get("")
def get_orders(
    request: Request,
    status: Optional[str] = Query(None, description="按状态筛选: pending/paid/shipped/delivered/cancelled/refunded"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
):
    """
    获取当前用户的订单列表
    - 支持按状态筛选
    - 支持分页
    - 按创建时间倒序排列
    """
    member = _get_current_user(request)
    db = _read_db()
    orders = db.get("orders", [])

    # 筛选当前用户的订单
    user_orders = [o for o in orders if o["member_id"] == member["id"]]

    # 按状态筛选
    if status is not None:
        user_orders = [o for o in user_orders if o["status"] == status]

    # 按创建时间倒序
    user_orders.sort(key=lambda x: x["created_at"], reverse=True)

    # 分页
    total = len(user_orders)
    offset = (page - 1) * page_size
    page_orders = user_orders[offset:offset + page_size]

    return {
        "success": True,
        "data": {
            "items": [_order_to_dict(o) for o in page_orders],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
        },
    }


@router.get("/{order_id}")
def get_order(request: Request, order_id: int):
    """
    获取订单详情
    - 包含订单基本信息和订单明细列表
    """
    member = _get_current_user(request)
    db = _read_db()
    orders = db.get("orders", [])

    order = next(
        (o for o in orders if o["id"] == order_id and o["member_id"] == member["id"]),
        None,
    )
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")

    return {
        "success": True,
        "data": _order_to_dict(order),
    }


@router.post("")
def create_order(request: Request, req: CreateOrderRequest):
    """
    创建订单
    - 从购物车中选取商品（指定ID或所有选中项）
    - 校验商品库存、上架状态
    - 扣减库存
    - 清除已下单的购物车项
    - 生成订单编号和订单明细
    """
    member = _get_current_user(request)
    db = _read_db()
    cart_items = db.get("cart_items", [])
    products = db.get("products", [])
    orders = db.get("orders", [])
    order_items_list = db.get("order_items", [])

    now = datetime.utcnow().isoformat() + "Z"

    # 确定要下单的购物车项
    user_cart = [item for item in cart_items if item["member_id"] == member["id"]]

    if req.cart_item_ids is not None and len(req.cart_item_ids) > 0:
        # 按指定ID筛选
        target_items = [
            item for item in user_cart
            if item["id"] in req.cart_item_ids and item.get("checked", True)
        ]
    else:
        # 使用所有选中项
        target_items = [item for item in user_cart if item.get("checked", True)]

    if not target_items:
        raise HTTPException(status_code=400, detail="购物车中没有可结算的商品")

    # 校验商品并计算金额
    order_item_records = []
    total_amount = 0.0
    shop_id = None
    stock_updates = {}  # product_id -> new_stock

    for cart_item in target_items:
        product = _find_product(db, cart_item["product_id"])
        if not product:
            raise HTTPException(
                status_code=404,
                detail=f"商品不存在 (id={cart_item['product_id']})",
            )
        if not product.get("is_on_sale", True):
            raise HTTPException(
                status_code=400,
                detail=f"商品「{product.get('name')}」已下架",
            )
        if cart_item["quantity"] > product.get("stock", 0):
            raise HTTPException(
                status_code=400,
                detail=f"商品「{product.get('name')}」库存不足，当前库存: {product.get('stock', 0)}",
            )

        # 记录商铺ID（所有商品应属于同一商铺，简化处理取第一个）
        if shop_id is None:
            shop_id = product.get("shop_id")

        subtotal = round(product["price"] * cart_item["quantity"], 2)
        total_amount += subtotal

        # 记录库存扣减
        stock_updates[product["id"]] = product.get("stock", 0) - cart_item["quantity"]

        # 构建订单明细
        new_item_id = max((i["id"] for i in order_items_list), default=0) + 1
        order_item_records.append({
            "id": new_item_id,
            "order_id": None,  # 稍后填充
            "product_id": product["id"],
            "product_name": product.get("name", ""),
            "product_image": product.get("main_image"),
            "price": product["price"],
            "quantity": cart_item["quantity"],
            "subtotal": subtotal,
        })

    # 计算积分抵扣（100积分 = 1元）
    discount_amount = 0.0
    if req.points_used > 0:
        if req.points_used > member.get("points", 0):
            raise HTTPException(status_code=400, detail="积分余额不足")
        discount_amount = round(req.points_used / 100, 2)
        if discount_amount > total_amount:
            discount_amount = total_amount
            req.points_used = int(discount_amount * 100)

    pay_amount = round(total_amount - discount_amount, 2)
    if pay_amount < 0:
        pay_amount = 0.0

    # 生成订单
    new_order_id = max((o["id"] for o in orders), default=0) + 1
    order_no = _generate_order_no()

    # 计算获得积分（实付金额每1元得1积分）
    points_earned = int(pay_amount)

    new_order = {
        "id": new_order_id,
        "order_no": order_no,
        "member_id": member["id"],
        "shop_id": shop_id,
        "status": "pending",
        "payment_method": req.payment_method,
        "payment_time": None,
        "total_amount": round(total_amount, 2),
        "discount_amount": discount_amount,
        "pay_amount": pay_amount,
        "points_used": req.points_used,
        "points_earned": points_earned,
        "receiver_name": req.receiver_name,
        "receiver_phone": req.receiver_phone,
        "receiver_address": req.receiver_address,
        "remark": req.remark,
        "paid_at": None,
        "shipped_at": None,
        "delivered_at": None,
        "cancelled_at": None,
        "created_at": now,
        "updated_at": now,
    }

    # 填充订单明细的 order_id
    for item_record in order_item_records:
        item_record["order_id"] = new_order_id

    new_order["order_items"] = order_item_records

    # 扣减库存
    for p in products:
        if p["id"] in stock_updates:
            p["stock"] = stock_updates[p["id"]]
            p["sales_count"] = p.get("sales_count", 0) + next(
                item["quantity"] for item in order_item_records if item["product_id"] == p["id"]
            )

    # 扣减用户积分
    if req.points_used > 0:
        for m in db.get("members", []):
            if m["id"] == member["id"]:
                m["points"] = m.get("points", 0) - req.points_used
                break

    # 移除已下单的购物车项
    target_item_ids = {item["id"] for item in target_items}
    remaining_cart = [
        item for item in cart_items
        if item["id"] not in target_item_ids
    ]

    # 写入数据库
    orders.append(new_order)
    order_items_list.extend(order_item_records)

    db["orders"] = orders
    db["order_items"] = order_items_list
    db["cart_items"] = remaining_cart
    db["products"] = products
    _write_db(db)

    return {
        "success": True,
        "message": "订单创建成功",
        "data": _order_to_dict(new_order),
    }


@router.put("/{order_id}/cancel")
def cancel_order(request: Request, order_id: int, req: CancelOrderRequest):
    """
    取消订单
    - 仅 pending 状态的订单可取消
    - 恢复商品库存
    - 退还使用积分
    """
    member = _get_current_user(request)
    db = _read_db()
    orders = db.get("orders", [])
    order_items_list = db.get("order_items", [])
    products = db.get("products", [])

    order = next(
        (o for o in orders if o["id"] == order_id and o["member_id"] == member["id"]),
        None,
    )
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")

    if order["status"] != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"当前订单状态为「{order['status']}」，无法取消",
        )

    now = datetime.utcnow().isoformat() + "Z"
    order["status"] = "cancelled"
    order["cancelled_at"] = now
    order["updated_at"] = now
    if req.reason:
        order["cancel_reason"] = req.reason

    # 恢复库存
    items = [i for i in order_items_list if i["order_id"] == order_id]
    for item in items:
        for p in products:
            if p["id"] == item["product_id"]:
                p["stock"] = p.get("stock", 0) + item["quantity"]
                p["sales_count"] = max(0, p.get("sales_count", 0) - item["quantity"])
                break

    # 退还积分
    points_used = order.get("points_used", 0)
    if points_used > 0:
        for m in db.get("members", []):
            if m["id"] == member["id"]:
                m["points"] = m.get("points", 0) + points_used
                break

    db["orders"] = orders
    db["products"] = products
    _write_db(db)

    return {
        "success": True,
        "message": "订单已取消",
        "data": _order_to_dict(order),
    }


@router.put("/{order_id}/status")
def update_order_status(request: Request, order_id: int, req: UpdateOrderStatusRequest):
    """
    更新订单状态
    - 支持状态流转: pending -> paid -> shipped -> delivered
    - 支持 pending -> cancelled / 任意已支付 -> refunded
    """
    member = _get_current_user(request)
    db = _read_db()
    orders = db.get("orders", [])

    order = next(
        (o for o in orders if o["id"] == order_id and o["member_id"] == member["id"]),
        None,
    )
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")

    # 定义合法的状态流转
    valid_transitions = {
        "pending": ["paid", "cancelled"],
        "paid": ["shipped", "cancelled", "refunded"],
        "shipped": ["delivered", "refunded"],
        "delivered": ["refunded"],
        "cancelled": [],
        "refunded": [],
    }

    current_status = order["status"]
    allowed = valid_transitions.get(current_status, [])

    if req.status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"不允许从「{current_status}」变更为「{req.status}」",
        )

    now = datetime.utcnow().isoformat() + "Z"
    order["status"] = req.status
    order["updated_at"] = now

    # 记录各状态时间
    if req.status == "paid":
        order["paid_at"] = now
        order["payment_time"] = now
        # 支付成功后发放积分
        points_earned = order.get("points_earned", 0)
        if points_earned > 0:
            for m in db.get("members", []):
                if m["id"] == member["id"]:
                    m["points"] = m.get("points", 0) + points_earned
                    break
    elif req.status == "shipped":
        order["shipped_at"] = now
    elif req.status == "delivered":
        order["delivered_at"] = now
    elif req.status == "cancelled":
        order["cancelled_at"] = now

    db["orders"] = orders
    _write_db(db)

    return {
        "success": True,
        "message": f"订单状态已更新为「{req.status}」",
        "data": _order_to_dict(order),
    }


@router.delete("/{order_id}")
def delete_order(request: Request, order_id: int):
    """
    删除订单（仅已取消或已退款的订单可删除）
    - 同时删除关联的订单明细
    """
    member = _get_current_user(request)
    db = _read_db()
    orders = db.get("orders", [])
    order_items_list = db.get("order_items", [])

    order = next(
        (o for o in orders if o["id"] == order_id and o["member_id"] == member["id"]),
        None,
    )
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")

    if order["status"] not in ("cancelled", "refunded"):
        raise HTTPException(
            status_code=400,
            detail="仅已取消或已退款的订单可删除",
        )

    # 删除订单
    orders = [o for o in orders if o["id"] != order_id]
    # 删除关联订单明细
    order_items_list = [i for i in order_items_list if i["order_id"] != order_id]

    db["orders"] = orders
    db["order_items"] = order_items_list
    _write_db(db)

    return {
        "success": True,
        "message": "订单已删除",
    }


@router.get("/statistics/summary")
def get_order_statistics(request: Request):
    """
    获取当前用户的订单统计摘要
    - 各状态订单数量
    - 总消费金额
    """
    member = _get_current_user(request)
    db = _read_db()
    orders = db.get("orders", [])

    user_orders = [o for o in orders if o["member_id"] == member["id"]]

    status_counts = {}
    total_spent = 0.0
    for o in user_orders:
        status = o["status"]
        status_counts[status] = status_counts.get(status, 0) + 1
        if status in ("paid", "shipped", "delivered"):
            total_spent += o.get("pay_amount", 0)

    return {
        "success": True,
        "data": {
            "total_orders": len(user_orders),
            "status_counts": status_counts,
            "total_spent": round(total_spent, 2),
        },
    }
