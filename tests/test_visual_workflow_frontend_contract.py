from pathlib import Path


FRONTEND = Path(__file__).resolve().parents[1] / "frontend" / "ai-agent" / "src"


def test_visual_workflow_is_reachable_from_sidebar_and_chat_view():
    sidebar = (FRONTEND / "components" / "SessionSidebar.tsx").read_text(encoding="utf-8")
    chat = (FRONTEND / "components" / "ChatInterface.tsx").read_text(encoding="utf-8")
    workspace = (FRONTEND / "features" / "visual-workflow" / "VisualWorkflowWorkspace.tsx").read_text(encoding="utf-8")

    assert "AI 工作流" in sidebar
    assert "onOpenVisualWorkflow" in sidebar
    assert "visual-workflow" in chat
    assert "VisualWorkflowWorkspace" in chat
    assert "保存" in workspace
    assert "校验" in workspace
    assert "运行（即将支持）" in workspace
    assert "积分" not in workspace


def test_visual_workflow_frontend_uses_typed_canvas_and_theme_aware_styles():
    canvas = (FRONTEND / "features" / "visual-workflow" / "WorkflowCanvas.tsx").read_text(encoding="utf-8")
    store = (FRONTEND / "features" / "visual-workflow" / "store.ts").read_text(encoding="utf-8")

    assert "@xyflow/react" in canvas
    assert "isValidWorkflowConnection" in canvas
    assert "dark:bg-slate-950" in canvas
    assert "undoStack" in store
    assert "redoStack" in store


def test_visual_workflow_api_client_matches_backend_contract():
    api = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")

    assert "getVisualWorkflowNodeDefinitions" in api
    assert "saveVisualWorkflowRevision" in api
    assert "validateVisualWorkflow" in api
    assert "/api/visual-workflow-node-definitions" in api
    assert "/api/visual-workflows" in api
