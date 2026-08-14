from pathlib import Path


def test_thesis_body_generation_uses_explicit_conversation_instruction():
    source = Path('frontend/ai-agent/src/features/ai-writing/WritingWorkspace.tsx').read_text(encoding='utf-8')
    assert '我要基于大纲生成正文' in source
    assert 'onThesisBodyRequest' in source
    assert 'data-writing-word-message' in source
    assert source.count('data-writing-word-message') == 1
