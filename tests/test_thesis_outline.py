import json
import unittest
from unittest.mock import patch

import main
from fastapi.testclient import TestClient
from pydantic import ValidationError

from thesis_writing import (
    ThesisBodyRequest,
    ThesisReferenceRequest,
    ThesisOutlineRequest,
    build_thesis_outline_prompt,
    normalize_search_results,
    choose_chapter_for_source,
    build_thesis_chapter_prompt,
    build_citation_verification_prompt,
    parse_outline_ndjson_lines,
)


class ThesisOutlineContractTests(unittest.TestCase):
    def test_dashscope_parser_keeps_source_only_deep_research_frames(self):
        frame = {
            "output": {
                "message": {
                    "phase": "",
                    "content": "",
                    "status": "streamingWebResult",
                    "extra": {
                        "deep_research": {
                            "webSites": [{
                                "title": "权威来源",
                                "url": "https://example.com/report",
                            }],
                        },
                    },
                },
            },
        }

        parsed = main._parse_dashscope_sse_line(f"data: {json.dumps(frame)}")

        self.assertIsNotNone(parsed)
        self.assertEqual(
            parsed["extra"]["deep_research"]["webSites"][0]["url"],
            "https://example.com/report",
        )

    def test_thesis_deep_research_payload_starts_the_research_step(self):
        payload = main._build_thesis_deep_research_payload("研究主题与章节")

        messages = payload["input"]["messages"]
        self.assertEqual([message["role"] for message in messages], ["user", "assistant", "user"])
        self.assertIn("无需继续反问", messages[-1]["content"])
        self.assertEqual(payload["output_format"], "model_summary_report")
        self.assertFalse(payload["parameters"]["enable_feedback"])

    def test_deep_research_reference_ids_are_unique_with_single_source_normalization(self):
        first = main._normalize_deep_research_reference(
            "c1", {"title": "来源一", "url": "https://example.com/one"}, 1,
        )
        second = main._normalize_deep_research_reference(
            "c1", {"title": "来源二", "url": "https://example.com/two"}, 2,
        )

        self.assertEqual(first["id"], "c1-ref-1")
        self.assertEqual(second["id"], "c1-ref-2")

    def test_accepts_confirmed_target_word_tiers(self):
        for target_words in (None, 3000, 5000, 8000, 10000, 15000, 20000, 30000):
            request = ThesisOutlineRequest(
                instruction="人工智能对就业结构的影响",
                thesis_type="毕业论文",
                education_level="本科生",
                target_words=target_words,
            )
            self.assertEqual(request.target_words, target_words)

    def test_rejects_unsupported_target_word_tier(self):
        with self.assertRaises(ValidationError):
            ThesisOutlineRequest(
                instruction="人工智能对就业结构的影响",
                thesis_type="毕业论文",
                education_level="本科生",
                target_words=6000,
            )

    def test_prompt_contains_real_topic_and_ndjson_contract(self):
        request = ThesisOutlineRequest(
            instruction="人工智能对就业结构的影响",
            thesis_type="毕业论文",
            education_level="本科生",
            target_words=8000,
        )

        prompt = build_thesis_outline_prompt(request)

        self.assertIn("人工智能对就业结构的影响", prompt)
        self.assertIn("8000", prompt)
        self.assertIn("每行一个 JSON 对象", prompt)
        self.assertIn('"type":"chapter"', prompt)
        self.assertIn('"type":"section"', prompt)

    def test_parser_emits_only_complete_valid_ndjson_objects(self):
        chunks = [
            '{"type":"title","title":"AI与就业"}\n{"type":"chapter",',
            '"id":"c1","order":1,"title":"1. 引言","summary":"研究背景"}\n',
            'not-json\n{"type":"section","chapter_id":"c1","id":"s1",',
            '"order":1,"title":"1.1 研究背景","writing_brief":"说明背景"}\n',
        ]

        events, remainder = parse_outline_ndjson_lines(chunks)

        self.assertEqual([event["type"] for event in events], ["title", "chapter", "section"])
        self.assertEqual(events[1]["id"], "c1")
        self.assertEqual(events[2]["chapter_id"], "c1")
        self.assertEqual(remainder, "")
        json.dumps(events, ensure_ascii=False)

    def test_outline_endpoint_streams_semantic_events(self):
        def fake_events(_request, _settings):
            yield 'event: thesis_outline_started\ndata: {"type":"thesis_outline_started"}\n\n'
            yield 'event: thesis_title\ndata: {"type":"title","title":"AI与就业"}\n\n'
            yield 'event: thesis_outline_completed\ndata: {"type":"done"}\n\n'

        with (
            patch.object(main, "generate_thesis_outline_events", fake_events),
            patch.object(main.model_settings_store, "load") as load_settings,
        ):
            load_settings.return_value.api_key = "test-key"
            response = TestClient(main.app).post(
                "/api/writing/thesis/outline/stream",
                json={
                    "instruction": "人工智能对就业结构的影响",
                    "thesis_type": "毕业论文",
                    "education_level": "本科生",
                    "target_words": 8000,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("thesis_outline_started", response.text)
        self.assertIn("AI与就业", response.text)
        self.assertEqual(response.headers["content-type"].split(";")[0], "text/event-stream")

    def test_reference_results_are_deduplicated_and_limited(self):
        raw = [
            {"title": "不安全来源", "url": "javascript:alert(1)", "snippet": "应忽略"},
            {"title": "来源 A", "url": "https://example.com/a", "snippet": "摘要 A"},
            {"title": "重复 A", "url": "https://example.com/a", "snippet": "重复"},
            *[
                {"title": f"来源 {index}", "url": f"https://example.com/{index}", "snippet": f"摘要 {index}"}
                for index in range(2, 9)
            ],
        ]

        results = normalize_search_results("c1", raw, limit=6)

        self.assertEqual(len(results), 6)
        self.assertEqual(results[0]["chapter_id"], "c1")
        self.assertEqual(results[0]["domain"], "example.com")
        self.assertEqual(len({item["url"] for item in results}), 6)

    def test_deep_research_source_is_assigned_to_matching_chapter(self):
        chapters = [
            {"id": "c1", "title": "人工智能技术发展", "summary": "技术演进与应用"},
            {"id": "c2", "title": "就业结构变化", "summary": "岗位替代与新增职业"},
        ]

        chapter_id = choose_chapter_for_source(
            chapters,
            {"title": "生成式人工智能如何改变就业市场", "description": "分析岗位替代和新增职业"},
            current_query="人工智能对就业岗位的影响",
            counts={"c1": 2, "c2": 1},
        )

        self.assertEqual(chapter_id, "c2")

    def test_source_assignment_balances_when_no_chapter_matches(self):
        chapters = [{"id": "c1", "title": "第一章"}, {"id": "c2", "title": "第二章"}]
        chapter_id = choose_chapter_for_source(chapters, {"title": "无明显关键词"}, counts={"c1": 3, "c2": 1})
        self.assertEqual(chapter_id, "c2")

    def test_reference_endpoint_streams_chapter_sources(self):
        request = ThesisReferenceRequest(
            instruction="人工智能对就业结构的影响",
            chapters=[{"id": "c1", "title": "1. 引言", "summary": "研究背景"}],
        )
        self.assertEqual(request.chapters[0].id, "c1")

        def fake_reference_events(_request, _settings):
            yield 'event: thesis_chapter_search_started\ndata: {"type":"chapter_search_started","chapter_id":"c1"}\n\n'
            yield 'event: thesis_reference_found\ndata: {"type":"reference_found","chapter_id":"c1","id":"r1","title":"来源","url":"https://example.com","domain":"example.com","snippet":"摘要","status":"found"}\n\n'
            yield 'event: thesis_chapter_search_completed\ndata: {"type":"chapter_search_completed","chapter_id":"c1"}\n\n'

        with (
            patch.object(main, "generate_thesis_deep_reference_events", fake_reference_events),
            patch.object(main.model_settings_store, "load") as load_settings,
        ):
            load_settings.return_value.api_key = "test-key"
            response = TestClient(main.app).post(
                "/api/writing/thesis/references/stream",
                json=request.model_dump(),
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("thesis_reference_found", response.text)

    def test_body_prompt_binds_outline_and_real_reference_ids(self):
        request = ThesisBodyRequest(
            title="人工智能对就业结构的影响",
            chapters=[{
                "id": "c1", "title": "1. 引言", "summary": "说明研究问题", "target_words": 800,
                "sections": [{"id": "s1", "title": "1.1 研究背景", "writing_brief": "介绍背景", "target_words": 400}],
                "references": [{"id": "r1", "title": "统计报告", "url": "https://example.com/report", "snippet": "就业数据"}],
            }],
        )

        prompt = build_thesis_chapter_prompt(request, request.chapters[0])

        self.assertIn("1.1 研究背景", prompt)
        self.assertIn("[ref:r1]", prompt)
        self.assertIn("不得编造", prompt)
        self.assertIn("800", prompt)
        self.assertIn("至少 1600", prompt)
        self.assertIn("不要使用 Markdown 控制符", prompt)

    def test_body_endpoint_streams_tokens_by_chapter(self):
        def fake_body_events(_request, _settings):
            yield 'event: thesis_body_started\ndata: {"type":"body_started"}\n\n'
            yield 'event: thesis_body_token\ndata: {"type":"body_token","chapter_id":"c1","token":"正文"}\n\n'
            yield 'event: thesis_body_completed\ndata: {"type":"body_completed"}\n\n'

        with (
            patch.object(main, "generate_thesis_body_events", fake_body_events),
            patch.object(main.model_settings_store, "load") as load_settings,
        ):
            load_settings.return_value.api_key = "test-key"
            response = TestClient(main.app).post(
                "/api/writing/thesis/body/stream",
                json={
                    "title": "人工智能对就业结构的影响",
                    "chapters": [{"id": "c1", "title": "1. 引言", "sections": []}],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn('"chapter_id":"c1"', response.text)
        self.assertIn('"token":"正文"', response.text)

    def test_citation_verification_prompt_contains_only_used_evidence(self):
        request = ThesisBodyRequest(
            title="人工智能与就业",
            chapters=[{
                "id": "c1", "title": "1. 引言", "sections": [],
                "references": [{"id": "r1", "title": "报告", "url": "https://example.com/r1", "snippet": "就业结构发生变化"}],
            }],
        )

        prompt = build_citation_verification_prompt(request.chapters[0], "就业结构发生变化[ref:r1]", {"r1"})

        self.assertIn("r1", prompt)
        self.assertIn("verified", prompt)
        self.assertIn("unsupported", prompt)
        self.assertIn("就业结构发生变化", prompt)


if __name__ == "__main__":
    unittest.main()
