from fastapi.testclient import TestClient

import main


def test_hook_api_lists_builtin_hooks_and_toggles_one():
    with TestClient(main.app) as client:
        response = client.get("/api/hooks")
        assert response.status_code == 200
        payload = response.json()
        assert payload["count"] >= 2
        firewall = next(item for item in payload["hooks"] if item["id"] == "command_firewall")
        original = firewall["enabled"]

        toggled = client.put(
            "/api/hooks/command_firewall/toggle",
            json={"enabled": not original},
        )

        assert toggled.status_code == 200
        assert toggled.json()["hook"]["enabled"] is (not original)

        restored = client.put(
            "/api/hooks/command_firewall/toggle",
            json={"enabled": original},
        )
        assert restored.status_code == 200


def test_hook_api_returns_not_found_for_unknown_hook():
    with TestClient(main.app) as client:
        response = client.put("/api/hooks/missing/toggle", json={"enabled": True})
        assert response.status_code == 404
