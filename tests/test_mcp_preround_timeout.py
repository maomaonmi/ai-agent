import asyncio

import main


def test_mcp_preround_timeout_emits_error_and_releases_chat():
    async def hanging_preround(*_args, **_kwargs):
        await asyncio.sleep(1)
        yield {"mcp_phase": "done", "tool_count": 0, "tool_notes": []}

    async def scenario():
        original = main.run_mcp_tool_preround
        main.run_mcp_tool_preround = hanging_preround
        try:
            return [
                event
                async for event in main.iter_mcp_tool_preround_with_timeout(
                    [], main.RuntimeSettings(mcp_mode="auto"), timeout_seconds=0.01
                )
            ]
        finally:
            main.run_mcp_tool_preround = original

    events = asyncio.run(scenario())

    assert events[-1]["mcp_phase"] == "error"
    assert events[-1]["reason"] == "timeout"
