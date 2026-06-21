const SENSITIVE_KEYS = new Set(['authorization', 'password', 'apikey', 'apipassword', 'token']);

const sanitize = (value) => {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '***REDACTED***' : sanitize(nested);
    }
    return output;
  }
  return value;
};

export const createLogger = (level = 'INFO') => {
  const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
  const minIndex = Math.max(0, levels.indexOf(level));

  const log = (entryLevel, message, data = undefined) => {
    if (levels.indexOf(entryLevel) < minIndex) return;
    const payload = {
      timestamp: new Date().toISOString(),
      level: entryLevel,
      message
    };
    if (data !== undefined) payload.data = sanitize(data);
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  return {
    debug: (message, data) => log('DEBUG', message, data),
    info: (message, data) => log('INFO', message, data),
    warn: (message, data) => log('WARN', message, data),
    error: (message, data) => log('ERROR', message, data)
  };
};
