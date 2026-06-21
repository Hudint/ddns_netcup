from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from urllib import request

API_URL = "https://ccp.netcup.net/run/webservice/servers/endpoint.php?JSON"


class NetcupAPIError(RuntimeError):
    pass


@dataclass
class NetcupCredentials:
    customer_number: str
    api_key: str
    api_password: str


class NetcupClient:
    def __init__(self, credentials: NetcupCredentials, timeout: int = 30):
        self.credentials = credentials
        self.timeout = timeout

    def _request(self, payload: Dict) -> Dict:
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            API_URL,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json", "User-Agent": "ddns-netcup-bridge/1.0"},
        )
        with request.urlopen(req, timeout=self.timeout) as resp:
            raw = resp.read()

        parsed = json.loads(raw)
        if parsed.get("status") != "success":
            raise NetcupAPIError(parsed.get("longmessage", "Unknown Netcup API error"))
        return parsed

    def _auth_payload(self, apisessionid: Optional[str] = None) -> Dict:
        payload = {
            "customernumber": self.credentials.customer_number,
            "apikey": self.credentials.api_key,
        }
        if apisessionid is None:
            payload["apipassword"] = self.credentials.api_password
        else:
            payload["apisessionid"] = apisessionid
        return payload

    def login(self) -> str:
        result = self._request({"action": "login", "param": self._auth_payload()})
        return result["responsedata"]["apisessionid"]

    def logout(self, session_id: str) -> None:
        self._request({"action": "logout", "param": self._auth_payload(session_id)})

    def info_dns_records(self, domain: str, session_id: str) -> List[Dict]:
        result = self._request(
            {
                "action": "infoDnsRecords",
                "param": {
                    **self._auth_payload(session_id),
                    "domainname": domain,
                },
            }
        )
        records = result["responsedata"]["dnsrecords"]
        if not isinstance(records, list):
            raise NetcupAPIError("Invalid DNS record response")
        return records

    def update_dns_records(self, domain: str, records: List[Dict], session_id: str) -> None:
        self._request(
            {
                "action": "updateDnsRecords",
                "param": {
                    **self._auth_payload(session_id),
                    "domainname": domain,
                    "dnsrecordset": {"dnsrecords": records},
                },
            }
        )


class NetcupDNSService:
    def __init__(self, client: NetcupClient):
        self.client = client

    @staticmethod
    def _apply_record(records: List[Dict], host: str, record_type: str, value: str) -> bool:
        changed = False
        matched = False
        for record in records:
            if record.get("hostname") == host and record.get("type") == record_type:
                matched = True
                if record.get("destination") != value:
                    record["destination"] = value
                    changed = True

        if not matched:
            records.append(
                {
                    "hostname": host,
                    "type": record_type,
                    "priority": "0",
                    "destination": value,
                    "deleterecord": "false",
                    "state": "yes",
                }
            )
            changed = True

        return changed

    def update_targets(self, targets: List[Tuple[str, str]], ipv4: Optional[str], ipv6: Optional[str]) -> bool:
        any_changed = False
        session_id = self.client.login()
        try:
            by_domain: Dict[str, List[str]] = {}
            for domain, host in targets:
                by_domain.setdefault(domain, []).append(host)

            for domain, hosts in by_domain.items():
                records = self.client.info_dns_records(domain, session_id)
                changed = False
                for host in hosts:
                    if ipv4:
                        changed = self._apply_record(records, host, "A", ipv4) or changed
                    if ipv6:
                        changed = self._apply_record(records, host, "AAAA", ipv6) or changed
                if changed:
                    self.client.update_dns_records(domain, records, session_id)
                    any_changed = True
        finally:
            self.client.logout(session_id)

        return any_changed
