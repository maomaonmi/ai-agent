from backend.models import Product, ProductCreate, ProductUpdate, db
from typing import Optional


def get_products(
    category: Optional[str] = None,
    keyword: Optional[str] = None,
    page: int = 1,
    page_size: int = 10,
) -> dict:
    """获取商品列表，支持分类筛选、关键字搜索和分页"""
    products = list(db["products"].values())

    # 按分类筛选
    if category:
        products = [p for p in products if p.get("category") == category]

    # 按关键字搜索（匹配名称或描述）
    if keyword:
        kw = keyword.lower()
        products = [
            p
            for p in products
            if kw in p.get("name", "").lower() or kw in p.get("description", "").lower()
        ]

    # 按id升序排列
    products.sort(key=lambda x: x.get("id", 0))

    # 分页计算
    total = len(products)
    start = (page - 1) * page_size
    end = start + page_size
    paginated = products[start:end]

    return {
        "items": paginated,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size if page_size > 0 else 0,
    }


def get_product(product_id: int) -> Optional[dict]:
    """根据ID获取单个商品"""
    return db["products"].get(product_id)


def create_product(data: ProductCreate) -> dict:
    """创建商品"""
    # 生成新ID：取当前最大id + 1，若为空则从1开始
    existing_ids = list(db["products"].keys())
    new_id = max(existing_ids) + 1 if existing_ids else 1

    product = {
        "id": new_id,
        "name": data.name,
        "description": data.description,
        "price": data.price,
        "stock": data.stock,
        "category": data.category,
        "image_url": data.image_url,
        "status": data.status,
    }

    db["products"][new_id] = product
    return product


def update_product(product_id: int, data: ProductUpdate) -> Optional[dict]:
    """更新商品信息"""
    product = db["products"].get(product_id)
    if not product:
        return None

    update_data = data.model_dump(exclude_unset=True)
    product.update(update_data)
    db["products"][product_id] = product
    return product


def delete_product(product_id: int) -> bool:
    """删除商品"""
    if product_id in db["products"]:
        del db["products"][product_id]
        return True
    return False
