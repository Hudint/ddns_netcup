/**
 * Core update flow: decide which DNS records need changing and apply them.
 *
 * `computeRecordUpdate` is a pure function (no I/O) so the decision logic is
 * fully unit-testable. `applyUpdate` wires it to the Netcup client.
 */

import { isIPv4, isIPv6 } from "node:net";
import type { AppConfig } from "./config.js";
import { mapHostname } from "./config.js";
import { NetcupClient, type DnsRecord } from "./netcup.js";
import { logger } from "./logger.js";

export type RecordType = "A" | "AAAA";

export interface RecordDecision {
  /** The record to send to Netcup (existing record updated, or a new one). */
  record: DnsRecord;
  /** True if the destination actually changed (or the record is new). */
  changed: boolean;
}

/**
 * Given the existing records for a zone, decide how to set `recordHost`/`type`
 * to `destination`. Reuses the existing record's `id` so Netcup updates in
 * place rather than creating a duplicate; creates a new record if none exists.
 */
export function computeRecordUpdate(
  existing: DnsRecord[],
  recordHost: string,
  type: RecordType,
  destination: string,
): RecordDecision {
  const match = existing.find((r) => r.hostname === recordHost && r.type === type);

  if (match) {
    if (match.destination === destination) {
      return { record: match, changed: false };
    }
    return { record: { ...match, destination, deleterecord: false }, changed: true };
  }

  return {
    record: { hostname: recordHost, type, destination, deleterecord: false },
    changed: true,
  };
}

export interface IpUpdate {
  ipv4?: string;
  ipv6?: string;
}

export interface UpdateResultEntry {
  type: RecordType;
  ip: string;
  changed: boolean;
}

export class UpdateError extends Error {
  constructor(
    message: string,
    readonly code: "notfqdn" | "badip",
  ) {
    super(message);
    this.name = "UpdateError";
  }
}

/**
 * Validate input, map the hostname to a Netcup zone, and apply the requested
 * A / AAAA updates within a single API session.
 */
export async function applyUpdate(
  client: NetcupClient,
  config: AppConfig,
  fqdn: string,
  ips: IpUpdate,
): Promise<UpdateResultEntry[]> {
  const mapping = mapHostname(fqdn, config);
  if (!mapping) {
    throw new UpdateError(`Hostname not allowed: ${fqdn}`, "notfqdn");
  }

  if (ips.ipv4 && !isIPv4(ips.ipv4)) {
    throw new UpdateError(`Invalid IPv4 address: ${ips.ipv4}`, "badip");
  }
  if (ips.ipv6 && !isIPv6(ips.ipv6)) {
    throw new UpdateError(`Invalid IPv6 address: ${ips.ipv6}`, "badip");
  }

  // A supplied IP whose family is disabled is accepted but ignored — the
  // request still succeeds, nothing is written for that family.
  const wanted: Array<{ type: RecordType; ip: string }> = [];
  if (ips.ipv4 && config.enableIpv4) wanted.push({ type: "A", ip: ips.ipv4 });
  if (ips.ipv6 && config.enableIpv6) wanted.push({ type: "AAAA", ip: ips.ipv6 });

  if ((ips.ipv4 && !config.enableIpv4) || (ips.ipv6 && !config.enableIpv6)) {
    logger.debug("Ignoring disabled address family", {
      fqdn,
      enableIpv4: config.enableIpv4,
      enableIpv6: config.enableIpv6,
    });
  }

  // Nothing to do (e.g. only a disabled family was supplied): don't even open a
  // Netcup session.
  if (wanted.length === 0) return [];

  const results: UpdateResultEntry[] = [];

  await client.withDomain(mapping.domain, (existing) => {
    const toUpdate: DnsRecord[] = [];
    for (const { type, ip } of wanted) {
      const decision = computeRecordUpdate(existing, mapping.recordHost, type, ip);
      results.push({ type, ip, changed: decision.changed });
      if (decision.changed) toUpdate.push(decision.record);
    }
    return toUpdate;
  });

  return results;
}
