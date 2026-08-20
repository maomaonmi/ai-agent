import unittest
from unittest.mock import patch

from main import (
    MARKDOWN_REPORT_FORMAT,
    RuntimeSettings,
    extract_json_object,
    generate_plan_execute_events,
    normalize_plan_tasks,
    plan_llm_invoke,
    resolve_plan_agent,
    run_plan_web_search,
    plan_research_figures,
    _safe_source_url,
    task_executor_node,
)


class PlanExecuteContractTests(unittest.TestCase):
    def test_markdown_report_contract_requires_comparison_table(self):
        self.assertIn("| 对比维度 |", MARKDOWN_REPORT_FORMAT)
        self.assertIn("## 结论摘要", MARKDOWN_REPORT_FORMAT)
        self.assertIn("## 风险与限制", MARKDOWN_REPORT_FORMAT)

    def test_extracts_json_from_markdown_fence(self):
        parsed = extract_json_object('```json\n{"tasks": [{"title": "调研市场"}]}\n```')
        self.assertEqual(parsed["tasks"][0]["title"], "调研市场")

    def test_extracts_json_after_glm_preface_and_trailing_comma(self):
        parsed = extract_json_object(
            '这是结构化计划：\n```json\n'
            '{"tasks": [{"title": "梳理目标", "description": "明确约束",}],}\n'
            '```\n以上。'
        )
        self.assertEqual(parsed["tasks"][0]["title"], "梳理目标")

    def test_repairs_common_glm_unescaped_quotes_inside_string_values(self):
        parsed = extract_json_object(
            '{"tasks":[{"title":"讨论光速不变","description":"解释 "光速不变" '
            '与因果律的关系"}]}'
        )
        self.assertIn('光速不变', parsed["tasks"][0]["description"])

    def test_normalizes_and_limits_untrusted_tasks(self):
        raw_tasks = [
            {
                "title": f"任务 {index}",
                "description": "执行说明",
                "status": "unknown",
                "requires_web": index % 2 == 0,
            }
            for index in range(10)
        ]

        tasks = normalize_plan_tasks(raw_tasks, start_id=3, limit=2)

        self.assertEqual([task["id"] for task in tasks], [3, 4])
        self.assertEqual([task["status"] for task in tasks], ["pending", "pending"])
        self.assertTrue(tasks[0]["requires_web"])
        self.assertFalse(tasks[1]["requires_web"])

    def test_report_prompt_avoids_table_heavy_tail(self):
        self.assertIn("最多 2 张 Markdown 表格", MARKDOWN_REPORT_FORMAT)
        self.assertIn("## 结论与下一步", MARKDOWN_REPORT_FORMAT)
        self.assertIn("禁止以表格、代码块或图表数据结尾", MARKDOWN_REPORT_FORMAT)

    def test_figure_slots_keep_source_url_and_meaningful_figure_prompt(self):
        slots = plan_research_figures(
            "## 第一章 趋势\n" + "这是一段有足够上下文的研究材料。" * 40,
            2,
            source_urls=["https://example.com/article"],
        )
        self.assertEqual(len(slots), 2)
        self.assertEqual(slots[0]["source_url"], "https://example.com/article")
        self.assertIn("帮助读者理解", slots[0]["prompt"])
        self.assertEqual(_safe_source_url("http://localhost/private"), None)

    def test_discards_tasks_without_titles(self):
        tasks = normalize_plan_tasks([{"description": "缺少标题"}, "invalid"])
        self.assertEqual(tasks, [])

    def test_normalizes_assigned_agent_and_preserves_web_compatibility(self):
        tasks = normalize_plan_tasks([
            {
                "title": "检索最新政策",
                "assigned_agent": "web_search_agent",
            },
            {
                "title": "处理未知任务",
                "assigned_agent": "untrusted_agent",
                "requires_web": True,
            },
        ])

        self.assertEqual(tasks[0]["assigned_agent"], "web_search_agent")
        self.assertTrue(tasks[0]["requires_web"])
        self.assertEqual(tasks[1]["assigned_agent"], "deep_thinker_agent")
        self.assertFalse(tasks[1]["requires_web"])

    def test_resolves_only_registered_plan_agents(self):
        self.assertEqual(
            resolve_plan_agent("data_analyst_agent"),
            "data_analyst_agent",
        )
        self.assertEqual(
            resolve_plan_agent("arbitrary_python_function"),
            "deep_thinker_agent",
        )

    def test_preserves_custom_agent_only_when_explicitly_allowed(self):
        raw = [{
            "title": "编写测试",
            "assigned_agent": "pytest-expert",
        }]

        rejected = normalize_plan_tasks(raw)
        accepted = normalize_plan_tasks(
            raw,
            allowed_custom_agents={"pytest-expert"},
        )

        self.assertEqual(rejected[0]["assigned_agent"], "deep_thinker_agent")
        self.assertEqual(accepted[0]["assigned_agent"], "pytest-expert")


class PlanEventStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_event_order_keeps_final_answer_after_progress(self):
        class FakePlanApp:
            def stream(self, _inputs, config=None):
                self.config = config
                yield {
                    "planner": {
                        "tasks": [{
                            "id": 1,
                            "title": "验证方案",
                            "description": "检查关键假设",
                            "status": "pending",
                            "requires_web": False,
                            "result": None,
                            "error": None,
                        }],
                        "iteration": 0,
                    }
                }
                yield {
                    "summarizer": {
                        "tasks": [{
                            "id": 1,
                            "title": "验证方案",
                            "description": "检查关键假设",
                            "status": "completed",
                            "requires_web": False,
                            "result": "验证完成",
                            "error": None,
                        }],
                        "iteration": 1,
                        "final_response": "最终报告",
                    }
                }

        with patch("main.get_plan_execute_app", return_value=FakePlanApp()):
            events = [
                event
                async for event in generate_plan_execute_events("完成复杂任务")
            ]

        event_names = [
            event.splitlines()[0].removeprefix("event: ")
            for event in events
        ]
        self.assertEqual(
            event_names,
            ["system_status", "plan_update", "plan_update", "done", "plan_done"],
        )

    async def test_plan_graph_receives_runtime_search_policy_and_firecrawl_options(self):
        class CapturingPlanApp:
            def __init__(self):
                self.inputs = None

            def stream(self, inputs, config=None):
                self.inputs = inputs
                return iter(())

        fake_app = CapturingPlanApp()
        runtime = RuntimeSettings(
            web_search="off",
            web_search_options={"limit": 6, "scrape_top_n": 1},
        )

        with patch("main.get_plan_execute_app", return_value=fake_app):
            list_events = [
                event
                async for event in generate_plan_execute_events(
                    "analyze a market",
                    runtime_settings=runtime,
                )
            ]

        self.assertTrue(list_events)
        self.assertFalse(fake_app.inputs["web_search_enabled"])
        self.assertEqual(fake_app.inputs["web_search_options"]["limit"], 6)


