/** Entrypoint: load config, start the HTTP server. */

import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { logger } from "./logger.js";

function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    logger.error("Configuration error", { error: (err as Error).message });
    process.exit(1);
  }

  const app = createApp(config);
  const server = app.listen(config.port, () => {
    logger.info("ddns-netcup listening", {
      port: config.port,
      domains: config.allowedDomains,
      trustProxy: config.trustProxy,
    });
  });

  const shutdown = (signal: string) => {
    logger.info("Shutting down", { signal });
    server.close(() => process.exit(0));
    // Force-exit if connections linger.
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
