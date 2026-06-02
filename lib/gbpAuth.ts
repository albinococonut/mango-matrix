// Google Business Profile OAuth helpers. Standard OAuth2 authorization-code
// flow with refresh-token persistence in Upstash KV.
//
// Single-connection model: ONE Google account owns all 8 Mango locations, so
// we store one set of tokens (refresh + access + expiry) under a single KV
// key and reuse them across every shop. If a future expansion lands us with
// locations under different Google accounts, switch this to per-shop keys.
//
// SCOPES: business.manage covers everything we need (accounts, locations,
// reviews). access_type=offline + prompt=consent guarantees a refresh_token
// on every authorize (Google withholds it on subsequent consents otherwise).

import { readCache, writeCache } from './cache';

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_BASE = 'https://oauth2.googleapis.com/token';
export const SCOPES = ['https://www.googleapis.com/auth/business.manage', 'openid', 'email'];

const TOKENS_KEY = 'gbp_oauth_primary_v1';
// Discovered accounts + locations, refreshed on each /callback so /admin/gbp
// can show what Google sees without making API calls on every page load.
export const DISCOVERED_KEY = 'gbp_discovered_v1';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not configured. Add it in Vercel → Settings → Environment Variables.`);
  return v;
}

/**
 * Where Google redirects after consent. The value MUST match exactly what's
 * registered in Google Cloud → Credentials → OAuth client → Authorized
 * redirect URIs. We hardcode the stable alias because VERCEL_URL points at
 * the per-deploy random URL, which would never match the registered one.
 */
export function getRedirectUri(): string {
  if (process.env.GBP_OAUTH_REDIRECT_URI) return process.env.GBP_OAUTH_REDIRECT_URI;
  return 'https://mango-matrix.vercel.app/api/gbp/oauth/callback';
}

export function buildAuthorizeUrl(state: string): string {
  const clientId = requireEnv('GBP_OAUTH_CLIENT_ID');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  });
  return `${AUTH_BASE}?${params}`;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const clientId = requireEnv('GBP_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('GBP_OAUTH_CLIENT_SECRET');
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getRedirectUri(),
    grant_type: 'authorization_code',
  });
  const r = await fetch(TOKEN_BASE, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!r.ok) throw new Error(`OAuth code exchange failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const clientId = requireEnv('GBP_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('GBP_OAUTH_CLIENT_SECRET');
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  const r = await fetch(TOKEN_BASE, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!r.ok) {
    const txt = await r.text();
    const e: any = new Error(`OAuth refresh failed: ${r.status} ${txt}`);
    e.code = r.status === 400 ? 'REFRESH_REVOKED' : 'REFRESH_FAILED';
    throw e;
  }
  return r.json();
}

// ---- KV-backed token storage ----------------------------------------------

export interface StoredTokens {
  refresh_token: string;
  access_token: string;
  access_token_expires_at: string;   // ISO
  email?: string;                    // who consented (from id_token)
  connected_at: string;              // ISO of initial consent
  updated_at: string;                // ISO of last write (e.g. access token refresh)
}

export async function readStoredTokens(): Promise<StoredTokens | null> {
  return await readCache<StoredTokens>(TOKENS_KEY);
}

export async function writeStoredTokens(t: StoredTokens): Promise<void> {
  await writeCache(TOKENS_KEY, { ...t, updated_at: new Date().toISOString() });
}

/** Decode an id_token payload (no signature check — we trust Google's response). */
function decodeIdTokenEmail(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const parts = idToken.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((parts[1].length + 3) % 4);
    const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return typeof json.email === 'string' ? json.email : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persist a fresh authorize_code exchange result. Required to keep the
 * refresh_token across access-token refreshes (Google returns refresh_token
 * only on the initial exchange).
 */
export async function persistFreshTokens(t: TokenSet): Promise<StoredTokens> {
  if (!t.refresh_token) throw new Error('Google did not return a refresh_token. Re-authorize with prompt=consent.');
  const now = new Date();
  const stored: StoredTokens = {
    refresh_token: t.refresh_token,
    access_token: t.access_token,
    access_token_expires_at: new Date(now.getTime() + t.expires_in * 1000).toISOString(),
    email: decodeIdTokenEmail(t.id_token),
    connected_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  await writeStoredTokens(stored);
  return stored;
}

/**
 * Return a non-expired access token, refreshing via the stored refresh_token
 * if we're within 60s of expiry. Throws if no connection exists — caller
 * should redirect the admin to /admin/gbp to (re)connect.
 */
export async function getAccessToken(): Promise<string> {
  const stored = await readStoredTokens();
  if (!stored) throw new Error('Google Business Profile not connected. Visit /admin/gbp.');
  const expiresAt = new Date(stored.access_token_expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000) return stored.access_token;
  const t = await refreshAccessToken(stored.refresh_token);
  const updated: StoredTokens = {
    ...stored,
    access_token: t.access_token,
    access_token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await writeStoredTokens(updated);
  return updated.access_token;
}
