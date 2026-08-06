import json
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from agent_factory import (
    AgentConfig,
    AgentStore,
    AgentStoreCorruptedError,
    generate_agent_config,
)


def valid_agent(**overrides):
    data = {
        "id": "pytest-expert",
        "name": "🐍 Python 测试专家",
        "description": "设计和审查 Python 自动化测试",
        "system_prompt": "你是 Python 测试专家。请设计可维护、可复现且覆盖边界条件的测试方案。",
        "is_callable": True,
        "when_to_use": "需要编写单元测试、复现缺陷或评估测试覆盖率时调用。",
        "tools": ["read", "terminal", "read"],
    }
    data.update(overrides)
    return AgentConfig(**data)


class AgentConfigTests(unittest.TestCase):
    def test_rejects_invalid_agent_id_and_unknown_tool(self):
        with self.assertRaises(ValidationError):
            valid_agent(id="../unsafe", tools=["shell"])

    def test_deduplicates_allowed_tools(self):
        agent = valid_agent()
        self.assertEqual(agent.tools, ["read", "terminal"])


class AgentStoreTests(unittest.TestCase):
    def test_crud_persists_across_store_instances(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "agents.json"
            first_store = AgentStore(path)
            first_store.upsert(valid_agent())

            second_store = AgentStore(path)
            self.assertEqual(second_store.get("pytest-expert").name, "🐍 Python 测试专家")
            self.assertEqual(len(second_store.list()), 1)
            self.assertTrue(second_store.delete("pytest-expert"))
            self.assertIsNone(second_store.get("pytest-expert"))
            self.assertFalse(second_store.delete("pytest-expert"))

    def test_corrupted_store_is_not_treated_as_empty(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "agents.json"
            path.write_text("{invalid", encoding="utf-8")

            with self.assertRaises(AgentStoreCorruptedError):
                AgentStore(path).list()


class MetaGeneratorTests(unittest.TestCase):
    def test_generated_json_is_validated_and_normalized(self):
        def fake_llm(_system_prompt, _user_content):
            return """```json
            {
              "id": "market-researcher",
              "name": "📈 市场研究专家",
              "description": "研究市场与竞品",
              "system_prompt": "你是市场研究专家。基于可信信息分析市场、竞争格局和商业机会。",
              "is_callable": true,
              "when_to_use": "需要市场规模、竞品信息或商业机会分析时调用。",
              "tools": ["web_search", "web_search"]
            }
            ```"""

        generated = generate_agent_config("帮我研究市场", fake_llm)

        self.assertEqual(generated.id, "market-researcher")
        self.assertEqual(generated.tools, ["web_search"])

    def test_generated_non_json_fails_validation(self):
        with self.assertRaises(ValueError):
            generate_agent_config("测试", lambda _system, _user: "not json")


if __name__ == "__main__":
    unittest.main()
