from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="商场管理系统", version="1.0.0")

# 允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "message": "商场管理系统后端服务运行中"}


# ========== 商铺模块 ==========

@app.get("/api/shops")
def get_shops():
    return []


@app.get("/api/shops/{shop_id}")
def get_shop(shop_id: int):
    return {"id": shop_id}


@app.post("/api/shops")
def create_shop():
    return {"id": 1}


@app.put("/api/shops/{shop_id}")
def update_shop(shop_id: int):
    return {"id": shop_id}


@app.delete("/api/shops/{shop_id}")
def delete_shop(shop_id: int):
    return {"id": shop_id}


# ========== 商品模块 ==========

@app.get("/api/products")
def get_products():
    return []


@app.get("/api/products/{product_id}")
def get_product(product_id: int):
    return {"id": product_id}


@app.post("/api/products")
def create_product():
    return {"id": 1}


@app.put("/api/products/{product_id}")
def update_product(product_id: int):
    return {"id": product_id}


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int):
    return {"id": product_id}


# ========== 订单模块 ==========

@app.get("/api/orders")
def get_orders():
    return []


@app.get("/api/orders/{order_id}")
def get_order(order_id: int):
    return {"id": order_id}


@app.post("/api/orders")
def create_order():
    return {"id": 1}


@app.put("/api/orders/{order_id}")
def update_order(order_id: int):
    return {"id": order_id}


@app.delete("/api/orders/{order_id}")
def delete_order(order_id: int):
    return {"id": order_id}


# ========== 会员模块 ==========

@app.get("/api/members")
def get_members():
    return []


@app.get("/api/members/{member_id}")
def get_member(member_id: int):
    return {"id": member_id}


@app.post("/api/members")
def create_member():
    return {"id": 1}


@app.put("/api/members/{member_id}")
def update_member(member_id: int):
    return {"id": member_id}


@app.delete("/api/members/{member_id}")
def delete_member(member_id: int):
    return {"id": member_id}
