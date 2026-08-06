import json
import asyncio
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from App import (
    AcceptanceAssertion,
    AcceptancePlan,
    AcceptanceStep,
    CodeAcceptanceRequest,
    apply_edit_operations,
    build_code_agent_prompt,
    build_acceptance_messages,
    build_fullstack_patch_messages,
    fullstack_patch_stream,
    build_fix_messages,
    build_modify_messages,
    clean_generated_html,
    _extract_html_from_mangled_envelope_source,
    create_code_router,
    format_sse,
    ensure_changed,
    compile_acceptance_script,
    execute_acceptance_script,
    validate_acceptance_plan,
    run_acceptance_agent,
    clean_generated_vfs,
    validate_fullstack_vfs,
    validate_vfs_javascript,
    apply_vfs_edit_operations,
    _fix_content_newlines,
    normalize_agent_envelope,
    FULLSTACK_REQUIRED_FILES,
)


class CodeSandboxTests(unittest.TestCase):
    def test_acceptance_assertion_normalizes_boolean_expected_from_model(self):
        plan = AcceptancePlan.model_validate({
            "summary": "search input is visible",
            "steps": [],
            "assertions": [{
                "kind": "visible",
                "selector": "#search-input",
                "expected": True,
            }],
        })

        self.assertEqual(plan.assertions[0].expected, "true")

    def test_manual_fullstack_fix_prompt_includes_recent_console_diagnostics(self):
        messages = build_fullstack_patch_messages(
            {
                "frontend/index.html": "<button>保存</button>",
                "frontend/styles.css": "",
                "frontend/app.js": "try { save(); } catch (error) {}",
                "backend/server.py": "",
                "backend/database.json": '{"students": []}',
            },
            "请你改错啊",
            diagnostics="Unexpected token 'catch'\nFailed to fetch",
        )

        self.assertIn("Unexpected token 'catch'", messages[1]["content"])
        self.assertIn("Failed to fetch", messages[1]["content"])

    def test_fullstack_patch_retries_once_when_model_returns_empty_operations(self):
        responses = [
            '{"operations": []}',
            json.dumps({"operations": [{
                "file": "frontend/app.js",
                "op": "replace",
                "target": "const broken = true;",
                "content": "const broken = false;",
            }]}),
        ]

        class FakeCompletions:
            def __init__(self):
                self.calls = 0

            async def create(self, **_kwargs):
                content = responses[self.calls]
                self.calls += 1
                return SimpleNamespace(choices=[SimpleNamespace(
                    message=SimpleNamespace(content=content),
                )])

        class FakeClient:
            class Chat:
                completions = FakeCompletions()
            chat = Chat()

        vfs = {
            "frontend/index.html": "<button>保存</button>",
            "frontend/styles.css": "",
            "frontend/app.js": "const broken = true;",
            "backend/server.py": "",
            "backend/database.json": '{"students": []}',
        }

        async def collect():
            return [event async for event in fullstack_patch_stream(
                vfs, "修复错误", None, FakeClient(), "test-model",
                workspace_id="test-ws", run_id="test-run", terminal_pool=None,
            )]

        events = asyncio.run(collect())
        self.assertEqual(FakeClient.chat.completions.calls, 2)
        self.assertTrue(any('const broken = false;' in event for event in events))

    def test_fullstack_patch_replans_with_exact_safe_anchors_after_target_rejection(self):
        responses = [
            json.dumps({"operations": [{
                "file": "frontend/index.html",
                "op": "replace",
                "target": "<h2>Students</h2><table>",
                "content": "<h2>Students</h2><input id='search'><table>",
            }]}),
            json.dumps({"operations": [{
                "file": "frontend/index.html",
                "op": "insert_after",
                "target": "<h2>Students</h2>",
                "content": "<input id='search'>",
            }]}),
        ]

        class FakeCompletions:
            def __init__(self):
                self.calls = 0
                self.messages = []

            async def create(self, **kwargs):
                self.messages.append(kwargs["messages"])
                content = responses[self.calls]
                self.calls += 1
                return SimpleNamespace(choices=[SimpleNamespace(
                    message=SimpleNamespace(content=content),
                )])

        class FakeClient:
            class Chat:
                completions = FakeCompletions()
            chat = Chat()

        vfs = {
            "frontend/index.html": "<section>\n  <h2>Students</h2>\n  <div class='tools'></div>\n  <table></table>\n</section>",
            "frontend/styles.css": "",
            "frontend/app.js": "",
            "backend/server.py": "",
            "backend/database.json": '{"students": []}',
        }

        async def collect():
            return [event async for event in fullstack_patch_stream(
                vfs, "add search", None, FakeClient(), "test-model",
                workspace_id="test-ws", run_id="test-run", terminal_pool=None,
            )]

        events = asyncio.run(collect())
        self.assertEqual(FakeClient.chat.completions.calls, 2)
        self.assertIn("Safe exact anchors", FakeClient.chat.completions.messages[1][-1]["content"])
        self.assertTrue(any("id='search'" in event for event in events))

    def test_fullstack_patch_reports_the_precise_rejection_reason(self):
        class FakeCompletions:
            async def create(self, **_kwargs):
                return SimpleNamespace(choices=[SimpleNamespace(
                    message=SimpleNamespace(content=json.dumps({"operations": [{
                        "file": "frontend/app.js",
                        "op": "replace",
                        "target": "missing fragment",
                        "content": "replacement",
                    }]})),
                )])

        class FakeClient:
            class Chat:
                completions = FakeCompletions()
            chat = Chat()

        vfs = {
            "frontend/index.html": "<main></main>",
            "frontend/styles.css": "",
            "frontend/app.js": "const ready = true;",
            "backend/server.py": "",
            "backend/database.json": '{"students": []}',
        }

        async def collect():
            return [event async for event in fullstack_patch_stream(
                vfs, "add search", None, FakeClient(), "test-model",
                workspace_id="test-ws", run_id="test-run", terminal_pool=None,
            )]

        events = asyncio.run(collect())
        self.assertIn("match exactly one", events[-1])

    def test_vfs_patch_accepts_one_unique_target_with_formatting_only_differences(self):
        vfs = {
            "frontend/index.html": "<main></main>",
            "frontend/styles.css": "",
            "frontend/app.js": "function load() {\n    return true;\n}\nload();",
            "backend/server.py": "",
            "backend/database.json": '{"students": []}',
        }

        updated = apply_vfs_edit_operations(vfs, [{
            "file": "frontend/app.js",
            "op": "replace",
            "target": "function load() { return true; }",
            "content": "function load() {\n    return false;\n}",
        }])

        self.assertIn("return false", updated["frontend/app.js"])
        self.assertIn("load();", updated["frontend/app.js"])

    def test_javascript_syntax_validation_rejects_unmatched_catch(self):
        with self.assertRaisesRegex(ValueError, "frontend/app.js"):
            validate_vfs_javascript({"frontend/app.js": "function save() { catch (error) {} }"})

    def test_manual_modify_forwards_recent_runtime_diagnostics(self):
        source = (
            Path(__file__).parents[1]
            / "frontend" / "ai-agent" / "src" / "hooks" / "useCodeAutoRepair.ts"
        ).read_text(encoding="utf-8")
        modify_section = source.split("const modify = useCallback", 1)[1].split(
            "const handleRuntimeError", 1
        )[0]

        self.assertIn("pendingDiagnostics", modify_section)
        self.assertIn("recentErrorsRef.current.join", modify_section)
        self.assertIn("controller.signal, pendingDiagnostics", modify_section)

    def test_acceptance_agent_returns_blocked_report_when_planner_times_out(self):
        class HangingCompletions:
            async def create(self, **_kwargs):
                await asyncio.Event().wait()

        class FakeClient:
            class Chat:
                completions = HangingCompletions()
            chat = Chat()

        request = CodeAcceptanceRequest(
            user_request="点击按钮后显示表单",
            preview_html="<button>添加</button>",
        )
        report = asyncio.run(run_acceptance_agent(
            request,
            FakeClient(),
            "test-model",
            planning_timeout_seconds=0.01,
        ))

        self.assertFalse(report["passed"])
        self.assertTrue(report["blocked"])
        self.assertEqual(report["stage"], "planning")
        self.assertIn("超时", report["diagnostic"])

    def test_frontend_acceptance_request_has_a_watchdog_timeout(self):
        source = (
            Path(__file__).parents[1]
            / "frontend" / "ai-agent" / "src" / "lib" / "api.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("ACCEPTANCE_REQUEST_TIMEOUT_MS", source)
        self.assertIn("测试请求超过", source)

    def test_acceptance_ui_cannot_remain_running_past_its_deadline(self):
        source = (
            Path(__file__).parents[1]
            / "frontend" / "ai-agent" / "src" / "components" / "CodeWorkspace.tsx"
        ).read_text(encoding="utf-8")

        self.assertIn("ACCEPTANCE_UI_TIMEOUT_MS", source)
        self.assertIn("acceptancePreviewRef", source)
        self.assertIn("测试状态超过 50 秒", source)
        self.assertIn("[runId, status.state]", source)

    def test_test_agent_prompt_prioritizes_behavior_over_console_only_success(self):
        messages = build_acceptance_messages(
            "点击添加学生按钮后显示表单",
            "<button id='add'>添加学生</button><form id='form' hidden></form>",
            [{"level": "log", "text": "按钮被点击"}],
        )

        self.assertIn("不能只验证控制台", messages[0]["content"])
        self.assertIn("DOM", messages[0]["content"])
        self.assertIn("按钮被点击", messages[1]["content"])
    def test_acceptance_plan_requires_an_observable_dom_assertion(self):
        plan = AcceptancePlan(
            summary="点击添加学生按钮",
            steps=[AcceptanceStep(action="click", selector="button:has-text('添加学生')")],
            assertions=[AcceptanceAssertion(kind="console_contains", expected="按钮被点击")],
        )

        with self.assertRaisesRegex(ValueError, "DOM"):
            validate_acceptance_plan(plan)

    def test_acceptance_plan_compiles_to_bounded_python_playwright_script(self):
        plan = AcceptancePlan(
            summary="点击后显示学生表单",
            steps=[AcceptanceStep(action="click", selector="#add-student")],
            assertions=[AcceptanceAssertion(kind="visible", selector="#student-form")],
        )

        script = compile_acceptance_script(
            "<!doctype html><button id='add-student'>添加学生</button><form id='student-form'></form>",
            plan,
        )

        self.assertIn("from playwright.sync_api import sync_playwright", script)
        self.assertIn("page.locator", script)
        self.assertIn('sandbox="allow-scripts"', script)
        self.assertIn("offline=True", script)
        self.assertIn("#student-form", script)
        self.assertNotIn("subprocess", script)

    def test_acceptance_runner_exception_is_blocked_not_a_product_failure(self):
        report = execute_acceptance_script(
            "raise RuntimeError(\"Playwright locator.click timed out\")\n"
        )

        self.assertFalse(report["passed"])
        self.assertTrue(report["blocked"])
        self.assertIn("Playwright locator.click timed out", report["runner_stderr"])

    def test_acceptance_plan_rejects_unsupported_actions(self):
        with self.assertRaises(ValueError):
            AcceptanceStep(action="run_shell", selector="#add")

    def test_selected_button_logging_prompt_requires_click_handler_logging(self):
        messages = build_fullstack_patch_messages(
            {
                "frontend/index.html": "<button>添加学生</button>",
                "frontend/styles.css": "",
                "frontend/app.js": "console.log('app.js 已加载');",
                "backend/server.py": "",
                "backend/database.json": '{"students": []}',
            },
            "给这个按钮加个日志，点击时在控制台看到",
            {
                "selector": "button",
                "tag_name": "button",
                "class_name": "",
                "element_id": "",
                "outer_html": "<button>添加学生</button>",
            },
        )

        self.assertIn("事件处理器内部", messages[0]["content"])
        self.assertIn("页面加载日志不能冒充点击日志", messages[0]["content"])
        self.assertIn("添加学生", messages[1]["content"])

    def test_no_op_model_patch_is_not_reported_as_success(self):
        with self.assertRaisesRegex(ValueError, "没有产生实际代码变化"):
            ensure_changed("const ready = true;", "const ready = true;")

    def test_sandbox_console_preserves_error_name_and_message(self):
        source = (
            Path(__file__).parents[1]
            / "frontend" / "ai-agent" / "src" / "Code" / "inspectorScript.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("value instanceof Error", source)
        self.assertIn("value.message", source)
        self.assertIn(r"value.stack ? '\\n' + value.stack", source)

    def test_element_inspector_builds_a_unique_selector_for_plain_buttons(self):
        source = (
            Path(__file__).parents[1]
            / "frontend" / "ai-agent" / "src" / "Code" / "inspectorScript.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("document.querySelectorAll(candidate).length === 1", source)
        self.assertIn(":nth-of-type(", source)

    def test_code_workspace_exposes_manual_auto_repair_stop(self):
        workspace_source = (
            Path(__file__).parents[1]
            / "frontend" / "ai-agent" / "src" / "components" / "CodeWorkspace.tsx"
        ).read_text(encoding="utf-8")
        hook_source = (
            Path(__file__).parents[1]
            / "frontend" / "ai-agent" / "src" / "hooks" / "useCodeAutoRepair.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("终止自动修复", workspace_source)
        self.assertIn("stopAutoRepair", hook_source)

    def test_sandbox_warnings_are_promoted_to_auto_repair_diagnostics(self):
        workspace_source = (
            Path(__file__).parents[1]
            / "frontend" / "ai-agent" / "src" / "components" / "CodeWorkspace.tsx"
        ).read_text(encoding="utf-8")

        self.assertIn("data.level === 'warn'", workspace_source)
        self.assertIn("source: `console.${data.level}`", workspace_source)

    def test_code_agent_rules_forbid_unavailable_browser_storage(self):
        prompt = build_code_agent_prompt(
            task="生成学生管理页面。",
            tools=("generate_project",),
            output_contract="返回 HTML。",
        )

        self.assertIn("localStorage", prompt)
        self.assertIn("sessionStorage", prompt)
        self.assertIn("不可用", prompt)

    def test_fullstack_bridge_preserves_regex_escapes_in_generated_script(self):
        source = (
            Path(__file__).parents[1]
            / "frontend"
            / "ai-agent"
            / "src"
            / "Code"
            / "fullstackBundler.ts"
        ).read_text(encoding="utf-8")

        self.assertIn(r"var isRelativeApiUrl = /^\\/?api\\//.test(rawUrl);", source)

    def test_fullstack_bridge_parses_relative_api_urls_without_about_srcdoc_base(self):
        source = (
            Path(__file__).parents[1]
            / "frontend" / "ai-agent" / "src" / "Code" / "fullstackBundler.ts"
        ).read_text(encoding="utf-8")

        self.assertIn("if (!isRelativeApiUrl) return null", source)
        self.assertIn("rawUrl.split(/[?#]/, 1)[0]", source)
        self.assertIn("pathname: pathname", source)

    def test_failed_patch_synthesis_schedules_another_repair_until_user_stops(self):
        source = (
            Path(__file__).parents[1]
            / "frontend" / "ai-agent" / "src" / "hooks" / "useCodeAutoRepair.ts"
        ).read_text(encoding="utf-8")
        repair_section = source.split("const handleRuntimeError = useCallback", 1)[1].split(
            "const stopAutoRepair", 1
        )[0]

        self.assertIn("repairRetryTimerRef", source)
        self.assertIn("repairHandlerRef.current(runtimeError)", repair_section)
        self.assertIn("Repair synthesis failed", repair_section)

    def test_repeated_unproductive_patch_failure_opens_the_circuit_breaker(self):
        source = (
            Path(__file__).parents[1]
            / "frontend" / "ai-agent" / "src" / "hooks" / "useCodeAutoRepair.ts"
        ).read_text(encoding="utf-8")
        repair_section = source.split("const handleRuntimeError = useCallback", 1)[1].split(
            "const stopAutoRepair", 1
        )[0]

        self.assertIn("occurrence >= 3", repair_section)
        self.assertIn("setStatus({ state: 'error'", repair_section)
        self.assertIn("isRunning: false", repair_section)

    def test_layered_prompt_separates_core_task_tools_and_quality_gate(self):
        prompt = build_code_agent_prompt(
            task="只修复导致请求失败的代码。",
            tools=("inspect_project", "apply_patch"),
            output_contract="只返回 JSON 补丁。",
        )

        self.assertIn("<core_rules>", prompt)
        self.assertIn("<task_policy>", prompt)
        self.assertIn("<available_tools>", prompt)
        self.assertIn("inspect_project", prompt)
        self.assertIn("<quality_gate>", prompt)
        self.assertIn("<output_contract>", prompt)

    def test_layered_prompt_requires_contract_consistency_before_patch(self):
        prompt = build_code_agent_prompt(
            task="修改全栈虚拟文件系统。",
            tools=("inspect_project", "apply_vfs_patch", "verify_contracts"),
            output_contract="只返回 JSON。",
        )

        self.assertIn("前端请求、后端路由和数据库资源必须一致", prompt)
        self.assertIn("先观察，再选择最小范围的工具", prompt)

    def test_clean_generated_vfs_accepts_json_fences(self):
        source = '''```json
{"frontend/index.html":"<main></main>","frontend/styles.css":"","frontend/app.js":"","backend/server.py":"","backend/database.json":"{}"}
```'''

        self.assertEqual(
            clean_generated_vfs(source)["frontend/index.html"],
            "<main></main>",
        )

    def test_validate_fullstack_vfs_requires_frontend_and_database(self):
        with self.assertRaises(ValueError):
            validate_fullstack_vfs({"frontend/index.html": "<main></main>"})

    def test_validate_fullstack_vfs_rejects_invalid_database_json(self):
        with self.assertRaises(ValueError):
            validate_fullstack_vfs({
                "frontend/index.html": "<main></main>",
                "backend/database.json": "not-json",
            })

    def test_fullstack_patch_changes_only_targeted_file(self):
        vfs = {
            "frontend/index.html": "<main>Todo</main>",
            "frontend/styles.css": "body { color: blue; }",
            "frontend/app.js": "fetch('/api/todos')",
            "backend/server.py": "GET /api/todos",
            "backend/database.json": '{"todos": []}',
        }

        updated = apply_vfs_edit_operations(vfs, [{
            "file": "frontend/styles.css",
            "op": "replace",
            "target": "blue",
            "content": "red",
        }])

        self.assertEqual(updated["frontend/styles.css"], "body { color: red; }")
        self.assertEqual(updated["backend/database.json"], vfs["backend/database.json"])

    def test_fullstack_patch_rejects_ambiguous_target(self):
        vfs = {
            "frontend/index.html": "<main>Todo Todo</main>",
            "frontend/styles.css": "",
            "frontend/app.js": "",
            "backend/server.py": "",
            "backend/database.json": '{"todos": []}',
        }

        with self.assertRaises(ValueError):
            apply_vfs_edit_operations(vfs, [{
                "file": "frontend/index.html",
                "op": "replace",
                "target": "Todo",
                "content": "Task",
            }])

    def test_apply_edit_operations_replaces_only_the_exact_target_fragment(self):
        code = "<button class=\"primary\">Save</button><p>Keep this</p>"

        updated = apply_edit_operations(
            code,
            [
                {
                    "op": "replace",
                    "target": '<button class="primary">Save</button>',
                    "content": '<button class="danger">Delete</button>',
                }
            ],
        )

        self.assertEqual(
            updated,
            '<button class="danger">Delete</button><p>Keep this</p>',
        )

    def test_apply_edit_operations_deletes_only_the_exact_target_fragment(self):
        code = "<main><aside>Temporary help</aside><p>Keep this</p></main>"

        updated = apply_edit_operations(
            code,
            [
                {
                    "op": "delete",
                    "target": "<aside>Temporary help</aside>",
                    "content": "",
                }
            ],
        )

        self.assertEqual(updated, "<main><p>Keep this</p></main>")

    def test_apply_edit_operations_inserts_content_after_the_exact_anchor(self):
        code = "<main><h1>Dashboard</h1><p>Existing content</p></main>"

        updated = apply_edit_operations(
            code,
            [
                {
                    "op": "insert_after",
                    "target": "<h1>Dashboard</h1>",
                    "content": "<button>Refresh</button>",
                }
            ],
        )

        self.assertEqual(
            updated,
            "<main><h1>Dashboard</h1><button>Refresh</button>"
            "<p>Existing content</p></main>",
        )

    def test_apply_edit_operations_rejects_a_target_that_is_missing(self):
        with self.assertRaisesRegex(ValueError, "match exactly one"):
            apply_edit_operations(
                "<button>Save</button>",
                [
                    {
                        "op": "replace",
                        "target": "<button>Delete</button>",
                        "content": "<button>Remove</button>",
                    }
                ],
            )

    def test_apply_edit_operations_rejects_an_ambiguous_target(self):
        with self.assertRaisesRegex(ValueError, "match exactly one"):
            apply_edit_operations(
                "<li>Item</li><li>Item</li>",
                [
                    {
                        "op": "delete",
                        "target": "<li>Item</li>",
                        "content": "",
                    }
                ],
            )

    def test_clean_generated_html_removes_markdown_fences(self):
        source = "```html\n<!DOCTYPE html><html><body>Hi</body></html>\n```"

        self.assertEqual(
            clean_generated_html(source),
            "<!DOCTYPE html><html><body>Hi</body></html>",
        )

    def test_clean_generated_html_strips_unified_envelope_and_extracts_payload_html(self):
        """如果模型把 envelope JSON 当纯 HTML 返回（老入口 stream_html_completion 漏切），
        clean_generated_html 要剥掉外层，只返回 payload.html 的真实 HTML。"""
        html_body = (
            "<!DOCTYPE html><html><head><title>教学管理系统</title>"
            '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css">'
            "</head><body><div id='app'><h1>Dashboard</h1><table><thead><tr>"
            "<th>ID</th><th>Name</th><th>Grade</th></tr></thead><tbody></tbody>"
            "</table></div></body></html>"
        )
        envelope = json.dumps({
            "intent": "patch",
            "summary": "从零创建教学管理系统，包含仪表盘、课程管理、学生管理、教师管理、成绩管理等模块，使用内存状态和内置Mock数据",
            "terminal_commands": [],
            "rationale": "",
            "payload": {"html": html_body},
        }, ensure_ascii=False)
        # 还带围栏
        wrapped = f"```html\n{envelope}\n```"

        cleaned = clean_generated_html(wrapped)
        # 正确提取：返回纯 html_body，开头绝对不能是 `{"intent":`
        self.assertFalse(cleaned.startswith("{"))
        self.assertTrue(cleaned.startswith("<!DOCTYPE html>"))
        self.assertIn("<title>教学管理系统</title>", cleaned)
        # 外层的 summary / intent 字段不出现在结果里
        self.assertNotIn('"intent"', cleaned)
        self.assertNotIn("从零创建教学管理系统", cleaned)
        # 实际 HTML 内容完整保留
        self.assertIn("tailwindcss@2.2.19", cleaned)
        self.assertIn("<th>ID</th>", cleaned)

    def test_extract_html_from_mangled_broken_json_envelope_recovers_body(self):
        """用户现场场景：旧 bug 把 envelope JSON 整个写进 index.html，
        且模型输出被中断 → 结尾的 `\"}}` 都没闭合 → 正常 JSON 解析失败。
        _extract_html_from_mangled_envelope_source 必须靠字面量正则把 payload.html
        的字符串抠出来。"""
        html_body = (
            "<!DOCTYPE html>\n<html lang=\"zh-CN\"><head>\n"
            '<meta charset="UTF-8">\n<title>教学管理系统</title>\n'
            '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css">\n'
            "</head>\n<body>\n<div id=\"app\">\n"
            '<h1 class="text-2xl">Dashboard</h1>\n'
            '<table class="min-w-full"><thead><tr>\n'
            "<th>ID</th><th>Name</th><th>Grade</th></tr></thead><tbody>\n"
            "<tr><td>1</td><td>Alice</td><td>A</td></tr>\n"
            "</tbody></table>\n</div>\n</body>\n</html>\n"
        )
        # 用 json.dumps 制造"破损 envelope"：只有开头，没有闭合
        envelope_head = (
            '{ "intent": "patch", '
            '"summary": "从零创建教学管理系统，包含仪表盘、课程管理、学生管理、教师管理、成绩管理等模块，使用内存状态和内置Mock数据", '
            '"terminal_commands": [], '
            '"payload": { "html": ' + json.dumps(html_body, ensure_ascii=False)
        )
        # 删掉结尾的 `}}` 让 JSON 变成不合法
        broken = envelope_head  # 现在结尾是 `"</html>\n"` ，没有 `}}`
        self.assertFalse(broken.rstrip().endswith("}"))  # 确保真的破损

        recovered = _extract_html_from_mangled_envelope_source(broken)
        # 关键：不要以 `{` 开头，要以 <!DOCTYPE 开头
        self.assertFalse(recovered.startswith("{"))
        self.assertTrue(recovered.startswith("<!DOCTYPE html>"))
        self.assertIn('<title>教学管理系统</title>', recovered)
        self.assertIn("tailwindcss@2.2.19", recovered)
        self.assertIn("<th>ID</th>", recovered)
        # 外层的 summary / intent 字面值不能出现在恢复出的 HTML 里
        self.assertNotIn("从零创建教学管理系统", recovered)
        self.assertNotIn('"intent"', recovered)

    def test_extract_html_ignores_clean_regular_html(self):
        """正常的完整 HTML 不被误伤，原样返回（字节级一致）。"""
        good = (
            "<!DOCTYPE html>\n<html><head><title>正常页面</title></head>"
            "<body><p>hello</p></body></html>\n"
        )
        self.assertEqual(_extract_html_from_mangled_envelope_source(good), good)

    def test_extract_html_ignores_small_snippets(self):
        """短 HTML 片段（<300 字符）即使被 envelope 包着也不提取，
        避免把某个小 div 当整页重写。"""
        small = "<div><p>很短</p></div>"
        wrapped = '{"intent":"patch","payload":{"html":' + json.dumps(small) + '}}'
        self.assertEqual(_extract_html_from_mangled_envelope_source(wrapped), wrapped)

    def test_format_sse_preserves_unicode_and_done_flag(self):
        event = format_sse(
            {
                "type": "code_update",
                "code": "<h1>你好</h1>",
                "done": True,
            }
        )

        self.assertTrue(event.startswith("data: "))
        payload = json.loads(event.removeprefix("data: ").strip())
        self.assertEqual(
            payload,
            {
                "type": "code_update",
                "code": "<h1>你好</h1>",
                "done": True,
            },
        )

    def test_generate_endpoint_rejects_blank_prompt_before_calling_model(self):
        app = FastAPI()
        app.include_router(create_code_router(api_key="test-key"))
        client = TestClient(app)

        response = client.post(
            "/api/code/generate",
            json={"prompt": "   "},
        )

        self.assertEqual(response.status_code, 422)

    def test_fix_prompt_keeps_error_as_diagnostic_data(self):
        messages = build_fix_messages(
            "<!DOCTYPE html><script>missing()</script>",
            "ReferenceError: missing is not defined",
        )

        self.assertIn("只修改必要部分", messages[0]["content"])
        self.assertIn(
            "ReferenceError: missing is not defined",
            messages[1]["content"],
        )
        self.assertIn("<!DOCTYPE html>", messages[1]["content"])

    def test_fix_prompt_requires_an_incremental_patch_not_a_full_rewrite(self):
        messages = build_fix_messages(
            "<!DOCTYPE html><button id='add'>添加学生</button>",
            "TypeError: handler is not a function",
        )

        self.assertIn('"operations"', messages[0]["content"])
        self.assertIn("exactly once", messages[0]["content"])
        self.assertNotIn("只输出修复后的完整 HTML", messages[0]["content"])

    def test_fix_endpoint_rejects_blank_code_and_error(self):
        app = FastAPI()
        app.include_router(create_code_router(api_key="test-key"))
        client = TestClient(app)

        response = client.post(
            "/api/code/fix",
            json={"code": "   ", "error": "   "},
        )

        self.assertEqual(response.status_code, 422)

    def test_modify_prompt_requires_incremental_changes(self):
        messages = build_modify_messages(
            "<!DOCTYPE html><button class='blue'>保存</button>",
            "把按钮改成红色",
        )

        self.assertIn("只修改用户明确要求的部分", messages[0]["content"])
        self.assertIn("把按钮改成红色", messages[1]["content"])
        self.assertIn("<!DOCTYPE html>", messages[1]["content"])

    def test_modify_endpoint_rejects_blank_code_or_instruction(self):
        app = FastAPI()
        app.include_router(create_code_router(api_key="test-key"))
        client = TestClient(app)

        response = client.post(
            "/api/code/modify",
            json={"code": "<!DOCTYPE html>", "instruction": "   "},
        )

        self.assertEqual(response.status_code, 422)

    def test_modify_prompt_includes_selected_element_context(self):
        messages = build_modify_messages(
            "<!DOCTYPE html><button class='cta'>购买</button>",
            "把这个按钮改成红色",
            {
                "selector": "button.cta",
                "tag_name": "button",
                "class_name": "cta",
                "element_id": "",
                "outer_html": "<button class='cta'>购买</button>",
            },
        )

        self.assertIn("button.cta", messages[1]["content"])
        self.assertIn("<selected_element>", messages[1]["content"])

    def test_archive_endpoint_writes_vfs_under_configured_workspace(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            app = FastAPI()
            app.include_router(
                create_code_router(
                    api_key="test-key",
                    workspace_root=Path(temporary_directory),
                )
            )
            client = TestClient(app)

            response = client.post(
                "/api/code/vfs/archive",
                json={
                    "project_name": "landing-page",
                    "files": {
                        "index.html": "<h1>Hello</h1>",
                        "assets/styles.css": "body { color: red; }",
                    },
                },
            )

            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json()["file_count"], 2)
            project_path = Path(response.json()["project_path"])
            self.assertEqual(project_path, Path(temporary_directory) / "landing-page")
            self.assertEqual((project_path / "index.html").read_text(encoding="utf-8"), "<h1>Hello</h1>")
            self.assertEqual(
                (project_path / "assets" / "styles.css").read_text(encoding="utf-8"),
                "body { color: red; }",
            )

    def test_archive_endpoint_rejects_file_path_traversal(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            app = FastAPI()
            app.include_router(
                create_code_router(
                    api_key="test-key",
                    workspace_root=Path(temporary_directory),
                )
            )
            client = TestClient(app)

            response = client.post(
                "/api/code/vfs/archive",
                json={
                    "project_name": "landing-page",
                    "files": {"../outside.txt": "must not be written"},
                },
            )

            self.assertEqual(response.status_code, 422)
            self.assertFalse((Path(temporary_directory).parent / "outside.txt").exists())


# ─────────────────────────────────────────────────────────
# Day60 换行符修复 + 流式去重 单元测试
# 覆盖: _fix_content_newlines / normalize_agent_envelope /
#       clean_generated_vfs / format_sse 流式计数
# ─────────────────────────────────────────────────────────
class NewlineAndStreamingRegressionTests(unittest.TestCase):
    # ── helpers ────────────────────────────────────────
    def _mini_vfs(self, *, escape_style: str = "real") -> dict[str, str]:
        """构造 5 文件 fullstack VFS。escape_style:
        - 'real'   : 真实换行 chr(10) （正常情况）
        - 'double' : 字面量 \\n （模型双重转义 bug）
        - 'triple' : 字面量 \\\\n （三重转义残留）
        """
        html_lines = [
            "<!DOCTYPE html>",
            '<html lang="zh-CN">',
            "<head>",
            '  <meta charset="UTF-8">',
            '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
            "  <title>学生管理系统 - Student Admin Dashboard</title>",
            '  <link rel="stylesheet" href="styles.css">',
            '  <meta name="description" content="全栈学生信息管理系统示例，支持增删改查">',
            "  <style>",
            "    body { background: #f8fafc; }",
            "    header { padding: 16px 24px; background: #1e293b; color: white; }",
            "  </style>",
            "</head>",
            "<body>",
            "  <header>",
            '    <h1>Students Admin Dashboard</h1>',
            '    <p>Welcome to the student management system demo page.</p>',
            "  </header>",
            '  <main id="app">',
            '    <section class="toolbar">',
            '      <input id="search" placeholder="Search by name or id...">',
            '      <button id="add">Add new student</button>',
            "    </section>",
            '    <section class="content">',
            '      <table id="students-table">',
            "        <thead><tr><th>ID</th><th>Name</th><th>Grade</th><th>Actions</th></tr></thead>",
            "        <tbody></tbody>",
            "      </table>",
            "    </section>",
            "  </main>",
            '  <script src="app.js"></script>',
            "</body>",
            "</html>",
        ]
        js_lines = [
            "// 初始化全局状态：学生列表缓存 + DOM 引用",
            "const state = { students: [], table: null, searchInput: null, addBtn: null };",
            "",
            "// 页面启动：读 DOM 元素、拉取学生数据、绑定事件",
            "document.addEventListener('DOMContentLoaded', async () => {",
            "  state.table = document.querySelector('#students-table tbody');",
            "  state.searchInput = document.querySelector('#search');",
            "  state.addBtn = document.querySelector('#add');",
            "  // 如果被挤到同一行：这行 // 注释会吞掉下面的 fetchStudents()",
            "  await fetchStudents();",
            "  renderTable();",
            "  bindEvents();",
            "});",
            "",
            "// 从后端 API 拉取所有学生记录",
            "async function fetchStudents() {",
            "  const res = await fetch('/api/students');",
            "  if (!res.ok) throw new Error('fetch failed');",
            "  state.students = await res.json();",
            "}",
            "",
            "// 将 state.students 渲染到表格",
            "function renderTable(filter = '') {",
            "  const rows = filter",
            "    ? state.students.filter(s => s.name.includes(filter) || String(s.id) === filter)",
            "    : state.students;",
            "  state.table.innerHTML = rows.map(rowToTr).join('');",
            "}",
            "",
            "// 单行渲染函数",
            "function rowToTr(s) {",
            "  return '<tr><td>' + s.id + '</td><td>' + s.name + '</td><td>' + s.grade + '</td></tr>';",
            "}",
            "",
            "// 搜索 + 新增按钮事件",
            "function bindEvents() {",
            "  state.searchInput.addEventListener('input', e => renderTable(e.target.value));",
            "  state.addBtn.addEventListener('click', addStudent);",
            "}",
            "",
            "// 新增学生（示意）",
            "async function addStudent() {",
            "  const name = prompt('Student name?') || '';",
            "  if (!name) return;",
            "  await fetch('/api/students', {",
            "    method: 'POST',",
            "    headers: { 'Content-Type': 'application/json' },",
            "    body: JSON.stringify({ name, grade: 'A' })",
            "  });",
            "  await fetchStudents();",
            "  renderTable();",
            "}",
        ]
        css_lines = [
            "/* ===== Base reset ===== */",
            "* { box-sizing: border-box; }",
            "body {",
            "  margin: 0;",
            "  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;",
            "  color: #0f172a;",
            "}",
            "",
            "/* ===== Layout ===== */",
            "header h1 { margin: 0; font-size: 20px; }",
            "main#app { padding: 24px; max-width: 1024px; margin: 0 auto; }",
            ".toolbar { display: flex; gap: 12px; margin-bottom: 16px; }",
            ".toolbar input { flex: 1; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; }",
            ".toolbar button { padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 6px; }",
            "",
            "/* ===== Table ===== */",
            "#students-table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; }",
            "#students-table th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-size: 13px; }",
            "#students-table td { padding: 10px 12px; border-top: 1px solid #e2e8f0; font-size: 14px; }",
            "h1 { color: #1e40af; }",
        ]
        py_lines = [
            "# FastAPI 学生管理后端：CORS + JSON DB + CRUD",
            "from fastapi import FastAPI, HTTPException",
            "from fastapi.middleware.cors import CORSMiddleware",
            "from pydantic import BaseModel",
            "",
            "app = FastAPI(title='Student Admin API')",
            "app.add_middleware(",
            "    CORSMiddleware,",
            "    allow_origins=['*'],",
            "    allow_methods=['*'],",
            "    allow_headers=['*'],",
            ")",
            "",
            "# 内存数据库",
            "DB = {'students': [{'id': 1, 'name': 'Alice', 'grade': 'A'}]}",
            "",
            "class StudentIn(BaseModel):",
            "    name: str",
            "    grade: str = 'N/A'",
            "",
            "@app.get('/api/students')",
            "def list_students():",
            "    return DB['students']",
            "",
            "@app.post('/api/students')",
            "def create_student(payload: StudentIn):",
            "    next_id = max((s['id'] for s in DB['students']), default=0) + 1",
            "    record = {'id': next_id, 'name': payload.name, 'grade': payload.grade}",
            "    DB['students'].append(record)",
            "    return record",
            "",
            "@app.delete('/api/students/{student_id}')",
            "def delete_student(student_id: int):",
            "    for i, s in enumerate(DB['students']):",
            "        if s['id'] == student_id:",
            "            return DB['students'].pop(i)",
            "    raise HTTPException(404, 'not found')",
        ]
        db = '{"students": [{"id": 1, "name": "Alice", "grade": "A"}, {"id": 2, "name": "Bob", "grade": "B"}]}'
        if escape_style == "real":
            sep = "\n"
        elif escape_style == "double":
            sep = "\\n"
        else:  # triple
            sep = "\\\\n"
        return {
            "frontend/index.html": sep.join(html_lines),
            "frontend/styles.css": sep.join(css_lines),
            "frontend/app.js": sep.join(js_lines),
            "backend/server.py": sep.join(py_lines),
            "backend/database.json": db,
        }

    # ── _fix_content_newlines ─────────────────────────
    def test_fix_double_escaped_newlines_in_js(self):
        """双重转义的 JS：// 注释后面有 30+ 字面量 \\n，必须全部还原为真实换行。"""
        bad = self._mini_vfs(escape_style="double")["frontend/app.js"]
        self.assertLessEqual(bad.count("\n"), 0)  # 没有真实换行
        self.assertGreaterEqual(bad.count("\\n"), 30)  # 但有巨多字面量 \n

        fixed = _fix_content_newlines(bad)

        # 修复后：真实换行数量接近 join 分隔符数量
        self.assertGreaterEqual(fixed.count("\n"), 30)
        # // 注释独占一行：下一行是 const state，不是 // 注释里的内容
        lines = fixed.split("\n")
        comment_line_idx = next(
            i for i, ln in enumerate(lines) if "初始化全局状态" in ln
        )
        # 下一行：state 初始化，不在注释行里
        self.assertIn("const state", lines[comment_line_idx + 1])

    def test_fix_triple_escaped_newlines(self):
        """三重转义残留（\\\\n）：先降到 \\n，再走双重转义分支。"""
        bad = self._mini_vfs(escape_style="triple")["frontend/app.js"]
        self.assertIn("\\\\n", bad)

        fixed = _fix_content_newlines(bad)

        # 不应再有三重或双重的字面量
        self.assertNotIn("\\\\n", fixed)
        self.assertGreaterEqual(fixed.count("\n"), 30)

    def test_fix_preserves_normal_real_newlines(self):
        """代码本身就是真实换行（正常情况）→ 字节零修改。"""
        good = self._mini_vfs(escape_style="real")["frontend/app.js"]
        fixed = _fix_content_newlines(good)
        self.assertEqual(fixed, good)

    def test_fix_small_file_not_triggered(self):
        """小 CSS（<20 个字面量 \\n）：不误伤。"""
        tiny = "body{\\nmargin:0\\n}"  # 只有 2 个字面量
        fixed = _fix_content_newlines(tiny)
        # 没有触发修复：仍然是字面量 \\n
        self.assertIn("\\n", fixed)

    def test_fix_non_string_passthrough(self):
        """非字符串输入：原样返回。"""
        self.assertIsNone(_fix_content_newlines(None))  # type: ignore[arg-type]
        self.assertEqual(_fix_content_newlines(42), 42)  # type: ignore[arg-type]

    # ── normalize_agent_envelope: 全链路换行修复 ───
    def test_envelope_patch_html_content_gets_newlines(self):
        """intent=patch + payload.html: 双重转义 HTML 必须还原。"""
        bad_html = self._mini_vfs(escape_style="double")["frontend/index.html"]
        raw = json.dumps({
            "intent": "patch",
            "summary": "重写页面",
            "payload": {"html": bad_html},
            "terminal_commands": [],
            "rationale": "",
        })
        env = normalize_agent_envelope(raw)
        self.assertEqual(env["intent"], "patch")
        fixed_html = env["payload"]["html"]
        self.assertGreaterEqual(fixed_html.count("\n"), 10)
        self.assertIn("</head>\n", fixed_html)  # head 闭合后独占一行 + 新行

    def test_envelope_patch_operations_content_fixed(self):
        """operations[].content 里的双重转义 JS：每个 op.content 单独还原。"""
        bad_js = self._mini_vfs(escape_style="double")["frontend/app.js"]
        ops = [{
            "file": "frontend/app.js",
            "op": "replace",
            "target": "const OLD = true;",
            "content": bad_js,  # 双重转义内容
        }]
        raw = {
            "intent": "patch",
            "summary": "替换 app.js",
            "payload": {"operations": ops},
            "terminal_commands": [],
            "rationale": "",
        }
        env = normalize_agent_envelope(raw)
        fixed_content = env["payload"]["operations"][0]["content"]
        # // 注释后面的 fetch 语句：如果未修复会整行被吞，修复后 fetch 单独一行
        self.assertIn("\n  const res = await fetch", fixed_content)

    def test_envelope_patch_files_dict_fixed(self):
        """file-replace 路径: payload.files 中每一个文件值独立修复。"""
        bad = self._mini_vfs(escape_style="double")
        raw = {
            "intent": "patch",
            "summary": "批量重写",
            "payload": {
                "files": bad,
                "deleted": [],
            },
            "terminal_commands": [],
            "rationale": "",
        }
        env = normalize_agent_envelope(raw)
        fixed_app = env["payload"]["files"]["frontend/app.js"]
        fixed_css = env["payload"]["files"]["frontend/styles.css"]
        self.assertGreaterEqual(fixed_app.count("\n"), 30)
        # CSS reset 后 body { \n + margin:0 独占一行
        self.assertIn("body {\n", fixed_css)

    def test_envelope_fullstack_bootstrap_top_level_keys_fixed(self):
        """裸 5-file VFS（顶层 key=路径）→ 走 fullstack_bootstrap 早返回分支。"""
        bad = self._mini_vfs(escape_style="double")
        env = normalize_agent_envelope(bad)
        self.assertEqual(env["intent"], "fullstack_bootstrap")
        fixed_server = env["payload"]["backend/server.py"]
        # 修复后每行 Python 语句独立一行：app = FastAPI(title=...) 前后各有换行
        self.assertIn("\napp = FastAPI(", fixed_server)
        self.assertIn("def list_students():\n    return DB['students']", fixed_server)

    def test_envelope_raw_denuded_html_string_fixed(self):
        """非 JSON 裸字符串 + _looks_like_full_html → 早返回 denuded 分支。"""
        bad_html = self._mini_vfs(escape_style="double")["frontend/index.html"]
        # 包一层 ```html 围栏，模拟模型走 markdown 围栏
        wrapped = f"```html\n{bad_html}\n```"
        env = normalize_agent_envelope(wrapped)
        self.assertEqual(env["intent"], "patch")
        fixed_html = env["payload"]["html"]
        self.assertGreaterEqual(fixed_html.count("\n"), 10)
        self.assertNotIn("\\n<", fixed_html)  # 不残留字面量 \n<

    def test_envelope_normal_code_is_byte_identical(self):
        """正常有真实换行的 envelope：_fix_content_newlines 不篡改任何字节。"""
        good = self._mini_vfs(escape_style="real")
        env_before_serialize = {
            "intent": "patch",
            "summary": "ok",
            "payload": {
                "operations": [{
                    "file": "frontend/app.js",
                    "op": "new_file",
                    "content": good["frontend/app.js"],
                }],
            },
            "terminal_commands": [],
            "rationale": "",
        }
        env = normalize_agent_envelope(env_before_serialize)
        self.assertEqual(
            env["payload"]["operations"][0]["content"],
            good["frontend/app.js"],
        )

    # ── clean_generated_vfs ─────────────────────────
    def test_clean_generated_vfs_double_escape_roundtrip(self):
        """带 ```json 围栏的双重转义 VFS → 5 文件全部还原真实换行。"""
        bad = self._mini_vfs(escape_style="double")
        wrapped = "```json\n" + json.dumps(bad, ensure_ascii=False) + "\n```"
        vfs = clean_generated_vfs(wrapped)
        self.assertEqual(set(vfs.keys()), FULLSTACK_REQUIRED_FILES)
        app = vfs["frontend/app.js"]
        self.assertGreaterEqual(app.count("\n"), 30)
        # 最关键的 // 注释行隔离断言：注释独占一行，下一行是 state 初始化
        lines = app.split("\n")
        comment = next(i for i, l in enumerate(lines) if "初始化全局状态" in l)
        self.assertIn("const state", lines[comment + 1])

    def test_clean_generated_vfs_preserves_normal_newlines(self):
        """正常真实换行的 VFS → 解析后字节级等于原始 payload。"""
        good = self._mini_vfs(escape_style="real")
        vfs = clean_generated_vfs(json.dumps(good, ensure_ascii=False))
        for path in FULLSTACK_REQUIRED_FILES:
            self.assertEqual(vfs[path], good[path])

    def test_clean_generated_vfs_strips_unified_envelope_and_extracts_vfs(self):
        """fullstack 模型现在按 UNIFIED ENVELOPE 输出：外层 5 键 JSON，真正的 VFS 在 payload。
        clean_generated_vfs 必须先剥 envelope 再取 payload 当 VFS，不能把 intent/summary 当文件 key。"""
        good = self._mini_vfs(escape_style="real")
        envelope = {
            "intent": "fullstack_bootstrap",
            "summary": "生成教学管理系统骨架，前后端各 3 模块",
            "terminal_commands": [
                {"command": "python -m http.server 8000", "reason": "预览", "expected_output_hint": "Serving HTTP"}
            ],
            "rationale": "",
            "payload": good,
        }
        source = "```json\n" + json.dumps(envelope, ensure_ascii=False) + "\n```"
        vfs = clean_generated_vfs(source)
        self.assertEqual(set(vfs.keys()), FULLSTACK_REQUIRED_FILES)
        # 外层字段绝对不能当文件 key
        self.assertNotIn("intent", vfs)
        self.assertNotIn("summary", vfs)
        self.assertNotIn("terminal_commands", vfs)
        # 真实 HTML 内容正确
        self.assertIn("<title>", vfs["frontend/index.html"])
        # Python 内容正确
        self.assertIn("FastAPI", vfs["backend/server.py"])

    def test_clean_generated_vfs_envelope_with_files_dict(self):
        """file-replace 口径：envelope.payload = {"files": {...}, "deleted": []} → clean_generated_vfs 也能解析 files 作为 VFS 内容。"""
        good = self._mini_vfs(escape_style="real")
        envelope = {
            "intent": "patch",
            "summary": "rewrite 3 files",
            "terminal_commands": [],
            "rationale": "",
            "payload": {"files": good, "deleted": []},
        }
        source = json.dumps(envelope, ensure_ascii=False)
        vfs = clean_generated_vfs(source)
        self.assertIn("frontend/index.html", vfs)
        self.assertIn("backend/server.py", vfs)
        self.assertIn("FastAPI", vfs["backend/server.py"])
        self.assertNotIn("intent", vfs)

    # ── 流式重复追加间接验证：format_sse 合并结果 ──
    def test_envelope_extracted_from_natural_language_prefix(self):
        """GLM 等模型常在 envelope JSON 前加自然语言解释，必须能正确提取并识别为 fullstack_bootstrap。"""
        good = self._mini_vfs(escape_style="real")
        envelope = {
            "intent": "fullstack_bootstrap",
            "summary": "创建了一个简单的购物商场平台，包含商品浏览、购物车管理和订单功能。",
            "terminal_commands": [],
            "rationale": "采用 FastAPI + 原生 JavaScript",
            "payload": good,
        }
        raw_text = (
            "根据您的需求，我将为您创建一个简单的购物商场平台，包含商品浏览、购物车和订单功能。\n\n"
            + json.dumps(envelope, ensure_ascii=False)
        )
        env = normalize_agent_envelope(raw_text)
        self.assertEqual(env["intent"], "fullstack_bootstrap")
        self.assertIn("frontend/index.html", env["payload"])
        self.assertIn("backend/server.py", env["payload"])

    def test_streaming_output_not_duplicated_in_accumulated_length(self):
        """如果调用方保留了“删之前”的重复 yield，把 chunks 数 +1
        再累计到同一 trace.output，总长度会 ≈ 2x accumulated。
        本测试用相同 API 口径校验 format_sse 的输出长度。"""
        chunks = [
            '{"fron',
            'tend/index.h',
            'tml": "<!DOCT',
            'YPE html>\\n<ht',
            'ml>\\n</html>"}',
        ]
        accumulated = "".join(chunks)

        # 模拟“删之前”的错误路径：每个 chunk 一条 SSE + 末尾再补一条 accumulated
        def old_way() -> list[str]:
            events = [format_sse({
                "type": "agent_activity", "channel": "output",
                "phase": "patching", "content": c, "done": False,
            }) for c in chunks]
            events.append(format_sse({
                "type": "agent_activity", "channel": "output",
                "phase": "patching", "content": accumulated, "done": False,
            }))
            return events

        # 模拟“删之后”：只发 chunks
        def new_way() -> list[str]:
            return [format_sse({
                "type": "agent_activity", "channel": "output",
                "phase": "patching", "content": c, "done": False,
            }) for c in chunks]

        # 前端累计 output 内容（剥离 SSE data: 头 + \n\n 尾 + 反 JSON 取 content）
        def extract_content(ev: str) -> str:
            self.assertTrue(ev.startswith("data: "))
            payload = json.loads(ev[len("data: "):].rstrip("\n\n"))
            return payload["content"]

        old_sum = "".join(extract_content(e) for e in old_way())
        new_sum = "".join(extract_content(e) for e in new_way())
        # 新方式：恰好 == accumulated
        self.assertEqual(new_sum, accumulated)
        # 旧方式：长度约 2x（accumulated * 2）
        self.assertEqual(len(old_sum), len(accumulated) * 2)
        # 旧方式 JSON.parse 失败（两份拼一起），新方式成功
        self.assertIsInstance(json.loads(new_sum), dict)
        with self.assertRaises(json.JSONDecodeError):
            json.loads(old_sum)


if __name__ == "__main__":
    unittest.main()
