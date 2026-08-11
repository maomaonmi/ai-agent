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


def test_hook_source_can_be_saved_as_non_executable_draft_and_files_are_parsed():
    with TestClient(main.app) as client:
        source = client.get("/api/hooks/command_firewall/source")
        assert source.status_code == 200
        assert source.json()["executable"] is False
        saved = client.put(
            "/api/hooks/command_firewall/source",
            json={"content": "# reviewed draft\n"},
        )
        assert saved.status_code == 200
        assert saved.json()["executable"] is False
        parsed = client.post(
            "/api/hooks/parse",
            json={"filename": "security.md", "content": "name: Security\nlifecycle: before_tool_call\npolicy: block"},
        )
        assert parsed.status_code == 200
        assert parsed.json()["parsed"]["name"] == "Security"
        assert parsed.json()["executable"] is False


def test_hook_ai_draft_is_limited_to_declarative_metadata(monkeypatch):
    monkeypatch.setattr(
        main,
        "plan_llm_invoke",
        lambda *_args, **_kwargs: '{"name":"PII","description":"mask","lifecycle":"before_llm_call","policy":"transform","priority":10}',
    )
    with TestClient(main.app) as client:
        response = client.post("/api/hooks/draft", json={"prompt": "在 LLM 调用前脱敏"})
        assert response.status_code == 200
        payload = response.json()
        assert payload["parsed"]["lifecycle"] == "before_llm_call"
        assert payload["executable"] is False
