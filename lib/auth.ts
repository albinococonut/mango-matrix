// Role-based auth. Single cookie carries a signed payload {role, iat}.
// HMAC-SHA256 via Web Crypto so the same code works in Edge (middleware) and
// Node (API routes, server components).
//
// SECURITY MODEL:
//  - Passwords live in env vars only (EMPLOYEE_DASHBOARD_PASSWORD,
//    EXECUTIVE_DASHBOARD_PASSWORD). Never sent to the client.
//  - /api/login compares the submitted password against each env var
//    server-side and signs a role into the cookie.
//  - The cookie value is `<base64url(payload)>.<base64url(hmac)>`. Clients can
//    decode the payload but cannot forge the signature without AUTH_SECRET.
//  - Middleware verifies the signature on every request. Page + executive-only
//    API routes re-derive the role from the cookie and conditionally render
//    or refuse, so editing the frontend never reveals exec data.

export type Role = 'employee' | 'executive';

export const COOKIE_NAME = 'mango_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface Payload {
  role: Role;
  iat: number; // issued-at unix seconds; cheap freshness check
}

function getSecret(): string {
  // Prefer an explicit AUTH_SECRET; fall back to DASHBOARD_PASSWORD so existing
  // deploys can roll forward without a fresh env var. Refuses to operate with
  // no secret at all.
  const s = process.env.AUTH_SECRET || process.env.DASHBOARD_PASSWORD;
  if (!s || s.length < 6) throw new Error('AUTH_SECRET (or DASHBOARD_PASSWORD) must be set to a non-trivial value.');
  return s;
}

// --- base64url helpers (Edge-safe; no Buffer) ---------------------------

function b64urlEncode(bytes: Uint8Array | string): string {
  const str = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecodeToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlDecodeToString(s: string): string {
  return new TextDecoder().decode(b64urlDecodeToBytes(s));
}

// --- HMAC sign + verify --------------------------------------------------

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64urlEncode(new Uint8Array(sig));
}

/** Constant-time string compare. */
function constEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signRoleCookie(role: Role): Promise<{ value: string; maxAge: number }> {
  const payload: Payload = { role, iat: Math.floor(Date.now() / 1000) };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = await hmac(payloadB64, getSecret());
  return { value: `${payloadB64}.${sig}`, maxAge: MAX_AGE_SECONDS };
}

export async function verifyRoleCookie(value: string | undefined | null): Promise<Role | null> {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return null;
  const payloadB64 = value.slice(0, dot);
  const providedSig = value.slice(dot + 1);
  try {
    const expectedSig = await hmac(payloadB64, getSecret());
    if (!constEq(providedSig, expectedSig)) return null;
    const obj = JSON.parse(b64urlDecodeToString(payloadB64)) as Payload;
    if (obj.role !== 'employee' && obj.role !== 'executive') return null;
    return obj.role;
  } catch {
    return null;
  }
}

// --- Password lookup -----------------------------------------------------

/** Return the role this password unlocks, or null if it matches none. */
export function roleForPassword(password: string): Role | null {
  if (!password) return null;
  const exec = process.env.EXECUTIVE_DASHBOARD_PASSWORD;
  const emp = process.env.EMPLOYEE_DASHBOARD_PASSWORD;
  if (exec && constEq(password, exec)) return 'executive';
  if (emp && constEq(password, emp)) return 'employee';
  return null;
}
