from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Dict, List


@dataclass(frozen=True)
class NetcupTarget:
    domain: str
    host: str


@dataclass(frozen=True)
class AppConfig:
    host_mappings: Dict[str, List[NetcupTarget]]
    ddns_username: str
    ddns_password: str
    netcup_customer_number: str
    netcup_api_key: str
    netcup_api_password: str
    bind_host: str
    bind_port: int
    log_level: str


class ConfigError(ValueError):
    pass


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ConfigError(f"Missing required environment variable: {name}")
    return value


def parse_host_mappings(raw: str) -> Dict[str, List[NetcupTarget]]:
    mappings: Dict[str, List[NetcupTarget]] = {}
    if not raw.strip():
        raise ConfigError("DDNS_HOST_MAPPINGS is required")

    for item in [p.strip() for p in raw.split(";") if p.strip()]:
        if "=" not in item:
            raise ConfigError(f"Invalid mapping entry: {item}")
        client_host, targets_raw = [part.strip().lower() for part in item.split("=", 1)]
        targets: List[NetcupTarget] = []
        for target_raw in [p.strip() for p in targets_raw.split(",") if p.strip()]:
            parts = [p.strip().lower() for p in target_raw.split(":")]
            if len(parts) != 2 or not parts[0] or not parts[1]:
                raise ConfigError(f"Invalid target entry: {target_raw}")
            targets.append(NetcupTarget(domain=parts[0], host=parts[1]))

        if not targets:
            raise ConfigError(f"No targets configured for hostname: {client_host}")

        mappings[client_host] = targets

    if not mappings:
        raise ConfigError("No hostname mappings configured")

    return mappings


def load_config() -> AppConfig:
    return AppConfig(
        host_mappings=parse_host_mappings(_require_env("DDNS_HOST_MAPPINGS")),
        ddns_username=_require_env("DDNS_USERNAME"),
        ddns_password=_require_env("DDNS_PASSWORD"),
        netcup_customer_number=_require_env("NETCUP_CUSTOMER_NUMBER"),
        netcup_api_key=_require_env("NETCUP_API_KEY"),
        netcup_api_password=_require_env("NETCUP_API_PASSWORD"),
        bind_host=os.getenv("BIND_HOST", "0.0.0.0"),
        bind_port=int(os.getenv("BIND_PORT", "8000")),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
    )
