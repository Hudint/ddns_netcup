#!/bin/sh
# ---------------------------------------------------------------------------
# on_boot.d wrapper for the ddns-netcup IPv6 updater.
#
# Place this in /data/on_boot.d/ (requires an on-boot-script package — see the
# README; UniFi OS 4.x+ uses unifi-common / on-boot-script-2.x). It (re)starts
# the long-running updater in the background on every boot / firmware update,
# then returns immediately so boot isn't blocked.
# ---------------------------------------------------------------------------
set -eu

SCRIPT="/data/scripts/ddns-netcup-ipv6.sh"

[ -x "$SCRIPT" ] || chmod +x "$SCRIPT" 2>/dev/null || {
  echo "ddns-netcup-ipv6: $SCRIPT missing or not executable" >&2
  exit 0
}

# Kill any previous instance, then start a fresh detached loop.
pkill -f "$SCRIPT" 2>/dev/null || true
setsid "$SCRIPT" >/dev/null 2>&1 &
