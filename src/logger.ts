/**
 * Minimal structured JSON logger with secret redaction.
 *
 * We deliberately avoid pulling in a logging framework: a few lines of code
 * give us structured output, levels and — most importantly — guaranteed
 * redaction of sensitive fields so Netcup credentials / client passwords never
 * end up in the logs.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const configuredLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
const threshold = LEVELS[configuredLevel] ?? LEVELS.info;

/** Keys whose values must never be logged verbatim. */
const SENSITIVE_KEYS = new Set([
  "apikey",
  "apipassword",
  "apisessionid",
  "password",
  "pass",
  "token",
  "authorization",
  "secret",
]);

const REDACTED = "[REDACTED]";

/** Recursively redact sensitive fields in a plain object/array. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}

function emit(level: Level, message: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit("error", message, fields),
};
