from __future__ import annotations

import ipaddress
import logging
from typing import Optional

from flask import Flask, Response, request

from .auth import is_valid_basic_auth
from .config import AppConfig, load_config
from .logging_utils import configure_logging
from .netcup import NetcupClient, NetcupCredentials, NetcupDNSService, NetcupAPIError


logger = logging.getLogger(__name__)


def _dyndns_response(message: str, status_code: int = 200) -> Response:
    return Response(f"{message}\n", status=status_code, mimetype="text/plain")


def _parse_ip(value: str) -> Optional[str]:
    if not value:
        return None

    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def _extract_ips() -> tuple[Optional[str], Optional[str], Optional[str]]:
    myip = _parse_ip(request.args.get("myip", ""))
    myipv6 = _parse_ip(request.args.get("myipv6", ""))

    if myip and ":" in myip and not myipv6:
        myipv6 = myip
        myip = None

    if myip is None and myipv6 is None:
        remote_ip = _parse_ip(request.headers.get("X-Forwarded-For", "").split(",")[0].strip()) or _parse_ip(request.remote_addr or "")
        if remote_ip and ":" in remote_ip:
            myipv6 = remote_ip
        else:
            myip = remote_ip

    if myip and ":" in myip:
        return None, None, "badip"
    if myipv6 and ":" not in myipv6:
        return None, None, "badip"

    return myip, myipv6, None


def create_app(config: Optional[AppConfig] = None, dns_service: Optional[NetcupDNSService] = None) -> Flask:
    config = config or load_config()
    configure_logging(config.log_level)

    app = Flask(__name__)

    credentials = NetcupCredentials(
        customer_number=config.netcup_customer_number,
        api_key=config.netcup_api_key,
        api_password=config.netcup_api_password,
    )
    service = dns_service or NetcupDNSService(NetcupClient(credentials))

    @app.get("/health")
    def health() -> Response:
        return _dyndns_response("ok")

    @app.get("/update")
    def update() -> Response:
        auth_header = request.headers.get("Authorization", "")
        if not is_valid_basic_auth(auth_header, config.ddns_username, config.ddns_password):
            logger.warning("Authentication failed", extra={"extra_data": {"remote_addr": request.remote_addr}})
            return _dyndns_response("badauth", 401)

        hostname = (request.args.get("hostname") or "").strip().lower()
        if not hostname:
            return _dyndns_response("nohost", 400)

        targets = config.host_mappings.get(hostname)
        if not targets:
            return _dyndns_response("nohost", 404)

        ipv4, ipv6, ip_error = _extract_ips()
        if ip_error:
            return _dyndns_response(ip_error, 400)

        try:
            changed = service.update_targets(
                targets=[(target.domain, target.host) for target in targets],
                ipv4=ipv4,
                ipv6=ipv6,
            )
        except NetcupAPIError:
            logger.exception("Netcup API error", extra={"extra_data": {"hostname": hostname}})
            return _dyndns_response("dnserr", 500)
        except Exception:
            logger.exception("Unexpected update error", extra={"extra_data": {"hostname": hostname}})
            return _dyndns_response("911", 500)

        public_ip = ipv4 or ipv6 or ""
        status = "good" if changed else "nochg"
        return _dyndns_response(f"{status} {public_ip}".strip())

    return app
