// Admin — Daily Ticker override. Executive only.
//
// The intranet's scrolling ticker normally shows an automatic line published
// daily by the Claude cron job. This page lets an executive override it with
// an exact message (shown verbatim) for an optional time window. Gate pattern
// mirrors app/admin/gbp/page.tsx: server-side session check + redirect.

import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ConceptShell } from '@/components/concept2/kit';
import { getCurrentTicker, getOverrideRow, hasTickerStore, type CurrentTicker, type TickerOverrideRow } from '@/lib/ticker';
import TickerForm from './TickerForm';

export const dynamic = 'force-dynamic';

export default async function TickerAdminPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  if (session.role !== 'executive') redirect('/employee');

  const dbConfigured = hasTickerStore();
  let override: TickerOverrideRow | null = null;
  let current: CurrentTicker = { text: null, source: 'none' };
  if (dbConfigured) {
    [override, current] = await Promise.all([getOverrideRow(), getCurrentTicker()]);
  }

  return (
    <ConceptShell active="ticker" title="Daily Ticker" sub="Control what scrolls on the intranet ticker" email={session.email ?? undefined} role={session.role ?? undefined}>
      <div className="max-w-3xl">
        {!dbConfigured && (
          <div className="mb-6 rounded-2xl px-5 py-4" style={{ background: 'rgba(192,90,46,0.08)', border: '1px solid rgba(192,90,46,0.25)' }}>
            <div className="c2ui text-sm font-semibold" style={{ color: '#C05A2E' }}>Ticker storage not configured</div>
            <div className="c2ui text-xs mt-0.5" style={{ color: '#C05A2E' }}>
              The Upstash Redis env vars (KV_REST_API_URL / KV_REST_API_TOKEN) are not set in this
              environment. Overrides cannot be saved. Production has them set.
            </div>
          </div>
        )}
        <TickerForm initialOverride={override} initialCurrent={current} dbConfigured={dbConfigured} />
      </div>
    </ConceptShell>
  );
}
