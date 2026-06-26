/**
 * Environment-based configuration.
 *
 * All secrets (Netcup API credentials and the DDNS client credentials) are read
 * from the environment here and nowhere else. The rest of the app receives a
 * validated, typed config object.
 */

export interface NetcupConfig {
  customerNumber: string;
  apiKey: string;
  apiPassword: string;
  apiUrl: string;
}

export interface AppConfig {
  port: number;
  trustProxy: boolean;
  netcup: NetcupConfig;
  /** dyndns2 / Basic-Auth client credentials (optional if a token is set). */
  ddnsUsername?: string;
  ddnsPassword?: string;
  /** Optional shared-secret token alternative to Basic Auth. */
  ddnsToken?: string;
  /** Netcup zones we are allowed to write to, e.g. ["example.com"]. */
  allowedDomains: string[];
  /** Optional explicit FQDN allow-list. Empty = any host within allowedDomains. */
  allowedHostnames: string[];
  /** When false, IPv4 (A record) updates are accepted but silently ignored. */
  enableIpv4: boolean;
  /** When false, IPv6 (AAAA record) updates are accepted but silently ignored. */
  enableIpv6: boolean;
}

const DEFAULT_API_URL = "https://ccp.netcup.net/run/webservice/servers/endpoint.php?JSON";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function list(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v);
}

export function loadConfig(): AppConfig {
  const ddnsUsername = process.env.DDNS_USERNAME?.trim();
  const ddnsPassword = process.env.DDNS_PASSWORD?.trim();
  const ddnsToken = process.env.DDNS_TOKEN?.trim();

  if (!ddnsToken && !(ddnsUsername && ddnsPassword)) {
    throw new Error(
      "No client authentication configured: set DDNS_USERNAME + DDNS_PASSWORD, and/or DDNS_TOKEN.",
    );
  }

  const allowedDomains = list("ALLOWED_DOMAINS");
  if (allowedDomains.length === 0) {
    throw new Error("ALLOWED_DOMAINS must list at least one Netcup zone, e.g. example.com");
  }

  return {
    port: Number(process.env.PORT ?? 8080),
    trustProxy: bool("TRUST_PROXY", false),
    netcup: {
      customerNumber: required("NETCUP_CUSTOMER_NUMBER"),
      apiKey: required("NETCUP_API_KEY"),
      apiPassword: required("NETCUP_API_PASSWORD"),
      apiUrl: process.env.NETCUP_API_URL?.trim() || DEFAULT_API_URL,
    },
    ddnsUsername,
    ddnsPassword,
    ddnsToken,
    allowedDomains,
    allowedHostnames: list("ALLOWED_HOSTNAMES"),
    enableIpv4: bool("ENABLE_IPV4", true),
    enableIpv6: bool("ENABLE_IPV6", true),
  };
}

export interface HostMapping {
  /** The Netcup zone, e.g. "example.com". */
  domain: string;
  /** The record host within the zone; "@" for the zone apex. */
  recordHost: string;
}

/**
 * Map an incoming FQDN to a Netcup zone + record host, enforcing the allow-list.
 *
 * Returns null if the hostname is not covered by ALLOWED_DOMAINS, or is not in
 * ALLOWED_HOSTNAMES when that explicit list is configured.
 */
export function mapHostname(fqdn: string, config: AppConfig): HostMapping | null {
  const host = fqdn.trim().toLowerCase().replace(/\.$/, "");

  if (config.allowedHostnames.length > 0 && !config.allowedHostnames.includes(host)) {
    return null;
  }

  // Prefer the longest matching zone so "a.b.example.com" maps correctly even
  // if both "example.com" and "b.example.com" are configured zones.
  const match = config.allowedDomains
    .filter((domain) => host === domain || host.endsWith("." + domain))
    .sort((a, b) => b.length - a.length)[0];

  if (!match) return null;

  const recordHost = host === match ? "@" : host.slice(0, host.length - match.length - 1);
  return { domain: match, recordHost };
}
