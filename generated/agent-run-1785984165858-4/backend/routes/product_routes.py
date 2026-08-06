from fastapi import APIRouter, Query, HTTPException
from typing import Optional

from backend.controllers import product_controller
from backend.models import ProductCreate, ProductUpdate

router = APIRouter(prefix="/api/products", tags=["products"])


@router.get("")
def list_products(
    category: Optional[str] = Query(None, description="按分类筛选"),
    keyword: Optional[str] = Query(None, description="关键字搜索"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(10, ge=1, le=100, description="每页数量"),
):
    """获取商品列表，支持分类筛选、关键字搜索和分页"""
    result = product_controller.get_products(
        category=category,
        keyword=keyword,
        page=page,
        page_size=page_size,
    )
    return result


@router.get("/{product_id}")
def get_product(product_id: int):
    """根据ID获取单个商品"""
    product = product_controller.get_product(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    return product


@router.post("")
def create_product(data: ProductCreate):
    """创建商品"""
    product = product_controller.create_product(data)
    return product


@router.put("/{product_id}")
def update_product(product_id: int, data: ProductUpdate):
    """更新商品信息"""
    product = product_controller.update_product(product_id, data)
    if not product:
        raise HTTPException(status_code=404, detail="商品不存在")
    return product


@router.delete("/{product_id}")
def delete_product(product_id: int):
    """删除商品"""
    success = product_controller.delete_product(product_id)
    if not success:
        raise HTTPException(status_code=404, detail="商品不存在")
    return {"detail": "删除成功"}
