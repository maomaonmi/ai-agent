import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from agent_factory import AgentStore


class AgentFactoryApiTests(unittest.TestCase):
    def test_crud_contract_and_not_found_semantics(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store = AgentStore(Path(temp_dir) / "agents.json")
            with patch("main.agent_store", store):
                with TestClient(main.app) as client:
                    payload = {
                        "id": "legal-reviewer",
                        "name": "⚖️ 法律审查专家",
                        "description": "审查合同条款和法律风险",
                        "system_prompt": "你是法律审查专家。识别条款风险、适用规则和需要专业律师确认的问题。",
                        "is_callable": True,
                        "when_to_use": "需要审查合同、政策合规性或识别法律风险时调用。",
                        "tools": ["read"],
                    }

                    created = client.post("/api/agents", json=payload)
                    self.assertEqual(created.status_code, 201)
                    self.assertEqual(created.json()["agent"]["id"], "legal-reviewer")

                    listed = client.get("/api/agents")
                    self.assertEqual(listed.status_code, 200)
                    self.assertEqual(listed.json()["count"], 1)

                    fetched = client.get("/api/agents/legal-reviewer")
                    self.assertEqual(fetched.status_code, 200)

                    deleted = client.delete("/api/agents/legal-reviewer")
                    self.assertEqual(deleted.status_code, 200)
                    self.assertEqual(
                        client.get("/api/agents/legal-reviewer").status_code,
                        404,
                    )
                    self.assertEqual(
                        client.delete("/api/agents/legal-reviewer").status_code,
                        404,
                    )


if __name__ == "__main__":
    unittest.main()
