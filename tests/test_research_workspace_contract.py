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


def test_deep_report_uses_its_own_tiptap_document():
    source = (ROOT / "report/DeepResearchDocument.tsx").read_text(encoding="utf-8")
    assert "@tiptap/react" in source
    assert "@tiptap/starter-kit" in source
    assert "immediatelyRender: false" in source
    assert "editable: false" in source
    assert "data-research-document" in source


def test_report_adapter_only_charts_explicit_numeric_evidence():
    adapter = (ROOT / "report/researchReportAdapter.ts").read_text(encoding="utf-8")
    assert "extractExplicitMetrics" in adapter
    assert "sourceText" in adapter
    assert "percent" in adapter


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
