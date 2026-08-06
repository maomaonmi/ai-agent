"""
商品管理接口 - 只读API
包含：商品列表(分页/筛选/排序)、商品详情、分类列表
"""

from fastapi import APIRouter, Query, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, desc, asc
from typing import Optional
import json

from backend.models import Product, ProductCategory, Shop, Base

router = APIRouter(prefix="/api/products", tags=["商品管理"])


# ==================== 工具函数 ====================

def get_db() -> Session:
    """获取数据库会话（后续可替换为依赖注入）"""
    from backend.main import SessionLocal
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def product_to_dict(product: Product) -> dict:
    """将 Product ORM 对象序列化为字典"""
    images = []
    if product.images:
        try:
            images = json.loads(product.images)
        except (json.JSONDecodeError, TypeError):
            images = []

    return {
        "id": product.id,
        "name": product.name,
        "description": product.description,
        "main_image": product.main_image,
        "images": images,
        "price": product.price,
        "original_price": product.original_price,
        "cost_price": product.cost_price,
        "stock": product.stock,
        "sales_count": product.sales_count,
        "unit": product.unit,
        "barcode": product.barcode,
        "weight": product.weight,
        "is_on_sale": product.is_on_sale,
        "is_recommend": product.is_recommend,
        "category_id": product.category_id,
        "shop_id": product.shop_id,
        "category": {
            "id": product.category.id,
            "name": product.category.name,
            "icon": product.category.icon,
            "parent_id": product.category.parent_id,
        } if product.category else None,
        "shop": {
            "id": product.shop.id,
            "name": product.shop.name,
            "logo": product.shop.logo,
            "rating": product.shop.rating,
        } if product.shop else None,
        "created_at": product.created_at.isoformat() if product.created_at else None,
        "updated_at": product.updated_at.isoformat() if product.updated_at else None,
    }


def category_to_dict(category: ProductCategory, include_children: bool = False) -> dict:
    """将 ProductCategory ORM 对象序列化为字典"""
    result = {
        "id": category.id,
        "name": category.name,
        "icon": category.icon,
        "parent_id": category.parent_id,
        "shop_id": category.shop_id,
        "sort_order": category.sort_order,
        "is_active": category.is_active,
        "created_at": category.created_at.isoformat() if category.created_at else None,
    }
    if include_children and hasattr(category, "children"):
        result["children"] = [
            category_to_dict(child) for child in category.children
        ]
    return result


# ==================== 商品列表接口 ====================

