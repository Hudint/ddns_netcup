# ddns-netcup

A tiny self-hosted **Dynamic DNS bridge for [Netcup](https://www.netcup.de/)**.

It exposes a standard **dyndns2** update endpoint and translates incoming
updates into Netcup CCP DNS API calls — using server-side credentials that the
client never sees. Any dyndns2-compatible client works: `ddclient`, `inadyn`,
routers (FRITZ!Box, OPNsense, UniFi/UDM, …), or a plain `curl`/cron job.

The client only ever knows the dedicated DDNS username/password; the Netcup API
credentials stay on the server.

---

## Architecture overview

| File | Responsibility |
|------|----------------|
| `src/config.ts` | Loads & validates env config; maps an incoming FQDN to a Netcup zone + record host (with allow-list). |
| `src/auth.ts` | Client auth: dyndns2 Basic Auth and/or shared-secret token, compared in **constant time**. |
| `src/netcup.ts` | Low-level Netcup CCP DNS API client: `login → infoDnsRecords → updateDnsRecords → logout`. No business logic. |
| `src/updater.ts` | Pure diff logic (`computeRecordUpdate`) + orchestration (`applyUpdate`). Sends **only changed records** — no full-zone rewrite. |
| `src/server.ts` | Express app: `/nic/update` (+ `/update` alias), dyndns2 text responses, health check. |
| `src/index.ts` | Entrypoint & graceful shutdown. |
| `src/logger.ts` | Structured JSON logging with **secret redaction**. |

**Update flow:** authenticate → validate `hostname`/`myip` → map hostname to a
configured zone → open one Netcup session → read existing records → for each
A/AAAA, update in place (keeping the record `id`) only if the destination
changed, otherwise create it → push just the changed records → logout.

---

## Environment variables

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `NETCUP_CUSTOMER_NUMBER` | ✅ | — | Netcup customer number. |
| `NETCUP_API_KEY` | ✅ | — | Netcup API key (CCP → *Stammdaten → API*). |
| `NETCUP_API_PASSWORD` | ✅ | — | Netcup API password. |
| `NETCUP_API_URL` | — | public CCP JSON endpoint | Override the API endpoint. |
| `DDNS_USERNAME` + `DDNS_PASSWORD` | ⚠️¹ | — | Credentials your DDNS client uses (Basic Auth). |
| `DDNS_TOKEN` | ⚠️¹ | — | Shared-secret token alternative (`?token=` or `Bearer`). |
| `ALLOWED_DOMAINS` | ✅ | — | Comma-separated Netcup zones allowed to be updated, e.g. `example.com`. |
| `ALLOWED_HOSTNAMES` | — | *(any host in zone)* | Optional comma-separated explicit FQDN allow-list. |
| `ENABLE_IPV4` | — | `true` | When `false`, IPv4 (`A`) updates are accepted but silently ignored. |
| `ENABLE_IPV6` | — | `true` | When `false`, IPv6 (`AAAA`) updates are accepted but silently ignored. |
| `PORT` | — | `8080` | Listen port. |
| `TRUST_PROXY` | — | `false` | Set `true` only behind a trusted reverse proxy (for correct client IP). |
| `LOG_LEVEL` | — | `info` | `debug` \| `info` \| `warn` \| `error`. |

¹ You must configure **at least one** client auth method: `DDNS_USERNAME`+`DDNS_PASSWORD`, and/or `DDNS_TOKEN`.

See [`.env.example`](.env.example) for a copy-paste template.

---

## Running locally

Requires Node 20+.

```bash
npm install
cp .env.example .env        # then edit .env
npm run build && npm start  # or: npm run dev  (watch mode)
npm test                    # unit tests (auth + update logic)
```

---

## Running with Docker

### Prebuilt image (GHCR)

A multi-arch image (`linux/amd64`, `linux/arm64`) is published by the included
GitHub Action on every push to `master` and every `v*` tag:

```bash
docker run -d --name ddns-netcup -p 8080:8080 --env-file .env \
  ghcr.io/hudint/ddns_netcup:latest
```

### docker compose

A ready-to-use [`docker-compose.yml`](docker-compose.yml) is included (it reads
secrets from an `.env` file). If you prefer a **single self-contained file with
all variables inline**, use this — fill in the values and run `docker compose up -d`:

```yaml
services:
  ddns-netcup:
    image: ghcr.io/hudint/ddns_netcup:latest
    container_name: ddns-netcup
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      # --- Netcup API credentials (server-side only, never sent to clients) ---
      NETCUP_CUSTOMER_NUMBER: "123456"
      NETCUP_API_KEY: "your_netcup_api_key"
      NETCUP_API_PASSWORD: "your_netcup_api_password"

      # --- DDNS client login (this is what your router/DDNS client uses) -----
      DDNS_USERNAME: "router"
      DDNS_PASSWORD: "change-me-to-a-long-random-secret"
      # Optional token instead of / in addition to username+password:
      # DDNS_TOKEN: "another-long-random-secret"

      # --- What may be updated -----------------------------------------------
      ALLOWED_DOMAINS: "example.com"
      # Optional: restrict to specific FQDNs (comma-separated):
      # ALLOWED_HOSTNAMES: "home.example.com,vpn.example.com"

      # --- Address families --------------------------------------------------
      # Set to "false" to ignore that family even if the client sends it:
      ENABLE_IPV4: "true"
      ENABLE_IPV6: "true"

      # --- Server ------------------------------------------------------------
      PORT: "8080"
      # Set to "true" only when running behind a trusted reverse proxy:
      TRUST_PROXY: "false"
      LOG_LEVEL: "info"
```

> ⚠️ Keeping secrets inline is convenient but means they live in the compose
> file — don't commit it to a public repo. The `.env` approach
> ([`docker-compose.yml`](docker-compose.yml)) keeps secrets out of the YAML.

### Build locally

```bash
docker build -t ddns-netcup .
docker run -d -p 8080:8080 --env-file .env ddns-netcup
```

---

## Configuring a DDNS client (dyndns2)

**Endpoint:** `GET /nic/update` (alias: `/update`)

| Query param | Notes |
|-------------|-------|
| `hostname`  | FQDN to update, e.g. `home.example.com`. Must resolve to an `ALLOWED_DOMAINS` zone. |
| `myip`      | IPv4 and/or IPv6. May be comma-separated (`1.2.3.4,2001:db8::1`). If omitted, the client's source IP is used. |
| `myipv6`    | Optional explicit IPv6. |
| `token`     | Optional, if using token auth instead of Basic Auth. |

**Auth:** HTTP Basic Auth (`DDNS_USERNAME` / `DDNS_PASSWORD`) — the dyndns2
standard — or a `DDNS_TOKEN` via `Authorization: Bearer <token>` / `?token=`.

### Example requests & responses

```bash
# Update IPv4 (Basic Auth)
curl -u router:secret \
  "https://ddns.example.com/nic/update?hostname=home.example.com&myip=203.0.113.7"
# → good 203.0.113.7

# Same IP again
# → nochg 203.0.113.7

# Dual-stack
curl -u router:secret \
  "https://ddns.example.com/nic/update?hostname=home.example.com&myip=203.0.113.7&myipv6=2001:db8::1234"
# → good 203.0.113.7

# Token auth
curl "https://ddns.example.com/nic/update?hostname=home.example.com&myip=203.0.113.7&token=mytoken"
```

**Response codes** (dyndns2): `good <ip>`, `nochg <ip>`, `badauth` (401),
`notfqdn` (host invalid / not allowed), `dnserr` (invalid IP or Netcup error).

---

## Client examples

The service speaks plain dyndns2, so most clients just need the endpoint URL and
your `DDNS_USERNAME` / `DDNS_PASSWORD`. A few concrete setups follow — pick the
one matching your client, the rest follow the same pattern.

### ddclient

```conf
# /etc/ddclient/ddclient.conf
protocol=dyndns2
use=web
ssl=yes
server=ddns.example.com
login=router
password='your-ddns-password'
home.example.com
```

### inadyn (raw config)

```ini
custom ddns-netcup {
    hostname    = "home.example.com"
    username    = "router"
    password    = "your-ddns-password"
    ddns-server = "ddns.example.com"
    ddns-path   = "/nic/update?hostname=%h&myip=%i"
}
```

### FRITZ!Box

*Internet → Permit Access → DynDNS*, provider **Custom**:

| Field | Value |
|-------|-------|
| Update URL | `https://ddns.example.com/nic/update?hostname=<domain>&myip=<ipaddr>` |
| Domain name | `home.example.com` |
| Username | `router` |
| Password | your `DDNS_PASSWORD` |

(The FRITZ!Box substitutes `<domain>`, `<ipaddr>` / `<ip6addr>` itself.)

### UniFi / UDM

UniFi's Dynamic DNS uses `inadyn` with a **custom** provider. Under
*Settings → Internet → (WAN) → Dynamic DNS → Create New*:

| Field | Value |
|-------|-------|
| Service   | `custom` |
| Hostname  | `home.example.com` |
| Username  | your `DDNS_USERNAME` |
| Password  | your `DDNS_PASSWORD` |
| Server    | `ddns.example.com/nic/update?hostname=%h&myip=%i` |

> ⚠️ **On current UniFi firmware the `Server` field must contain the full path +
> query template, not just the hostname** (there is no separate "Path" field).
> `%h` expands to the hostname, `%i` to the detected IP.
>
> - ✅ `ddns.example.com/nic/update?hostname=%h&myip=%i`
> - ❌ `ddns.example.com` (inadyn then only requests `/` → *"DDNS server response not OK"*)
> - ❌ `https://ddns.example.com/...` (drop the scheme, or inadyn fails with
>   *"Failed resolving hostname https"*)
>
> inadyn talks **HTTPS on port 443** by default, so the host must be reachable
> over HTTPS (e.g. via your reverse proxy — see the security note below).

---

## IPv6 and dual-stack

The endpoint updates both `A` (IPv4) and `AAAA` (IPv6) records. How you pass the
addresses:

| Goal | Request |
|------|---------|
| IPv4 only | `?hostname=…&myip=1.2.3.4` |
| IPv6 only | `?hostname=…&myip=2001:db8::1` *(family auto-detected)* |
| IPv6, explicit | `?hostname=…&myipv6=2001:db8::1` |
| Dual-stack | `?hostname=…&myip=1.2.3.4&myipv6=2001:db8::1` |

`myip` auto-detects the family; `myipv6` / `ipv6` always set the `AAAA` record.

### Turning a family off

Set `ENABLE_IPV4=false` or `ENABLE_IPV6=false` to make the server **accept but
ignore** that family: the client may still send the address, the request still
returns success, but no record of that type is touched. This is handy when a
dual-stack client insists on sending an address you don't want published.

### ⚠️ UniFi / inadyn caveat (the IPv6 problem)

On UniFi gateways, inadyn's `%i` token is filled with **one** address — and on a
dual-stack WAN that is the **IPv4** address. So a single custom-DDNS entry
**cannot** reliably update an `AAAA` record; the `%i` you'd map into `myipv6`
would still be the IPv4. This is a known UniFi/inadyn limitation, not a
limitation of this service ([community thread][unifi-ipv6]).

Realistic options:

1. **Let the UDM report its own IPv6 (recommended for VPN access).** A small
   persistent script runs *on the UDM*, detects its WAN IPv6 and calls
   `?myipv6=…` directly — sidestepping inadyn entirely. It survives reboots and
   firmware updates via `on_boot.d`. Ready-to-use:
   **[`examples/udm-pro-ipv6/`](examples/udm-pro-ipv6/)**. This is the right
   choice when you need the **UDM's own** address (e.g. for the built-in VPN
   over IPv6 behind CGNAT/DS-Lite).
