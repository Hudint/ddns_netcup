import { timingSafeEqual } from 'node:crypto';

export const parseBasicAuth = (header) => {
  if (!header || !header.startsWith('Basic ')) return null;

  try {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1)
    };
  } catch {
    return null;
  }
};

const safeCompare = (left, right) => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const isValidBasicAuth = (header, expectedUsername, expectedPassword) => {
  const parsed = parseBasicAuth(header);
  if (!parsed) return false;
  return safeCompare(parsed.username, expectedUsername) && safeCompare(parsed.password, expectedPassword);
};