class DistributedExecutorTests(unittest.TestCase):
    def test_routes_task_to_assigned_expert(self):
        state = {
            "user_task": "分析项目",
            "execution_mode": "distributed",
            "tasks": [{
                "id": 1,
                "title": "计算成本",
                "description": "建立成本模型",
                "status": "in_progress",
                "requires_web": False,
                "assigned_agent": "data_analyst_agent",
                "result": None,
                "error": None,
            }],
            "current_task_id": 1,
            "iteration": 0,
            "max_iterations": 8,
            "replan_message": "",
            "should_finish": False,
            "final_response": "",
        }

        with patch(
            "main.PLAN_AGENT_EXECUTORS",
            {"data_analyst_agent": lambda _state, _task: "成本分析完成"},
        ):
            output = task_executor_node(state)

        self.assertEqual(output["tasks"][0]["status"], "completed")
        self.assertEqual(output["tasks"][0]["result"], "成本分析完成")
        self.assertEqual(output["iteration"], 1)

    def test_routes_allowed_custom_agent_from_request_snapshot(self):
        state = {
            "user_task": "提高测试质量",
            "execution_mode": "distributed",
            "custom_agent_catalog": {
                "pytest-expert": {
                    "id": "pytest-expert",
                    "name": "Python 测试专家",
                    "system_prompt": "设计可靠的 Python 测试。",
                    "tools": ["read"],
                }
            },
            "tasks": [{
                "id": 1,
                "title": "设计测试",
                "description": "覆盖边界条件",
                "status": "in_progress",
                "requires_web": False,
                "assigned_agent": "pytest-expert",
                "result": None,
                "error": None,
            }],
            "current_task_id": 1,
            "iteration": 0,
            "max_iterations": 8,
            "replan_message": "",
            "should_finish": False,
            "final_response": "",
        }

        with patch(
            "main.execute_custom_plan_agent",
            return_value="自定义专家完成",
        ):
            output = task_executor_node(state)

        self.assertEqual(output["tasks"][0]["assigned_agent"], "pytest-expert")
        self.assertEqual(output["tasks"][0]["result"], "自定义专家完成")


class PlanWebSearchTests(unittest.TestCase):
    def test_uses_firecrawl_for_plan_tasks_when_it_is_the_active_provider(self):
        state = {
            "web_search_enabled": True,
            "web_search_options": {
                "limit": 7,
                "time_range": "w",
                "location": "China",
                "scrape_top_n": 2,
                "highlights": True,
            },
        }
        candidates = [{"title": "Firecrawl result", "url": "https://example.com", "content": "evidence"}]

        with patch("main.SEARCH_PROVIDER", "firecrawl"), patch(
            "main._run_firecrawl_search",
            return_value=(candidates, None, 1),
        ) as firecrawl_search, patch("main._run_tavily_search") as tavily_search:
            results, error = run_plan_web_search("latest market data", state)

        self.assertIsNone(error)
        self.assertEqual(results, candidates)
        firecrawl_search.assert_called_once()
        self.assertEqual(firecrawl_search.call_args.kwargs["options"].limit, 7)
        tavily_search.assert_not_called()

    def test_does_not_call_any_provider_when_plan_web_search_is_disabled(self):
        with patch("main._run_firecrawl_search") as firecrawl_search, patch(
            "main._run_tavily_search"
        ) as tavily_search:
            results, error = run_plan_web_search(
                "latest market data",
                {"web_search_enabled": False},
            )

        self.assertEqual(results, [])
        self.assertIn("已关闭", error)
        firecrawl_search.assert_not_called()
        tavily_search.assert_not_called()


class PlanModelProviderTests(unittest.TestCase):
    def test_plan_llm_uses_openai_compatible_profile_for_all_supported_providers(self):
        profiles = [
            ("deepseek-v4-flash", "https://api.deepseek.com"),
            ("qwen3.7-plus", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
            ("glm-5", "https://open.bigmodel.cn/api/paas/v4"),
        ]

        for model_id, base_url in profiles:
            with self.subTest(model_id=model_id), patch("main.ACTIVE_MODEL_ID", model_id), patch(
                "main.DEEPSEEK_BASE_URL", base_url
            ), patch("main.DEEPSEEK_API_KEY", "test-key"), patch("main.ChatOpenAI") as chat_cls:
                chat_cls.return_value.invoke.return_value.content = '{"tasks": []}'

                result = plan_llm_invoke("system", "user")

                self.assertEqual(result, '{"tasks": []}')
                self.assertEqual(chat_cls.call_args.kwargs["model"], model_id)
                self.assertEqual(chat_cls.call_args.kwargs["base_url"], base_url)

if __name__ == "__main__":
    unittest.main()
