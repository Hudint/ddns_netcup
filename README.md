# ddns_netcup

Self-hosted DynDNS bridge for Netcup, designed for UniFi/UDM Pro or other dyndns2-style clients.

## Architecture overview

- DDNS client calls `GET /update` with hostname and IP.
- Service authenticates with HTTP Basic Auth.
- Hostname is checked against an explicit allowlist mapping.
- Service updates mapped records via Netcup API (`login` → `infoDnsRecords` → `updateDnsRecords` → `logout`).
- Netcup credentials remain server-side only.

## Environment variables

Use `.env.example` as a template.

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
- `TRUST_PROXY` (default `false`; only enable behind trusted reverse proxy)

Notes:

- Hostname matching is case-insensitive.
- `host` supports `@` (zone apex) and `*` (wildcard).
- This bridge is intentionally limited to A/AAAA updates.

## Running locally

```bash
npm install
export $(grep -v '^#' .env | xargs)
npm start
```

## Running with Docker

```bash
docker build -t ddns-netcup .
docker run --rm -p 8000:8000 --env-file .env ddns-netcup
```

## Update endpoint (dyndns2-style)

- `GET /update?hostname=sub.example.com&myip=1.2.3.4`
- Optional IPv6: `myipv6=2001:db8::1`
- If no IP is supplied, client remote IP is used.

Auth:

- HTTP Basic Auth using `DDNS_USERNAME` and `DDNS_PASSWORD`

Responses:

- `good <ip>` → record changed
- `nochg <ip>` → no change needed
- `badauth` → auth failed
- `nohost` → hostname missing or not configured
- `badip` → invalid IP input
- `dnserr` → Netcup API update failed
- `911` → unexpected server error

When both IPv4 and IPv6 are provided, response echoes IPv4 first (`myip` precedence).

## UniFi / UDM Pro usage

Use a custom/inadyn-compatible provider setup:

- URL/path: `/update?hostname=<your-hostname>&myip=%i`
- Username/password: `DDNS_USERNAME` / `DDNS_PASSWORD`
- Run this service behind HTTPS (reverse proxy recommended).

Exact UniFi UI labels vary by version; use equivalent custom provider fields.

## Security notes and limitations

- Use HTTPS termination (Nginx/Caddy/Traefik) to protect DDNS credentials in transit.
- Keep `NETCUP_*` credentials only in environment variables on the server.
- Structured logs redact sensitive keys (e.g. `authorization`, `password`, `apikey`).
- Only configured hostnames can trigger updates.
- Netcup API requires read-modify-write of DNS record sets per affected domain.

## Tests

```bash
npm test
```
