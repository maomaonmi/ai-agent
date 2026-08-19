import asyncio
import sqlite3
import time

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


def test_research_figure_job_inserts_with_matching_columns(tmp_path, monkeypatch):
    database = main.SESSION_DB_PATH
    main.SESSION_DB_PATH = tmp_path / "research-figures.db"
    main._initialize_image_store()

    async def fake_run(*_args, **_kwargs):
        return None

    monkeypatch.setattr(main, "_run_research_figure_job", fake_run)
    try:
        response = TestClient(main.app).post(
            "/api/research/figures/jobs",
            json={"session_id": "test-session", "report_version": "v1", "report": "这是一篇足够长的研究报告正文，用于验证研究配图任务可以正确入库并返回任务状态。" * 4},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "queued"
    finally:
        main.RESEARCH_FIGURE_TASKS.clear()
        main.SESSION_DB_PATH = database


def test_research_figure_batches_persist_by_chapter(tmp_path, monkeypatch):
    database = main.SESSION_DB_PATH
    assets = main.IMAGE_ASSET_DIR
    main.SESSION_DB_PATH = tmp_path / "research-batches.db"
    main.IMAGE_ASSET_DIR = tmp_path / "assets"
    main.IMAGE_ASSET_DIR.mkdir()
    main._initialize_image_store()
    job_id = "research-batch-test"
    report = "\n".join([
        "# 第一章 背景",
        "背景内容。" * 120,
        "# 第二章 方法",
        "方法内容。" * 120,
    ])
    with sqlite3.connect(main.SESSION_DB_PATH) as connection:
        connection.execute(
            "INSERT INTO research_figure_jobs (id, session_id, report_version, report_hash, report_text, policy, max_images, context_mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (job_id, "session-1", "v1", "hash-1", report, "economy", 4, "mixed", "queued", time.time()),
        )
        connection.commit()

    async def fake_generate(*_args, **_kwargs):
        return ["https://example.test/figure.png"]

    async def fake_download(_url, asset_id, batch_id):
        path = main.IMAGE_ASSET_DIR / f"{asset_id}.png"
        path.write_bytes(b"png")
        return {"id": asset_id, "url": f"/api/image/assets/{asset_id}", "local_path": str(path), "mime_type": "image/png"}

    monkeypatch.setattr(main, "_call_dashscope_multimodal_image", fake_generate)
    monkeypatch.setattr(main, "_download_image", fake_download)
    try:
        asyncio.run(main._run_research_figure_job(job_id, report, "economy"))
        payload = main._research_job_payload(job_id)
        assert payload["status"] == "succeeded"
        assert payload["total_batches"] >= 2
        assert all(figure["batch_title"] for figure in payload["figures"])
        assert all(batch["status"] == "succeeded" for batch in payload["batches"])
    finally:
        main.SESSION_DB_PATH = database
        main.IMAGE_ASSET_DIR = assets


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
