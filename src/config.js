const required = (name) => {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const parseHostMappings = (raw) => {
  const input = (raw || '').trim();
  if (!input) throw new Error('DDNS_HOST_MAPPINGS is required');

  const mappings = new Map();

  for (const entry of input.split(';').map((v) => v.trim()).filter(Boolean)) {
    const [clientHost, rawTargets] = entry.split('=');
    if (!clientHost || !rawTargets) throw new Error(`Invalid mapping entry: ${entry}`);

    const targets = rawTargets
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((target) => {
        const [domain, host] = target.split(':').map((v) => v.trim().toLowerCase());
        if (!domain || !host) throw new Error(`Invalid target entry: ${target}`);
        return { domain, host };
      });

    if (!targets.length) throw new Error(`No targets configured for hostname: ${clientHost}`);
    mappings.set(clientHost.trim().toLowerCase(), targets);
  }

  if (!mappings.size) throw new Error('No hostname mappings configured');
  return mappings;
};

const parsePort = (raw) => {
  const value = Number.parseInt(raw || '8000', 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid BIND_PORT value: ${raw}`);
  }
  return value;
};

export const loadConfig = () => ({
  hostMappings: parseHostMappings(required('DDNS_HOST_MAPPINGS')),
  ddnsUsername: required('DDNS_USERNAME'),
  ddnsPassword: required('DDNS_PASSWORD'),
  netcupCustomerNumber: required('NETCUP_CUSTOMER_NUMBER'),
  netcupApiKey: required('NETCUP_API_KEY'),
  netcupApiPassword: required('NETCUP_API_PASSWORD'),
  bindHost: (process.env.BIND_HOST || '0.0.0.0').trim(),
  bindPort: parsePort(process.env.BIND_PORT),
  logLevel: (process.env.LOG_LEVEL || 'INFO').trim().toUpperCase(),
  trustProxy: (process.env.TRUST_PROXY || 'false').trim().toLowerCase() === 'true'
});
