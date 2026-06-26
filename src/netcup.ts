/**
 * Low-level client for the Netcup CCP DNS API (JSON variant).
 *
 * Endpoint: https://ccp.netcup.net/run/webservice/servers/endpoint.php?JSON
 * Every request is an HTTP POST with body `{ action, param }`. The session is
 * established with `login` (returns an `apisessionid`) and torn down with
 * `logout`.
 *
 * This module intentionally contains no business logic — it just speaks the
 * protocol. The diff/decision logic lives in updater.ts so it can be unit
 * tested without the network.
 */

import type { NetcupConfig } from "./config.js";
import { logger } from "./logger.js";

const REQUEST_TIMEOUT_MS = 15_000;
/** Netcup status code returned when a zone simply has no records yet. */
const STATUS_NO_RECORDS = 5029;

export interface DnsRecord {
  id?: string;
  hostname: string;
  type: string;
  priority?: string;
  destination: string;
  deleterecord?: boolean;
  state?: string;
}

interface ApiResponse<T> {
  serverrequestid: string;
  action: string;
  status: "success" | "error" | "started" | "pending";
  statuscode: number;
  shortmessage: string;
  longmessage: string;
  responsedata: T;
}

export class NetcupError extends Error {
  constructor(
    readonly action: string,
    readonly statuscode: number,
    message: string,
  ) {
    super(`Netcup ${action} failed (${statuscode}): ${message}`);
    this.name = "NetcupError";
  }
}

export class NetcupClient {
  constructor(private readonly config: NetcupConfig) {}

  private async call<T>(action: string, param: Record<string, unknown>): Promise<ApiResponse<T>> {
    let res: Response;
    try {
      res = await fetch(this.config.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, param }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new NetcupError(action, 0, `network error: ${(err as Error).message}`);
    }

    const data = (await res.json()) as ApiResponse<T>;
    if (data.status !== "success") {
      throw new NetcupError(action, data.statuscode, data.longmessage || data.shortmessage);
    }
    return data;
  }

  private async login(): Promise<string> {
    const res = await this.call<{ apisessionid: string }>("login", {
      customernumber: this.config.customerNumber,
      apikey: this.config.apiKey,
      apipassword: this.config.apiPassword,
    });
    return res.responsedata.apisessionid;
  }

  private async logout(apisessionid: string): Promise<void> {
    try {
      await this.call("logout", {
        customernumber: this.config.customerNumber,
        apikey: this.config.apiKey,
        apisessionid,
      });
    } catch (err) {
      // A failed logout is non-fatal; just note it.
      logger.warn("Netcup logout failed", { error: (err as Error).message });
    }
  }

  private async infoDnsRecords(apisessionid: string, domain: string): Promise<DnsRecord[]> {
    try {
      const res = await this.call<{ dnsrecords: DnsRecord[] }>("infoDnsRecords", {
        domainname: domain,
        customernumber: this.config.customerNumber,
        apikey: this.config.apiKey,
        apisessionid,
      });
      return res.responsedata.dnsrecords ?? [];
    } catch (err) {
      // An empty zone is reported as an error code; treat it as "no records".
      if (err instanceof NetcupError && err.statuscode === STATUS_NO_RECORDS) return [];
      throw err;
    }
  }

  private async updateDnsRecords(
    apisessionid: string,
    domain: string,
    records: DnsRecord[],
  ): Promise<DnsRecord[]> {
    const res = await this.call<{ dnsrecords: DnsRecord[] }>("updateDnsRecords", {
      domainname: domain,
      customernumber: this.config.customerNumber,
      apikey: this.config.apiKey,
      apisessionid,
      // Only the records we want to change are sent — no full-zone rewrite.
      dnsrecordset: { dnsrecords: records },
    });
    return res.responsedata.dnsrecords ?? [];
  }

  /**
   * Run a unit of work against a single domain inside one authenticated
   * session. `work` receives the current records and returns the (possibly
   * empty) set of records to push back. Logout always runs.
   */
  async withDomain(
    domain: string,
    work: (records: DnsRecord[]) => DnsRecord[],
  ): Promise<void> {
    const session = await this.login();
    try {
      const existing = await this.infoDnsRecords(session, domain);
      const toUpdate = work(existing);
      if (toUpdate.length > 0) {
        await this.updateDnsRecords(session, domain, toUpdate);
      }
    } finally {
      await this.logout(session);
    }
  }
}
