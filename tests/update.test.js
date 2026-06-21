import assert from 'node:assert/strict';
import test from 'node:test';

import { handleUpdate } from '../src/app.js';

const authHeader = (username, password) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

const baseConfig = () => ({
  hostMappings: new Map([['sub.example.com', [{ domain: 'example.com', host: 'sub' }]]]),
  ddnsUsername: 'ddns',
  ddnsPassword: 'secret',
  trustProxy: false
});

const makeLogger = () => {
  const calls = [];
  return {
    calls,
    debug() {},
    info() {},
    warn(message, data) { calls.push({ level: 'warn', message, data }); },
    error(message, data) { calls.push({ level: 'error', message, data }); }
  };
};

test('rejects bad auth and logs warning', async () => {
  const logger = makeLogger();
  const response = await handleUpdate(
    { query: { hostname: 'sub.example.com', myip: '1.2.3.4' }, headers: {}, remoteAddress: '1.2.3.4' },
    baseConfig(),
    { updateTargets: async () => true },
    logger
  );

  assert.equal(response.statusCode, 401);
  assert.equal(response.body, 'badauth\n');
  assert.equal(logger.calls[0]?.level, 'warn');
});

test('updates ipv4 and returns good', async () => {
  const calls = [];
  const response = await handleUpdate(
    {
      query: { hostname: 'sub.example.com', myip: '1.2.3.4' },
      headers: { authorization: authHeader('ddns', 'secret') },
      remoteAddress: '1.2.3.4'
    },
    baseConfig(),
    {
      updateTargets: async (targets, ipv4, ipv6) => {
        calls.push({ targets, ipv4, ipv6 });
        return true;
      }
    },
    makeLogger()
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'good 1.2.3.4\n');
  assert.deepEqual(calls, [{ targets: [{ domain: 'example.com', host: 'sub' }], ipv4: '1.2.3.4', ipv6: null }]);
});

test('returns nochg when unchanged', async () => {
  const response = await handleUpdate(
    {
      query: { hostname: 'sub.example.com', myip: '1.2.3.4' },
      headers: { authorization: authHeader('ddns', 'secret') },
      remoteAddress: '1.2.3.4'
    },
    baseConfig(),
    { updateTargets: async () => false },
    makeLogger()
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'nochg 1.2.3.4\n');
});

test('supports explicit ipv6 updates', async () => {
  const calls = [];
  const response = await handleUpdate(
    {
      query: { hostname: 'sub.example.com', myipv6: '2001:db8::1' },
      headers: { authorization: authHeader('ddns', 'secret') },
      remoteAddress: '2001:db8::2'
    },
    baseConfig(),
    {
      updateTargets: async (targets, ipv4, ipv6) => {
        calls.push({ targets, ipv4, ipv6 });
        return true;
      }
    },
    makeLogger()
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'good 2001:db8::1\n');
  assert.deepEqual(calls, [{ targets: [{ domain: 'example.com', host: 'sub' }], ipv4: null, ipv6: '2001:db8::1' }]);
});
