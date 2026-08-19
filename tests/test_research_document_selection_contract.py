from pathlib import Path


def test_research_document_card_is_keyboard_accessible_and_selectable():
    source = Path(
        'frontend/ai-agent/src/features/deep-research/ResearchDocumentCard.tsx'
    ).read_text(encoding='utf-8')

    assert 'onSelect' in source
    assert 'selected' in source
    assert 'aria-pressed={selected}' in source
    assert 'onClick={onSelect}' in source


def test_research_workspace_uses_the_selected_report_instead_of_always_latest():
    source = Path(
        'frontend/ai-agent/src/components/ChatInterface.tsx'
    ).read_text(encoding='utf-8')

    assert 'selectedResearchMessageIndex' in source
    assert 'setSelectedResearchMessageIndex(index)' in source
    assert 'selectedResearchReportMessage' in source
    assert 'onSelect={() => setSelectedResearchMessageIndex(index)}' in source
    assert 'report={rightPaneIsLiveLatestReport && (answerPacingActive || answerPacedLength > 0)' in source


def test_new_research_turn_returns_the_right_pane_to_latest_output():
    source = Path(
        'frontend/ai-agent/src/components/ChatInterface.tsx'
    ).read_text(encoding='utf-8')

    assert 'if (mode === \'research\') setSelectedResearchMessageIndex(null)' in source
