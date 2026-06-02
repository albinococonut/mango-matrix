'use client';

// Accounts Receivable — executive only. One section, three toggle views that
// share an identical structure: Past Due >30 · New (<7d) · Total AR. Each view
// shows the chain total, AR by shop, a trend chart (real nightly snapshots +
// an approximate reconstruction), and the full customer AR table (highest owed
// → lowest). Premium card system, restrained colours, zebra + sticky header.

import { useEffect, useMemo, useState } from 'react';
import { Landmark, AlertTriangle, Clock, Layers } from 'lucide-react';
import { format } from 'date-fns';
import { usd } from '@/lib/format';
import LineChartBlock from '@/components/charts/LineChartBlock';

type Mode = 'over30' | 'new' | 'total';
const MODES: { key: Mode; label: string; icon: any; tone: string }[] = [
  { key: 'over30', label: 'Past Due >30 Days', icon: AlertTriangle, tone: '#C9412A' },
  { key: 'new', label: 'New (<7 days)', icon: Clock, tone: '#19A268' },
  { key: 'total', label: 'Total AR', icon: Layers, tone: '#3B82F6' },
];

type RangeKey = 'ytd' | 'this_month' | 'last_90' | 'last_30' | 'custom';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'ytd', label: 'Year to Date' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_90', label: 'Last 90 Days' },
  { key: 'last_30', label: 'Last 30 Days' },
  { key: 'custom', label: 'Custom' },
];

interface Customer {
  customerId: number; customerName: string; shopNum: string; shopName: string;
  roNumber: number; invoiceDate: string; daysOverdue: number;
  balance: number; totalOwedByCustomer: number; status: string; aged?: boolean;
}
interface Payload {
  mode: Mode; asOf: string; agedTotal?: number;
  summary: { total: number; count: number; byShop: { shopNum: string; shopName: string; amount: number; count: number }[] };
  customers: Customer[];
  trend: {
    real: { date: string; total: number; over30: number; new: number }[];
    points: number; firstSnapshot: string;
  };
  note: string;
}

function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function rangeToDates(r: RangeKey, cs: string, ce: string): { start: string; end: string } {
  const now = new Date();
  const end = ymd(now);
  if (r === 'custom') return { start: cs, end: ce };
  if (r === 'this_month') return { start: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), end };
  if (r === 'last_90') return { start: ymd(new Date(Date.now() - 90 * 864e5)), end };
  if (r === 'last_30') return { start: ymd(new Date(Date.now() - 30 * 864e5)), end };
  return { start: `${now.getFullYear()}-01-01`, end }; // ytd
}

