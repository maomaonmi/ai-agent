from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend" / "ai-agent"


def test_chat_more_menu_and_both_sidebar_states_share_ppt_route() -> None:
    chat = (FRONTEND / "src" / "components" / "ChatInterface.tsx").read_text(encoding="utf-8")
    sidebar = (FRONTEND / "src" / "components" / "SessionSidebar.tsx").read_text(encoding="utf-8")

    assert "const openPptMarket" in chat
    assert "window.location.assign('/ppt')" in chat
    assert "label === 'PPT 创作'" in chat
    assert "onOpenPpt={openPptWorkspace}" in chat
    assert "window.location.assign(`/ppt/workspace/new?source=sidebar&session=${sessionId}`)" in chat
    assert sidebar.count("onOpenPpt") >= 4
    assert 'aria-label="打开 AI PPT"' in sidebar
    assert 'title="AI PPT"' in sidebar


def test_ppt_route_is_a_standalone_app_router_page() -> None:
    route = FRONTEND / "src" / "app" / "ppt" / "page.tsx"

    assert route.is_file()
    source = route.read_text(encoding="utf-8")
    assert "PptTemplateMarket" in source


def test_sidebar_workspace_is_unique_and_uploads_do_not_stall() -> None:
    chat = (FRONTEND / "src" / "components" / "ChatInterface.tsx").read_text(encoding="utf-8")
    market = (FRONTEND / "src" / "features" / "ppt" / "market" / "PptTemplateMarket.tsx").read_text(encoding="utf-8")

    assert "source=sidebar&session=${sessionId}" in chat
    assert 'status: "READY"' in market
    assert "可立即使用" in market
    assert "new Map(uploads.map" in market
    assert "环形模板浏览器" in market
    assert "orbitDistance" in market
    assert "onWheel={handleOrbitWheel}" in market
