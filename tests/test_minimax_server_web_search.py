"""测试 minimax 模型能力矩阵：supports_server_web_search 字段。

Why: 文档未限定 web_search 仅 M3，但后端实际可能拒；能力位集中管——
agent_loop / chat 据此决定是否注入 web_search tool，避免无搜索时仍推送占位卡片。
"""
from model_settings import capabilities_for_model


def test_m3_supports_server_web_search():
    cap = capabilities_for_model("MiniMax-M3")
    assert cap.supports_server_web_search is True, "M3 文档示例明确支持 web_search"


def test_m2_7_supports_server_web_search_default():
    """M2.7 标 True：文档未限定模型，按协议级能力开放。"""
    cap = capabilities_for_model("MiniMax-M2.7")
    assert cap.supports_server_web_search is True, "M2.7 未实测拒，能力位默认开"


def test_m2_5_highspeed_supports_server_web_search():
    cap = capabilities_for_model("MiniMax-M2.5-highspeed")
    assert cap.supports_server_web_search is True


def test_unknown_model_defaults_to_supports_web_search():
    """未知模型兜底 True：保守走 Anthropic Messages 协议级能力（文档原则）。"""
    cap = capabilities_for_model("MiniMax-Unknown-99")
    assert cap.supports_server_web_search is True


def test_non_minimax_provider_defaults_to_supports_web_search():
    cap = capabilities_for_model("non-existent-model")
    assert cap.supports_server_web_search is True
