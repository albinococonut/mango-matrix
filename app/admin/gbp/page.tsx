// Admin — Google Business Profile connection. Executive only.
//
// Shows the current OAuth connection status, a button to (re)connect, and a
// snapshot of every Google account + location the connection can see. The
// snapshot is whatever the most recent /api/gbp/oauth/callback cached in
// KV under DISCOVERED_KEY; if the connection is fresh and discovery fails,
// the page surfaces the error so the admin can re-authorize.

import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ExecShell from '@/components/ExecShell';
import { readStoredTokens, DISCOVERED_KEY, type StoredTokens } from '@/lib/gbpAuth';
import { readCache } from '@/lib/cache';
import type { DiscoveredSnapshot } from '@/lib/gbpDiscovery';

export const dynamic = 'force-dynamic';

export default async function GbpAdminPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  if (session.role !== 'executive') redirect('/employee');
  const role = session.role;

  const tokens: StoredTokens | null = await readStoredTokens();
  const snapshot = await readCache<DiscoveredSnapshot>(DISCOVERED_KEY);
  const connected = !!tokens;

  const justConnected = searchParams?.connected === '1';
  const justRefreshed = searchParams?.refreshed === '1';
  const oauthError = searchParams?.error;
  const discoverErr = searchParams?.discover_err;

  const connectedAt = tokens?.connected_at ? new Date(tokens.connected_at) : null;
  const updatedAt = tokens?.updated_at ? new Date(tokens.updated_at) : null;
  const fmt = (d: Date | null) => d ? d.toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' MT' : '—';

  const totalLocations = snapshot?.accounts.reduce((s, a) => s + a.locations.length, 0) ?? 0;

  return (
    <ExecShell role={role} email={session.email}>
      <div className="max-w-3xl mx-auto py-2">
        <h1 className="text-2xl font-bold text-mango-ink mb-1">Google Business Profile</h1>
        <p className="text-sm text-mango-muted mb-6">
          Connect the Google account that manages your Mango locations so the dashboard can pull real review counts.
        </p>

        {justConnected && !oauthError && (
          <div className="card mb-4 border-emerald-200 bg-emerald-50/60">
            <div className="text-sm font-semibold text-emerald-800">Connected ✓</div>
            <div className="text-xs text-emerald-700/80 mt-0.5">
              Google Business Profile is now linked. See the discovered locations below.
            </div>
          </div>
        )}

        {justRefreshed && !discoverErr && (
          <div className="card mb-4 border-emerald-200 bg-emerald-50/60">
            <div className="text-sm font-semibold text-emerald-800">Locations refreshed ✓</div>
          </div>
        )}

        {oauthError && (
          <div className="card mb-4 border-mango-red/30 bg-mango-red/8">
            <div className="text-sm font-semibold text-mango-red">OAuth failed</div>
            <div className="text-xs text-mango-red/90 mt-0.5 font-mono break-all">{oauthError}</div>
          </div>
        )}

        <div className="card mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-mango-muted font-semibold">Status</div>
              {connected ? (
                <>
                  <div className="text-lg font-bold text-emerald-700 mt-0.5">Connected</div>
                  <div className="text-xs text-mango-muted mt-1">
                    Account: <span className="font-medium text-mango-ink">{tokens?.email || 'unknown'}</span>
                  </div>
                  <div className="text-xs text-mango-muted">Connected: {fmt(connectedAt)}</div>
                  <div className="text-xs text-mango-muted">Last refresh: {fmt(updatedAt)}</div>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold text-mango-red mt-0.5">Not connected</div>
                  <div className="text-xs text-mango-muted mt-1">Click Connect to start the Google sign-in flow.</div>
                </>
              )}
            </div>
            <div className="flex flex-col items-stretch gap-2 shrink-0">
              <a
                href="/api/gbp/oauth/start"
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-mango-orange text-white font-semibold text-sm hover:bg-mango-orange/90 transition"
              >
                {connected ? 'Re-connect' : 'Connect Google'}
              </a>
              {connected && (
                <form action="/api/gbp/discover" method="post">
                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-white text-mango-ink border border-mango-line text-sm font-semibold hover:border-mango-orange/50 transition"
                  >
                    Refresh locations
                  </button>
                </form>
              )}
            </div>
          </div>
          {connected && (
            <p className="text-[11px] text-mango-muted mt-3 leading-relaxed">
              If discovery failed with a quota error, click <span className="font-semibold">Refresh locations</span> — it'll retry with longer backoff (can take up to 3 minutes). You only need to <span className="font-semibold">Re-connect</span> if you want to switch which Google account is linked.
            </p>
          )}
        </div>

        {discoverErr && (
          <div className="card mb-4 border-mango-red/30 bg-mango-red/8">
            <div className="text-sm font-semibold text-mango-red">Location discovery failed</div>
            <div className="text-xs text-mango-red/90 mt-0.5 font-mono break-all">{discoverErr}</div>
            <div className="text-xs text-mango-red/70 mt-2">
              The OAuth tokens were saved successfully, but listing your accounts/locations failed. Try Re-connect above, or contact support.
            </div>
          </div>
        )}

        {connected && snapshot && (
          <div className="card">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-lg font-semibold text-mango-ink">Discovered locations</h2>
              <div className="text-[11px] text-mango-muted">{totalLocations} location{totalLocations === 1 ? '' : 's'} across {snapshot.accounts.length} account{snapshot.accounts.length === 1 ? '' : 's'}</div>
            </div>
            <p className="text-xs text-mango-muted mb-4">
              These are every Google Business Profile location the connected Google account can manage. After all 8 Mango shops are listed here, we'll wire up the per-shop mapping and the dashboard will start showing real review counts.
            </p>
            {snapshot.accounts.length === 0 && (
              <div className="text-sm text-mango-red italic">No accounts found. Make sure the Google account you signed in with has manager access to your business listings.</div>
            )}
            {snapshot.accounts.map(acct => (
              <div key={acct.name} className="border-t border-mango-line/60 pt-3 mt-3 first:border-t-0 first:pt-0 first:mt-0">
                <div className="text-sm font-semibold text-mango-ink">{acct.accountName}</div>
                <div className="text-[11px] text-mango-muted font-mono mb-2">{acct.name} · {acct.type}</div>
                {acct.locations.length === 0 ? (
                  <div className="text-xs text-mango-muted italic">No locations under this account.</div>
                ) : (
                  <ul className="space-y-1">
                    {acct.locations.map(loc => (
                      <li key={loc.name} className="text-xs flex items-baseline gap-2">
                        <span className="font-semibold text-mango-ink">{loc.title}</span>
                        {loc.phoneNumbers?.primaryPhone && <span className="text-mango-muted">· {loc.phoneNumbers.primaryPhone}</span>}
                        <span className="text-mango-faint font-mono ml-auto">{loc.name.replace(/^accounts\/[^/]+\//, '')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <div className="text-[10px] text-mango-faint mt-4 pt-3 border-t border-mango-line/50">
              Snapshot fetched: {fmt(new Date(snapshot.fetched_at))}
            </div>
          </div>
        )}

        {connected && !snapshot && !discoverErr && (
          <div className="card text-sm text-mango-muted italic">
            No location snapshot stored yet. Click Re-connect above to refresh.
          </div>
        )}
      </div>
    </ExecShell>
  );
}
