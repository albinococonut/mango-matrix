// Role-based auth. Single cookie carries a signed payload {role, iat, email?}.
// HMAC-SHA256 via Web Crypto so the same code works in Edge (middleware) and
// Node (API routes, server components).
//
// SECURITY MODEL:
//  - Sessions are minted by /api/auth/google/callback after a verified
//    Google OAuth sign-in. The callback hard-rejects any email whose
//    domain is not @mangoautomotive.com (server-side check beyond the
//    hd= hint sent at /api/auth/google/start).
//  - Role is derived from EXECUTIVE_EMAILS (comma-separated allowlist of
//    emails). Anything not on the list defaults to 'employee'.
//  - The cookie value is `<base64url(payload)>.<base64url(hmac)>`. Clients can
//    decode the payload but cannot forge the signature without AUTH_SECRET.
//  - Middleware verifies the signature on every request. Page + executive-only
//    API routes re-derive the role from the cookie and conditionally render
//    or refuse, so editing the frontend never reveals exec data.
//  - Shared-password sign-in has been retired; /api/login now serves only
//    the logout endpoint.

export type Role = 'employee' | 'executive';

// Bumped from "mango_session" → "mango_session_v2" as a one-time force-logout
// to make everyone re-authenticate via Google after the shared-password
// retirement. Existing browsers carrying the old cookie are simply ignored
// by the server (no matching name) → redirected to /login.
export const COOKIE_NAME = 'mango_session_v2';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface Payload {
  role: Role;
  iat: number;        // issued-at unix seconds; cheap freshness check
  email?: string;     // present iff session came from Google OAuth (not password fallback)
}

export const ALLOWED_DOMAIN = 'mangoautomotive.com';

/** True for `*@mangoautomotive.com` (case-insensitive). False for anything else. */
export function isAllowedDomain(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  return lower.endsWith(`@${ALLOWED_DOMAIN}`);
}

/**
 * Pick a role for a verified email. EXECUTIVE_EMAILS is a comma-separated env
 * var (case-insensitive). Anything not on the list defaults to employee.
 */
export function roleForEmail(email: string): Role {
  const raw = process.env.EXECUTIVE_EMAILS || '';
  const allowlist = raw.split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowlist.includes(email.toLowerCase().trim())) return 'executive';
  return 'employee';
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
  return signSessionCookie(role);
}

/**
 * Sign a session cookie with role + optional verified email. Email is set
 * for Google-OAuth sessions and omitted for password-fallback sessions.
 */
export async function signSessionCookie(role: Role, email?: string): Promise<{ value: string; maxAge: number }> {
  const payload: Payload = { role, iat: Math.floor(Date.now() / 1000) };
  if (email) payload.email = email;
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = await hmac(payloadB64, getSecret());
  return { value: `${payloadB64}.${sig}`, maxAge: MAX_AGE_SECONDS };
}

export async function verifyRoleCookie(value: string | undefined | null): Promise<Role | null> {
  const session = await verifySession(value);
  return session?.role ?? null;
}

/**
 * Verify the cookie and return the full session (role + optional email),
 * or null if the cookie is missing/invalid. Backward compatible with
 * cookies signed before the email field was added (they decode with
 * email=undefined).
 */
export async function verifySession(value: string | undefined | null): Promise<{ role: Role; email?: string } | null> {
  // PREVIEW ONLY: Vercel preview deployments have no auth env vars (passwords
  // are Production-scoped), so login is impossible there. For visual review,
  // open the executive dashboard with no password on preview builds. This
  // NEVER affects production (VERCEL_ENV==='production') or local dev
  // (VERCEL_ENV undefined) — both still require the real password.
  if (process.env.VERCEL_ENV === 'preview') return { role: 'executive' };
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
    return { role: obj.role, email: obj.email };
  } catch {
    return null;
  }
}

// Shared-password authentication was retired once Google sign-in went live.
// The previous roleForPassword() helper has been removed; new sessions are
// minted exclusively by /api/auth/google/callback. The HMAC secret used
// for cookie signing (AUTH_SECRET, with DASHBOARD_PASSWORD as a legacy
// fallback) is intentionally preserved — changing it would invalidate
// every existing Google-issued session.
