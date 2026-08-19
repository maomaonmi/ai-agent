from pathlib import Path


ROOT = Path("frontend/ai-agent/src")


def test_plan_workspace_is_independent_from_research_workspace():
    workspace = (ROOT / "features/autonomous-plan/PlanWorkspace.tsx").read_text(encoding="utf-8")
    assert "data-plan-workspace" in workspace
    assert "ResearchWorkspace" not in workspace
    assert "TaskOutput" in workspace
    assert "PlanReport" in workspace


def test_plan_right_pane_has_task_outputs_and_report_actions():
    pane = (ROOT / "features/autonomous-plan/PlanWorkspace.tsx").read_text(encoding="utf-8")
    assert "任务产出" in pane
    assert "最终报告" in pane
    assert "复制报告" in pane
    assert "下载报告" in pane
    assert "全屏查看" in pane
    assert 'role="tablist"' in pane
    assert "overflow-x-auto" in pane


def test_plan_report_document_supports_tables_charts_and_figures():
    adapter = (ROOT / "features/autonomous-plan/planReportAdapter.ts").read_text(encoding="utf-8")
    document = (ROOT / "features/autonomous-plan/PlanReportDocument.tsx").read_text(encoding="utf-8")
    assert "parsePlanTables" in adapter
    assert "PlanReportChart" in adapter
    assert "data-plan-chart" in document
    assert "data-plan-figure" in document
    assert "MarkdownMessage" in document
    assert "<thead className=\"bg-slate-100\"> <" not in document
    assert "正在生成配图" in document
    assert "重试配图" in document


def test_plan_progress_is_persisted_during_stream_and_final_message():
    chat = (ROOT / "components/ChatInterface.tsx").read_text(encoding="utf-8")
    assert "persistPlanMessages" in chat
    assert "onPlanProgress" in chat
    assert "planProgress: event" in chat
    assert "PlanWorkspace" in chat
    assert "mode === 'plan' || mode === 'distributed_plan'" in chat


def test_plan_figures_restore_existing_jobs_and_have_timeout_retry_contract():
    workspace = (ROOT / "features/autonomous-plan/PlanWorkspace.tsx").read_text(encoding="utf-8")
    api = (ROOT / "lib/api.ts").read_text(encoding="utf-8")
    assert "FIGURE_TIMEOUT_MS = 30_000" in workspace
    assert "getPlanFigureJob(existingJobId)" in workspace
    assert "retryPlanFigure" in workspace
    assert "/api/plan/figures/jobs" in api
