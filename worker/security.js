// Auth primitives on WebCrypto — JWT (HMAC-SHA256) and PBKDF2 password
// hashing. Replaces jsonwebtoken + bcryptjs from the Node backend, since
// neither runs on Workers. Token payload shape matches src/routes/auth.js
// ({ sub, role }, 7-day expiry).

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const JWT_TTL_SECONDS = 7 * 24 * 60 * 60; // matches JWT_EXPIRES_IN '7d'
const PBKDF2_ITERATIONS = 25000;

export const jwtSecret = (env) => env.JWT_SECRET || 'change-me-in-production';

function bytesToBase64(bytes) {
  const arr = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i += 0x8000) {
    bin += String.fromCharCode(...arr.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const b64url = (bytes) => bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => base64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signToken(user, secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(encoder.encode(JSON.stringify({ sub: user.id, role: user.role, iat: now, exp: now + JWT_TTL_SECONDS })));
  const data = `${header}.${payload}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(data));
  return `${data}.${b64url(signature)}`;
}

/** Returns the decoded payload or null when the token is invalid/expired. */
export async function verifyToken(token, secret) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(parts[2]), encoder.encode(data));
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(b64urlDecode(parts[1])));
    if (!payload || typeof payload !== 'object') return null;
    if (payload.exp !== undefined && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

async function deriveBits(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

/** Hashes a password as pbkdf2$25000$<salt-b64>$<hash-b64>. */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(bits)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterations, saltB64, hashB64] = String(stored || '').split('$');
    if (scheme !== 'pbkdf2') return false;
    const bits = new Uint8Array(await deriveBits(password, base64ToBytes(saltB64), parseInt(iterations, 10)));
    const expected = base64ToBytes(hashB64);
    if (bits.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}
