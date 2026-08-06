import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from model_settings import ModelSettings, ModelSettingsStore


class ModelSettingsTests(unittest.TestCase):
    def test_store_round_trip_and_public_response_hides_api_key(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ModelSettingsStore(Path(directory) / "settings.json")
            saved = ModelSettings(
                provider="glm",
                base_url="https://open.bigmodel.cn/api/paas/v4/",
                model_id="glm-4.5",
                api_key="secret-value",
                display_name="GLM-4.5",
                input_context=128000,
                output_context=16000,
            )
            store.save(saved)

            self.assertEqual(store.load().provider, "glm")
            self.assertEqual(store.load().base_url, "https://open.bigmodel.cn/api/paas/v4")
            self.assertNotIn("api_key", store.public())
            self.assertTrue(store.public()["has_api_key"])

    def test_context_and_tool_limits_are_validated(self):
        with self.assertRaises(ValidationError):
            ModelSettings(input_context=0)
        with self.assertRaises(ValidationError):
            ModelSettings(tool_call_rounds=1001)

    def test_required_endpoint_and_model_are_rejected_when_blank(self):
        with self.assertRaises(ValidationError):
            ModelSettings(base_url=" ")
        with self.assertRaises(ValidationError):
            ModelSettings(model_id=" ")

    def test_keys_are_kept_separately_for_each_provider(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ModelSettingsStore(Path(directory) / "settings.json")
            store.save(ModelSettings(provider="deepseek", api_key="deepseek-secret"))
            store.save(ModelSettings(
                provider="glm",
                base_url="https://open.bigmodel.cn/api/paas/v4",
                model_id="glm-5v-turbo",
                api_key="glm-secret",
            ))

            self.assertEqual(store.load("deepseek").api_key, "deepseek-secret")
            self.assertEqual(store.load("glm").api_key, "glm-secret")
            self.assertEqual(store.load().provider, "glm")

    def test_blank_key_keeps_same_provider_key_not_previous_provider_key(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ModelSettingsStore(Path(directory) / "settings.json")
            store.save(ModelSettings(provider="deepseek", api_key="deepseek-secret"))
            store.save(ModelSettings(
                provider="glm",
                base_url="https://open.bigmodel.cn/api/paas/v4",
                model_id="glm-5v-turbo",
                api_key="",
            ))

            self.assertEqual(store.load("glm").api_key, "")
            self.assertEqual(store.load("deepseek").api_key, "deepseek-secret")

    def test_glm_model_id_must_be_api_identifier_not_display_name(self):
        with self.assertRaises(ValidationError):
            ModelSettings(
                provider="glm",
                base_url="https://open.bigmodel.cn/api/paas/v4",
                model_id="GLM-5V Turbo",
            )


if __name__ == "__main__":
    unittest.main()
