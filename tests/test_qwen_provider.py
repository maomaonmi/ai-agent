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

    def test_deepseek_v4_uses_deepseek_thinking_protocol(self):
        """Why: DeepSeek V4 升级后走 deepseek 思考协议（extra_body.thinking + 顶层 reasoning_effort），
        不再走兜底 none 分支。"""
        caps = capabilities_for_model("deepseek-v4-flash")
        self.assertTrue(caps.supports_json_format)
        self.assertEqual(caps.thinking_control, "deepseek")
        self.assertFalse(caps.supports_vision)

        caps_pro = capabilities_for_model("deepseek-v4-pro")
        self.assertEqual(caps_pro.thinking_control, "deepseek")

    def test_unknown_model_falls_back_to_plain_openai(self):
        # Why: 用真正未注册的模型 ID 验证兜底分支，不再是 deepseek-chat（已升级为 v4-flash）。
        caps = capabilities_for_model("some-unknown-model-xyz")
        self.assertTrue(caps.supports_json_format)
        self.assertEqual(caps.thinking_control, "none")
        self.assertFalse(caps.supports_vision)

    def test_capabilities_for_model_uses_catalog_not_string_sniff(self):
        """Why: 验证能力判断走 MODEL_CATALOG 查表，而非历史字符串嗅探。
        若改回字符串嗅探，deepseek-v4-flash 会命中兜底返回 thinking_control='none'。"""
        from model_settings import MODEL_CATALOG
        # 遍历 catalog 中所有模型 ID，验证 capabilities_for_model 返回值与 catalog 字段一致
        for provider_variants in MODEL_CATALOG.values():
            for variant in provider_variants:
                caps = capabilities_for_model(variant["model_id"])
                self.assertEqual(
                    caps.thinking_control,
                    variant.get("thinking_control", "none"),
                    f"thinking_control mismatch for {variant['model_id']}",
                )
                self.assertEqual(
                    caps.supports_vision,
                    variant.get("supports_vision", False),
                    f"supports_vision mismatch for {variant['model_id']}",
                )
                self.assertEqual(
                    caps.supports_json_format,
                    variant.get("supports_json_format", True),
                    f"supports_json_format mismatch for {variant['model_id']}",
                )


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

    def test_deepseek_v4_sends_thinking_extra_body_and_top_level_effort(self):
        """Why: DeepSeek V4 升级后必须发送 thinking extra_body + 顶层 reasoning_effort。
        与 GLM 关键差异：reasoning_effort 是顶层参数，不放 extra_body.thinking。
        思考模式启用时 temperature 必须移除（官方文档明确不生效）。"""
        captured = self._capture("deepseek-v4-flash", thinking="enabled", reasoning_effort="high")
        self.assertIn("response_format", captured)
        self.assertEqual(captured["extra_body"], {"thinking": {"type": "enabled"}})
        self.assertEqual(captured["reasoning_effort"], "high")
        # reasoning_effort 不应出现在 extra_body.thinking 里（与 GLM 区分）
        self.assertNotIn("reasoning_effort", captured["extra_body"]["thinking"])
        # 思考启用时 temperature 必须移除
        self.assertNotIn("temperature", captured)

    def test_deepseek_v4_disabled_thinking_omits_effort(self):
        """Why: 思考关闭时只传 thinking.type=disabled，不传 reasoning_effort，
        且保留 temperature（非思考模式 temperature 生效）。"""
        captured = self._capture("deepseek-v4-flash", thinking="disabled")
        self.assertEqual(captured["extra_body"], {"thinking": {"type": "disabled"}})
        self.assertNotIn("reasoning_effort", captured)
        # 非思考模式保留 temperature
        self.assertIn("temperature", captured)

    def test_deepseek_v4_pro_also_uses_deepseek_protocol(self):
        """Why: 验证 v4-pro 同样走 deepseek 协议，而非兜底 none。"""
        captured = self._capture("deepseek-v4-pro", thinking="enabled", reasoning_effort="max")
        self.assertEqual(captured["extra_body"], {"thinking": {"type": "enabled"}})
        self.assertEqual(captured["reasoning_effort"], "max")


class DeepSeekValidationTests(unittest.TestCase):
    """DeepSeek reasoning_effort 字段校验——按 provider 分支，仅允许 low/high/xhigh/max。"""

    def test_deepseek_accepts_four_effort_levels(self):
        for effort in ["low", "high", "xhigh", "max"]:
            settings = ModelSettings(provider="deepseek", reasoning_effort=effort)
            self.assertEqual(settings.reasoning_effort, effort)

    def test_deepseek_rejects_medium_and_minimal(self):
        # Why: DeepSeek 协议字面值无 medium/minimal，传入应被校验拦截
        for invalid in ["medium", "minimal", "none"]:
            with self.assertRaises(ValidationError):
                ModelSettings(provider="deepseek", reasoning_effort=invalid)

    def test_glm_still_accepts_medium_and_minimal(self):
        """Why: GLM 校验白名单不受 DeepSeek 收紧影响，保持 7 档。"""
        for effort in ["medium", "minimal", "none"]:
            settings = ModelSettings(provider="glm", reasoning_effort=effort)
            self.assertEqual(settings.reasoning_effort, effort)


class DeepSeekProfileMigrationTests(unittest.TestCase):
    """持久化 profile 自动迁移：deepseek-chat → deepseek-v4-flash。"""

    def test_legacy_deepseek_chat_is_migrated_to_v4_flash(self):
        import json
        with tempfile.TemporaryDirectory() as directory:
            settings_path = Path(directory) / "settings.json"
            # 模拟旧 profile（deepseek-chat + 64K/8K）
            legacy_doc = {
                "active_provider": "deepseek",
                "profiles": {
                    "deepseek": {
                        "provider": "deepseek",
                        "api_format": "openai_chat_completions",
                        "base_url": "https://api.deepseek.com",
                        "model_id": "deepseek-chat",
                        "api_key": "sk-test",
                        "display_name": "DeepSeek Chat",
                        "input_context": 64000,
                        "output_context": 8000,
                        "thinking_enabled": True,
                        "reasoning_effort": "high",
                        "max_tokens": 16000,
                    }
                },
            }
            settings_path.write_text(json.dumps(legacy_doc), encoding="utf-8")
            store = ModelSettingsStore(settings_path)
            profile = store.load("deepseek")
            # 迁移后应为 v4-flash + 1M/384K
            self.assertEqual(profile.model_id, "deepseek-v4-flash")
            self.assertEqual(profile.display_name, "DeepSeek V4 Flash")
            self.assertEqual(profile.input_context, 1_000_000)
            self.assertEqual(profile.output_context, 384_000)

    def test_already_v4_is_not_migrated(self):
        """Why: 迁移幂等——已是 v4 系列则保持不变。"""
        import json
        with tempfile.TemporaryDirectory() as directory:
            settings_path = Path(directory) / "settings.json"
            v4_doc = {
                "active_provider": "deepseek",
                "profiles": {
                    "deepseek": {
                        "provider": "deepseek",
                        "model_id": "deepseek-v4-pro",
                        "base_url": "https://api.deepseek.com",
                        "api_key": "sk-test",
                        "display_name": "DeepSeek V4 Pro",
                        "input_context": 1_000_000,
                        "output_context": 384_000,
                    }
                },
            }
            settings_path.write_text(json.dumps(v4_doc), encoding="utf-8")
            store = ModelSettingsStore(settings_path)
            profile = store.load("deepseek")
            self.assertEqual(profile.model_id, "deepseek-v4-pro")
            self.assertEqual(profile.display_name, "DeepSeek V4 Pro")


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
