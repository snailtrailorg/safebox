"""get_client_ip 统一策略的单元测试。

背景：原先有两份 IP 提取实现 —— 限流要求「可信代理直连才采信 X-Real-IP」，
auth（记录 last_auth_ip）却**无条件信任**该头。后者仅靠 nginx 的
proxy_set_header 覆盖客户端自带头才安全，属脆弱的隐式依赖（改 nginx / 加 CDN 即破）。
现统一为 app/middleware/rate_limit.get_client_ip 单一实现，本测试锁住契约。
"""

import pytest
from fastapi import Request

from app.config import settings
from app.middleware.rate_limit import get_client_ip


def _req(client_ip: str, real_ip: str | None = None) -> Request:
    """构造最小 scope 的 Request（不经 httpx，聚焦策略本身）。"""
    headers = []
    if real_ip is not None:
        headers.append((b"x-real-ip", real_ip.encode()))
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/",
        "client": (client_ip, 12345),
        "headers": headers,
    })


@pytest.fixture(autouse=True)
def _restore_trusted_proxies(monkeypatch):
    """每条用例独立设置 trusted_proxies，跑完自动还原。"""
    yield
    monkeypatch.setattr(settings, "trusted_proxies", settings.trusted_proxies, raising=False)


def test_untrusted_direct_ignores_header(monkeypatch):
    """非可信直连：自带 X-Real-IP 被忽略（防伪造核心断言）。"""
    monkeypatch.setattr(settings, "trusted_proxies", "127.0.0.1")
    assert get_client_ip(_req("9.9.9.9", "1.2.3.4")) == "9.9.9.9"


def test_trusted_direct_uses_header(monkeypatch):
    """可信代理直连：采纳 X-Real-IP（nginx 覆盖后的真实客户端 IP）。"""
    monkeypatch.setattr(settings, "trusted_proxies", "127.0.0.1")
    assert get_client_ip(_req("127.0.0.1", "203.0.113.7")) == "203.0.113.7"


def test_trusted_direct_without_header_falls_back_to_direct(monkeypatch):
    """可信代理但未带头：回退直连地址（不崩、不猜）。"""
    monkeypatch.setattr(settings, "trusted_proxies", "127.0.0.1")
    assert get_client_ip(_req("127.0.0.1")) == "127.0.0.1"


def test_empty_trusted_proxies_never_trusts_header(monkeypatch):
    """trusted_proxies 为空（本仓默认）：一律取直连地址。

    这正是当前生产未配置时的行为 —— last_auth_ip 会记成 127.0.0.1，
    借此把「必须配置 trusted_proxies」固化成被测试守护的事实。
    """
    monkeypatch.setattr(settings, "trusted_proxies", "")
    assert get_client_ip(_req("127.0.0.1", "203.0.113.7")) == "127.0.0.1"


def test_trusted_list_is_whitespace_tolerant(monkeypatch):
    """逗号列表容忍空白（运维手写 " 127.0.0.1 , 10.0.0.1 " 不失效）。"""
    monkeypatch.setattr(settings, "trusted_proxies", " 127.0.0.1 , 10.0.0.1 ")
    assert get_client_ip(_req("10.0.0.1", "203.0.113.7")) == "203.0.113.7"


def test_xff_never_trusted_even_from_proxy(monkeypatch):
    """即使直连可信，也不采信 X-Forwarded-For（其最左端客户端可控）。"""
    monkeypatch.setattr(settings, "trusted_proxies", "127.0.0.1")
    req = Request({
        "type": "http", "method": "GET", "path": "/",
        "client": ("127.0.0.1", 12345),
        "headers": [(b"x-forwarded-for", b"6.6.6.6")],
    })
    assert get_client_ip(req) == "127.0.0.1"
