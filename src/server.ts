/**
 * Express app exposing a dyndns2-compatible update endpoint.
 *
 * Response bodies follow the dyndns2 convention (plain text: `good <ip>`,
 * `nochg <ip>`, `badauth`, `notfqdn`, `dnserr`, ...) so that inadyn-based
 * clients — including UniFi / UDM Pro custom DDNS — understand the result.
 */

import { isIPv4, isIPv6 } from "node:net";
import express, { type Request, type Response } from "express";
import type { AppConfig } from "./config.js";
import { authenticate } from "./auth.js";
import { NetcupClient } from "./netcup.js";
import { applyUpdate, UpdateError, type IpUpdate } from "./updater.js";
import { logger } from "./logger.js";

/** Pull whatever IP hints the client supplied and bucket them by family. */
function parseRequestedIps(req: Request): { ips: IpUpdate; supplied: boolean; invalid: boolean } {
  const out: IpUpdate = {};
  let supplied = false;
  let invalid = false;

  const consume = (raw: string, family?: "v6") => {
    for (const part of raw.split(",")) {
      const ip = part.trim();
      if (!ip) continue;
      supplied = true;
      if (family !== "v6" && isIPv4(ip)) out.ipv4 ??= ip;
      else if (isIPv6(ip)) out.ipv6 = ip;
      else invalid = true;
    }
  };

  // inadyn/dyndns2 uses `myip`; some clients use `ip`. `myip` may be a
  // comma-separated list mixing v4 and v6.
  for (const key of ["myip", "ip"]) {
    const v = req.query[key];
    if (typeof v === "string") consume(v);
  }
  // Explicit IPv6 parameter.
  for (const key of ["myipv6", "ipv6"]) {
    const v = req.query[key];
    if (typeof v === "string") consume(v, "v6");
  }

  return { ips: out, supplied, invalid };
}

function getHostname(req: Request): string | undefined {
  for (const key of ["hostname", "host", "domain"]) {
    const v = req.query[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

export function createApp(config: AppConfig): express.Express {
  const app = express();
  app.disable("x-powered-by");
  // Required for correct req.ip when running behind a reverse proxy.
  if (config.trustProxy) app.set("trust proxy", true);

  const client = new NetcupClient(config.netcup);

  // Log every incoming request (debug level). This makes it obvious when a
  // client (e.g. inadyn/UniFi) hits the wrong path — query secrets are redacted
  // by the logger.
  app.use((req, _res, next) => {
    logger.debug("request", { method: req.method, path: req.path, query: req.query });
    next();
  });

  app.get(["/healthz", "/"], (_req, res) => {
    res.type("text/plain").send("ok");
  });

  const handleUpdate = async (req: Request, res: Response) => {
    // --- Authentication ---------------------------------------------------
    const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
    if (!authenticate({ authorization: req.headers.authorization, queryToken }, config)) {
      logger.warn("Rejected update: bad auth", { ip: req.ip });
      res.set("WWW-Authenticate", 'Basic realm="ddns"');
      return res.status(401).type("text/plain").send("badauth");
    }

    // --- Input ------------------------------------------------------------
    const hostname = getHostname(req);
    if (!hostname || !/^[a-zA-Z0-9._-]+$/.test(hostname)) {
      return res.status(400).type("text/plain").send("notfqdn");
    }

    const { ips, supplied, invalid } = parseRequestedIps(req);
    // An IP was provided but we couldn't parse a valid address out of it.
    if (invalid && !ips.ipv4 && !ips.ipv6) {
      return res.status(400).type("text/plain").send("dnserr");
    }
    // No IP supplied at all: fall back to the client's source address.
    if (!supplied) {
      const src = req.ip ?? "";
      if (isIPv4(src)) ips.ipv4 = src;
      else if (isIPv6(src)) ips.ipv6 = src;
    }
    if (!ips.ipv4 && !ips.ipv6) {
      return res.status(400).type("text/plain").send("dnserr");
    }

    // --- Apply ------------------------------------------------------------
    try {
      const results = await applyUpdate(client, config, hostname, ips);
      const changed = results.some((r) => r.changed);
      const reportedIp = ips.ipv4 ?? ips.ipv6 ?? "";
      logger.info("DNS update processed", {
        hostname,
        results,
        outcome: changed ? "good" : "nochg",
      });
      return res.type("text/plain").send(`${changed ? "good" : "nochg"} ${reportedIp}`);
    } catch (err) {
      if (err instanceof UpdateError) {
        logger.warn("Update rejected", { hostname, code: err.code, message: err.message });
        return res
          .status(err.code === "notfqdn" ? 400 : 422)
          .type("text/plain")
          .send(err.code === "notfqdn" ? "notfqdn" : "dnserr");
      }
      logger.error("Update failed", { hostname, error: (err as Error).message });
      return res.status(502).type("text/plain").send("dnserr");
    }
  };

  // `/nic/update` is the canonical dyndns2 path; `/update` is a friendly alias.
  app.get("/nic/update", handleUpdate);
  app.get("/update", handleUpdate);

  return app;
}
