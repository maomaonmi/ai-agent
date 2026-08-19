import ast
from pathlib import Path


ROOT = Path("frontend/ai-agent/src/features/deep-research")
CHAT = Path("frontend/ai-agent/src/components/ChatInterface.tsx")


def test_research_workspace_is_an_independent_feature_boundary():
    workspace = (ROOT / "ResearchWorkspace.tsx").read_text(encoding="utf-8")
    assert "data-research-workspace" in workspace
    assert "ResearchReportPane" in workspace
    assert "WritingWorkspace" not in workspace
    assert "../ai-writing" not in workspace


def test_report_pane_has_both_reports_and_complete_actions():
    pane = (ROOT / "report/ResearchReportPane.tsx").read_text(encoding="utf-8")
    assert "深度研报" in pane
    assert "文本报告" in pane
    assert "复制报告" in pane
    assert "下载报告" in pane
    assert "全屏查看" in pane
    assert "role=\"tablist\"" in pane


def test_deep_report_uses_its_own_structured_markdown_document():
    source = (ROOT / "report/DeepResearchDocument.tsx").read_text(encoding="utf-8")
    assert "MarkdownMessage" in source
    assert "data-research-markdown" in source
    assert "data-research-document" in source


def test_report_adapter_only_charts_explicit_numeric_evidence():
    adapter = (ROOT / "report/researchReportAdapter.ts").read_text(encoding="utf-8")
    assert "extractExplicitMetrics" in adapter
    assert "sourceText" in adapter
    assert "percent" in adapter


def test_deep_report_derives_its_title_and_structure_from_report_content():
    adapter = (ROOT / "report/researchReportAdapter.ts").read_text(encoding="utf-8")
    assert "deriveReportTitle" in adapter
    assert "parseMarkdownTables" in adapter
    assert "dataCharts" in adapter
    assert "title: deriveReportTitle(report)" in adapter
    pane = (ROOT / "report/ResearchReportPane.tsx").read_text(encoding="utf-8")
    assert "{reportDocument.title}</h2>" in pane


def test_deep_report_uses_gfm_markdown_and_multiple_evidence_chart_types():
    source = (ROOT / "report/DeepResearchDocument.tsx").read_text(encoding="utf-8")
    assert "MarkdownMessage" in source
    assert "ComparisonChart" in source
    assert "TrendChart" in source
    assert "data-research-markdown" in source


def test_research_charts_are_distributed_adaptive_and_hoverable():
    adapter = (ROOT / "report/researchReportAdapter.ts").read_text(encoding="utf-8")
    source = (ROOT / "report/DeepResearchDocument.tsx").read_text(encoding="utf-8")
    assert "'donut'" in adapter
    assert "splitReportSections" in source
    assert "onMouseEnter" in source
    assert "onFocus" in source
    assert "data-research-chart" in source


def test_chat_interface_mounts_research_workspace_without_changing_request_api():
    source = CHAT.read_text(encoding="utf-8")
    assert "ResearchWorkspace" in source
    assert "mode === 'research'" in source
    assert "sendDeepResearch(" in source
    assert "onResearchProcess" in source
    assert "onResearchReasonDone" in source
    assert "onResearchDone" in source


def test_research_document_has_scoped_typography_and_print_rules():
    styles = Path("frontend/ai-agent/src/app/globals.css").read_text(encoding="utf-8")
    assert ".research-tiptap-document" in styles
    assert "[data-research-workspace]" in styles
    assert "@media print" in styles


def test_workspace_has_desktop_and_mobile_report_surfaces():
    workspace = (ROOT / "ResearchWorkspace.tsx").read_text(encoding="utf-8")
    assert "xl:block" in workspace
    assert "xl:hidden" in workspace
    assert "打开调研报告" in workspace


