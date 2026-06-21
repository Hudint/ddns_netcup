import { createServer } from 'node:http';
import { URL } from 'node:url';

import { isValidBasicAuth } from './auth.js';
import { NetcupAPIError } from './netcup.js';

const textResponse = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  body: `${body}\n`
});

const parseIp = (value) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) {
    const parts = trimmed.split('.').map(Number);
    if (parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return trimmed;
    return null;
  }
  if (/^[0-9a-fA-F:]+$/.test(trimmed) && trimmed.includes(':')) return trimmed.toLowerCase();
  return null;
};

const extractRemoteAddress = (requestLike, trustProxy) => {
  if (trustProxy) {
    const forwarded = requestLike.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return requestLike.remoteAddress || null;
};

export const handleUpdate = async (requestLike, config, dnsService, logger) => {
  const authorization = requestLike.headers.authorization || '';
  if (!isValidBasicAuth(authorization, config.ddnsUsername, config.ddnsPassword)) {
    logger.warn('Authentication failed', { remoteAddress: requestLike.remoteAddress });
    return textResponse(401, 'badauth');
  }

  const hostname = (requestLike.query.hostname || '').trim().toLowerCase();
  if (!hostname) return textResponse(400, 'nohost');

  const targets = config.hostMappings.get(hostname);
  if (!targets) return textResponse(400, 'nohost');

  let ipv4 = parseIp(requestLike.query.myip || null);
  let ipv6 = parseIp(requestLike.query.myipv6 || null);

  if (ipv4 && ipv4.includes(':') && !ipv6) {
    ipv6 = ipv4;
    ipv4 = null;
  }

  if (!ipv4 && !ipv6) {
    const remote = parseIp(extractRemoteAddress(requestLike, config.trustProxy));
    if (remote) {
      if (remote.includes(':')) ipv6 = remote;
      else ipv4 = remote;
    }
  }

  if (!ipv4 && !ipv6) return textResponse(400, 'badip');
  if (ipv4 && ipv4.includes(':')) return textResponse(400, 'badip');
  if (ipv6 && !ipv6.includes(':')) return textResponse(400, 'badip');

  try {
    const changed = await dnsService.updateTargets(targets, ipv4, ipv6);
    const ipForResponse = ipv4 || ipv6 || '';
    return textResponse(200, `${changed ? 'good' : 'nochg'} ${ipForResponse}`.trim());
  } catch (error) {
    if (error instanceof NetcupAPIError) {
      logger.error('Netcup API error', { hostname, error: error.message });
      return textResponse(500, 'dnserr');
    }
    logger.error('Unexpected update error', { hostname, error: String(error) });
    return textResponse(500, '911');
  }
};

export const createHttpServer = (config, dnsService, logger) => createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('911\n');
    return;
  }

  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok\n');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/update') {
    const query = Object.fromEntries(url.searchParams.entries());
    const requestLike = {
      query,
      headers: req.headers,
      remoteAddress: req.socket.remoteAddress || null
    };
    const response = await handleUpdate(requestLike, config, dnsService, logger);
    res.writeHead(response.statusCode, response.headers);
    res.end(response.body);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('notfound\n');
});
