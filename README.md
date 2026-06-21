# ddns_netcup

Self-hosted DynDNS bridge for Netcup, designed for UniFi/UDM Pro or other dyndns2-style clients.

## Architecture overview

- DDNS client calls `GET /update` with hostname and IP.
- Service authenticates the client via HTTP Basic Auth.
- Hostname is matched against an explicit allowlist mapping.
- Service logs in to Netcup API server-side and updates only mapped records.
- Netcup credentials stay only on this server.

## Environment variables

Use `.env.example` as template.

Required:

- `DDNS_USERNAME`
- `DDNS_PASSWORD`
- `DDNS_HOST_MAPPINGS` (`client.fqdn=domain.tld:host[,domain.tld:host];...`)
- `NETCUP_CUSTOMER_NUMBER`
- `NETCUP_API_KEY`
- `NETCUP_API_PASSWORD`

Optional:

- `BIND_HOST` (default `0.0.0.0`)
- `BIND_PORT` (default `8000`)
- `LOG_LEVEL` (default `INFO`)

`host` supports `@` (zone apex) and `*` (wildcard).

## Running locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
export $(grep -v '^#' .env | xargs)
python main.py
```

## Running with Docker

```bash
docker build -t ddns-netcup .
docker run --rm -p 8000:8000 --env-file .env ddns-netcup
```

## Update endpoint (dyndns2-style)

- `GET /update?hostname=sub.example.com&myip=1.2.3.4`
- Optional IPv6: `myipv6=2001:db8::1`
- If no IP is provided, remote client IP is used.

Auth:

- HTTP Basic Auth with `DDNS_USERNAME` / `DDNS_PASSWORD`

Responses:

- `good <ip>` → record changed
- `nochg <ip>` → already up to date
- `badauth` → auth failed
- `nohost` → hostname missing or not allowed
- `badip` → invalid IP input
- `dnserr` → Netcup update failure
- `911` → unexpected server error

## UniFi / UDM Pro usage

Use custom Dynamic DNS provider format:

- Server: this service URL (prefer HTTPS reverse proxy)
- Path: `/update?hostname=<your-hostname>&myip=%i`
- Username/password: `DDNS_USERNAME` / `DDNS_PASSWORD`

If exact UI fields differ by UniFi version, use an inadyn-compatible custom provider flow with the same endpoint/auth pattern.

## Security notes and limitations

- Run behind HTTPS (reverse proxy like Caddy/Traefik/Nginx) to protect credentials in transit.
- Keep `NETCUP_*` credentials only in server env vars.
- Logs are structured JSON and redact sensitive keys.
- Only configured hostnames are updatable.
- Netcup API update uses read/modify/write of DNS record sets per mapped domain.

## Tests

```bash
pytest
```

## Reference

Netcup update flow was adapted from the Netcup community tooling approach (`login` → `infoDnsRecords` → `updateDnsRecords` → `logout`) while refactoring into a client-facing HTTP bridge.