def test_research_has_an_independent_real_docx_exporter():
    exporter = (ROOT / "export/researchWordExport.ts").read_text(encoding="utf-8")
    pane = (ROOT / "report/ResearchReportPane.tsx").read_text(encoding="utf-8")
    assert "application/vnd.openxmlformats-officedocument.wordprocessingml.document" in exporter
    assert "JSZip" in exporter
    assert "createResearchWordDocument" in pane
    assert "${safeName}.docx" in pane


def test_web_and_word_exports_share_the_same_report_document():
    exporter = (ROOT / "export/researchWordExport.ts").read_text(encoding="utf-8")
    pane = (ROOT / "report/ResearchReportPane.tsx").read_text(encoding="utf-8")
    adapter = (ROOT / "report/researchReportAdapter.ts").read_text(encoding="utf-8")
    assert "ResearchReportDocument" in exporter
    assert "createResearchWordDocument(reportDocument)" in pane
    assert "rawReport" in adapter


def test_research_report_has_independent_search_and_outline_navigation():
    pane = (ROOT / "report/ResearchReportPane.tsx").read_text(encoding="utf-8")
    navigation = (ROOT / "navigation/ResearchNavigationPanel.tsx").read_text(encoding="utf-8")
    assert "ResearchNavigationPanel" in pane
    assert "搜索结果与目录" in pane
    assert "搜索结果" in navigation
    assert "目录结构" in navigation
    assert "../ai-writing" not in navigation


def test_research_adapter_exposes_stable_outline_nodes():
    adapter = (ROOT / "report/researchReportAdapter.ts").read_text(encoding="utf-8")
    assert "ResearchOutlineItem" in adapter
    assert "outline:" in adapter
    assert "research-section-" in adapter


def test_research_workspace_persists_width_and_supports_drag_resize():
    workspace = (ROOT / "ResearchWorkspace.tsx").read_text(encoding="utf-8")
    assert "research-workspace-preferences-v2" in workspace
    assert "role=\"separator\"" in workspace
    assert "onPointerDown" in workspace
    assert "sessionId" in workspace


def test_qwen_research_sources_cross_the_backend_sse_contract():
    backend = Path("main.py").read_text(encoding="utf-8")
    assert "normalize_qwen_research_sources" in backend
    assert '"top_chunks": persisted_sources' in backend
    assert '"count": len(web_docs)' in backend


def test_qwen_source_normalizer_deduplicates_and_clamps_scores():
    backend = Path("main.py").read_text(encoding="utf-8")
    module = ast.parse(backend)
    function = next(
        node for node in module.body
        if isinstance(node, ast.FunctionDef) and node.name == "normalize_qwen_research_sources"
    )
    namespace: dict[str, object] = {}
    exec(compile(ast.Module(body=[function], type_ignores=[]), "main.py", "exec"), namespace)
    normalize = namespace["normalize_qwen_research_sources"]
    result = normalize([
        {"title": "A", "url": "https://example.com/a", "description": "first", "score": 3},
        {"title": "duplicate", "url": "https://example.com/a", "snippet": "ignored"},
        {"name": "B", "link": "https://example.com/b", "content": "second", "score": "bad"},
    ])
    assert len(result) == 2
    assert result[0] == {"id": 1, "title": "A", "url": "https://example.com/a", "score": 1.0, "text": "first"}
    assert result[1]["title"] == "B"
    assert result[1]["score"] == 1.0


def test_research_stream_accepts_and_persists_web_docs():
    api = Path("frontend/ai-agent/src/lib/api.ts").read_text(encoding="utf-8")
    chat = CHAT.read_text(encoding="utf-8")
    assert "onWebDocs?: (event: WebDocsEvent)" in api
    assert "Array.isArray(parsed.docs)" in api
    assert chat.count("onWebDocs: handleResearchWebDocs") >= 2
    assert "persistResearchMessages" in chat


def test_history_report_falls_back_to_persisted_web_docs():
    chat = CHAT.read_text(encoding="utf-8")
    assert "researchSourcesFromMessage" in chat
    assert "latestResearchReportMessage" in chat


