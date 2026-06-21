from __future__ import annotations

import base64

from ddns_netcup.app import create_app
from ddns_netcup.config import AppConfig, NetcupTarget


class FakeDNSService:
    def __init__(self, changed: bool = True, raises: Exception | None = None):
        self.changed = changed
        self.raises = raises
        self.calls = []

    def update_targets(self, targets, ipv4, ipv6):
        if self.raises:
            raise self.raises
        self.calls.append({"targets": targets, "ipv4": ipv4, "ipv6": ipv6})
        return self.changed


def basic_auth(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("utf-8")
    return f"Basic {token}"


def make_config() -> AppConfig:
    return AppConfig(
        host_mappings={"sub.example.com": [NetcupTarget(domain="example.com", host="sub")]},
        ddns_username="ddns",
        ddns_password="secret",
        netcup_customer_number="123",
        netcup_api_key="api",
        netcup_api_password="pass",
        bind_host="127.0.0.1",
        bind_port=8000,
        log_level="INFO",
    )


def test_rejects_bad_auth() -> None:
    app = create_app(config=make_config(), dns_service=FakeDNSService())
    client = app.test_client()

    response = client.get("/update?hostname=sub.example.com&myip=1.2.3.4")

    assert response.status_code == 401
    assert response.data == b"badauth\n"


def test_updates_ipv4_and_returns_good() -> None:
    service = FakeDNSService(changed=True)
    app = create_app(config=make_config(), dns_service=service)
    client = app.test_client()

    response = client.get(
        "/update?hostname=sub.example.com&myip=1.2.3.4",
        headers={"Authorization": basic_auth("ddns", "secret")},
    )

    assert response.status_code == 200
    assert response.data == b"good 1.2.3.4\n"
    assert service.calls == [{"targets": [("example.com", "sub")], "ipv4": "1.2.3.4", "ipv6": None}]


def test_returns_nochg_when_unchanged() -> None:
    service = FakeDNSService(changed=False)
    app = create_app(config=make_config(), dns_service=service)
    client = app.test_client()

    response = client.get(
        "/update?hostname=sub.example.com&myip=1.2.3.4",
        headers={"Authorization": basic_auth("ddns", "secret")},
    )

    assert response.status_code == 200
    assert response.data == b"nochg 1.2.3.4\n"


def test_unknown_hostname_returns_nohost() -> None:
    app = create_app(config=make_config(), dns_service=FakeDNSService())
    client = app.test_client()

    response = client.get(
        "/update?hostname=unknown.example.com&myip=1.2.3.4",
        headers={"Authorization": basic_auth("ddns", "secret")},
    )

    assert response.status_code == 404
    assert response.data == b"nohost\n"
