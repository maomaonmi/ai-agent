from pathlib import Path


def test_existing_code_workspace_is_not_constrained_to_chat_width():
    source = (
        Path(__file__).parents[1]
        / "frontend"
        / "ai-agent"
        / "src"
        / "components"
        / "ChatInterface.tsx"
    ).read_text(encoding="utf-8")

    assert "mode === 'code' ? 'max-w-none' : 'max-w-4xl'" in source