def test_research_chat_renders_a_document_card_without_discarding_report_state():
    chat = CHAT.read_text(encoding="utf-8")
    assert "ResearchDocumentCard" in chat
    assert "isResearchDocument" in chat
    assert "persistResearchMessages" in chat
    assert "researchChunks" in chat


def test_research_figures_have_a_dedicated_backend_job_contract():
    backend = Path("main.py").read_text(encoding="utf-8")
    assert "research_figure_jobs" in backend
    assert "research_figures" in backend
    assert "/api/research/figures/jobs" in backend
    assert "/cancel" in backend
    assert "/retry" in backend
    assert "target_ordinal" in backend
    assert "max_images" in backend
    assert "context_before" in backend
    assert "RESEARCH_FIGURE_SEMAPHORE" in backend
    assert "report_text" in backend
    assert "batch_index" in backend
    assert "batch_title" in backend
    assert 'job_data["batches"]' in backend
    assert "generate_batch" in backend


def test_research_figures_are_persisted_on_the_report_message_and_rendered():
    api = Path("frontend/ai-agent/src/lib/api.ts").read_text(encoding="utf-8")
    chat = CHAT.read_text(encoding="utf-8")
    workspace = (ROOT / "ResearchWorkspace.tsx").read_text(encoding="utf-8")
    document = (ROOT / "report/DeepResearchDocument.tsx").read_text(encoding="utf-8")
    assert "ResearchFigure" in api
    assert "createResearchFigureJob" in api
    assert "researchFigures" in api
    assert "researchFigures" in chat
    assert "researchFigures" in workspace
    assert "data-research-figure" in document
    assert "createFigurePlaceholders" in workspace
    assert "正在生成研究配图" in (ROOT / "ResearchDocumentCard.tsx").read_text(encoding="utf-8")
    assert "animate-spin" in document
    assert "onError" in document
    assert "retryResearchFigure" in workspace
    assert "allImagesReady" in workspace
    assert "figureBatches" in workspace
    assert "配图按章节分批生成" in (ROOT / "report/ResearchReportPane.tsx").read_text(encoding="utf-8")
    assert "isUsableJobId" in workspace
    assert "job_id: 'pending'" in workspace
    assert "containsOnlyPendingResearchFigures" in chat
    assert "buildHistoricalResearchChain" in chat
    assert "历史链路摘要" in (Path("frontend/ai-agent/src/components/NodeProgressPanel.tsx")).read_text(encoding="utf-8")


def test_research_figures_have_a_deadline_and_user_retry_path():
    workspace = (ROOT / "ResearchWorkspace.tsx").read_text(encoding="utf-8")
    document = (ROOT / "report/DeepResearchDocument.tsx").read_text(encoding="utf-8")
    pane = (ROOT / "report/ResearchReportPane.tsx").read_text(encoding="utf-8")
    assert "FIGURE_TIMEOUT_MS = 30_000" in workspace
    assert "图片生成超过 30 秒，可点击重试" in workspace
    assert "重试配图" in document
    assert "onFigureRetry" in document
    assert "onFigureRetry" in pane


def test_research_figure_planner_keeps_count_and_context_bounds():
    backend = Path("main.py").read_text(encoding="utf-8")
    module = ast.parse(backend)
    names = {"plan_research_figures", "_research_context", "_research_figure_type"}
    functions = [node for node in module.body if isinstance(node, ast.FunctionDef) and node.name in names]
    namespace = {"re": __import__("re"), "Any": object}
    exec(compile(ast.Module(body=functions, type_ignores=[]), "main.py", "exec"), namespace)
    plan = namespace["plan_research_figures"]("\n".join(["# 研究章节", "这是一段用于验证研究配图上下文裁剪和布局分散的正文。" * 80]), 10)
    assert 2 <= len(plan) <= 10
    assert all(0 < len(item["context_before"]) <= 200 for item in plan)
    assert all(len(item["context_after"] or "") <= 110 for item in plan)
    assert all("batch_index" in item and "batch_title" in item for item in plan)
