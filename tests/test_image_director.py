import main
from fastapi.testclient import TestClient


def test_image_director_prefers_cogview_for_required_chinese_text():
    result = main._image_director_result(
        main.ImageDirectRequest(raw_prompt="科技感猫咪，画面带‘2026’霓虹字")
    )
    assert result["recommended_model"] == "cogview-4"
    assert "中文文字" in result["routing_reasons"][0]


def test_image_director_respects_manual_model_lock():
    result = main._image_director_result(
        main.ImageDirectRequest(
            raw_prompt="普通风景",
            model_mode="manual",
            model="glm-image",
        )
    )
    assert result["recommended_model"] == "glm-image"
    assert result["routing_reasons"] == ["用户已锁定模型"]


def test_image_model_capability_limits_turbo_to_one_output():
    turbo = next(model for model in main.IMAGE_MODEL_CAPABILITIES if model["id"] == "z-image-turbo")
    assert turbo["max_outputs"] == 1


def test_image_models_endpoint_exposes_capability_registry():
    response = TestClient(main.app).get("/api/image/models")
    assert response.status_code == 200
    assert any(model["id"] == "glm-image" for model in response.json()["models"])


def test_generation_persists_qwen_asset_without_calling_network(tmp_path, monkeypatch):
    database = main.SESSION_DB_PATH
    assets = main.IMAGE_ASSET_DIR
    main.SESSION_DB_PATH = tmp_path / "images.db"
    main.IMAGE_ASSET_DIR = tmp_path / "assets"
    main.IMAGE_ASSET_DIR.mkdir()
    main._initialize_image_store()

    async def fake_qwen(*_args, **_kwargs):
        return ["https://example.test/qwen.png"]

    async def fake_download(_url, asset_id, batch_id):
        path = main.IMAGE_ASSET_DIR / f"{asset_id}.png"
        path.write_bytes(b"png")
        return {"id": asset_id, "url": f"/api/image/assets/{asset_id}", "local_path": str(path), "mime_type": "image/png"}

    monkeypatch.setattr(main, "_call_qwen_image", fake_qwen)
    monkeypatch.setattr(main, "_download_image", fake_download)
    try:
        response = TestClient(main.app).post("/api/image/generations", json={"raw_prompt": "a cat", "model_mode": "manual", "model": "qwen-image-3.0-pro"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "succeeded"
        assert payload["images"]
        history = TestClient(main.app).get("/api/image/batches").json()
        assert history["batches"][0]["batch_id"] == payload["batch_id"]
    finally:
        main.SESSION_DB_PATH = database
        main.IMAGE_ASSET_DIR = assets


def test_generation_persists_zhipu_asset_without_calling_network(tmp_path, monkeypatch):
    database = main.SESSION_DB_PATH
    assets = main.IMAGE_ASSET_DIR
    main.SESSION_DB_PATH = tmp_path / "images.db"
    main.IMAGE_ASSET_DIR = tmp_path / "assets"
    main.IMAGE_ASSET_DIR.mkdir()
    main._initialize_image_store()

    async def fake_zhipu(*_args, **_kwargs):
        return ["https://example.test/glm.png"]

    async def fake_download(_url, asset_id, batch_id):
        path = main.IMAGE_ASSET_DIR / f"{asset_id}.png"
        path.write_bytes(b"png")
        return {"id": asset_id, "url": f"/api/image/assets/{asset_id}", "local_path": str(path), "mime_type": "image/png"}

    monkeypatch.setattr(main, "_call_zhipu_image", fake_zhipu)
    monkeypatch.setattr(main, "_download_image", fake_download)
    try:
        response = TestClient(main.app).post("/api/image/generations", json={"raw_prompt": "中文海报", "model_mode": "manual", "model": "glm-image"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "succeeded"
        assert payload["images"]
    finally:
        main.SESSION_DB_PATH = database
        main.IMAGE_ASSET_DIR = assets
