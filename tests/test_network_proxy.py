import os

from model_settings import ServiceSettings, ServiceSettingsStore, apply_network_proxy


def test_proxy_url_accepts_host_port_and_normalizes_scheme():
    settings = ServiceSettings(proxy_enabled=True, proxy_url="127.0.0.1:7897")

    assert settings.proxy_url == "http://127.0.0.1:7897"


def test_proxy_url_rejects_unsupported_scheme():
    try:
        ServiceSettings(proxy_enabled=True, proxy_url="socks5://127.0.0.1:7897")
    except ValueError as exc:
        assert "HTTP/HTTPS" in str(exc)
    else:
        raise AssertionError("unsupported proxy scheme should be rejected")


def test_apply_network_proxy_sets_httpx_environment_and_can_restore():
    keys = ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy")
    saved = {key: os.environ.get(key) for key in keys}
    try:
        for key in keys:
            os.environ.pop(key, None)
        apply_network_proxy(ServiceSettings(proxy_enabled=True, proxy_url="http://127.0.0.1:7897"))
        assert os.environ["HTTP_PROXY"] == "http://127.0.0.1:7897"
        assert os.environ["HTTPS_PROXY"] == "http://127.0.0.1:7897"
        apply_network_proxy(ServiceSettings(proxy_enabled=False))
        for key, value in saved.items():
            assert os.environ.get(key) == value
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_service_public_hides_proxy_url(tmp_path):
    store = ServiceSettingsStore(tmp_path / "service.json")
    store.save(ServiceSettings(proxy_enabled=True, proxy_url="http://user:secret@127.0.0.1:7897"))

    public = store.public()

    assert public["proxy_enabled"] is True
    assert public["has_proxy"] is True
    assert public["proxy_host"] == "127.0.0.1"
    assert "secret" not in str(public)
