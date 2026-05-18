// Google Business Profile OAuth helpers. Wraps the standard Google OAuth2
// authorization-code-with-PKCE flow. Returns refresh + access tokens.
//
// SCOPES: we only need business.manage to read accounts/locations/reviews.
// `access_type=offline` + `prompt=consent` is required to receive a refresh
// token on every authorize (otherwise Google only sends it on first consent).

import { sql } from './db';

const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_BASE = 'https://oauth2.googleapis.com/token';
export const SCOPES = ['https://www.googleapis.com/auth/business.manage', 'openid', 'email'];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not configured. See README.gbp.md for setup.`);
  return v;
}

export function getRedirectUri(): string {
  // Prefer an explicit override (production), else infer from VERCEL_URL, else localhost.
  if (process.env.GBP_OAUTH_REDIRECT_URI) return process.env.GBP_OAUTH_REDIRECT_URI;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/api/gbp/oauth/callback`;
  return 'http://localhost:3000/api/gbp/oauth/callback';
}

/** Build the URL the admin clicks to begin OAuth. */
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
  refresh_token?: string;     // present on first consent only; persist when received
  expires_in: number;          // seconds
  token_type: string;          // 'Bearer'
  scope: string;
  id_token?: string;
}

/** Exchange authorization code for tokens. */
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

/** Use a stored refresh_token to get a fresh access_token. */
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
    // 400 invalid_grant = refresh token revoked or user removed access.
    // Caller should surface "needs re-connect" to admin.
    const e: any = new Error(`OAuth refresh failed: ${r.status} ${txt}`);
    e.code = r.status === 400 ? 'REFRESH_REVOKED' : 'REFRESH_FAILED';
    throw e;
  }
  return r.json();
}

/**
 * Fetch a valid access token for an account, refreshing if it's expiring within
 * 60 seconds. Updates the DB row with the new access token + expiry so other
 * concurrent callers don't all refresh.
 */
export async function getAccessTokenForAccount(accountId: string): Promise<string> {
  const db = sql();
  const rows = await db`SELECT refresh_token, access_token, access_token_expires_at FROM gbp_oauth_tokens WHERE account_id = ${accountId} LIMIT 1`;
  if (rows.length === 0) throw new Error(`No OAuth tokens stored for account ${accountId}. Connect via /admin/gbp.`);
  const row = rows[0] as any;
  const expiresAt = new Date(row.access_token_expires_at).getTime();
  if (expiresAt - Date.now() > 60_000) return row.access_token;
  const t = await refreshAccessToken(row.refresh_token);
  const newExpiry = new Date(Date.now() + t.expires_in * 1000);
  await db`UPDATE gbp_oauth_tokens SET access_token = ${t.access_token}, access_token_expires_at = ${newExpiry}, updated_at = NOW() WHERE account_id = ${accountId}`;
  return t.access_token;
}
