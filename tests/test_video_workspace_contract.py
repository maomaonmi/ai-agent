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
    assert "生成视频" in workspace
    assert "SSE 实时连接" in workspace
    assert "下载视频" in workspace


def test_video_workspace_uses_full_width_responsive_theme_contract():
    workspace = (FRONTEND / "features" / "video" / "VideoStudioWorkspace.tsx").read_text(encoding="utf-8")

    assert "max-w-none" in workspace
    assert "lg:grid-cols-[clamp(330px,31vw,470px)_minmax(0,1fr)]" in workspace
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


def test_video_workspace_exposes_optional_public_audio_input_for_supported_models():
    api = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")
    workspace = (FRONTEND / "features" / "video" / "VideoStudioWorkspace.tsx").read_text(encoding="utf-8")

    assert "supports_audio_input" in api
    assert "audio_url" in api
    assert "参考音频 URL" in workspace
    assert "仅支持公开 HTTP/HTTPS" in workspace
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


def test_video_workspace_exposes_first_frame_and_start_end_modes():
    workspace = (FRONTEND / "features" / "video" / "VideoStudioWorkspace.tsx").read_text(encoding="utf-8")
    api = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")

    assert "首帧图生视频" in workspace
    assert "首尾帧过渡" in workspace
    assert "本地上传" in workspace
    assert "Base64" in workspace
    assert "first_frame_url" in api
    assert "last_frame_url" in api


def test_video_workspace_exposes_reference_video_mode_and_asset_lifecycle():
    workspace = (FRONTEND / "features" / "video" / "VideoStudioWorkspace.tsx").read_text(encoding="utf-8")
    api = (FRONTEND / "lib" / "api.ts").read_text(encoding="utf-8")

    assert "reference_to_video" in workspace
    assert "参考视频生成" in workspace
    assert "uploadReferenceVideo" in api
    assert "getReferenceAsset" in api
    assert "deleteReferenceAsset" in api
    assert "TRANSCODING" in api
    assert "thumbnailUrl" in api
    assert "createVideoThumbnail" in api
    assert "Video 1" in workspace
