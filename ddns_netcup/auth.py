from __future__ import annotations

import base64
import hmac
from typing import Optional, Tuple


def parse_basic_auth(auth_header: str) -> Optional[Tuple[str, str]]:
    if not auth_header.startswith("Basic "):
        return None

    token = auth_header[6:].strip()
    try:
        decoded = base64.b64decode(token, validate=True).decode("utf-8")
    except Exception:
        return None

    if ":" not in decoded:
        return None

    return tuple(decoded.split(":", 1))


def is_valid_basic_auth(auth_header: str, expected_username: str, expected_password: str) -> bool:
    parsed = parse_basic_auth(auth_header)
    if parsed is None:
        return False

    username, password = parsed
    return hmac.compare_digest(username, expected_username) and hmac.compare_digest(password, expected_password)
