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


def test_video_api_client_exposes_polling_and_sse_contract():
    api = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")

    assert "getVideoTaskStatus" in api
    assert "listVideoTasks" in api
    assert "openVideoTaskStream" in api
    assert "/api/video/create_task" in api
    assert "/api/video/stream/" in api
