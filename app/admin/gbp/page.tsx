// Admin — Google Business Profile connection. Executive only.

import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ConceptShell } from '@/components/concept2/kit';
import { readStoredTokens, DISCOVERED_KEY, type StoredTokens } from '@/lib/gbpAuth';
import { readCache } from '@/lib/cache';
import type { DiscoveredSnapshot } from '@/lib/gbpDiscovery';

export const dynamic = 'force-dynamic';

const INK   = '#22201C';
const INK2  = '#5C564E';
const FAINT = '#938C81';
const LINE  = 'rgba(34,32,28,0.08)';
const AMBER = '#E8863E';

const card = {
  borderRadius: 26,
  border: '1px solid rgba(237,220,206,0.85)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255,255,255,0.82))',
  boxShadow: '0 1px 0 rgba(255,255,255,0.95) inset, 0 20px 54px -26px rgba(40,34,26,0.24)',
  padding: '20px 24px',
  marginBottom: 16,
} as const;

export default async function GbpAdminPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  if (session.role !== 'executive') redirect('/employee');

  const tokens: StoredTokens | null = await readStoredTokens();
  const snapshot = await readCache<DiscoveredSnapshot>(DISCOVERED_KEY);
  const connected = !!tokens;

  const justConnected = searchParams?.connected === '1';
  const justRefreshed = searchParams?.refreshed === '1';
  const oauthError = searchParams?.error;
  const discoverErr = searchParams?.discover_err;

  const connectedAt = tokens?.connected_at ? new Date(tokens.connected_at) : null;
  const updatedAt = tokens?.updated_at ? new Date(tokens.updated_at) : null;
  const fmt = (d: Date | null) => d ? d.toLocaleString('en-US', {
    timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }) + ' MT' : '—';

  const totalLocations = snapshot?.accounts.reduce((s, a) => s + a.locations.length, 0) ?? 0;

  return (
    <ConceptShell active="gbp" title="Google Business Profile" sub="Connect the Google account that manages your Mango locations" email={session.email ?? undefined} role={session.role ?? undefined}>
      <div className="max-w-3xl">

        {justConnected && !oauthError && (
          <div style={{ ...card, border: '1px solid rgba(52,160,96,0.30)', background: 'rgba(52,160,96,0.06)', marginBottom: 16 }}>
            <div className="c2ui text-sm font-semibold" style={{ color: '#276741' }}>Connected ✓</div>
            <div className="c2ui text-xs mt-0.5" style={{ color: '#276741' }}>Google Business Profile is now linked. See the discovered locations below.</div>
          </div>
        )}

        {justRefreshed && !discoverErr && (
          <div style={{ ...card, border: '1px solid rgba(52,160,96,0.30)', background: 'rgba(52,160,96,0.06)', marginBottom: 16 }}>
            <div className="c2ui text-sm font-semibold" style={{ color: '#276741' }}>Locations refreshed ✓</div>
          </div>
        )}

        {oauthError && (
          <div style={{ ...card, border: '1px solid rgba(192,90,46,0.30)', background: 'rgba(192,90,46,0.06)', marginBottom: 16 }}>
            <div className="c2ui text-sm font-semibold" style={{ color: '#C05A2E' }}>OAuth failed</div>
            <div className="c2ui text-xs mt-0.5 font-mono break-all" style={{ color: '#C05A2E' }}>{oauthError}</div>
          </div>
        )}

        {/* Connection status card */}
        <div style={card}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="c2ui text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>Status</div>
              {connected ? (
                <>
                  <div className="c2disp text-lg font-bold mt-0.5" style={{ color: '#276741' }}>Connected</div>
                  <div className="c2ui text-xs mt-1" style={{ color: INK2 }}>
                    Account: <span className="font-semibold" style={{ color: INK }}>{tokens?.email || 'unknown'}</span>
                  </div>
                  <div className="c2ui text-xs" style={{ color: FAINT }}>Connected: {fmt(connectedAt)}</div>
                  <div className="c2ui text-xs" style={{ color: FAINT }}>Last refresh: {fmt(updatedAt)}</div>
                </>
              ) : (
                <>
                  <div className="c2disp text-lg font-bold mt-0.5" style={{ color: '#C05A2E' }}>Not connected</div>
                  <div className="c2ui text-xs mt-1" style={{ color: INK2 }}>Click Connect to start the Google sign-in flow.</div>
                </>
              )}
            </div>
            <div className="flex flex-col items-stretch gap-2 shrink-0">
              <a
                href="/api/gbp/oauth/start"
                className="c2ui inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition"
                style={{ background: AMBER }}
              >
                {connected ? 'Re-connect' : 'Connect Google'}
              </a>
              {connected && (
                <form action="/api/gbp/discover" method="post">
                  <button
                    type="submit"
                    className="c2ui w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition"
                    style={{ color: INK, background: 'rgba(34,32,28,0.06)', border: `1px solid ${LINE}` }}
                  >
                    Refresh locations
                  </button>
                </form>
              )}
            </div>
          </div>
          {connected && (
            <p className="c2ui text-[11px] mt-3 leading-relaxed" style={{ color: FAINT }}>
              If discovery failed with a quota error, click <span className="font-semibold">Refresh locations</span> — it&apos;ll retry with longer backoff (can take up to 3 minutes). You only need to <span className="font-semibold">Re-connect</span> if you want to switch which Google account is linked.
            </p>
          )}
        </div>

        {discoverErr && (
          <div style={{ ...card, border: '1px solid rgba(192,90,46,0.30)', background: 'rgba(192,90,46,0.06)' }}>
            <div className="c2ui text-sm font-semibold" style={{ color: '#C05A2E' }}>Location discovery failed</div>
            <div className="c2ui text-xs mt-0.5 font-mono break-all" style={{ color: '#C05A2E' }}>{discoverErr}</div>
            <div className="c2ui text-xs mt-2" style={{ color: '#C05A2E' }}>
              The OAuth tokens were saved successfully, but listing your accounts/locations failed. Try Re-connect above, or contact support.
            </div>
          </div>
        )}

        {connected && snapshot && (
          <div style={card}>
            <div className="flex items-baseline justify-between mb-2">
              <div className="c2disp text-lg font-semibold" style={{ color: INK }}>Discovered locations</div>
              <div className="c2ui text-[11px]" style={{ color: FAINT }}>{totalLocations} location{totalLocations === 1 ? '' : 's'} across {snapshot.accounts.length} account{snapshot.accounts.length === 1 ? '' : 's'}</div>
            </div>
            <p className="c2ui text-xs mb-4" style={{ color: INK2 }}>
              These are every Google Business Profile location the connected Google account can manage. After all 8 Mango shops are listed here, we&apos;ll wire up the per-shop mapping and the dashboard will start showing real review counts.
            </p>
            {snapshot.accounts.length === 0 && (
              <div className="c2ui text-sm italic" style={{ color: '#C05A2E' }}>No accounts found. Make sure the Google account you signed in with has manager access to your business listings.</div>
            )}
            {snapshot.accounts.map(acct => (
              <div key={acct.name} style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12, marginTop: 12 }}>
                <div className="c2ui text-sm font-semibold" style={{ color: INK }}>{acct.accountName}</div>
                <div className="c2ui text-[11px] font-mono mb-2" style={{ color: FAINT }}>{acct.name} · {acct.type}</div>
                {acct.locations.length === 0 ? (
                  <div className="c2ui text-xs italic" style={{ color: FAINT }}>No locations under this account.</div>
                ) : (
                  <ul className="space-y-1">
                    {acct.locations.map(loc => (
                      <li key={loc.name} className="c2ui text-xs flex items-baseline gap-2">
                        <span className="font-semibold" style={{ color: INK }}>{loc.title}</span>
                        {loc.phoneNumbers?.primaryPhone && <span style={{ color: FAINT }}>· {loc.phoneNumbers.primaryPhone}</span>}
                        <span className="font-mono ml-auto" style={{ color: FAINT }}>{loc.name.replace(/^accounts\/[^/]+\//, '')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <div className="c2ui text-[10px] mt-4 pt-3" style={{ borderTop: `1px solid ${LINE}`, color: FAINT }}>
              Snapshot fetched: {fmt(new Date(snapshot.fetched_at))}
            </div>
          </div>
        )}

        {connected && !snapshot && !discoverErr && (
          <div style={card}>
            <p className="c2ui text-sm italic" style={{ color: FAINT }}>No location snapshot stored yet. Click Re-connect above to refresh.</p>
          </div>
        )}

      </div>
    </ConceptShell>
  );
}
