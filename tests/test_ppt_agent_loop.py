from __future__ import annotations

import pytest

from ppt_agent_loop import SearchBatch, SearchBatchLimitExceeded


def test_search_batch_never_allows_more_than_twenty_results() -> None:
    with pytest.raises(SearchBatchLimitExceeded):
        SearchBatch(provider="firecrawl", query="agent", limit=21)

    batch = SearchBatch(provider="qwen", query="agent", limit=20)
    assert batch.limit == 20
