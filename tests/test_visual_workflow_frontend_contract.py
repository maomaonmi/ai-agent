from pathlib import Path


FRONTEND = Path(__file__).resolve().parents[1] / "frontend" / "ai-agent" / "src"


def test_visual_workflow_is_reachable_from_sidebar_and_chat_view():
    sidebar = (FRONTEND / "components" / "SessionSidebar.tsx").read_text(encoding="utf-8")
    chat = (FRONTEND / "components" / "ChatInterface.tsx").read_text(encoding="utf-8")
    workspace = (FRONTEND / "features" / "visual-workflow" / "VisualWorkflowWorkspace.tsx").read_text(encoding="utf-8")

    assert "视频流工作台" in sidebar
    assert "onOpenVisualWorkflow" in sidebar
    assert "'/visual-workflow'" in chat
    assert "VisualWorkflowWorkspace" not in chat
    assert "保存" in workspace
    assert "校验" in workspace
    assert "运行" in workspace
    assert "积分" not in workspace


def test_visual_workflow_has_a_dedicated_next_route():
    route = (FRONTEND / "app" / "visual-workflow" / "page.tsx").read_text(encoding="utf-8")
    route_client = (FRONTEND / "app" / "visual-workflow" / "VisualWorkflowRoute.tsx").read_text(encoding="utf-8")

    assert "VisualWorkflowRoute" in route
    assert "VisualWorkflowHub" in route_client


def test_visual_workflow_hub_lists_history_and_editor_has_a_dedicated_path():
    hub = (FRONTEND / "features" / "visual-workflow" / "VisualWorkflowHub.tsx").read_text(encoding="utf-8")
    canvas_route = (FRONTEND / "app" / "visual-workflow" / "VisualWorkflowCanvasRoute.tsx").read_text(encoding="utf-8")
    canvas_page = (FRONTEND / "app" / "visual-workflow" / "canvas" / "[workflowId]" / "page.tsx").read_text(encoding="utf-8")

    assert "listVisualWorkflows" in hub
    assert "createVisualWorkflow" in hub
    assert "新建画布" in hub
    assert "历史画布" in hub
    assert "/visual-workflow/canvas/" in hub
    assert "useParams" in canvas_route
    assert "workflowId" in canvas_route
    assert "VisualWorkflowCanvasRoute" in canvas_page


def test_visual_workflow_run_artifacts_are_serialized_and_rehydrated():
    types = (FRONTEND / "features" / "visual-workflow" / "types.ts").read_text(encoding="utf-8")
    store = (FRONTEND / "features" / "visual-workflow" / "store.ts").read_text(encoding="utf-8")

    assert "outputArtifacts" in types
    assert "runtimeArtifacts: Array.isArray(node.config.outputArtifacts)" in types
    assert "config: { ...node.data.config, outputArtifacts: nextArtifacts }" in store
    assert "statuses[node.id] === 'success'" in store


def test_visual_workflow_run_statuses_are_normalized_before_persistence():
    workspace = (FRONTEND / "features" / "visual-workflow" / "VisualWorkflowWorkspace.tsx").read_text(encoding="utf-8")

    assert "nodeRun.status === 'SUCCEEDED' ? 'success'" in workspace
    assert "nodeRun.status === 'FAILED' ? 'error'" in workspace


def test_visual_workflow_frontend_uses_typed_canvas_and_theme_aware_styles():
    canvas = (FRONTEND / "features" / "visual-workflow" / "WorkflowCanvas.tsx").read_text(encoding="utf-8")
    store = (FRONTEND / "features" / "visual-workflow" / "store.ts").read_text(encoding="utf-8")

    assert "@xyflow/react" in canvas
    assert "isValidWorkflowConnection" in canvas
    assert "bg-[var(--workflow-canvas-bg)]" in canvas
    assert "undoStack" in store
    assert "redoStack" in store


def test_visual_workflow_ports_allow_multiple_connections():
    validation = (FRONTEND / "features" / "visual-workflow" / "validation.ts").read_text(encoding="utf-8")
    canvas = (FRONTEND / "features" / "visual-workflow" / "WorkflowCanvas.tsx").read_text(encoding="utf-8")

    assert "createsCycle" in validation
    assert "sourcePort.cardinality === 'one'" not in validation
    assert "targetPort.cardinality === 'one'" not in validation
    assert canvas.count("isConnectable={true}") == 2
    assert "media.asset" in (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")


def test_visual_workflow_api_client_matches_backend_contract():
    api = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")

    assert "getVisualWorkflowNodeDefinitions" in api
    assert "saveVisualWorkflowRevision" in api
    assert "validateVisualWorkflow" in api
    assert "compileVisualWorkflow" in api
    assert "createVisualWorkflowDryRun" in api
    assert "cancelVisualWorkflowRun" in api
    workspace = (FRONTEND / "features" / "visual-workflow" / "VisualWorkflowWorkspace.tsx").read_text(encoding="utf-8")
    assert "RunArtifactPreview" in workspace
    assert "<video" in workspace
    assert "<img" in workspace
    assert "/api/visual-workflow-node-definitions" in api
    assert "/api/visual-workflows" in api


def test_visual_workflow_nodes_support_inline_prompt_models_upload_and_delete():
    canvas = (FRONTEND / "features" / "visual-workflow" / "WorkflowCanvas.tsx").read_text(encoding="utf-8")
    inspector = (FRONTEND / "features" / "visual-workflow" / "WorkflowNodeInspector.tsx").read_text(encoding="utf-8")
    workspace = (FRONTEND / "features" / "visual-workflow" / "VisualWorkflowWorkspace.tsx").read_text(encoding="utf-8")

    assert "updateNodeConfig" in canvas
    assert "节点提示词" in canvas
    assert "节点模型" in canvas
    assert "scrollbar-none" in canvas
    assert "NodeMediaPreview" in canvas
    assert "uploadReferenceVideo" in canvas
    assert "添加图片" in canvas
    assert "添加视频" in canvas
    assert "videoUrl={(isVideoInput || isVideoGenerator)" in canvas
    assert "w-[320px]" in canvas
    assert "colorMode={isDarkTheme ? 'dark' : 'light'}" in canvas
    assert "appearance-settings-changed" in canvas
    assert "deleteKeyCode" in canvas
    assert "uploadImagePlazaAsset" in inspector
    assert "multiple" in inspector
    assert "删除节点" in inspector
    assert "deleteSelectedNode" in workspace
