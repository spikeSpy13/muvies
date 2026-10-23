import { isIP } from 'node:net';

function ipv4Scope(address) {
  if (isIP(address) !== 4) return null;
  const [first, second] = address.split('.').map(Number);
  if (first === 127) return 'loopback';
  if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) return 'private';
  return null;
}

function ipv6Words(address) {
  // WHATWG URL normalization converts embedded IPv4 tails into two hex words.
  let normalized;
  try { normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1); }
  catch { return null; }
  const [left, right] = normalized.split('::');
  const leading = left ? left.split(':').map(value => parseInt(value, 16)) : [];
  if (right === undefined) return leading.length === 8 ? leading : null;
  const trailing = right ? right.split(':').map(value => parseInt(value, 16)) : [];
  return [...leading, ...Array(8 - leading.length - trailing.length).fill(0), ...trailing];
}

function addressScope(value) {
  if (typeof value !== 'string') return null;
  let address = value.replace(/^\[|\]$/g, '');
  // Node may include an interface zone in a link-local socket address. A Host
  // URL containing such a zone is rejected by appOrigin's URL parser instead.
  const zone = address.indexOf('%');
  if (zone >= 0) {
    if (!/^[A-Za-z0-9_.-]+$/.test(address.slice(zone + 1))) return null;
    address = address.slice(0, zone);
  }
  if (isIP(address) === 4) return ipv4Scope(address);
  if (isIP(address) !== 6) return null;
  const words = ipv6Words(address);
  if (!words) return null;
  if (words.slice(0, 7).every(value => value === 0) && words[7] === 1) return 'loopback';
  if (words.slice(0, 5).every(value => value === 0) && words[5] === 0xffff) {
    return ipv4Scope(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  if ((words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80) return 'private';
  return null;
}

function parsedOrigin(req) {
  const host = req.headers?.host;
  if (typeof host !== 'string' || !host) return null;
  try {
    const origin = new URL(`${req.socket?.encrypted ? 'https' : 'http'}://${host}`);
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return null;
    return origin;
  } catch { return null; }
}

function hostScope(origin) {
  return origin.hostname === 'localhost' ? 'loopback' : addressScope(origin.hostname);
}

/** Allow the personal app only on loopback/private literal hosts and peers. */
export function appOrigin(req) {
  const origin = parsedOrigin(req);
  if (!origin || !hostScope(origin) || !addressScope(req.socket?.remoteAddress)) return null;
  return origin;
}

/** Google OAuth session endpoints remain accessible only from loopback. */
export function isLoopbackRequest(req) {
  const origin = parsedOrigin(req);
  return !!origin && hostScope(origin) === 'loopback' && addressScope(req.socket?.remoteAddress) === 'loopback';
}
