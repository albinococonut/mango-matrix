'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, ReferenceLine,
} from 'recharts';
import {
  Card, INK, INK2, FAINT, LINE, AMBER, GOOD, usdK, safe,
} from './kit';
import { SHOPS } from '@/lib/shops';
import type { PostcardCampaign } from '@/lib/marketingSpend';

// ── types ──────────────────────────────────────────────────────────────────

interface MonthSpend { googleAds: number; advertising: number; listing: number }
interface NewCustRow  { shopNum: string; month: string; newCustomers: number }

interface Payload {
  spend: Record<string, Record<string, MonthSpend>>;
  postcardCampaigns: PostcardCampaign[];
  months: string[];
  newCustomers: NewCustRow[];
  newCustomersReady: boolean;
  computedAt: string;
  stale?: boolean;
}

// ── helpers ────────────────────────────────────────────────────────────────

const SHOP_COLORS: Record<string, string> = Object.fromEntries(
  SHOPS.map(s => [s.num, s.color])
);
const SHOPS_WITH_MARKETING = ['001', '002', '003', '005', '006', '007', '009'];

function fmtMonth(m: string) {
  const [y, mo] = m.split('-');
  return new Date(+y, +mo - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
}

function buildSpendRows(
  months: string[],
  spend: Record<string, Record<string, MonthSpend>>,
  shopFilter: string,
): { month: string; label: string; googleAds: number; advertising: number; listing: number; total: number }[] {
  return months.map(m => {
    let ga = 0, adv = 0, lst = 0;
    const shops = shopFilter === 'all' ? SHOPS_WITH_MARKETING : [shopFilter];
    for (const num of shops) {
      const d = spend[num]?.[m];
      if (d) { ga += d.googleAds; adv += d.advertising; lst += d.listing; }
    }
    return { month: m, label: fmtMonth(m), googleAds: ga, advertising: adv, listing: lst, total: ga + adv + lst };
  });
}

function buildNewCustRows(
  months: string[],
  newCustomers: NewCustRow[],
  shopFilter: string,
): Array<{ month: string; label: string; [k: string]: number | string }> {
  const byMonthShop = new Map<string, Map<string, number>>();
  for (const row of newCustomers) {
    if (shopFilter !== 'all' && row.shopNum !== shopFilter) continue;
    if (!byMonthShop.has(row.month)) byMonthShop.set(row.month, new Map());
    byMonthShop.get(row.month)!.set(row.shopNum, row.newCustomers);
  }
  return months.map(m => {
    const shopMap = byMonthShop.get(m) ?? new Map();
    const row: { month: string; label: string; [k: string]: number | string } = { month: m, label: fmtMonth(m) };
    if (shopFilter === 'all') {
      let total = 0;
      for (const num of SHOPS_WITH_MARKETING) {
        const v = shopMap.get(num) ?? 0;
        row[num] = v;
        total += v;
      }
      row.total = total;
    } else {
      row.newCustomers = shopMap.get(shopFilter) ?? 0;
    }
    return row;
  });
}

// ── tooltip components ─────────────────────────────────────────────────────

function SpendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value ?? 0), 0);
  return (
    <div style={{ background: 'rgba(255,255,255,0.97)', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px', minWidth: 160 }}>
      <div style={{ color: INK, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {[...payload].reverse().map((p: any) => (
        <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: INK2, fontSize: 13 }}>
          <span style={{ color: p.fill }}>{p.name}</span>
          <span style={{ fontWeight: 600 }}>{usdK(p.value)}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, borderTop: `1px solid ${LINE}`, marginTop: 6, paddingTop: 6, fontWeight: 700, fontSize: 13, color: INK }}>
        <span>Total</span><span>{usdK(total)}</span>
      </div>
    </div>
  );
}

function NewCustTooltip({ active, payload, label, shopFilter }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value ?? 0), 0);
  return (
    <div style={{ background: 'rgba(255,255,255,0.97)', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px', minWidth: 160 }}>
      <div style={{ color: INK, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {shopFilter === 'all' ? (
        <>
          {[...payload].reverse().map((p: any) => (
            <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: INK2, fontSize: 13 }}>
              <span style={{ color: p.fill }}>{SHOPS.find(s => s.num === p.dataKey)?.name ?? p.dataKey}</span>
              <span style={{ fontWeight: 600 }}>{p.value}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, borderTop: `1px solid ${LINE}`, marginTop: 6, paddingTop: 6, fontWeight: 700, fontSize: 13, color: INK }}>
            <span>Chain</span><span>{total}</span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: INK2 }}>
          New customers: <strong style={{ color: INK }}>{payload[0]?.value ?? 0}</strong>
        </div>
      )}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export default function MarketingDashboard() {
  const [data, setData]         = useState<Payload | null>(null);
  const [loading, setLoading]   = useState(true);
  const [shopFilter, setShop]   = useState('all');
  const [windowMonths, setWin]  = useState(18);

  useEffect(() => {
    safe<Payload>('/api/marketing').then(d => { if (d) setData(d); setLoading(false); });
  }, []);

  const visibleMonths = useMemo(() => {
    if (!data) return [];
    const all = data.months;
    return windowMonths === 0 ? all : all.slice(-windowMonths);
  }, [data, windowMonths]);

  const spendRows   = useMemo(() => data ? buildSpendRows(visibleMonths, data.spend, shopFilter) : [], [data, visibleMonths, shopFilter]);
  const newCustRows = useMemo(() => data ? buildNewCustRows(visibleMonths, data.newCustomers, shopFilter) : [], [data, visibleMonths, shopFilter]);

  // Postcard campaigns that land within visible months
  const postcardMarkers = useMemo(() => {
    if (!data) return [];
    const first = visibleMonths[0];
    const last  = visibleMonths[visibleMonths.length - 1];
    return data.postcardCampaigns.filter(c => {
      const month = c.inHomeStart.slice(0, 7);
      return month >= first && month <= last;
    });
  }, [data, visibleMonths]);

  // Cost per new customer by month (chain-wide)
  const cac = useMemo(() => {
    return spendRows.map((sr, i) => {
      const nc = newCustRows[i];
      const newC = shopFilter === 'all' ? (nc?.total as number ?? 0) : (nc?.newCustomers as number ?? 0);
      const cost = sr.total;
      return { month: sr.month, label: sr.label, cac: newC > 0 ? Math.round(cost / newC) : null };
    });
  }, [spendRows, newCustRows, shopFilter]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: FAINT }}>
      Loading marketing data…
    </div>
  );
  if (!data) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: '#C05A2E' }}>
      Marketing data unavailable
    </div>
  );

  const shopOpts = [
    { key: 'all', label: 'All Shops' },
    ...SHOPS.filter(s => SHOPS_WITH_MARKETING.includes(s.num)).map(s => ({ key: s.num, label: `${s.num} · ${s.name}` })),
  ];

  const windowOpts = [
    { key: 12, label: '12 months' },
    { key: 18, label: '18 months' },
    { key: 24, label: '24 months' },
    { key: 0,  label: 'All time' },
  ];

  const filterBar = (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={shopFilter} onChange={e => setShop(e.target.value)}
        style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '5px 10px', fontSize: 13, color: INK, background: 'rgba(255,255,255,0.85)' }}>
        {shopOpts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <select value={windowMonths} onChange={e => setWin(+e.target.value)}
        style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '5px 10px', fontSize: 13, color: INK, background: 'rgba(255,255,255,0.85)' }}>
        {windowOpts.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      {data.stale && <span style={{ fontSize: 12, color: FAINT }}>stale cache</span>}
    </div>
  );

  // ── new customers chart ──────────────────────────────────────────────────
  const newCustChart = (
    <Card id="new-customers" eyebrow="Acquisition" title="New Customers per Month"
      sub={shopFilter === 'all' ? 'Chain-wide, stacked by shop — new to each location' : `Shop ${shopFilter} only`}
      right={filterBar}>
      {data.newCustomers.length === 0 ? (
        <div style={{ color: FAINT, textAlign: 'center', padding: '40px 0' }}>
          New customer data is being computed — check back in a few minutes.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          {shopFilter === 'all' ? (
            <BarChart data={newCustRows} barSize={14} maxBarSize={22}>
              <CartesianGrid vertical={false} stroke={LINE} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
              <Tooltip content={<NewCustTooltip shopFilter={shopFilter} />} />
              {SHOPS_WITH_MARKETING.map(num => (
                <Bar key={num} dataKey={num} stackId="a" fill={SHOP_COLORS[num]} name={num} radius={num === '001' ? [3, 3, 0, 0] : undefined} />
              ))}
            </BarChart>
          ) : (
            <BarChart data={newCustRows} barSize={20}>
              <CartesianGrid vertical={false} stroke={LINE} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
              <Tooltip content={<NewCustTooltip shopFilter={shopFilter} />} />
              <Bar dataKey="newCustomers" fill={SHOP_COLORS[shopFilter] ?? AMBER} radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </Card>
  );

  // ── spend chart ──────────────────────────────────────────────────────────
  const spendChart = (
    <Card id="spend" eyebrow="Spend" title="Marketing Spend by Category"
      sub="Google Ads (6814) · Postcards & Other Advertising (6819) · Listing Fees (6812)">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={spendRows} barSize={14} maxBarSize={22}>
          <CartesianGrid vertical={false} stroke={LINE} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={usdK} tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
          <Tooltip content={<SpendTooltip />} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: INK2 }} />
          <Bar dataKey="googleAds"   name="Google Ads"           stackId="a" fill="#4A90D9" />
          <Bar dataKey="advertising" name="Postcards & Adv"      stackId="a" fill={AMBER} />
          <Bar dataKey="listing"     name="Listing Fees"         stackId="a" fill="#9B7BE0" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );

  // ── postcard timeline ────────────────────────────────────────────────────
  const postcardCard = (
    <Card id="postcards" eyebrow="Direct Mail" title="Postcard Campaigns"
      sub="UpSwell in-home dates — pieces delivered to mailboxes">
      {postcardMarkers.length === 0 ? (
        <div style={{ color: FAINT, padding: '20px 0' }}>No postcard campaigns in this window.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {postcardMarkers.map((c, i) => {
            const pct = Math.min(100, Math.round((c.pieces / 65000) * 100));
            return (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: INK, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span style={{ color: INK2 }}>
                    {c.pieces.toLocaleString()} pieces · in-home {c.inHomeStart}{c.inHomeEnd && c.inHomeEnd !== c.inHomeStart ? ` – ${c.inHomeEnd}` : ''}
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: LINE }}>
                  <div style={{ height: 8, borderRadius: 4, width: `${pct}%`, background: AMBER }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );

  // ── cost per new customer ────────────────────────────────────────────────
  const cacCard = (
    <Card id="attribution" eyebrow="Attribution (Phase 1)" title="Cost per New Customer"
      sub="Total marketing spend ÷ new customers — chain-wide or per shop">
      {data.newCustomers.length === 0 ? (
        <div style={{ color: FAINT, padding: '20px 0' }}>Computing new customer data…</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={cac.filter(r => r.cac !== null && r.cac < 5000)} barSize={16}>
            <CartesianGrid vertical={false} stroke={LINE} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => `$${v}`} tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v: any) => [`$${v}`, 'CAC']} />
            <Bar dataKey="cac" name="Cost / new customer" fill={GOOD} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
      <p style={{ fontSize: 12, color: FAINT, marginTop: 12 }}>
        Phase 2 will separate Google Ads vs. postcard attribution using a distributed lag model
        and link each Google Ads call to its resulting RO via WhatConverts.
      </p>
    </Card>
  );

  return (
    <div>
      {newCustChart}
      {spendChart}
      {postcardCard}
      {cacCard}
    </div>
  );
}