@router.get("")
def get_products(
    category_id: Optional[int] = Query(None, description="按分类ID筛选"),
    shop_id: Optional[int] = Query(None, description="按商铺ID筛选"),
    keyword: Optional[str] = Query(None, description="搜索关键词(商品名称/描述)"),
    is_on_sale: Optional[bool] = Query(None, description="是否上架"),
    is_recommend: Optional[bool] = Query(None, description="是否推荐"),
    min_price: Optional[float] = Query(None, description="最低价格"),
    max_price: Optional[float] = Query(None, description="最高价格"),
    sort_by: str = Query("created_at", description="排序字段: created_at/price/sales_count"),
    sort_order: str = Query("desc", description="排序方向: asc/desc"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
):
    """
    获取商品列表
    支持按分类、商铺、关键词、价格区间筛选，支持分页和排序
    """
    db = next(get_db())

    try:
        # 构建基础查询，预加载关联数据
        query = db.query(Product).options(
            joinedload(Product.category),
            joinedload(Product.shop),
        )

        # 筛选条件
        if category_id is not None:
            # 同时包含该分类及其子分类下的商品
            category_ids = [category_id]
            sub_categories = db.query(ProductCategory.id).filter(
                ProductCategory.parent_id == category_id,
                ProductCategory.is_active == True,
            ).all()
            category_ids.extend([c.id for c in sub_categories])
            query = query.filter(Product.category_id.in_(category_ids))

        if shop_id is not None:
            query = query.filter(Product.shop_id == shop_id)

        if keyword is not None and keyword.strip():
            like_pattern = f"%{keyword.strip()}%"
            query = query.filter(
                or_(
                    Product.name.like(like_pattern),
                    Product.description.like(like_pattern),
                    Product.barcode.like(like_pattern),
                )
            )

        if is_on_sale is not None:
            query = query.filter(Product.is_on_sale == is_on_sale)

        if is_recommend is not None:
            query = query.filter(Product.is_recommend == is_recommend)

        if min_price is not None:
            query = query.filter(Product.price >= min_price)

        if max_price is not None:
            query = query.filter(Product.price <= max_price)

        # 排序
        sort_column = {
            "created_at": Product.created_at,
            "price": Product.price,
            "sales_count": Product.sales_count,
            "name": Product.name,
        }.get(sort_by, Product.created_at)

        if sort_order.lower() == "asc":
            query = query.order_by(asc(sort_column))
        else:
            query = query.order_by(desc(sort_column))

        # 计算总数
        total = query.count()

        # 分页
        offset = (page - 1) * page_size
        products = query.offset(offset).limit(page_size).all()

        return {
            "items": [product_to_dict(p) for p in products],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
        }
    finally:
        db.close()


# ==================== 商品详情接口 ====================

@router.get("/{product_id}")
def get_product(product_id: int):
    """
    获取商品详情
    根据商品ID返回完整的商品信息，包含分类和商铺信息
    """
    db = next(get_db())

    try:
        product = db.query(Product).options(
            joinedload(Product.category),
            joinedload(Product.shop),
        ).filter(Product.id == product_id).first()

        if product is None:
            raise HTTPException(status_code=404, detail=f"商品不存在 (id={product_id})")

        return product_to_dict(product)
    finally:
        db.close()


# ==================== 商品分类列表接口 ====================

@router.get("/categories/list", tags=["商品分类"])
def get_categories(
    shop_id: Optional[int] = Query(None, description="按商铺ID筛选分类"),
    parent_id: Optional[int] = Query(None, description="父分类ID，不传则返回顶级分类"),
    include_children: bool = Query(False, description="是否包含子分类"),
):
    """
    获取商品分类列表
    支持按商铺筛选、按父分类筛选，可返回树形结构
    """
    db = next(get_db())

    try:
        query = db.query(ProductCategory).filter(
            ProductCategory.is_active == True,
        )

        if shop_id is not None:
            # 返回全局分类 + 该商铺专属分类
            query = query.filter(
                or_(
                    ProductCategory.shop_id == None,
                    ProductCategory.shop_id == shop_id,
                )
            )

        if parent_id is not None:
            query = query.filter(ProductCategory.parent_id == parent_id)
        else:
            # 不传 parent_id 时返回顶级分类
            query = query.filter(ProductCategory.parent_id == None)

        query = query.order_by(asc(ProductCategory.sort_order), asc(ProductCategory.id))

        if include_children:
            # 预加载子分类
            query = query.options(joinedload(ProductCategory.children))

        categories = query.all()

        return {
            "items": [category_to_dict(c, include_children=include_children) for c in categories],
            "total": len(categories),
        }
    finally:
        db.close()


# ==================== 推荐商品接口 ====================

@router.get("/recommend/list", tags=["推荐商品"])
def get_recommend_products(
    limit: int = Query(10, ge=1, le=50, description="返回数量"),
    shop_id: Optional[int] = Query(None, description="限定商铺"),
):
    """
    获取推荐商品列表
    返回标记为推荐且已上架的商品，按销量降序排列
    """
    db = next(get_db())

    try:
        query = db.query(Product).options(
            joinedload(Product.category),
            joinedload(Product.shop),
        ).filter(
            Product.is_recommend == True,
            Product.is_on_sale == True,
        )

        if shop_id is not None:
            query = query.filter(Product.shop_id == shop_id)

        products = query.order_by(desc(Product.sales_count)).limit(limit).all()

        return {
            "items": [product_to_dict(p) for p in products],
            "total": len(products),
        }
    finally:
        db.close()


# ==================== 热销商品接口 ====================

@router.get("/hot/list", tags=["热销商品"])
def get_hot_products(
    limit: int = Query(10, ge=1, le=50, description="返回数量"),
    shop_id: Optional[int] = Query(None, description="限定商铺"),
):
    """
    获取热销商品列表
    返回已上架商品中销量最高的商品
    """
    db = next(get_db())

    try:
        query = db.query(Product).options(
            joinedload(Product.category),
            joinedload(Product.shop),
        ).filter(Product.is_on_sale == True)

        if shop_id is not None:
            query = query.filter(Product.shop_id == shop_id)

        products = query.order_by(desc(Product.sales_count)).limit(limit).all()

        return {
            "items": [product_to_dict(p) for p in products],
            "total": len(products),
        }
    finally:
        db.close()
