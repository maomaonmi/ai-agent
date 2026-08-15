from pathlib import Path


def test_body_editor_exposes_revision_actions_and_selection():
    source = Path(
        "frontend/ai-agent/src/features/ai-writing/thesis/ThesisBodyView.tsx"
    ).read_text(encoding="utf-8")

    for text in ["重新生成", "扩写缩写", "写作风格", "智能润色", "插入", "替换"]:
        assert text in source
    assert "onTextSelection" in source
    assert "revisionSuggestion" in source
    assert "styleOptions" in source
    assert "anchorRect" in source
    assert 'position: \'fixed\'' in source


def test_follow_up_input_routes_to_revision_instead_of_recreating_document():
    source = Path(
        "frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx"
    ).read_text(encoding="utf-8")

    assert "requestWritingRevision" in source
    assert "applyRevisionSuggestion" in source
    assert "writingDoc.generatedLength > 0" in source
    assert "scene.fields.find((field) => field.id === 'style')" in source
    assert "仅返回修改后的正文" in source
    assert "responseLength: 'brief'" in Path(
        "frontend/ai-agent/src/components/ChatInterface.tsx"
    ).read_text(encoding="utf-8")


def test_follow_up_composer_keeps_scene_parameters_and_attachment_button():
    source = Path(
        "frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx"
    ).read_text(encoding="utf-8")
    assert "data-writing-follow-up-composer" in source
    assert 'aria-label="添加附件"' in source
    assert "scene.fields.map" in source