export default function AccountsReceivable() {
  const [mode, setMode] = useState<Mode>('total');
  const [range, setRange] = useState<RangeKey>('ytd');
  const [cs, setCs] = useState('');
  const [ce, setCe] = useState('');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [sortKey, setSortKey] = useState<keyof Customer>('balance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { start, end } = useMemo(() => rangeToDates(range, cs, ce), [range, cs, ce]);

  const sortedCustomers = useMemo(() => {
    const rows = [...(data?.customers || [])];
    rows.sort((a, b) => {
      const av = a[sortKey] as any, bv = b[sortKey] as any;
      let c: number;
      if (sortKey === 'invoiceDate') c = new Date(av).getTime() - new Date(bv).getTime();
      else if (typeof av === 'number') c = av - bv;
      else c = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? c : -c;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  function toggleSort(k: keyof Customer) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'customerName' || k === 'shopName' || k === 'status' ? 'asc' : 'desc'); }
  }

  useEffect(() => {
    if (range === 'custom' && (!cs || !ce)) return;
    setLoading(true); setErr(false);
    const q = new URLSearchParams({ view: 'ar', mode, start, end });
    fetch(`/api/exec-metrics?${q}`)
      .then((r) => r.json())
      .then((d) => { if (d?.summary) setData(d); else setErr(true); })
      .catch(() => setErr(true))
      .finally(() => setLoading(false));
  }, [mode, range, start, end, cs, ce]);

  const active = MODES.find((m) => m.key === mode)!;
  const maxShop = data ? Math.max(1, ...data.summary.byShop.map((s) => s.amount)) : 1;

  const series = data ? [
    {
      key: 'real', label: 'Captured daily', color: active.tone,
      data: data.trend.real.map((p) => ({ x: p.date, y: (p as any)[mode] })),
    },
  ] : [];
  const onePoint = !!data && data.trend.real.length < 2;

  return (
    <div data-fs-section className="card mb-6 relative">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Landmark className="w-5 h-5 text-mango-info" />
          <h2 className="text-lg font-semibold">Accounts Receivable</h2>
        </div>
        {data && <span className="text-[11px] text-mango-muted">as of {data.asOf}</span>}
      </div>

      {/* Mode toggle */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {MODES.map((m) => {
          const on = mode === m.key;
          return (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                on ? 'text-white' : 'bg-mango-bg text-mango-ink hover:bg-mango-line'
              }`}
              style={on ? { background: m.tone } : undefined}
            >
              <m.icon className="w-3.5 h-3.5" /> {m.label}
            </button>
          );
        })}
      </div>

      {loading && <div className="mt-4 h-[320px] animate-pulse rounded-xl bg-mango-bg" />}
      {err && !loading && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-mango-ink/80">
          AR is still warming up (it builds from the year-to-date invoice window on first load). Refresh in a moment.
        </div>
      )}

      {!loading && !err && data && (
        <div className="mt-4 space-y-5">
          {/* Headline + by-shop */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-mango-line p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-mango-muted">
                {active.label} · all shops
              </div>
              <div className="mt-1 text-4xl font-bold tracking-tight" style={{ color: active.tone }}>
                {usd(data.summary.total)}
              </div>
              <div className="mt-1 text-[12px] text-mango-muted">
                {data.summary.count} invoice{data.summary.count === 1 ? '' : 's'} · {data.summary.byShop.length} shops
              </div>
              {!!data.agedTotal && data.agedTotal > 0 && (
                <div className="mt-1 text-[12px] font-medium text-mango-amber">
                  incl. {usd(data.agedTotal)} legacy / aged (&gt;12 months old)
                </div>
              )}
            </div>
            <div className="lg:col-span-2 rounded-xl border border-mango-line p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-mango-muted mb-2">AR by shop</div>
              <div className="space-y-1.5">
                {data.summary.byShop.map((s) => (
                  <div key={s.shopNum} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-[13px]">{s.shopName}</span>
                    <div className="relative h-5 flex-1 overflow-hidden rounded bg-mango-bg">
                      <div className="h-full rounded" style={{ width: `${(s.amount / maxShop) * 100}%`, background: active.tone, opacity: 0.85 }} />
                    </div>
                    <span className="w-24 shrink-0 text-right text-[13px] font-semibold tabular-nums">{usd(s.amount)}</span>
                    <span className="w-10 shrink-0 text-right text-[11px] text-mango-muted tabular-nums">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Trend */}
          <div className="rounded-xl border border-mango-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-mango-muted">
                {active.label} — trend
              </div>
              <div className="flex flex-wrap gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${
                      range === r.key ? 'bg-mango-ink text-white' : 'bg-mango-bg text-mango-ink hover:bg-mango-line'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {range === 'custom' && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                <input type="date" value={cs} onChange={(e) => setCs(e.target.value)} className="rounded-lg border border-mango-line px-2 py-1.5" />
                <span className="text-mango-muted">→</span>
                <input type="date" value={ce} onChange={(e) => setCe(e.target.value)} className="rounded-lg border border-mango-line px-2 py-1.5" />
              </div>
            )}
            <div className="relative mt-3">
              <LineChartBlock height={260} series={series} showDots />
              {onePoint && (
                <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-[12px] text-mango-muted">
                  Tracking starts today — one snapshot so far. A new point is added each day after close.
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-mango-muted">
              Past AR can’t be known (Tekmetric only reports AR as of now), so this isn’t reconstructed. It’s built from real snapshots captured once daily after close — {data.trend.points} point{data.trend.points === 1 ? '' : 's'} so far (since {data.trend.firstSnapshot}), growing by one each day.
            </p>
          </div>

          {/* Customer detail — sortable table on tablet/desktop, stacked
              cards on mobile (no horizontal scroll). Footer total reconciles
              exactly to the "AR by shop" / headline figure above. */}
          <div className="rounded-xl border border-mango-line">
            <div className="border-b border-mango-line px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-mango-muted">
                Customer detail ({data.customers.length})
              </span>
              {/* Mobile sort control (column headers are hidden < md) */}
              <select
                value={`${sortKey}:${sortDir}`}
                onChange={(e) => { const [k, d] = e.target.value.split(':'); setSortKey(k as keyof Customer); setSortDir(d as 'asc' | 'desc'); }}
                className="md:hidden text-[12px] rounded-lg border border-mango-line bg-white px-2 py-2 min-h-[40px]"
              >
                <option value="balance:desc">Balance ↓</option>
                <option value="balance:asc">Balance ↑</option>
                <option value="daysOverdue:desc">Days overdue ↓</option>
                <option value="totalOwedByCustomer:desc">Total owed ↓</option>
                <option value="customerName:asc">Customer A–Z</option>
                <option value="shopName:asc">Shop A–Z</option>
              </select>
              <span className="hidden md:block text-[11px] text-mango-faint">click a column to sort</span>
            </div>

            {/* Mobile: stacked cards */}
            <div className="md:hidden divide-y divide-mango-line max-h-[520px] overflow-y-auto">
              {sortedCustomers.map((c, i) => (
                <div key={`${c.roNumber}-${i}`} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-mango-ink truncate">
                        {c.customerName}
                        {c.aged && <span className="ml-1.5 align-middle rounded px-1.5 py-0.5 text-[10px] font-semibold bg-mango-amber/15 text-mango-amber">LEGACY</span>}
                      </div>
                      <div className="text-[12px] text-mango-muted">{c.shopName} · RO {c.roNumber}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold tabular-nums" style={{ color: active.tone }}>{usd(c.balance)}</div>
                      <div className={`text-[12px] tabular-nums ${c.daysOverdue > 30 ? 'text-mango-red' : c.daysOverdue < 7 ? 'text-mango-green' : 'text-mango-muted'}`}>
                        {c.daysOverdue}d overdue
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-mango-faint tabular-nums">
                    <span>{format(new Date(c.invoiceDate), 'MMM d, yyyy')}</span>
                    <span>Total owed {usd(c.totalOwedByCustomer)}</span>
                  </div>
                </div>
              ))}
              {data.customers.length === 0 && (
                <div className="px-4 py-8 text-center text-mango-muted text-[13px]">No AR in this view.</div>
              )}
              {data.customers.length > 0 && (
                <div className="px-4 py-3 flex items-center justify-between text-[13px] font-semibold bg-mango-bg/40">
                  <span>Total · {active.label}</span>
                  <span className="tabular-nums" style={{ color: active.tone }}>{usd(data.summary.total)}</span>
                </div>
              )}
            </div>

            {/* Tablet / desktop: full sortable table */}
            <div className="hidden md:block max-h-[460px] overflow-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#E6E8EC]">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-mango-muted">
                    {([
                      ['customerName', 'Customer', 'left'],
                      ['shopName', 'Shop', 'left'],
                      ['roNumber', 'RO #', 'left'],
                      ['invoiceDate', 'Invoice', 'left'],
                      ['daysOverdue', 'Days', 'right'],
                      ['balance', 'Balance', 'right'],
                      ['totalOwedByCustomer', 'Total Owed', 'right'],
                      ['status', 'Status', 'left'],
                    ] as [keyof Customer, string, 'left' | 'right'][]).map(([k, label, align]) => (
                      <th
                        key={k}
                        onClick={() => toggleSort(k)}
                        className={`px-3 py-2 font-semibold cursor-pointer select-none hover:text-mango-ink ${align === 'right' ? 'text-right' : ''}`}
                      >
                        {label}<span className="ml-1 text-mango-info">{sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedCustomers.map((c, i) => (
                    <tr key={`${c.roNumber}-${i}`} className={i % 2 ? 'bg-mango-bg/50' : 'bg-white'}>
                      <td className="px-3 py-2 font-medium text-mango-ink">{c.customerName}</td>
                      <td className="px-3 py-2 text-mango-muted">{c.shopName}</td>
                      <td className="px-3 py-2 tabular-nums text-mango-muted">{c.roNumber}</td>
                      <td className="px-3 py-2 tabular-nums text-mango-muted">{format(new Date(c.invoiceDate), 'MMM d, yyyy')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={c.daysOverdue > 30 ? 'font-semibold text-mango-red' : c.daysOverdue < 7 ? 'text-mango-green' : 'text-mango-ink'}>
                          {c.daysOverdue}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{usd(c.balance)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-mango-muted">{usd(c.totalOwedByCustomer)}</td>
                      <td className="px-3 py-2 text-[12px] text-mango-muted">{c.status}</td>
                    </tr>
                  ))}
                  {data.customers.length === 0 && (
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-mango-muted">No AR in this view.</td></tr>
                  )}
                </tbody>
                {data.customers.length > 0 && (
                  <tfoot className="sticky bottom-0 bg-white shadow-[0_-1px_0_#E6E8EC]">
                    <tr className="text-[13px] font-semibold">
                      <td className="px-3 py-2" colSpan={5}>Total · {active.label} ({data.customers.length} invoices)</td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: active.tone }}>{usd(data.summary.total)}</td>
                      <td className="px-3 py-2" colSpan={2}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="border-t border-mango-line px-4 py-2 text-[11px] text-mango-muted">
              This total ties exactly to “{active.label} · all shops” and the AR-by-shop bars above.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
