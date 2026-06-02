'use client';

// Highest Leverage — by Shop.
//
// One card per shop, surfacing the seven UPSTREAM levers every chain KPI
// decomposes to: Calls · Call Conversion · AWRO · Close Rate · Parts GP ·
// Labor GP · Return Customers. Car Count and ARO are intentionally excluded
// because they're downstream — Car Count is driven by call conversion (and
// prior-quarter re-books); ARO = AWRO × close rate.
//
// ALL VALUES ARE WEEK-TO-DATE (Mon 00:00 MT → now). That makes the chain-
// median comparison an apples-to-apples "are we on pace this week?" check:
// every shop has had the same elapsed time, so a value below the median means
// the shop is behind the chain at the same point in the week.
//
// Below-median items render prominently (with the median value to beat);
// at/above-median items fade into a small "Holding strong" footer so the eye
// lands on what actually needs work.

import { useEffect, useMemo, useState } from 'react';
import { Target, Phone, PhoneIncoming, ClipboardList, Handshake, Wrench, Cog, Repeat } from 'lucide-react';
import { SHOPS } from '@/lib/shops';
import { usd, num, pct } from '@/lib/format';

function formatMedian(key: string, v: number): string {
  if (key === 'awro') return usd(v);
  if (key === 'calls') return num(Math.round(v));
  // conversion / closeRate / partsGp / laborGp / returnCust are all 0..1
  return pct(v);
}

interface LiveKpi {
  shopNum: string;
  awro: number;
  closeRate: number;
  partsGpPct: number;
  laborGpPct: number;
  cars: number;
}

// Minimum sample sizes — anything below these means the metric is statistical
// noise, not an action item. A 0% close rate on 0 closed ROs is not a problem;
// it's an absence of data. A 0% call conversion on 0 calls is the same. We
// surface these as "Need more X" instead of putting bogus zeros into the
// weak-below-median action list.
const MIN_CALLS_FOR_CONVERSION = 5;     // <5 eligible calls → can't compute meaningfully
const MIN_TICKETS_FOR_GP = 3;            // <3 closed ROs → no AWRO/close-rate/GP signal

// A real auto-repair shop closing real tickets always has SOME parts and
// labor margin (typically 50-65% / 70-80%). An EXACT 0.000% reading means
// the substrate is missing — no parts sold, or no labor sold, or revenue
// not yet attributed. Treat exact-zero GP% as pending so the operator
// doesn't get "Parts GP 0%" screamed at them when it just means "ticket
// hasn't been invoiced yet."
function isPhantomGp(v: number | null | undefined): boolean {
  return v === 0 || v == null;
}

