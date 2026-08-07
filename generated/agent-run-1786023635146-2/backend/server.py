from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import json
import os

app = FastAPI(title="LUXE MALL API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.path.join(os.path.dirname(__file__), "database.json")


def load_db():
    with open(DB_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_db(data):
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


@app.get("/api/categories")
def get_categories():
    db = load_db()
    return db["categories"]


@app.get("/api/products")
def get_products():
    db = load_db()
    return db["products"]


@app.get("/api/products/{product_id}")
def get_product(product_id: int):
    db = load_db()
    for p in db["products"]:
        if p["id"] == product_id:
            return p
    return {"error": "Product not found"}, 404


@app.get("/api/cart")
def get_cart():
    db = load_db()
    return db["cart"]


@app.post("/api/cart")
def add_to_cart(body: dict):
    db = load_db()
    product_id = body.get("product_id")
    quantity = body.get("quantity", 1)
    existing = None
    for item in db["cart"]:
        if item["product_id"] == product_id:
            existing = item
            break
    if existing:
        existing["quantity"] += quantity
    else:
        max_id = max((item["id"] for item in db["cart"]), default=0)
        db["cart"].append({
            "id": max_id + 1,
            "product_id": product_id,
            "quantity": quantity
        })
    save_db(db)
    return {"status": "ok"}


@app.put("/api/cart/{item_id}")
def update_cart_item(item_id: int, body: dict):
    db = load_db()
    quantity = body.get("quantity", 1)
    for item in db["cart"]:
        if item["id"] == item_id:
            item["quantity"] = quantity
            save_db(db)
            return {"status": "ok"}
    return {"error": "Cart item not found"}, 404


@app.delete("/api/cart/{item_id}")
def delete_cart_item(item_id: int):
    db = load_db()
    db["cart"] = [item for item in db["cart"] if item["id"] != item_id]
    save_db(db)
    return {"status": "ok"}


@app.delete("/api/cart")
def clear_cart():
    db = load_db()
    db["cart"] = []
    save_db(db)
    return {"status": "ok"}
