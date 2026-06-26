# UDM Pro → self-reporting IPv6 (AAAA) updater

Make a **UniFi Dream Machine (Pro)** keep an `AAAA` record pointed at **its own
public WAN IPv6** — for example so you can reach the UDM's built-in VPN over IPv6
when your IPv4 is stuck behind CGNAT / DS-Lite.

## Why this is needed

UniFi's GUI Dynamic DNS uses `inadyn`, and inadyn's `%i` token only carries the
**IPv4** address on a dual-stack WAN. A single custom-DDNS entry therefore
**cannot** update an `AAAA` record. This script runs *on the UDM*, detects the
IPv6 itself, and calls the `ddns-netcup` dyndns2 endpoint with `?myipv6=...`.

It uses the **on-boot-script** mechanism so it **survives reboots and firmware
updates** (everything lives under `/data`, which Ubiquiti restores after
updates). Boot scripts are placed in `/data/on_boot.d/`.

## Prerequisites

1. A running `ddns-netcup` reachable over **HTTPS** (e.g. `https://ddns.example.com`).
   The `AAAA` host must be inside your `ALLOWED_DOMAINS`.
   - Tip: on the server set `ENABLE_IPV4=false` if this UDM should *only* manage
     IPv6 — then a stray IPv4 can never overwrite the record.
2. The on-boot-script package installed on the UDM, so `/data/on_boot.d/` scripts
   run at boot. Pick the one matching your firmware:
   - **UniFi OS 4.x and newer** → [`unifi-common` / on-boot-script-2.x][on-boot]
     (systemd-based). One-line install:
     ```sh
     curl -fsL "https://raw.githubusercontent.com/unifi-utilities/unifi-common/HEAD/remote_install.sh" | /bin/bash
     ```
   - **Older UniFi OS** → the archived [`unifios-utilities` on-boot-script][on-boot-old].

   Both run executable scripts in `/data/on_boot.d/`, so the files below work
   unchanged either way.

## Install

SSH into the UDM, then download both files straight from this repo with `curl`:

```sh
RAW=https://raw.githubusercontent.com/Hudint/ddns_netcup/master/examples/udm-pro-ipv6

# 1. Download the updater into a persistent location, then edit the config block.
mkdir -p /data/scripts
curl -fsSL -o /data/scripts/ddns-netcup-ipv6.sh "$RAW/ddns-netcup-ipv6.sh"
chmod +x /data/scripts/ddns-netcup-ipv6.sh
vi /data/scripts/ddns-netcup-ipv6.sh     # set ENDPOINT, DDNS_HOSTNAME, USER, PASS

# 2. Download the on-boot wrapper so it (re)starts after reboots/updates.
mkdir -p /data/on_boot.d
curl -fsSL -o /data/on_boot.d/15-ddns-netcup-ipv6.sh "$RAW/on_boot.d/15-ddns-netcup-ipv6.sh"
chmod +x /data/on_boot.d/15-ddns-netcup-ipv6.sh

# 3. Start it now without rebooting.
/data/on_boot.d/15-ddns-netcup-ipv6.sh

# 4. Watch it work.
tail -f /data/ddns-netcup-ipv6.log
```

> If the repository is **private**, the raw URLs above return `404`. In that
> case copy the two files over with `scp` from your machine instead, e.g.
> `scp ddns-netcup-ipv6.sh root@<udm-ip>:/data/scripts/`.

> **Stuck in `vi`?** To save and quit: press `Esc`, then type `:wq` and hit
> `Enter`. To quit **without** saving: press `Esc`, then type `:q!` and `Enter`.
> Prefer a friendlier editor? Use `nano /data/scripts/ddns-netcup-ipv6.sh`
> instead (save & exit there with `Ctrl-O`, `Enter`, then `Ctrl-X`).

Expected log lines:

```
2026-06-26T20:10:00+0200 started (host=vpn.example.com interval=300s)
2026-06-26T20:10:00+0200 2003:db8:abcd:1::1 -> good 2003:db8:abcd:1::1
```

## Restarting after a config change

Edited the config block? Just re-run the on-boot wrapper — it kills the running
loop and starts a fresh one with the new settings:

```sh
/data/on_boot.d/15-ddns-netcup-ipv6.sh
tail -f /data/ddns-netcup-ipv6.log
```

(Manual equivalent: `pkill -f /data/scripts/ddns-netcup-ipv6.sh` then
`/data/scripts/ddns-netcup-ipv6.sh &`.)

## How the IPv6 is chosen

1. Finds the WAN interface via the default IPv6 route.
2. Picks the first **stable** global address on it — skipping `temporary` /
   `deprecated` privacy addresses and ULAs (`fd00::/8`) so the published address
   doesn't rotate.
3. If that fails, falls back to asking an external echo service
   (`api6.ipify.org`, …) what address it sees you from.

The updater only calls the server when the address actually changes, and the
server replies `good`/`nochg` either way.

## Notes & caveats

- **Privacy extensions:** if your UDM uses rotating privacy addresses for
  outbound and your VPN binds to a different one, step 1 above already prefers
  the stable address. If your ISP rotates the whole prefix, the record simply
  follows it within one `INTERVAL`.
- **Interface detection** relies on a default IPv6 route existing on the WAN. If
  your setup is unusual, hardcode `wan=` in `get_ipv6()`.
- This is provided as an example; UniFiOS internals change between releases, so
  verify the log after a firmware update.

[on-boot]: https://github.com/unifi-utilities/unifi-common/tree/main/on-boot-script-2.x
[on-boot-old]: https://github.com/unifi-utilities/unifios-utilities-archived