export default function HighestLeverageByShop() {
  const [conversion, setConversion] = useState<any[] | null>(null);
  const [returnCustomers, setReturnCustomers] = useState<any[] | null>(null);
  const [liveKpi, setLiveKpi] = useState<LiveKpi[]>([]);

  useEffect(() => {
    const safe = async <T,>(url: string): Promise<T | null> => {
      try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); } catch { return null; }
    };
    // WTD sources across the board so the chain-median comparison is "where
    // are you on pace this week?" rather than a 7-day trailing snapshot.
    safe<any>('/api/extras?view=booked-rate&wtd=1').then(d => {
      // Normalize bookedRatePct from 0..100 → 0..1 so it shares the same
      // scale as every other percentage in this component (closeRate,
      // partsGpPct, laborGpPct, returnWtdPct are all 0..1).
      const rows = (d?.shops || []).map((s: any) => ({
        ...s,
        bookedRatePct: typeof s.bookedRatePct === 'number' ? s.bookedRatePct / 100 : 0,
      }));
      setConversion(rows);
    });
    safe<any>('/api/extras?view=return-customers').then(d => setReturnCustomers(d?.shops || []));
    safe<any>('/api/metrics?range=this_week').then(d => {
      const lk: LiveKpi[] = [];
      for (const s of (d?.kpi?.byShop || [])) {
        lk.push({
          shopNum: s.shopNum,
          awro: s.awro ?? 0,
          closeRate: s.closeRate ?? 0,
          partsGpPct: s.partsGpPct ?? 0,
          laborGpPct: s.laborGpPct ?? 0,
          cars: s.cars ?? 0,
        });
      }
      setLiveKpi(lk);
    });
  }, []);

  const medianValues = useMemo(() => {
    const med = (arr: number[]) => {
      const xs = arr.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
      if (!xs.length) return 0;
      const m = Math.floor(xs.length / 2);
      return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
    };
    const conv = (conversion || []) as any[];
    // Conversion median only includes shops with enough calls — a 0% from a
    // shop with 0 eligible calls is noise, not a real conversion rate, and
    // would drag the median floor toward 0 misleadingly.
    const convQualified = conv.filter((x: any) => (x.eligible ?? 0) >= MIN_CALLS_FOR_CONVERSION);
    // Same logic for AWRO / close-rate / GP — exclude shops with too few
    // closed ROs. Also exclude phantom 0% GP rows (substrate missing — no
    // parts sold or not invoiced yet) from the medians on Parts/Labor GP,
    // so the chain median reflects shops that are actually transacting.
    const liveQualified = liveKpi.filter((x) => x.cars >= MIN_TICKETS_FOR_GP);
    const liveQualifiedAwro = liveQualified.filter((x) => !isPhantomGp(x.awro));
    const liveQualifiedPartsGp = liveQualified.filter((x) => !isPhantomGp(x.partsGpPct));
    const liveQualifiedLaborGp = liveQualified.filter((x) => !isPhantomGp(x.laborGpPct));
    const rc = (returnCustomers || []).filter((x: any) => !x.pending && typeof x.returnWtdPct === 'number');
    return {
      calls: med(conv.map((x: any) => x.eligible ?? 0)),
      conversion: med(convQualified.map((x: any) => x.bookedRatePct ?? 0)),
      awro: med(liveQualifiedAwro.map(x => x.awro)),
      closeRate: med(liveQualified.map(x => x.closeRate)),
      partsGp: med(liveQualifiedPartsGp.map(x => x.partsGpPct)),
      laborGp: med(liveQualifiedLaborGp.map(x => x.laborGpPct)),
      ret: med(rc.map((x: any) => x.returnWtdPct ?? 0)),
    };
  }, [conversion, liveKpi, returnCustomers]);

  type PendingReason = 'no-calls' | 'no-tickets' | 'awaiting' | null;
  function leafNodesFor(shopNum: string) {
    const live = liveKpi.find(x => x.shopNum === shopNum);
    const conv = ((conversion || []) as any[]).find((x: any) => x.shopNum === shopNum);
    const rc = (returnCustomers || []).find((x: any) => x.shopNum === shopNum);
    const rcReady = rc && !rc.pending && typeof rc.returnWtdPct === 'number';
    // Sample-size signals: which buckets of metrics can't be computed yet.
    // Even a "true" 0% close rate on 0 closed ROs isn't actionable feedback;
    // it just means we don't have the input data yet for the week.
    const eligibleCalls = conv?.eligible ?? null;
    const cars = live?.cars ?? null;
    const callsPending: PendingReason = eligibleCalls === null ? 'no-calls'
      : eligibleCalls < MIN_CALLS_FOR_CONVERSION ? 'no-calls' : null;
    const ticketsPending: PendingReason = cars === null ? 'no-tickets'
      : cars < MIN_TICKETS_FOR_GP ? 'no-tickets' : null;
    return [
      { key: 'calls',      Icon: Phone,         label: 'Calls',            value: conv?.eligible ?? null,        display: conv ? num(conv.eligible ?? 0) : '—',                    med: medianValues.calls,      pending: (eligibleCalls === null || eligibleCalls === 0) ? 'no-calls' as PendingReason : null },
      { key: 'conversion', Icon: PhoneIncoming, label: 'Call Conversion',  value: conv?.bookedRatePct ?? null,   display: callsPending ? '—' : (conv ? pct(conv.bookedRatePct ?? 0, 0) : '—'), med: medianValues.conversion, pending: callsPending },
      { key: 'awro',       Icon: ClipboardList, label: 'AWRO',             value: live?.awro ?? null,            display: ticketsPending || isPhantomGp(live?.awro) ? '—' : usd(live!.awro),    med: medianValues.awro,       pending: ticketsPending || isPhantomGp(live?.awro) ? (ticketsPending ?? 'no-tickets') : null },
      { key: 'closeRate',  Icon: Handshake,     label: 'Close Rate',       value: live?.closeRate ?? null,       display: ticketsPending ? '—' : (live ? pct(live.closeRate) : '—'),       med: medianValues.closeRate,  pending: ticketsPending },
      { key: 'partsGp',    Icon: Wrench,        label: 'Parts GP',         value: live?.partsGpPct ?? null,      display: ticketsPending || isPhantomGp(live?.partsGpPct) ? '—' : pct(live!.partsGpPct),      med: medianValues.partsGp,    pending: ticketsPending || isPhantomGp(live?.partsGpPct) ? (ticketsPending ?? 'no-tickets') : null },
      { key: 'laborGp',    Icon: Cog,           label: 'Labor GP',         value: live?.laborGpPct ?? null,      display: ticketsPending || isPhantomGp(live?.laborGpPct) ? '—' : pct(live!.laborGpPct),      med: medianValues.laborGp,    pending: ticketsPending || isPhantomGp(live?.laborGpPct) ? (ticketsPending ?? 'no-tickets') : null },
      { key: 'returnCust', Icon: Repeat,        label: 'Return Customers', value: rcReady ? rc.returnWtdPct : null, display: rcReady ? pct(rc.returnWtdPct) : '—',                 med: medianValues.ret,        pending: rcReady ? null : 'awaiting' as PendingReason },
    ] as Array<{ key: string; Icon: any; label: string; value: number | null; display: string; med: number; pending: PendingReason }>;
  }

  return (
    <div className="card mb-6">
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-mango-orange" />
          <h2 className="text-lg font-semibold">Highest Leverage — by Shop</h2>
        </div>
        <div className="text-[11px] text-mango-muted">Below company median = action item · At or above = holding strong</div>
      </div>
      <p className="text-xs text-mango-muted mb-4">
        Week-to-date (Mon → today MT). The seven upstream levers — Car Count and ARO are excluded because they're downstream (Car Count is driven by call conversion + prior re-books; ARO = AWRO × close rate). Every value is WTD so the company-median comparison is an on-pace check: every shop has had the same elapsed time, so below the median means behind the rest of the company at the same point in the week.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {SHOPS.map(s => {
          const leaves = leafNodesFor(s.num);
          const classify = (L: typeof leaves[number]) => {
            // Sample-size pending ALWAYS wins. A shop with 0 calls is not
            // "below median conversion at 0%" — that's noise dressed as a
            // verdict. Show it as pending so the operator gets a real signal.
            if (L.pending) return 'unknown' as const;
            const has = L.value !== null && Number.isFinite(L.value as number);
            if (!has || L.med <= 0) return 'unknown' as const;
            return (L.value as number) >= L.med ? 'strong' as const : 'weak' as const;
          };
          const weak    = leaves.filter(L => classify(L) === 'weak');
          const strong  = leaves.filter(L => classify(L) === 'strong');
          const unknown = leaves.filter(L => classify(L) === 'unknown');
          // Group pending leaves by reason so the footer copy is actionable:
          // "Need more calls" vs "Need more tickets closed" vs "Awaiting data".
          const pendNoCalls = unknown.filter(L => L.pending === 'no-calls');
          const pendNoTickets = unknown.filter(L => L.pending === 'no-tickets');
          const pendAwaiting = unknown.filter(L => L.pending === 'awaiting' || L.pending == null);
          return (
            <div key={s.num} className="rounded-lg border border-mango-line p-3 bg-white">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                <div className="font-semibold text-sm leading-tight">{s.name}</div>
              </div>

              {weak.length > 0 ? (
                <div className="space-y-1.5">
                  {weak.map(L => (
                    <div key={L.key} className="flex items-center gap-3 rounded-md px-2.5 py-2 bg-mango-red/8 border border-mango-red/25">
                      <L.Icon className="w-5 h-5 text-mango-red shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] uppercase tracking-wide text-mango-red/80 font-semibold leading-tight">{L.label}</div>
                        <div className="text-base font-bold tabular-nums leading-tight">{L.display}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] uppercase text-mango-muted leading-none">median</div>
                        <div className="text-xs font-medium tabular-nums text-mango-muted">{formatMedian(L.key, L.med)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-mango-green font-medium px-1 py-2">All levers at or above company median ✓</div>
              )}

              {strong.length > 0 && (
                <div className="mt-3 pt-3 border-t border-mango-line/60 opacity-55">
                  <div className="text-[10px] uppercase tracking-wide text-mango-muted mb-1.5">Holding strong</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {strong.map(L => (
                      <span key={L.key} className="inline-flex items-center gap-1 text-[11px] text-mango-ink/70">
                        <L.Icon className="w-3 h-3" />
                        {L.label} <span className="tabular-nums">{L.display}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {unknown.length > 0 && (
                <div className="mt-2 text-[10px] text-mango-muted italic space-y-0.5">
                  {pendNoCalls.length > 0 && (
                    <div>Need more calls: {pendNoCalls.map(L => L.label).join(', ')}</div>
                  )}
                  {pendNoTickets.length > 0 && (
                    <div>Need more tickets closed: {pendNoTickets.map(L => L.label).join(', ')}</div>
                  )}
                  {pendAwaiting.length > 0 && (
                    <div>Awaiting data: {pendAwaiting.map(L => L.label).join(', ')}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
