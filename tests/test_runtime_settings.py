import unittest

from pydantic import ValidationError

from main import (
    ChatRequest,
    RuntimeSettings,
    get_response_limits,
    resolve_runtime_mode,
    should_use_minimax_native_loop,
)


class RuntimeSettingsContractTests(unittest.TestCase):
    def test_defaults_are_balanced_and_automatic(self):
        settings = RuntimeSettings()

        self.assertEqual(settings.response_length, "balanced")
        self.assertEqual(settings.web_search, "auto")
        self.assertEqual(settings.deep_thinking, "auto")
        self.assertEqual(settings.discussion_rounds, 2)

    def test_request_rejects_unknown_setting_values(self):
        with self.assertRaises(ValidationError):
            ChatRequest(
                message="hello",
                runtime_settings={"web_search": "sometimes"},
            )
        with self.assertRaises(ValidationError):
            ChatRequest(
                message="hello",
                runtime_settings={"discussion_rounds": 6},
            )

    def test_forced_capabilities_override_regular_chat_mode(self):
        self.assertEqual(
            resolve_runtime_mode(
                "standard",
                RuntimeSettings(web_search="on", deep_thinking="auto"),
            ),
            ("standard", True, False),
        )
        self.assertEqual(
            resolve_runtime_mode(
                "standard",
                RuntimeSettings(web_search="off", deep_thinking="on"),
            ),
            ("standard", False, True),
        )
        self.assertEqual(
            resolve_runtime_mode(
                "web",
                RuntimeSettings(web_search="on", deep_thinking="on"),
            ),
            ("web", True, True),
        )

    def test_disabled_capabilities_downgrade_regular_chat_mode(self):
        self.assertEqual(
            resolve_runtime_mode(
                "web",
                RuntimeSettings(web_search="off", deep_thinking="off"),
            ),
            ("web", False, False),
        )
        self.assertEqual(
            resolve_runtime_mode(
                "deep",
                RuntimeSettings(web_search="auto", deep_thinking="off"),
            ),
            ("deep", False, False),
        )

    def test_specialized_workflows_keep_their_mode(self):
        settings = RuntimeSettings(web_search="off", deep_thinking="off")
        for mode in ("research", "agent", "plan", "distributed_plan"):
            resolved, _, _ = resolve_runtime_mode(mode, settings)
            self.assertEqual(resolved, mode)

    def test_response_token_budgets_increase_by_length(self):
        brief = get_response_limits("brief")
        balanced = get_response_limits("balanced")
        detailed = get_response_limits("detailed")

        self.assertLess(brief["answer_tokens"], balanced["answer_tokens"])
        self.assertLess(balanced["answer_tokens"], detailed["answer_tokens"])

    def test_minimax_native_loop_is_required_for_web_or_deep_without_mcp(self):
        self.assertTrue(should_use_minimax_native_loop("minimax", "off", True, False))
        self.assertTrue(should_use_minimax_native_loop("minimax", "off", False, True))
        self.assertFalse(should_use_minimax_native_loop("minimax", "off", False, False))
        self.assertFalse(should_use_minimax_native_loop("qwen", "off", True, True))


if __name__ == "__main__":
    unittest.main()
