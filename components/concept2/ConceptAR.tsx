'use client';

// Shared luxury Accounts Receivable section — the FULL workbench (mode toggle
// total/over30/new, time-period selector, per-shop bars + single-shop filter,
// daily trend chart, collapsible sortable customer detail). Used by BOTH the
// Diagnostic and the Weekly Review so they're a single source of truth, exactly
// like production where both embed <AccountsReceivable/>.

import { useEffect, useState } from 'react';
import { SHOPS as SHOP_META } from '@/lib/shops';
import { Card, Dropdown, INK, INK2, FAINT, LINE, AMBER, usd, usdK, safe } from './kit';

const META = SHOP_META.map((s) => ({ num: s.num, name: s.name, color: s.color }));
const AR_MODES: [string, string][] = [['total', 'Total AR'], ['over30', 'Over 30 days'], ['new', 'New · 0–30']];
const AR_RANGES = [{ key: 'ytd', label: 'Year to Date' }, { key: 'this_month', label: 'This Month' }, { key: 'last_90', label: 'Last 90 Days' }, { key: 'last_30', label: 'Last 30 Days' }];
function arDates(range: string): { start: string; end: string } {
  const now = new Date(); const end = now.toISOString().slice(0, 10); const ymd = (d: Date) => d.toISOString().slice(0, 10);
  if (range === 'this_month') return { start: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), end };
  if (range === 'last_90') return { start: ymd(new Date(Date.now() - 90 * 864e5)), end };
  if (range === 'last_30') return { start: ymd(new Date(Date.now() - 30 * 864e5)), end };
  return { start: `${now.getFullYear()}-01-01`, end };
}
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
type ARSortKey = 'customerName' | 'shopName' | 'roNumber' | 'invoiceDate' | 'daysOverdue' | 'balance' | 'totalOwedByCustomer' | 'status';

