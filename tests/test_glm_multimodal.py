import unittest

from pydantic import ValidationError

from glm_adapter import (
    ChatAttachment,
    build_user_content,
    choose_glm_model,
    validate_attachment_mix,
)
from model_settings import ModelSettings


class GLMMultimodalContractTests(unittest.TestCase):
    def setUp(self):
        self.settings = ModelSettings(
            provider="glm",
            base_url="https://open.bigmodel.cn/api/paas/v4",
            model_id="glm-5-turbo",
            text_model_id="glm-5-turbo",
            vision_model_id="glm-5v-turbo",
            display_name="GLM",
        )

    def test_text_uses_text_model_and_attachment_uses_vision_model(self):
        self.assertEqual(choose_glm_model(self.settings, []), "glm-5-turbo")
        self.assertEqual(
            choose_glm_model(self.settings, [ChatAttachment(type="image_url", url="https://example.com/a.png")]),
            "glm-5v-turbo",
        )

    def test_image_content_matches_official_chat_completions_shape(self):
        content = build_user_content("描述图片", [
            ChatAttachment(type="image_url", url="https://example.com/a.png"),
        ])
        self.assertEqual(content[0], {"type": "image_url", "image_url": {"url": "https://example.com/a.png"}})
        self.assertEqual(content[-1], {"type": "text", "text": "描述图片"})

    def test_file_video_and_image_cannot_be_mixed(self):
        with self.assertRaises(ValueError):
            validate_attachment_mix([
                ChatAttachment(type="image_url", url="https://example.com/a.png"),
                ChatAttachment(type="file_url", url="https://example.com/a.pdf"),
            ])

    def test_only_https_or_image_data_urls_are_accepted(self):
        with self.assertRaises(ValidationError):
            ChatAttachment(type="video_url", url="http://example.com/a.mov")
        ChatAttachment(type="image_url", url="data:image/png;base64,AAAA")
        with self.assertRaises(ValidationError):
            ChatAttachment(type="file_url", url="data:application/pdf;base64,AAAA")

    def test_model_parameters_have_safe_bounds(self):
        with self.assertRaises(ValidationError):
            ModelSettings(temperature=3)
        with self.assertRaises(ValidationError):
            ModelSettings(max_tokens=100_000)


if __name__ == "__main__":
    unittest.main()
