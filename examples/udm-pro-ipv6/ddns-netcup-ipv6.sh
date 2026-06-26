#!/bin/sh
# ---------------------------------------------------------------------------
# ddns-netcup — UDM Pro self-reporting IPv6 updater
#
# Runs ON the UDM (Pro) and keeps the AAAA record pointed at the UDM's own
# public WAN IPv6 address — e.g. for reaching the built-in VPN over IPv6 when
# IPv4 is stuck behind CGNAT / DS-Lite.
#
# Why this exists: UniFi's GUI Dynamic DNS uses inadyn, whose %i token only ever
# carries the IPv4 address on a dual-stack WAN, so it can't update an AAAA. This
# script sidesteps that by detecting the IPv6 itself and calling the dyndns2
# endpoint with ?myipv6=...
#
# It loops forever (see INTERVAL) and is started by the on_boot.d wrapper so it
# survives reboots and firmware updates. Make it executable: chmod +x this file.
# ---------------------------------------------------------------------------
set -eu

##### CONFIG — edit these ####################################################
ENDPOINT="https://ddns.example.com/nic/update"   # your ddns-netcup endpoint
DDNS_HOSTNAME="vpn.example.com"                   # FQDN whose AAAA to update
DDNS_USER="router"                               # = DDNS_USERNAME
DDNS_PASS="change-me"                            # = DDNS_PASSWORD
INTERVAL=300                                     # check every N seconds
LOG="/data/ddns-netcup-ipv6.log"                 # /data persists across updates
#############################################################################

log() { echo "$(date '+%Y-%m-%dT%H:%M:%S%z') $*" >> "$LOG"; }

# Determine the UDM's own stable, public IPv6 address.
get_ipv6() {
  # WAN interface = the one carrying the default IPv6 route.
  wan="$(ip -6 route show default 2>/dev/null | awk '{print $5; exit}')"
  if [ -n "${wan:-}" ]; then
    # Prefer a stable global address: drop temporary/deprecated (privacy)
    # addresses and ULAs (fd00::/8) so the published address doesn't rotate.
    addr="$(ip -6 -o addr show dev "$wan" scope global 2>/dev/null \
            | grep -v -e temporary -e deprecated \
            | awk '{print $4}' | cut -d/ -f1 \
            | grep -vi '^fd' | head -n1)"
    [ -n "$addr" ] && { echo "$addr"; return 0; }
  fi
  # Fallback: ask the internet what address it sees us from.
  for url in https://api6.ipify.org https://icanhazip.com https://ifconfig.co; do
    addr="$(curl -6 -fsS --max-time 10 "$url" 2>/dev/null | tr -d '[:space:]')" || addr=""
    case "$addr" in *:*) echo "$addr"; return 0 ;; esac
  done
  return 1
}

push() {
  # No -f: we WANT the dyndns2 body (good/nochg/notfqdn/badauth/...) even on a
  # 4xx, plus the HTTP status appended so failures are self-explanatory.
  curl -sS --max-time 15 -u "$DDNS_USER:$DDNS_PASS" \
    -w ' [HTTP %{http_code}]' \
    "$ENDPOINT?hostname=$DDNS_HOSTNAME&myipv6=$1" 2>&1 || true
}

log "started (host=$DDNS_HOSTNAME interval=${INTERVAL}s)"
last=""
while :; do
  if ip6="$(get_ipv6)"; then
    if [ "$ip6" != "$last" ]; then
      resp="$(push "$ip6")"
      log "$ip6 -> $resp"
      # Only remember it once the server confirms it (good/nochg).
      case "$resp" in good*|nochg*) last="$ip6" ;; esac
    fi
  else
    log "could not determine a public IPv6 address"
  fi
  sleep "$INTERVAL"
done
