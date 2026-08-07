"""千问供应商接入：能力矩阵、参数协议分发与 profile 持久化的单元测试。"""

import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError

from model_settings import ModelSettings, ModelSettingsStore, capabilities_for_model, ensure_direct_connection
from App import patch_is_idempotent, stream_json_completion


class _FakeCompletions:
    """捕获 create kwargs 并返回最小可用流式响应的假客户端。"""

    def __init__(self):
        self.captured_kwargs: dict | None = None

    async def create(self, **kwargs):
        self.captured_kwargs = kwargs
        delta = SimpleNamespace(content='{"answer": "ok"}', reasoning_content=None)
        chunk = SimpleNamespace(choices=[SimpleNamespace(delta=delta)])

        async def _stream():
            yield chunk

        return _stream()


class _FakeClient:
    def __init__(self):
        self.completions = _FakeCompletions()

    @property
    def chat(self):
        return self


def _run(coro):
    return asyncio.run(coro)


class CapabilitiesTests(unittest.TestCase):
    def test_glm_disables_json_format_and_uses_glm_thinking(self):
        caps = capabilities_for_model("glm-5v-turbo")
        self.assertFalse(caps.supports_json_format)
        self.assertEqual(caps.thinking_control, "glm")
        self.assertTrue(caps.supports_vision)

    def test_qwen_text_model_uses_budget_thinking_without_vision(self):
        caps = capabilities_for_model("qwen3.7-plus")
        self.assertTrue(caps.supports_json_format)
        self.assertEqual(caps.thinking_control, "qwen_budget")
        self.assertFalse(caps.supports_vision)

    def test_qwen_vl_model_supports_vision(self):
        self.assertTrue(capabilities_for_model("qwen-vl-max").supports_vision)

    def test_unknown_model_falls_back_to_plain_openai(self):
        caps = capabilities_for_model("deepseek-chat")
        self.assertTrue(caps.supports_json_format)
        self.assertEqual(caps.thinking_control, "none")
        self.assertFalse(caps.supports_vision)


class QwenProfileTests(unittest.TestCase):
    def test_qwen_default_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ModelSettingsStore(Path(directory) / "settings.json")
            profile = store.load("qwen")
            self.assertEqual(profile.provider, "qwen")
            self.assertEqual(profile.base_url, "https://dashscope.aliyuncs.com/compatible-mode/v1")
            self.assertEqual(profile.model_id, "qwen3.7-plus")
            self.assertEqual(profile.thinking_budget, 8_000)

    def test_qwen_profile_round_trip_and_key_isolation(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ModelSettingsStore(Path(directory) / "settings.json")
            store.save(ModelSettings(provider="qwen", api_key="sk-ws-secret", thinking_budget=2_000))
            store.save(ModelSettings(provider="deepseek", api_key="deepseek-secret"))
            self.assertEqual(store.load("qwen").api_key, "sk-ws-secret")
            self.assertEqual(store.load("qwen").thinking_budget, 2_000)
            self.assertEqual(store.load("deepseek").api_key, "deepseek-secret")
            self.assertNotIn("api_key", store.public("qwen"))

    def test_thinking_budget_bounds_are_validated(self):
        with self.assertRaises(ValidationError):
            ModelSettings(provider="qwen", thinking_budget=100)
        with self.assertRaises(ValidationError):
            ModelSettings(provider="qwen", thinking_budget=100_000)


class QwenThinkingDispatchTests(unittest.TestCase):
    def _capture(self, model: str, **overrides) -> dict:
        client = _FakeClient()
        kwargs = dict(
            model=model,
            messages=[{"role": "user", "content": "hi"}],
            temperature=0.2,
            max_tokens=16_000,
        )
        kwargs.update(overrides)
        content, _events = _run(stream_json_completion(client, **kwargs))
        self.assertEqual(content, '{"answer": "ok"}')
        return client.completions.captured_kwargs

    def test_qwen_gets_enable_thinking_and_budget_not_glm_fields(self):
        captured = self._capture("qwen3.7-plus", thinking_budget=8_000)
        extra = captured["extra_body"]
        self.assertEqual(extra, {"enable_thinking": True, "thinking_budget": 8_000})
        self.assertNotIn("thinking", extra)
        self.assertIn("response_format", captured)

    def test_qwen_thinking_disabled_omits_budget(self):
        captured = self._capture("qwen3.7-plus", thinking="disabled", thinking_budget=8_000)
        self.assertEqual(captured["extra_body"], {"enable_thinking": False})

    def test_qwen_budget_is_clamped_below_max_tokens(self):
        captured = self._capture("qwen3.7-plus", max_tokens=4_000, thinking_budget=16_000)
        self.assertLessEqual(captured["extra_body"]["thinking_budget"], 4_000 - 1_024)

    def test_glm_regression_keeps_glm_thinking_format(self):
        captured = self._capture("glm-5-turbo", reasoning_effort="high")
        self.assertEqual(captured["extra_body"], {"thinking": {"type": "enabled", "reasoning_effort": "high"}})
        self.assertNotIn("response_format", captured)

    def test_deepseek_keeps_json_format_without_extra_body(self):
        captured = self._capture("deepseek-chat")
        self.assertIn("response_format", captured)
        self.assertNotIn("extra_body", captured)


class DirectConnectionTests(unittest.TestCase):
    def test_host_is_appended_to_no_proxy_idempotently(self):
        saved = os.environ.pop("NO_PROXY", None)
        try:
            ensure_direct_connection("https://dashscope.aliyuncs.com/compatible-mode/v1")
            self.assertEqual(os.environ["NO_PROXY"], "dashscope.aliyuncs.com")
            ensure_direct_connection("https://dashscope.aliyuncs.com/compatible-mode/v1")
            self.assertEqual(os.environ["NO_PROXY"], "dashscope.aliyuncs.com")
            ensure_direct_connection("https://open.bigmodel.cn/api/paas/v4")
            self.assertEqual(os.environ["NO_PROXY"], "dashscope.aliyuncs.com,open.bigmodel.cn")
        finally:
            if saved is None:
                os.environ.pop("NO_PROXY", None)
            else:
                os.environ["NO_PROXY"] = saved

    def test_blank_url_is_noop(self):
        ensure_direct_connection("")


class IdempotentPatchTests(unittest.TestCase):
    """千问"需求已满足"幂等补丁识别——target==content 应被判定为已满足而非拒绝重试。"""

    VFS = {"frontend/styles.css": ".hero-slide {\n  background: url('a.png');\n}\n"}

    def test_target_equals_content_is_idempotent(self):
        ops = [{
            "file": "frontend/styles.css", "op": "replace",
            "target": ".hero-slide {\n  background: url('a.png');\n}",
            "content": ".hero-slide {\n  background: url('a.png');\n}",
        }]
        self.assertTrue(patch_is_idempotent(self.VFS, ops))

    def test_real_change_is_not_idempotent(self):
        ops = [{
            "file": "frontend/styles.css", "op": "replace",
            "target": ".hero-slide {",
            "content": ".hero-slide {\n  filter: blur(2px);",
        }]
        self.assertFalse(patch_is_idempotent(self.VFS, ops))

    def test_empty_operations_is_not_idempotent(self):
        self.assertFalse(patch_is_idempotent(self.VFS, []))

    def test_target_not_in_source_is_not_idempotent(self):
        ops = [{
            "file": "frontend/styles.css", "op": "replace",
            "target": ".not-exists { color: red; }",
            "content": ".not-exists { color: red; }",
        }]
        self.assertFalse(patch_is_idempotent(self.VFS, ops))


if __name__ == "__main__":
    unittest.main()
