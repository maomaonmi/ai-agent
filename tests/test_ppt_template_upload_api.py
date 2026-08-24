from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import ppt_api
from ppt_api import create_ppt_router
from ppt_repository import PptRepository


class FakePipeline:
    def render(self, source: Path, output_dir: Path):
        output_dir.mkdir(parents=True, exist_ok=True)
        thumb = output_dir / "page-0001-thumbnail.webp"
        preview = output_dir / "page-0001-preview.webp"
        thumb.write_bytes(b"thumb")
        preview.write_bytes(b"preview")
        return SimpleNamespace(
            page_count=1,
            width=960,
            height=540,
            pages=(SimpleNamespace(page_number=1, title="真实页面 1", thumbnail_path=thumb, preview_path=preview),),
        )


def _client(tmp_path: Path) -> tuple[TestClient, PptRepository]:
    repository = PptRepository(tmp_path / "ppt.db")

    async def owner_resolver(request: Request) -> str:
        return request.headers.get("x-test-owner", "owner-a")

    app = FastAPI()
    app.include_router(create_ppt_router(repository, owner_resolver=owner_resolver, asset_root=tmp_path / "assets"))
    return TestClient(app), repository


def test_upload_persists_source_and_real_page_records(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(ppt_api, "PptTemplatePipeline", FakePipeline)
    client, repository = _client(tmp_path)

    response = client.post(
        "/api/ppt/templates",
        headers={"x-test-owner": "owner-a"},
        files={"file": ("真实模板.pptx", b"ppt source", "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["source"] == "PRIVATE"
    template_id = payload["id"]
    persisted = client.get(f"/api/ppt/templates/{template_id}", headers={"x-test-owner": "owner-a"})
    assert persisted.status_code == 200
    assert persisted.json()["status"] == "READY"
    assert persisted.json()["pageCount"] == 1
    pages = client.get(f"/api/ppt/templates/{template_id}/pages", headers={"x-test-owner": "owner-a"})
    assert pages.status_code == 200
    assert pages.json()["pages"][0]["thumbnailUrl"].startswith("/api/ppt/assets/")
    assert pages.json()["pages"][0]["previewUrl"].startswith("/api/ppt/assets/")
    assert pages.json()["pages"][0]["title"] == "真实页面 1"
    assert repository.get_template(template_id, owner_scope="owner-a") is not None


def test_upload_rejects_non_ppt_files(tmp_path: Path) -> None:
    client, _ = _client(tmp_path)
    response = client.post(
        "/api/ppt/templates",
        files={"file": ("not-an-image.png", b"image", "image/png")},
    )
    assert response.status_code == 415
    assert response.json()["error"]["code"] == "PPT_TEMPLATE_UNSUPPORTED_FORMAT"
