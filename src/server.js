import { createHttpServer } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logging.js';
import { NetcupClient, NetcupDNSService } from './netcup.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);

const netcupClient = new NetcupClient({
  customerNumber: config.netcupCustomerNumber,
  apiKey: config.netcupApiKey,
  apiPassword: config.netcupApiPassword
});

const dnsService = new NetcupDNSService(netcupClient);
const server = createHttpServer(config, dnsService, logger);

server.listen(config.bindPort, config.bindHost, () => {
  logger.info('DDNS server listening', { host: config.bindHost, port: config.bindPort });
});
