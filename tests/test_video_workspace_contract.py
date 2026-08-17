from pathlib import Path


FRONTEND = Path(__file__).resolve().parents[1] / "frontend" / "ai-agent" / "src"


def test_video_workspace_has_sidebar_entry_and_independent_view():
    sidebar = (FRONTEND / "components" / "SessionSidebar.tsx").read_text(encoding="utf-8")
    chat = (FRONTEND / "components" / "ChatInterface.tsx").read_text(encoding="utf-8")
    workspace = (FRONTEND / "features" / "video" / "VideoStudioWorkspace.tsx").read_text(encoding="utf-8")

    assert "AI 视频" in sidebar
    assert "onOpenVideoStudio" in sidebar
    assert "video-studio" in chat
    assert "VideoStudioWorkspace" in chat
    assert "提交异步任务" in workspace
    assert "SSE 实时连接" in workspace
    assert "下载视频" in workspace


def test_video_workspace_uses_full_width_responsive_theme_contract():
    workspace = (FRONTEND / "features" / "video" / "VideoStudioWorkspace.tsx").read_text(encoding="utf-8")

    assert "max-w-none" in workspace
    assert "lg:grid-cols-[clamp(280px,24vw,420px)_minmax(0,1fr)]" in workspace
    assert "bg-slate-50" in workspace
    assert "dark:bg-[#0f1013]" in workspace
    assert "dark:border-white/[0.08]" in workspace


def test_video_api_client_exposes_polling_and_sse_contract():
    api = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")

    assert "getVideoTaskStatus" in api
    assert "listVideoTasks" in api
    assert "openVideoTaskStream" in api
    assert "/api/video/create_task" in api
    assert "/api/video/stream/" in api
    assert "deleteVideoTask" in api


def test_video_history_clears_preview_state_and_exposes_delete_action():
    workspace = (FRONTEND / "features" / "video" / "VideoStudioWorkspace.tsx").read_text(encoding="utf-8")
    hook = (FRONTEND / "features" / "video" / "useVideoTask.ts").read_text(encoding="utf-8")

    assert "const openHistory" in workspace
    assert "setCreatedTask(null)" in workspace
    assert "onDelete" in workspace
    assert "删除" in workspace
    assert "taskRef.current = initialTask" in hook
    assert "[applyTask, initialTask, taskId]" in hook
