from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="商场系统 API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- 商品 ----------
@app.get("/api/products")
def list_products():
    return []


@app.post("/api/products")
def create_product():
    return {"id": 0}


@app.get("/api/products/{item_id}")
def get_product(item_id: int):
    return {"id": item_id}


@app.put("/api/products/{item_id}")
def update_product(item_id: int):
    return {"id": item_id}


@app.delete("/api/products/{item_id}")
def delete_product(item_id: int):
    return {"id": item_id}


# ---------- 订单 ----------
@app.get("/api/orders")
def list_orders():
    return []


@app.post("/api/orders")
def create_order():
    return {"id": 0}


@app.get("/api/orders/{item_id}")
def get_order(item_id: int):
    return {"id": item_id}


@app.put("/api/orders/{item_id}")
def update_order(item_id: int):
    return {"id": item_id}


@app.delete("/api/orders/{item_id}")
def delete_order(item_id: int):
    return {"id": item_id}


# ---------- 分类 ----------
@app.get("/api/categories")
def list_categories():
    return []


@app.post("/api/categories")
def create_category():
    return {"id": 0}


@app.get("/api/categories/{item_id}")
def get_category(item_id: int):
    return {"id": item_id}


@app.put("/api/categories/{item_id}")
def update_category(item_id: int):
    return {"id": item_id}


@app.delete("/api/categories/{item_id}")
def delete_category(item_id: int):
    return {"id": item_id}