export default function ConceptAR({ id = 'receivables', eyebrow = 'Accounts Receivable' }: { id?: string; eyebrow?: string }) {
  const [mode, setMode] = useState('total');
  const [range, setRange] = useState('ytd');
  const [shopSel, setShopSel] = useState('all');
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<ARSortKey>('balance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showDetail, setShowDetail] = useState(false);
  useEffect(() => { let alive = true; setLoading(true); const { start, end } = arDates(range); const q = new URLSearchParams({ view: 'ar', mode, start, end }); safe<any>(`/api/exec-metrics?${q}`).then((d) => { if (!alive) return; setData(d?.summary ? d : null); setLoading(false); }); return () => { alive = false; }; }, [mode, range]);
  const byShopRaw = (data?.summary?.byShop ?? []).map((b: any) => { const meta = META.find((m) => m.num === b.shopNum); return { num: b.shopNum, name: meta?.name || b.shopName, color: meta?.color || FAINT, amount: b.amount || 0, count: b.count || 0 }; }).sort((a: any, b: any) => b.amount - a.amount);
  const max = Math.max(1, ...byShopRaw.map((b: any) => b.amount));
  const selShop = shopSel === 'all' ? null : byShopRaw.find((b: any) => b.num === shopSel);
  const selTotal = shopSel === 'all' ? (data?.summary?.total ?? 0) : (selShop?.amount ?? 0);
  const trend = ((data?.trend?.real ?? []) as any[]).map((p) => ({ date: p.date, y: p[mode] || 0 }));
  const customers: any[] = (data?.customers ?? []).filter((c: any) => shopSel === 'all' || c.shopNum === shopSel);
  const selCount = customers.length;
  const sorted = [...customers].sort((a, b) => { const av = a[sortKey], bv = b[sortKey]; let c: number; if (sortKey === 'invoiceDate') c = new Date(av).getTime() - new Date(bv).getTime(); else if (typeof av === 'number') c = av - bv; else c = String(av).localeCompare(String(bv)); return sortDir === 'asc' ? c : -c; });
  const toggle = (k: ARSortKey) => { if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSortKey(k); setSortDir(k === 'customerName' || k === 'shopName' || k === 'status' ? 'asc' : 'desc'); } };
  const modeLabel = AR_MODES.find((m) => m[0] === mode)![1];
  const right = (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <div className="inline-flex rounded-full p-1" style={{ background: 'rgba(34,32,28,0.05)', border: `1px solid ${LINE}` }}>
        {AR_MODES.map(([k, label]) => <button key={k} onClick={() => setMode(k)} className="c2ui rounded-full px-3 py-1 text-[13px] font-semibold transition" style={mode === k ? { background: '#fff', color: INK, boxShadow: '0 1px 4px rgba(40,34,26,0.12)' } : { color: INK2 }}>{label}</button>)}
      </div>
      <Dropdown value={shopSel} onChange={setShopSel} opts={[{ key: 'all', label: 'All Shops' }, ...META.map((m) => ({ key: m.num, label: m.name }))]} />
    </div>
  );
  const W = 900, H = 300, padL = 52, padR = 10, padT = 16, padB = 26;
  const ys = trend.map((p) => p.y); const tmin = Math.min(...ys, 0), tmax = Math.max(...ys, 1);
  const xAt = (i: number) => padL + (trend.length <= 1 ? 0 : (i / (trend.length - 1)) * (W - padL - padR));
  const yAt = (v: number) => padT + (1 - (v - tmin) / (tmax - tmin || 1)) * (H - padT - padB);
  const line = trend.map((p, i) => (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(p.y).toFixed(1)).join(' ');
  const labelStep = Math.max(1, Math.ceil(trend.length / 6));
  const visibleBars = shopSel === 'all' ? byShopRaw : byShopRaw.filter((b: any) => b.num === shopSel);
  return (
    <Card id={id} eyebrow={eyebrow} title="Outstanding" right={right}>
      {loading ? <div className="c2ui text-[13px] py-4" style={{ color: INK2 }}>Loading…</div> : !byShopRaw.length ? <div className="c2ui text-[13px] py-4" style={{ color: INK2 }}>Accounts-receivable data is warming up.</div> : (<>
        <div className="mb-5">
          <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: FAINT }}>{modeLabel} · {shopSel === 'all' ? 'all shops' : (selShop?.name ?? '')}</div>
          <div className="c2disp tabular-nums leading-none mt-1" style={{ color: INK, fontSize: 40, letterSpacing: '-0.02em' }}>{usd(selTotal)}</div>
          <div className="c2ui text-[13px] mt-1.5" style={{ color: INK2 }}>{selCount} invoice{selCount === 1 ? '' : 's'}{shopSel === 'all' ? ` · ${byShopRaw.length} shops` : ''}</div>
        </div>
        <div className="space-y-3">
          {visibleBars.map((b: any) => (
            <button key={b.num} onClick={() => setShopSel(shopSel === b.num ? 'all' : b.num)} className="w-full flex items-center gap-4 text-left">
              <div className="c2ui w-28 shrink-0 text-[13px] font-medium flex items-center gap-2" style={{ color: INK }}><span className="inline-block w-2 h-2 rounded-full" style={{ background: b.color }} />{b.name}</div>
              <div className="flex-1 h-7 rounded-lg overflow-hidden" style={{ background: 'rgba(34,32,28,0.04)' }}><div className="h-full rounded-lg" style={{ width: `${Math.max(2, (b.amount / max) * 100)}%`, background: `linear-gradient(90deg, ${b.color}66, ${b.color}cc)` }} /></div>
              <div className="c2disp tabular-nums w-20 text-right" style={{ color: INK, fontSize: 16 }}>{usdK(b.amount)}</div>
            </button>
          ))}
        </div>
        <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${LINE}` }}>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-wide" style={{ color: FAINT }}>{modeLabel} · daily trend</div>
            <Dropdown value={range} onChange={setRange} opts={AR_RANGES} />
          </div>
          {shopSel !== 'all' && <div className="c2ui text-[12.5px] mb-2" style={{ color: INK2 }}>Daily A/R snapshots are captured company-wide only — the trend below is all shops; the total, bars and customer list above are {selShop?.name ?? 'this shop'}.</div>}
          {trend.length < 2 ? (
            <div className="c2ui text-[13px] py-6 text-center" style={{ color: INK2 }}>Only one A/R snapshot so far in this window — a new point is captured each day after close.</div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto', display: 'block' }} preserveAspectRatio="xMidYMid meet">
              <defs><linearGradient id="c2ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(232,134,62,0.30)" /><stop offset="60%" stopColor="rgba(242,206,112,0.12)" /><stop offset="100%" stopColor="rgba(232,134,62,0.02)" /></linearGradient></defs>
              {[0, 0.5, 1].map((f) => { const y = padT + f * (H - padT - padB); const v = tmax - f * (tmax - tmin); return (<g key={f}><line x1={padL} x2={W - padR} y1={y} y2={y} stroke="rgba(34,32,28,0.06)" strokeWidth={1} /><text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill={FAINT}>{usdK(v)}</text></g>); })}
              <path d={`${line} L ${xAt(trend.length - 1).toFixed(1)} ${(H - padB).toFixed(1)} L ${xAt(0).toFixed(1)} ${(H - padB).toFixed(1)} Z`} fill="url(#c2ar)" />
              <path d={line} fill="none" stroke="#E8863E" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              {trend.map((p, i) => (i % labelStep === 0 || i === trend.length - 1) ? <text key={i} x={xAt(i)} y={H - 4} textAnchor="middle" fontSize="9" fill={FAINT}>{new Date(p.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</text> : null)}
            </svg>
          )}
        </div>
        <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${LINE}` }}>
          <button onClick={() => setShowDetail((v) => !v)} className="w-full flex items-center justify-between gap-2 mb-2 text-left">
            <span className="c2ui text-[12.5px] font-semibold uppercase tracking-wide" style={{ color: FAINT }}>Customer detail · {customers.length} invoices{shopSel !== 'all' ? ` · ${selShop?.name ?? ''}` : ''}</span>
            <span className="c2ui inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: INK2 }}>{showDetail ? 'Hide' : 'Show'}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={INK2} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showDetail ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}><path d="M6 9l6 6 6-6" /></svg></span>
          </button>
          {showDetail && (
          <div className="overflow-auto rounded-2xl" style={{ maxHeight: 420, border: `1px solid ${LINE}` }}>
            <table className="w-full c2ui text-[12.5px]">
              <thead className="sticky top-0" style={{ background: 'rgba(247,244,238,0.95)' }}>
                <tr style={{ color: FAINT }}>
                  {([['customerName', 'Customer', 'left'], ['shopName', 'Shop', 'left'], ['roNumber', 'RO #', 'left'], ['invoiceDate', 'Invoice', 'left'], ['daysOverdue', 'Days', 'right'], ['balance', 'Balance', 'right'], ['totalOwedByCustomer', 'Total Owed', 'right'], ['status', 'Status', 'left']] as [ARSortKey, string, 'left' | 'right'][]).map(([k, label, al]) => (
                    <th key={k} onClick={() => toggle(k)} className={`px-3 py-2 font-semibold uppercase tracking-wide text-[12.5px] cursor-pointer select-none ${al === 'right' ? 'text-right' : 'text-left'}`}>{label}<span className="ml-1" style={{ color: AMBER }}>{sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((c, i) => (
                  <tr key={`${c.roNumber}-${i}`} style={{ background: i % 2 ? 'rgba(255,255,255,0.4)' : 'transparent', borderTop: `1px solid ${LINE}` }}>
                    <td className="px-3 py-2 font-medium" style={{ color: INK }}>{c.customerName}</td>
                    <td className="px-3 py-2" style={{ color: INK2 }}>{c.shopName}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: INK2 }}>{c.roNumber}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: INK2 }}>{fmtDate(c.invoiceDate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: c.daysOverdue > 30 ? '#C05A2E' : c.daysOverdue < 7 ? '#3E8E5E' : INK }}>{c.daysOverdue}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: INK }}>{usd(c.balance)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: INK2 }}>{usd(c.totalOwedByCustomer)}</td>
                    <td className="px-3 py-2" style={{ color: INK2 }}>{c.status}</td>
                  </tr>
                ))}
                {!customers.length && <tr><td colSpan={8} className="px-3 py-8 text-center c2ui" style={{ color: INK2 }}>No AR in this view.</td></tr>}
              </tbody>
            </table>
          </div>
          )}
        </div>
      </>)}
    </Card>
  );
}