2. **IPv6 from another host.** If the `AAAA` should point at a specific server
   (not the UDM), update it from a cron job *on that host* — it knows its own
   IPv6: `curl -u user:pass "https://…/nic/update?hostname=…&myipv6=$(curl -6 -s https://api6.ipify.org)"`.
3. **A client that does dual-stack properly** (e.g. `ddclient`, FRITZ!Box with
   `<ip6addr>`) — pass both `myip` and `myipv6`.

If you only care about one family on UniFi, set the other to `ENABLE_…=false` so
a stray address can never overwrite the record you do care about.

[unifi-ipv6]: https://community.ui.com/questions/Add-support-for-Dynamic-DNS-with-IPv6-AAAA-record-updates-in-UniFi-Gateways/80c7a768-a320-4660-b15d-35a82684381f

---

## Security notes

- **Netcup credentials stay server-side.** They are read only from the
  environment and are never sent to the client, returned in responses, or
  logged (the logger redacts `apikey`, `apipassword`, `apisessionid`, etc.).
- **Constant-time auth.** Secrets are compared with a SHA-256 digest +
  `crypto.timingSafeEqual`, so neither value nor length leaks via timing.
- **Allow-list.** Only hostnames inside `ALLOWED_DOMAINS` (and, if set,
  `ALLOWED_HOSTNAMES`) can be written.
