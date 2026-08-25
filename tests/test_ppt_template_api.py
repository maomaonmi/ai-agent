from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from ppt_api import create_ppt_router
from ppt_repository import PptRepository


def _client(tmp_path):
    repository = PptRepository(tmp_path / "ppt.db")
    repository.initialize()
    repository.create_template(
        template_id="template-system-business",
        owner_scope="system",
        name="未来商业",
        description="现代商务汇报",
        scene="BUSINESS",
        source="SYSTEM",
        status="READY",
        manifest={"pageCount": 12, "coverAssetId": "cover-system"},
    )
    repository.create_template(
        template_id="template-private-a",
        owner_scope="owner-a",
        name="我的紫色模板",
        description="仅自己可见",
        scene="EDUCATION",
        source="PRIVATE",
        status="READY",
        manifest={"pageCount": 2, "coverAssetId": "cover-private"},
    )

    async def owner_resolver(request: Request) -> str:
        return request.headers.get("x-test-owner", "anonymous")

    app = FastAPI()
    app.include_router(create_ppt_router(repository, owner_resolver=owner_resolver))
    return TestClient(app), repository


def test_template_list_supports_pagination_filters_and_search(tmp_path) -> None:
    client, _ = _client(tmp_path)

    response = client.get(
        "/api/ppt/templates?page=1&pageSize=10&scene=BUSINESS&source=SYSTEM&q=未来",
        headers={"x-test-owner": "owner-b"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["id"] for item in payload["templates"]] == ["template-system-business"]
    assert payload["pagination"] == {
        "page": 1,
        "pageSize": 10,
        "hasMore": False,
    }
    assert "ownerScope" not in payload["templates"][0]
    assert "storagePath" not in str(payload)


def test_private_template_unauthorized_access_is_indistinguishable_from_missing(tmp_path) -> None:
    client, _ = _client(tmp_path)

    response = client.get(
        "/api/ppt/templates/template-private-a",
        headers={"x-test-owner": "owner-b"},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "PPT_TEMPLATE_NOT_FOUND"


def test_private_template_can_be_updated_and_deleted_idempotently(tmp_path) -> None:
    client, _ = _client(tmp_path)
    headers = {"x-test-owner": "owner-a"}

    updated = client.patch(
        "/api/ppt/templates/template-private-a",
        headers=headers,
        json={"name": "重命名模板", "scene": "BUSINESS"},
    )
    deleted = client.delete("/api/ppt/templates/template-private-a", headers=headers)
    deleted_again = client.delete("/api/ppt/templates/template-private-a", headers=headers)

    assert updated.status_code == 200
    assert updated.json()["name"] == "重命名模板"
    assert updated.json()["scene"] == "BUSINESS"
    assert deleted.status_code == 204
    assert deleted_again.status_code == 204


def test_system_template_cannot_be_mutated_from_market_api(tmp_path) -> None:
    client, _ = _client(tmp_path)
    headers = {"x-test-owner": "owner-a"}

    response = client.patch(
        "/api/ppt/templates/template-system-business",
        headers=headers,
        json={"name": "Hijacked"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PPT_TEMPLATE_READ_ONLY"


def test_template_pages_return_asset_urls_without_disk_paths(tmp_path) -> None:
    client, repository = _client(tmp_path)
    for asset_id, kind in (("thumb-1", "TEMPLATE_THUMBNAIL"), ("preview-1", "TEMPLATE_PREVIEW")):
        repository.create_asset(
            asset_id=asset_id,
            owner_scope="system",
            kind=kind,
            storage_path=f"system/template-system-business/{asset_id}.webp",
            mime_type="image/webp",
            size_bytes=10,
            sha256=("a" if asset_id == "thumb-1" else "b") * 64,
        )
    repository.upsert_template_page(
        template_id="template-system-business",
        page_number=1,
        status="READY",
        thumbnail_asset_id="thumb-1",
        preview_asset_id="preview-1",
    )

    response = client.get(
        "/api/ppt/templates/template-system-business/pages",
        headers={"x-test-owner": "owner-a"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "pages": [
            {
                "pageNumber": 1,
                "status": "READY",
                "thumbnailUrl": "/api/ppt/assets/thumb-1/content",
                "previewUrl": "/api/ppt/assets/preview-1/content",
            }
        ]
    }


def test_invalid_patch_uses_stable_error_contract(tmp_path) -> None:
    client, _ = _client(tmp_path)

    response = client.patch(
        "/api/ppt/templates/template-private-a",
        headers={"x-test-owner": "owner-a"},
        json={"name": "", "surprise": True},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_private_ready_template_without_pages_is_exposed_as_failed(tmp_path) -> None:
    client, repository = _client(tmp_path)
    repository.create_template(
        template_id="template-private-empty",
        owner_scope="owner-a",
        name="旧空模板",
        description=None,
        scene="CUSTOM",
        source="PRIVATE",
        status="READY",
        manifest={"pageCount": 0},
    )

    response = client.get(
        "/api/ppt/templates/template-private-empty",
        headers={"x-test-owner": "owner-a"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "FAILED"
    assert response.json()["errorCode"] == "PPT_TEMPLATE_NO_PAGES"
