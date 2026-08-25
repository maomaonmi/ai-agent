from pathlib import Path


FRONTEND = Path(__file__).resolve().parents[1] / "frontend" / "ai-agent" / "src"


def test_ppt_workspace_route_and_core_editor_controls_exist() -> None:
    route = FRONTEND / "app" / "ppt" / "workspace" / "[presentationId]" / "page.tsx"
    workspace = FRONTEND / "features" / "ppt" / "workspace" / "PptWorkspace.tsx"

    assert route.exists()
    assert workspace.exists()
    assert (FRONTEND / "app" / "api" / "ppt" / "export" / "route.ts").exists()
    assert "await params" in route.read_text(encoding="utf-8")

    source = workspace.read_text(encoding="utf-8")
    assert 'searchParams.get("source") === "sidebar"' in source
    assert 'templateId = freshFromSidebar ? "blank"' in source
    assert '新建 AI PPT' in source

    for contract_marker in (
        'data-ppt-workspace',
        'aria-label="AI 工作流"',
        'AI PPT 助手',
        'AI 工作流链路',
        'AI PPT 对话输入',
        '发送 PPT 需求',
        '调整 AI 对话区宽度',
        'aria-label="幻灯片缩略图"',
        '新建幻灯片',
        '插入文本',
        '插入图形',
        '插入图片',
        '插入图表',
        '插入表格',
        '演讲者备注',
        '导出 PPTX',
        '发布前预览',
        '发布到市场',
        'requestFullscreen',
        'PPT 放映',
    ):
        assert contract_marker in source
    assert 'useState(false)' in source


def test_workspace_exposes_agent_progress_and_asset_provenance() -> None:
    workspace = FRONTEND / "features" / "ppt" / "workspace" / "PptWorkspace.tsx"
    source = workspace.read_text(encoding="utf-8")

    for contract_marker in (
        '联网检索',
        '每次不超过 20 条',
        '网页图片',
        'AI 生成图片',
        '素材来源',
        '逐页搭建',
    ):
        assert contract_marker in source


def test_workspace_resumes_durable_runs_and_does_not_claim_uncreated_ai_assets() -> None:
    api = (FRONTEND / "features" / "ppt" / "api.ts").read_text(encoding="utf-8")
    workspace = (FRONTEND / "features" / "ppt" / "workspace" / "PptWorkspace.tsx").read_text(encoding="utf-8")

    assert "listResumableRuns" in api
    assert "/api/ppt/runs/resumable" in api
    assert "runId" in workspace and "listResumableRuns" in workspace
    assert 'meta: "3 / 3 张"' not in workspace
    assert "searchSourcesFromRunState" in workspace
    assert "imageUrlsFromRunState" in workspace
    assert "selectionRoundCount" in workspace
    assert "candidateSources" in workspace
    assert 'nextQuery.set("runId", run.runId)' in workspace
    assert 'nextQuery.set("resume", "1")' in workspace
    assert 'loading="lazy"' in workspace


def test_workspace_uses_durable_run_status_for_completion_and_publish() -> None:
    workspace = (FRONTEND / "features" / "ppt" / "workspace" / "PptWorkspace.tsx").read_text(encoding="utf-8")

    assert 'type PptRunStatus' in workspace
    assert 'runStatus === "COMPLETED"' in workspace
    assert 'setRunStatus(latestRun.status)' in workspace
    assert 'completed={runStatus === "COMPLETED"}' in workspace


def test_main_sidebar_exposes_a_dedicated_ppt_history_group() -> None:
    sidebar = (FRONTEND / "components" / "SessionSidebar.tsx").read_text(encoding="utf-8")

    for contract_marker in (
        "pptHistory",
        "pptHistoryLoading",
        "onSelectPptHistory",
        "PPT 历史记录",
        "presentationId",
        "runId",
    ):
        assert contract_marker in sidebar


def test_chat_interface_loads_and_routes_ppt_history_records() -> None:
    chat = (FRONTEND / "components" / "ChatInterface.tsx").read_text(encoding="utf-8")

    for contract_marker in (
        "listHistoryRuns",
        "pptHistoryLoading",
        "onSelectPptHistory",
        "source=history",
        "run.presentationId",
        "run.runId",
    ):
        assert contract_marker in chat