- **Input validation.** `hostname` is regex-restricted and `myip` is parsed
  with `net.isIPv4/isIPv6` before anything reaches Netcup.
- **Run behind HTTPS.** Basic Auth is only safe over TLS. Put the service
  behind a reverse proxy (Caddy / nginx / Traefik) that terminates HTTPS, and
  set `TRUST_PROXY=true` so the real client IP is honoured. Example Caddy:

  ```caddy
  ddns.example.com {
      reverse_proxy 127.0.0.1:8080
  }
  ```

- **Least privilege.** The container runs as the non-root `node` user.

---

## Limitations & assumptions

- **One Netcup account.** A single set of Netcup API credentials is supported.
  Multiple **zones** under that account work (`ALLOWED_DOMAINS=a.com,b.com`).
- **A / AAAA only.** The endpoint updates `A` (IPv4) and `AAAA` (IPv6) records.
  Other record types are out of scope.
- **TTL is not modified.** Existing record TTL/priority are preserved.
- **Client UIs vary.** Field names and URL/variable syntax differ between
  clients and firmware versions (e.g. UniFi's `%h`/`%i` vs. FRITZ!Box's
  `<domain>`/`<ipaddr>`). The common denominator is the dyndns2 request
  `GET /nic/update?hostname=<fqdn>&myip=<ip>` with HTTP Basic Auth; the
  [client examples](#client-examples) are illustrative, not exhaustive.
- **No persistence / rate limiting.** The service is stateless. If you expose it
  publicly, add rate limiting at your reverse proxy.

---

## License

MIT
