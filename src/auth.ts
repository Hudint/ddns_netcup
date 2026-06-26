/**
 * Client authentication for the DDNS endpoint.
 *
 * Two mechanisms are supported, both compared in constant time:
 *   1. HTTP Basic Auth (the dyndns2 standard, used by inadyn / UniFi).
 *   2. A shared-secret token, via `?token=` or `Authorization: Bearer <token>`.
 *
 * Netcup credentials are NEVER involved here — the client only ever proves it
 * knows the dedicated DDNS credentials.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config.js";

/**
 * Constant-time string comparison.
 *
 * We hash both inputs to a fixed-length digest first so that `timingSafeEqual`
 * (which requires equal-length buffers) never throws and the comparison does
 * not leak the secret's length.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Parse `Authorization: Basic <base64>` into username/password. */
export function parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(" ");
  if (scheme?.toLowerCase() !== "basic" || !encoded) return null;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

/** Parse `Authorization: Bearer <token>`. */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export interface AuthInput {
  authorization?: string;
  /** Token passed as a query parameter (?token=...). */
  queryToken?: string;
}

/**
 * Validate a request against the configured credentials.
 * Returns true only on a successful, constant-time match.
 */
export function authenticate(input: AuthInput, config: AppConfig): boolean {
  // 1. Token auth (Bearer header or ?token=) — only if a token is configured.
  if (config.ddnsToken) {
    const presented = parseBearer(input.authorization) ?? input.queryToken;
    if (presented && safeEqual(presented, config.ddnsToken)) return true;
  }

  // 2. Basic Auth — only if username + password are configured.
  if (config.ddnsUsername && config.ddnsPassword) {
    const basic = parseBasicAuth(input.authorization);
    if (basic) {
      // Evaluate both comparisons (no short-circuit) to avoid leaking which
      // half matched via timing.
      const userOk = safeEqual(basic.user, config.ddnsUsername);
      const passOk = safeEqual(basic.pass, config.ddnsPassword);
      if (userOk && passOk) return true;
    }
  }

  return false;
}
