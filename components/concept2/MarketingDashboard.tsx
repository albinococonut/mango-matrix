'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Cell, ReferenceLine,
} from 'recharts';
import {
  Card, Dropdown, Tabs, INK, INK2, FAINT, LINE, AMBER, GOOD, usdK, safe,
  PERIOD_RANGES, type PeriodRangeKey,
} from './kit';
import LineChartBlock from '@/components/charts/LineChartBlock';
import { SHOPS } from '@/lib/shops';
// ── types ──────────────────────────────────────────────────────────────────

interface MonthSpend { googleAds: number; advertising: number; listing: number; seo?: number }
interface NewCustRow  { shopNum: string; month: string; newCustomers: number }

interface ChannelData { customers: number; revenue: number }
interface AttributionSummaryRow {
  shopNum: string;
  month: string;
  google_ads: ChannelData;
  direct_mail: ChannelData;
  other: ChannelData;
}
interface MatchedCaller {
  shopNum: string;
  callMonth: string;
  channel: 'google_ads' | 'direct_mail' | 'organic' | 'other';
  customerId: number | null;
  roId: number | null;
  revenue: number;
}

interface AttributionCache {
  v: 2;
  callers: MatchedCaller[];
  summary: AttributionSummaryRow[];
  computedAt: string;
}

interface RepairPalMonth { appointments: number; revenue: number }
interface RepairPalCache {
  byShop: Record<string, Record<string, RepairPalMonth>>;
  importedAt: string;
}

interface UpswellMonthData {
  dmInvestment:   number;
  dmNewCustomers: number;  // Visit Type='New' only
  dmNewRevenue:   number;
  dmAllVisits:    number;
  dmAllRevenue:   number;
}
interface UpswellCache {
  byShop: Record<string, Record<string, UpswellMonthData>>;
  lagMedianDays: number;
  lag75PctDays:  number;
  lag90PctDays:  number;
  importedAt: string;
}

interface ReferralMonthCosts {
  repairPalCost:  number;  // actual QuickBooks payment (subscription + commission combined)
  costcoMonthly:  number;
  aaaMonthly:     number;
}
interface ReferralCostsCache {
  byShop: Record<string, Record<string, ReferralMonthCosts>>;
  importedAt: string;
}

interface ReferralShopCohort {
  num: string;
  name: string;
  // RepairPal
  rpAppts:     number;
  rpRevenue:   number;
  rpGp:        number;
  rpCost:      number;
  rpNet:       number;
  rpAvgRO:     number;
  rpGpPerAppt: number;
  rpRoiPct:    number | null;
  // Costco / AAA listing fees (total for the period)
  costcoTotal: number;
  aaaTotal:    number;
}

interface Payload {
  spend: Record<string, Record<string, MonthSpend>>;
  months: string[];
  newCustomers: NewCustRow[];
  newCustomersReady: boolean;
  attribution: AttributionCache | null;
  repairPal: RepairPalCache | null;
  upswell: UpswellCache | null;
  referralCosts: ReferralCostsCache | null;
  computedAt: string;
  stale?: boolean;
}

// ── constants ──────────────────────────────────────────────────────────────

const SHOPS_WITH_MARKETING = ['001', '002', '003', '004', '005', '006', '007', '009'];

const SHOP_COLORS: Record<string, string> = Object.fromEntries(
  SHOPS.map(s => [s.num, s.color])
);
const SHOP_NAMES: Record<string, string> = Object.fromEntries(
  SHOPS.map(s => [s.num, s.name])
);

const SHOP_OPTS = [
  { key: 'combined', label: 'Combined' },
  { key: 'all',      label: 'All Shops' },
  ...SHOPS.filter(s => SHOPS_WITH_MARKETING.includes(s.num)).map(s => ({ key: s.num, label: s.name })),
] as const;

// ── helpers ────────────────────────────────────────────────────────────────

// Filter the API's full month list (YYYY-MM strings) down to those that fall
// within the selected standard period range. Week-keyed options resolve to their
// containing month since marketing data is at monthly granularity.
function filterMonthsByPeriod(months: string[], period: PeriodRangeKey): string[] {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(); // 0-indexed
  const moKey = (yr: number, mo: number) => `${yr}-${String(mo + 1).padStart(2, '0')}`;
  switch (period) {
    case 'this_week':
    case 'this_month':
      return months.filter(mo => mo === moKey(y, m));
    case 'last_week':
    case 'last_month': {
      const lm = m === 0 ? 11 : m - 1, ly = m === 0 ? y - 1 : y;
      return months.filter(mo => mo === moKey(ly, lm));
    }
    case 'this_quarter': {
      const qStart = Math.floor(m / 3) * 3;
      return months.filter(mo => {
        const [my, mm] = mo.split('-').map(Number);
        return my === y && mm - 1 >= qStart && mm - 1 <= qStart + 2;
      });
    }
    case 'this_year':
      return months.filter(mo => mo.startsWith(`${y}-`));
    case 'last_year':
      return months.filter(mo => mo.startsWith(`${y - 1}-`));
    case 'last_90_days': {
      const cutoff = new Date(y, m - 2, 1);
      return months.filter(mo => {
        const [my, mm] = mo.split('-').map(Number);
        return new Date(my, mm - 1, 1) >= cutoff;
      });
    }
    case 'all_time':
    default:
      return months;
  }
}

function fmtMonth(m: string) {
  const [y, mo] = m.split('-');
  return new Date(+y, +mo - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
}

function buildSpendRows(months: string[], spend: Record<string, Record<string, MonthSpend>>, view: string) {
  const shops = view === 'combined' || view === 'all' ? SHOPS_WITH_MARKETING : [view];
  return months.map(m => {
    let ga = 0, adv = 0, lst = 0, seo = 0;
    for (const num of shops) {
      const d = spend[num]?.[m];
      if (d) { ga += d.googleAds; adv += d.advertising; lst += d.listing; seo += d.seo ?? 0; }
    }
    return { month: m, label: fmtMonth(m), googleAds: ga, advertising: adv, listing: lst, seo, total: ga + adv + lst + seo };
  });
}

function buildSpendLineSeries(months: string[], spend: Record<string, Record<string, MonthSpend>>) {
  const channels: { key: keyof MonthSpend; label: string; color: string }[] = [
    { key: 'googleAds',   label: 'Google Ads / LSA',       color: '#4A90D9' },
    { key: 'advertising', label: 'Direct Mail / Postcards', color: AMBER     },
    { key: 'listing',     label: 'Referral Networks',       color: '#9B7BE0' },
    { key: 'seo',         label: 'SEO Retainer',            color: '#50C878' },
  ];
  return channels.map(ch => ({
    key: ch.key,
    label: ch.label,
    color: ch.color,
    data: months.map(m => {
      let total = 0;
      for (const num of SHOPS_WITH_MARKETING) total += spend[num]?.[m]?.[ch.key] ?? 0;
      return { x: fmtMonth(m), y: total };
    }),
  }));
}

function buildNewCustRows(
  months: string[],
  newCustomers: NewCustRow[],
  view: string,
): Array<{ month: string; label: string; [k: string]: number | string }> {
  const isIndividual = view !== 'combined' && view !== 'all';
  const byMonthShop  = new Map<string, Map<string, number>>();
  for (const row of newCustomers) {
    if (isIndividual && row.shopNum !== view) continue;
    if (!byMonthShop.has(row.month)) byMonthShop.set(row.month, new Map());
    byMonthShop.get(row.month)!.set(row.shopNum, row.newCustomers);
  }
  return months.map(m => {
    const shopMap = byMonthShop.get(m) ?? new Map();
    const row: { month: string; label: string; [k: string]: number | string } = { month: m, label: fmtMonth(m) };
    if (!isIndividual) {
      let total = 0;
      for (const num of SHOPS_WITH_MARKETING) { const v = shopMap.get(num) ?? 0; row[num] = v; total += v; }
      row.total = total;
    } else {
      row.newCustomers = shopMap.get(view) ?? 0;
    }
    return row;
  });
}

function buildNewCustLineSeries(months: string[], newCustomers: NewCustRow[]) {
  const byShopMonth = new Map<string, Map<string, number>>();
  for (const row of newCustomers) {
    if (!byShopMonth.has(row.shopNum)) byShopMonth.set(row.shopNum, new Map());
    byShopMonth.get(row.shopNum)!.set(row.month, row.newCustomers);
  }
  return SHOPS_WITH_MARKETING.map(num => ({
    key: num,
    label: SHOP_NAMES[num] ?? num,
    color: SHOP_COLORS[num] ?? '#888',
    // Only include months where this shop actually has data; omitting a month
    // causes the chart to show a gap (null) rather than a misleading flat 0 line
    // for shops that weren't open yet or had no tracked customers.
    data: months
      .filter(m => (byShopMonth.get(num)?.get(m) ?? 0) > 0)
      .map(m => ({ x: fmtMonth(m), y: byShopMonth.get(num)!.get(m)! })),
  }));
}

function buildAttrRows(
  months: string[],
  attribution: AttributionCache | null,
  upswell: UpswellCache | null,
  repairPal: RepairPalCache | null,
  view: string,
  tekNewCust: Array<{ shopNum: string; month: string; newCustomers: number }>,
) {
  const shops = view === 'combined' || view === 'all' ? SHOPS_WITH_MARKETING : [view];
  return months.map(m => {
    // GA: all unique WC callers attributed to Google Ads (not just RO-matched)
    let ga = 0;
    if (attribution?.v === 2) {
      ga = attribution.callers.filter(c =>
        shops.includes(c.shopNum) && c.callMonth === m && c.channel === 'google_ads'
      ).length;
    }
    let total = 0;
    for (const num of shops) {
      const r = tekNewCust.find(n => n.shopNum === num && n.month === m);
      if (r) total += r.newCustomers;
    }
    let dm = 0;
    if (upswell) {
      for (const num of shops) {
        dm += upswell.byShop[num]?.[m]?.dmNewCustomers ?? 0;
      }
    }
    let rp = 0;
    if (repairPal) {
      for (const num of shops) {
        rp += repairPal.byShop[num]?.[m]?.appointments ?? 0;
      }
    }
    const other_all = Math.max(0, total - ga - dm - rp);
    return { month: m, label: fmtMonth(m), google_ads: ga, direct_mail: dm, other_all, total };
  });
}

// Average GP% used for revenue → GP$ estimates (chain avg from recent P&L)
const EST_GP_PCT = 0.53;
// RepairPal charges 10% of every invoice + $199/month subscription per shop
const REPAIR_PAL_FEE_PCT = 0.10;
const REPAIR_PAL_MONTHLY_SUB = 199;
// Avg ARO for new Google Ads customers (chain avg retail ticket)
const GOOGLE_AVG_ARO = 420;

interface ChannelRoi {
  label: string;
  color: string;
  visits: number;
  revenue: number;
  revenueIsEstimated: boolean;
  gpDollars: number;
  cost: number;
  net: number;
  cac: number | null;  // cost per new customer
}

function buildChannelRoi(
  months: string[],
  shops: string[],
  spend: Record<string, Record<string, MonthSpend>>,
  repairPal: RepairPalCache | null,
  attribution: AttributionCache | null,
  upswell: UpswellCache | null,
  referralCosts: ReferralCostsCache | null,
  tekNewCust: Array<{ shopNum: string; month: string; newCustomers: number }>,
): ChannelRoi[] {
  // --- RepairPal ---
  // Always use formula: $199/month per enrolled shop + 10% of RP revenue.
  // (QuickBooks payment data is unreliable — formula matches the contractual rate.)
  let rpAppts = 0, rpRevenue = 0;
  for (const num of shops) {
    for (const mo of months) {
      const rp = repairPal?.byShop[num]?.[mo];
      if (rp) { rpAppts += rp.appointments; rpRevenue += rp.revenue; }
    }
  }

  const RP_SHOPS = ['001', '002', '003', '004', '005', '006', '007'];
  const rpShopsInScope = shops.filter(n => RP_SHOPS.includes(n));
  let rpSubscription = 0;
  for (const num of rpShopsInScope) {
    const shopMonths = Object.keys(repairPal?.byShop[num] ?? {}).sort();
    if (!shopMonths.length) continue;
    const firstMonth = shopMonths[0];
    const billedMonths = months.filter(mo => mo >= firstMonth).length;
    rpSubscription += billedMonths * REPAIR_PAL_MONTHLY_SUB;
  }
  const rpCost = rpSubscription + Math.round(rpRevenue * REPAIR_PAL_FEE_PCT);

  const rpGp  = Math.round(rpRevenue * EST_GP_PCT);
  const rpNet = rpGp - rpCost;

  // --- Direct Mail (Upswell) ---
  let dmNewCustomers = 0, dmNewRevenue = 0, dmInvestment = 0;
  for (const num of shops) {
    for (const mo of months) {
      const u = upswell?.byShop[num]?.[mo];
      if (u) {
        dmNewCustomers += u.dmNewCustomers;
        dmNewRevenue   += u.dmNewRevenue;
        dmInvestment   += u.dmInvestment;
      }
    }
  }
  const dmInvestmentRounded = Math.round(dmInvestment);
  const dmGp  = Math.round(dmNewRevenue * EST_GP_PCT);
  const dmNet = dmGp - dmInvestmentRounded;

  // --- Google Ads (v2: all unique WC callers attributed to GA, revenue from matched ROs) ---
  // Customer count = total unique WC callers with channel === google_ads (regardless of TM
  // phone-match success). Phone-match failures and lookup timeouts don't disqualify the
  // caller — they called through a GA tracking number, so they are GA customers.
  // Revenue = actual RO revenue only from callers we could verify in Tekmetric.
  let gaCustomers = 0, gaRevenue = 0, gaCost = 0;
  if (attribution?.v === 2) {
    gaCustomers = attribution.callers.filter(c =>
      shops.includes(c.shopNum) &&
      months.includes(c.callMonth) &&
      c.channel === 'google_ads'
    ).length;
    for (const row of attribution.summary) {
      if (!shops.includes(row.shopNum) || !months.includes(row.month)) continue;
      gaRevenue += row.google_ads.revenue;
    }
  }
  for (const num of shops) {
    for (const mo of months) {
      gaCost += spend[num]?.[mo]?.googleAds ?? 0;
    }
  }
  const gaGp  = Math.round(gaRevenue * EST_GP_PCT);
  const gaNet = gaGp - gaCost;

  // --- Organic / Other: residual Tekmetric new customers not in any direct channel ---
  let totalNC = 0;
  for (const row of tekNewCust) {
    if (!shops.includes(row.shopNum) || !months.includes(row.month)) continue;
    totalNC += row.newCustomers;
  }
  const remainingNC    = Math.max(0, totalNC - rpAppts - dmNewCustomers);
  const otherCustomers = Math.max(0, remainingNC - gaCustomers);
  // Revenue for organic/other is still estimated (WC never sees GBP callers)
  const otherRevenue = Math.round(otherCustomers * GOOGLE_AVG_ARO);
  const otherGp      = Math.round(otherRevenue * EST_GP_PCT);

  // Cost = SEO retainer + AAA + Costco listing fees
  let otherCost = 0;
  for (const num of shops) {
    for (const mo of months) {
      otherCost += spend[num]?.[mo]?.seo ?? 0;
      if (referralCosts) {
        const rc = referralCosts.byShop[num]?.[mo];
        if (rc) otherCost += rc.costcoMonthly + rc.aaaMonthly;
      }
    }
  }
  otherCost = Math.round(otherCost);

  const rows: ChannelRoi[] = [
    {
      label: 'RepairPal',
      color: '#9B7BE0',
      visits: rpAppts,
      revenue: rpRevenue,
      revenueIsEstimated: false,
      gpDollars: rpGp,
      cost: rpCost,
      net: rpNet,
      cac: rpAppts > 0 && rpCost > 0 ? Math.round(rpCost / rpAppts) : null,
    },
    {
      label: 'Google Ads / LSA',
      color: '#4A90D9',
      visits: gaCustomers,
      revenue: gaRevenue,
      revenueIsEstimated: !attribution,  // estimated only when attribution cache is absent
      gpDollars: gaGp,
      cost: gaCost,
      net: gaNet,
      cac: gaCustomers > 0 && gaCost > 0 ? Math.round(gaCost / gaCustomers) : null,
    },
    {
      // Residual = total NC minus every directly-attributed channel.
      // Cost = SEO retainer + AAA + Costco listing fees.
      label: 'Other (SEO + Costco + AAA + Organic)',
      color: '#6DAF79',
      visits: otherCustomers,
      revenue: otherRevenue,
      revenueIsEstimated: true,
      gpDollars: otherGp,
      cost: otherCost,
      net: otherGp - otherCost,
      cac: otherCustomers > 0 && otherCost > 0 ? Math.round(otherCost / otherCustomers) : null,
    },
  ];

  if (upswell) {
    rows.splice(1, 0, {
      label: 'Direct Mail (Upswell)',
      color: AMBER,
      visits: dmNewCustomers,
      revenue: dmNewRevenue,
      revenueIsEstimated: false,
      gpDollars: dmGp,
      cost: dmInvestmentRounded,
      net: dmNet,
      cac: dmNewCustomers > 0 && dmInvestmentRounded > 0
        ? Math.round(dmInvestmentRounded / dmNewCustomers)
        : null,
    });
  }

  return rows.sort((a, b) => b.revenue - a.revenue);
}

// ── distributed lag model ──────────────────────────────────────────────────
// Weibull CDF fitted to Upswell empirical data.
// Parameters: β=1.5 (shape), θ=0.84 months (scale)
// Implied: median ≈ 20 days, 90th pct ≈ 45 days, >99% respond within 90 days.
function weibullCDF(tMonths: number): number {
  if (tMonths <= 0) return 0;
  return 1 - Math.exp(-Math.pow(tMonths / 0.84, 1.5));
}

/** CDF curve points for the postcard response visualization */
function buildResponseCDFData(): Array<{ day: number; label: string; pct: number }> {
  return [0, 7, 14, 20, 30, 45, 60, 90, 120].map(d => ({
    day: d,
    label: `Day ${d}`,
    pct: Math.round(weibullCDF(d / 30) * 1000) / 10,  // 0–100 scale
  }));
}

/** Per-month investment vs new-customer arrivals for Montana (shop 007) */
function buildShopLagRows(
  num: string,
  upswell: UpswellCache | null,
): Array<{ label: string; month: string; dmInvest: number; newCusts: number }> {
  const shop = upswell?.byShop[num] ?? {};
  return Object.entries(shop)
    .filter(([, d]) => d.dmInvestment > 0 || d.dmNewCustomers > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, d]) => ({
      label: fmtMonth(m),
      month: m,
      dmInvest: Math.round(d.dmInvestment),
      newCusts: d.dmNewCustomers,
    }));
}

/** Per-shop RepairPal economics + Costco/AAA listing fees for the selected period. */
function buildReferralCohortData(
  months: string[],
  repairPal: RepairPalCache | null,
  referralCosts: ReferralCostsCache | null,
): ReferralShopCohort[] {
  const RP_SHOPS = ['001', '002', '003', '004', '005', '006', '007'];
  return RP_SHOPS.map(num => {
    let rpAppts = 0, rpRevenue = 0;
    let costcoTotal = 0, aaaTotal = 0;
    for (const mo of months) {
      const rp = repairPal?.byShop[num]?.[mo];
      if (rp) { rpAppts += rp.appointments; rpRevenue += rp.revenue; }
      const rc = referralCosts?.byShop[num]?.[mo];
      if (rc) {
        costcoTotal += rc.costcoMonthly;
        aaaTotal    += rc.aaaMonthly;
      }
    }
    // Always formula: $199/month from first active month + 10% commission
    const shopMonths = Object.keys(repairPal?.byShop[num] ?? {}).sort();
    const firstMonth = shopMonths.length ? shopMonths[0] : null;
    const billedMonths = firstMonth ? months.filter(m => m >= firstMonth).length : 0;
    const rpCost = billedMonths * REPAIR_PAL_MONTHLY_SUB + Math.round(rpRevenue * REPAIR_PAL_FEE_PCT);
    const rpGp   = Math.round(rpRevenue * EST_GP_PCT);
    const rpNet  = rpGp - rpCost;
    const rpAvgRO     = rpAppts > 0 ? Math.round(rpRevenue / rpAppts) : 0;
    const rpGpPerAppt = rpAppts > 0 ? Math.round(rpGp / rpAppts) : 0;
    const rpRoiPct    = rpCost > 0 ? Math.round((rpNet / rpCost) * 100) : null;
    return {
      num, name: SHOP_NAMES[num] ?? num,
      rpAppts, rpRevenue: Math.round(rpRevenue), rpGp, rpCost, rpNet,
      rpAvgRO, rpGpPerAppt, rpRoiPct,
      costcoTotal: Math.round(costcoTotal), aaaTotal: Math.round(aaaTotal),
    };
  }).filter(r => r.rpAppts > 0 || r.rpCost > 0 || r.costcoTotal > 0 || r.aaaTotal > 0);
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

function NewCustTooltip({ active, payload, label, isIndividual }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value ?? 0), 0);
  return (
    <div style={{ background: 'rgba(255,255,255,0.97)', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px', minWidth: 160 }}>
      <div style={{ color: INK, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {isIndividual ? (
        <div style={{ fontSize: 13, color: INK2 }}>
          New customers: <strong style={{ color: INK }}>{payload[0]?.value ?? 0}</strong>
        </div>
      ) : (
        <>
          {[...payload].reverse().map((p: any) => (
            <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: INK2, fontSize: 13 }}>
              <span style={{ color: p.fill }}>{SHOP_NAMES[p.dataKey] ?? p.dataKey}</span>
              <span style={{ fontWeight: 600 }}>{p.value}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, borderTop: `1px solid ${LINE}`, marginTop: 6, paddingTop: 6, fontWeight: 700, fontSize: 13, color: INK }}>
            <span>Chain</span><span>{total}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────

export default function MarketingDashboard() {
  const [data, setData]       = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView]       = useState('combined');
  const [period, setPeriod]   = useState<PeriodRangeKey>('all_time');

  useEffect(() => {
    safe<Payload>('/api/marketing').then(d => { if (d) setData(d); setLoading(false); });
  }, []);

  const visibleMonths = useMemo(() => {
    if (!data) return [];
    return filterMonthsByPeriod(data.months, period);
  }, [data, period]);

  const isAll        = view === 'all';
  const isCombined   = view === 'combined';
  const isIndividual = !isAll && !isCombined;

  const spendRows       = useMemo(() => data ? buildSpendRows(visibleMonths, data.spend, view) : [], [data, visibleMonths, view]);
  const newCustRows     = useMemo(() => data ? buildNewCustRows(visibleMonths, data.newCustomers, view) : [], [data, visibleMonths, view]);
  const spendLineSeries = useMemo(() => data && isAll ? buildSpendLineSeries(visibleMonths, data.spend) : [], [data, visibleMonths, isAll]);
  const ncLineSeries    = useMemo(() => data && isAll ? buildNewCustLineSeries(visibleMonths, data.newCustomers) : [], [data, visibleMonths, isAll]);

  const cac = useMemo(() => spendRows.map((sr, i) => {
    const nc   = newCustRows[i];
    const newC = isIndividual ? (nc?.newCustomers as number ?? 0) : (nc?.total as number ?? 0);
    return { month: sr.month, label: sr.label, cac: newC > 0 ? Math.round(sr.total / newC) : null };
  }), [spendRows, newCustRows, isIndividual]);

  const attrRows = useMemo(() =>
    data ? buildAttrRows(visibleMonths, data.attribution, data.upswell ?? null, data.repairPal ?? null, view, data.newCustomers ?? []) : [],
  [data, visibleMonths, view]);

  const roiShops = useMemo(() =>
    isIndividual ? [view] : SHOPS_WITH_MARKETING.filter(n => n !== '009'),
  [view, isIndividual]);

  const channelRoi = useMemo(() =>
    data ? buildChannelRoi(visibleMonths, roiShops, data.spend, data.repairPal, data.attribution, data.upswell ?? null, data.referralCosts ?? null, data.newCustomers ?? []) : [],
  [data, visibleMonths, roiShops]);

  const responseCDFData  = useMemo(() => buildResponseCDFData(), []);
  const allShopsLagData  = useMemo(() => {
    if (!data?.upswell) return [];
    return SHOPS_WITH_MARKETING.map(num => ({
      num,
      name: SHOP_NAMES[num] ?? num,
      rows: buildShopLagRows(num, data.upswell!),
    })).filter(s => s.rows.some(r => r.dmInvest > 0 || r.newCusts > 0));
  }, [data]);
  const referralCohort   = useMemo(
    () => data ? buildReferralCohortData(visibleMonths, data.repairPal ?? null, data.referralCosts ?? null) : [],
    [data, visibleMonths],
  );

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

  // Shared filter bar — appears on every chart card
  const filterBar = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <Dropdown value={view} onChange={setView} opts={SHOP_OPTS} />
      <Dropdown value={period} onChange={v => setPeriod(v as PeriodRangeKey)} opts={PERIOD_RANGES} />
      {data.stale && <span style={{ fontSize: 11, color: FAINT }}>stale</span>}
    </div>
  );

  // ── new customers chart ──────────────────────────────────────────────────
  const newCustChart = (
    <Card id="new-customers" eyebrow="Acquisition" title="New Customers per Month"
      sub={isAll ? 'Per-shop trends — first visit at each location' : isCombined ? 'Chain-wide, stacked by shop' : `${SHOP_NAMES[view] ?? view} only`}
      right={filterBar}>
      {!data.newCustomersReady ? (
        <div style={{ color: FAINT, textAlign: 'center', padding: '40px 0' }}>
          New customer data is being computed — check back in a few minutes.
        </div>
      ) : isAll ? (
        <LineChartBlock series={ncLineSeries} xType="category" height={280} showDots formatValue={n => String(n)} />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          {isCombined ? (
            <BarChart data={newCustRows} barSize={14} maxBarSize={22}>
              <CartesianGrid vertical={false} stroke={LINE} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
              <Tooltip content={<NewCustTooltip isIndividual={false} />} />
              <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: INK2 }} />
              {SHOPS_WITH_MARKETING.map(num => (
                <Bar key={num} dataKey={num} stackId="a" fill={SHOP_COLORS[num]} name={SHOP_NAMES[num] ?? num} />
              ))}
            </BarChart>
          ) : (
            <BarChart data={newCustRows} barSize={20}>
              <CartesianGrid vertical={false} stroke={LINE} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
              <Tooltip content={<NewCustTooltip isIndividual />} />
              <Bar dataKey="newCustomers" fill={SHOP_COLORS[view] ?? AMBER} radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      )}
    </Card>
  );

  // ── spend chart ──────────────────────────────────────────────────────────
  const spendChart = (
    <Card id="spend" eyebrow="Spend" title="Marketing Spend by Channel"
      sub={isAll ? 'Company-wide spend by channel — Google Ads / LSA · Direct Mail · Referral Networks · SEO Retainer' : 'Google Ads / LSA (6814) · Direct Mail / Postcards (6819) · Referral Networks (6812) · SEO Retainer (6816)'}
      right={filterBar}>
      {isAll ? (
        <LineChartBlock series={spendLineSeries} xType="category" height={280} formatValue={usdK} />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={spendRows} barSize={14} maxBarSize={22}>
            <CartesianGrid vertical={false} stroke={LINE} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={usdK} tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
            <Tooltip content={<SpendTooltip />} />
            <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: INK2 }} />
            <Bar dataKey="googleAds"   name="Google Ads / LSA"          stackId="a" fill="#4A90D9" />
            <Bar dataKey="advertising" name="Direct Mail / Postcards"   stackId="a" fill={AMBER} />
            <Bar dataKey="listing"     name="Referral Networks"         stackId="a" fill="#9B7BE0" />
            <Bar dataKey="seo"         name="SEO Retainer"              stackId="a" fill="#50C878" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );

  // ── cost per new customer ────────────────────────────────────────────────
  const cacCard = (
    <Card id="attribution" eyebrow="Efficiency" title="Cost per New Customer"
      sub="Total marketing spend ÷ new customers acquired that month"
      right={filterBar}>
      {!data.newCustomersReady ? (
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
    </Card>
  );

  // ── channel attribution ──────────────────────────────────────────────────
  const attrCard = (
    <Card id="channel-attribution" eyebrow="Attribution (Phase 2)" title="New Customers by Channel"
      sub={data.attribution?.v === 2 ? `Phone-matched RO attribution · unique callers deduplicated · computed ${new Date(data.attribution.computedAt).toLocaleDateString()}` : 'Not yet computed — run warm-marketing-attribution cron job'}
      right={filterBar}>
      {data.attribution?.v !== 2 ? (
        <div style={{ color: FAINT, textAlign: 'center', padding: '40px 0', fontSize: 13 }}>
          Attribution data not yet available.<br />
          <span style={{ fontSize: 11 }}>Trigger via cron: <code>?job=warm-marketing-attribution</code></span>
        </div>
      ) : !data.newCustomersReady ? (
        <div style={{ color: FAINT, padding: '20px 0' }}>New customer data still computing…</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={attrRows} barSize={14} maxBarSize={22}>
            <CartesianGrid vertical={false} stroke={LINE} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} />
            <Tooltip
              content={({ active, payload, label }: any) => {
                if (!active || !payload?.length) return null;
                const total = payload.reduce((s: number, p: any) => s + (p.value ?? 0), 0);
                return (
                  <div style={{ background: 'rgba(255,255,255,0.97)', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px', minWidth: 180 }}>
                    <div style={{ fontWeight: 700, color: INK, marginBottom: 6 }}>{label}</div>
                    {[...payload].reverse().map((p: any) => (
                      <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13, color: INK2 }}>
                        <span style={{ color: p.fill }}>{p.name}</span>
                        <span style={{ fontWeight: 600 }}>{p.value?.toFixed(1)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, borderTop: `1px solid ${LINE}`, marginTop: 6, paddingTop: 6, fontWeight: 700, fontSize: 13, color: INK }}>
                      <span>Total</span><span>{total.toFixed(0)}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: INK2 }} />
            <Bar dataKey="google_ads"   name="Google Ads"   stackId="a" fill="#4A90D9" />
            <Bar dataKey="direct_mail"  name="Direct Mail"  stackId="a" fill={AMBER} />
            <Bar dataKey="other_all"    name="Other"        stackId="a" fill="#9B7BE0" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
      {data.attribution && (
        <p style={{ fontSize: 11, color: FAINT, marginTop: 10 }}>
          <strong style={{ color: INK2 }}>Google Ads</strong> — WhatConverts call attribution (proportional fraction applied to all months).{' '}
          <strong style={{ color: INK2 }}>Direct Mail</strong> — Upswell address-match: new customers (Visit Type = New) by invoice month; median lag from mail date to visit is {data.upswell?.lagMedianDays ?? 20} days, 90% within {data.upswell?.lag90PctDays ?? 45} days.{' '}
          <strong style={{ color: INK2 }}>Other</strong> — organic search, referral, walk-in, and untracked.
        </p>
      )}
    </Card>
  );

  // ── channel ROI ──────────────────────────────────────────────────────────
  const roiCard = (
    <Card id="channel-roi" eyebrow="Return on Marketing" title="Channel ROI"
      sub={`Revenue, GP$, and net return per channel · GP$ estimated at ${Math.round(EST_GP_PCT * 100)}% (chain avg) · Google Ads revenue estimated at $${GOOGLE_AVG_ARO} avg ARO`}
      right={filterBar}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${LINE}`, color: FAINT }}>
              <th style={{ textAlign: 'left',  padding: '6px 12px 6px 0', fontWeight: 600 }}>Channel</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Visits / Customers</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Revenue</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Est. GP$</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Channel Cost</th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Cost / Customer</th>
              <th style={{ textAlign: 'right', padding: '6px 0 6px 8px', fontWeight: 600 }}>Net (GP$ − Cost)</th>
            </tr>
          </thead>
          <tbody>
            {channelRoi.map(row => {
              const netColor = row.net >= 0 ? GOOD : '#E05A2E';
              return (
                <tr key={row.label} style={{ borderBottom: `1px solid ${LINE}` }}>
                  <td style={{ padding: '10px 12px 10px 0' }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: row.color, marginRight: 7, verticalAlign: 'middle' }} />
                    <span style={{ color: INK, fontWeight: 600 }}>{row.label}</span>
                  </td>
                  <td style={{ textAlign: 'right', padding: '10px 8px', color: INK2 }}>
                    {row.visits.toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right', padding: '10px 8px', color: INK2 }}>
                    {row.revenue > 0 ? (
                      <>
                        ${row.revenue.toLocaleString()}
                        {row.revenueIsEstimated && <span style={{ color: FAINT, fontSize: 11 }}> *</span>}
                      </>
                    ) : <span style={{ color: FAINT }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', padding: '10px 8px', color: INK2 }}>
                    {row.gpDollars > 0 ? (
                      <>${row.gpDollars.toLocaleString()}<span style={{ color: FAINT, fontSize: 11 }}> *</span></>
                    ) : <span style={{ color: FAINT }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', padding: '10px 8px', color: INK2 }}>
                    {row.cost > 0 ? `$${row.cost.toLocaleString()}` : <span style={{ color: FAINT }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', padding: '10px 8px', fontWeight: 600, color: INK }}>
                    {row.cac != null ? `$${row.cac.toLocaleString()}` : <span style={{ color: FAINT, fontWeight: 400 }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right', padding: '10px 0 10px 8px', fontWeight: 700, color: netColor }}>
                    {row.gpDollars > 0 && row.cost > 0 ? (
                      <>{row.net >= 0 ? '+' : ''}${row.net.toLocaleString()}</>
                    ) : <span style={{ color: FAINT, fontWeight: 400 }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: FAINT, marginTop: 8 }}>
          * Estimated. RepairPal revenue from actual invoices; RepairPal cost from actual QuickBooks payments (subscription + commission combined).
          Direct Mail revenue = Upswell address-matched new-customer invoices only (not return visits).
          Google Ads revenue = attributed new customers × ${GOOGLE_AVG_ARO} avg ARO.
          GP$ = revenue × {Math.round(EST_GP_PCT * 100)}% (chain avg GP).
          Google Ads customers = Google's call fraction × (Total NC − RepairPal − Direct Mail) — avoids double-counting RP/DM customers who also called a Google tracking number.
          Other customers = (1 − Google fraction) × (Total NC − RepairPal − Direct Mail): organic, walk-in, referral, untracked.
          Other cost = AAA + Costco listing fees only. Other revenue estimated at ${GOOGLE_AVG_ARO} avg ARO.
        </p>
      </div>
    </Card>
  );

  // ── per-shop direct mail performance ─────────────────────────────────────
  // Use ALL Upswell months (not filtered to P&L window) so shops with recent
  // campaigns don't show inflated CACs due to postcard-lag response arriving
  // after the P&L end date.
  const dmShopData = data.upswell ? SHOPS_WITH_MARKETING.map(num => {
    const shopMonths = Object.keys(data.upswell!.byShop[num] ?? {});
    let invest = 0, newCusts = 0;
    for (const mo of shopMonths) {
      const u = data.upswell!.byShop[num]?.[mo];
      if (u) { invest += u.dmInvestment; newCusts += u.dmNewCustomers; }
    }
    const cac = newCusts > 0 ? Math.round(invest / newCusts) : null;
    return { num, name: SHOP_NAMES[num] ?? num, color: SHOP_COLORS[num] ?? AMBER, invest: Math.round(invest), newCusts, cac };
  }).filter(d => d.invest > 0) : [];

  // Cap x-axis at 1.5× the 2nd-highest CAC so one outlier doesn't crush all bars
  const dmCacsSorted = dmShopData.filter(d => d.cac != null).map(d => d.cac!).sort((a, b) => a - b);
  const dmXMax = dmCacsSorted.length >= 2
    ? Math.ceil(dmCacsSorted[dmCacsSorted.length - 2] * 1.5 / 250) * 250
    : dmCacsSorted.length === 1 ? Math.ceil(dmCacsSorted[0] * 1.5 / 250) * 250 : 2000;
  const dmClippedShops = dmShopData.filter(d => d.cac != null && d.cac > dmXMax);

  const dmShopCard = data.upswell && dmShopData.length > 0 ? (
    <Card id="dm-shop-roas" eyebrow="Direct Mail Detail" title="Cost per New Customer by Shop"
      sub="Upswell address-match attribution · new customers (first visit) only · all campaign months · lag: median 20 days, 90% within 45 days"
      right={filterBar}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={dmShopData} layout="vertical" barSize={18} margin={{ left: 80, right: 40 }}>
          <CartesianGrid horizontal={false} stroke={LINE} />
          <XAxis type="number" tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false}
            tickFormatter={v => `$${v.toLocaleString()}`} domain={[0, dmXMax]} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: FAINT }} axisLine={false} tickLine={false} width={78} />
          <Tooltip
            content={({ active, payload }: any) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div style={{ background: 'rgba(255,255,255,0.97)', border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px', minWidth: 200 }}>
                  <div style={{ fontWeight: 700, color: INK, marginBottom: 6 }}>{d.name}</div>
                  <div style={{ fontSize: 13, color: INK2, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                    <span>Investment</span><span style={{ fontWeight: 600 }}>${d.invest.toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 13, color: INK2, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                    <span>New customers</span><span style={{ fontWeight: 600 }}>{d.newCusts}</span>
                  </div>
                  <div style={{ fontSize: 13, color: INK, fontWeight: 700, display: 'flex', justifyContent: 'space-between', gap: 16, borderTop: `1px solid ${LINE}`, marginTop: 6, paddingTop: 6 }}>
                    <span>Cost / new customer</span>
                    <span>{d.cac != null ? `$${d.cac.toLocaleString()}` : '—'}</span>
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="cac" name="Cost / new customer" radius={[0, 4, 4, 0]}>
            {dmShopData.map(d => (
              <Cell key={d.num} fill={d.cac != null && d.cac < 200 ? GOOD : d.cac != null && d.cac < 500 ? AMBER : '#E05A2E'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginTop: 10 }}>
        {dmShopData.map(d => (
          <span key={d.num} style={{ fontSize: 12, color: FAINT }}>
            <span style={{ color: INK2, fontWeight: 600 }}>{d.name}</span>
            {': '}
            {d.cac != null
              ? <span style={{ color: d.cac < 200 ? GOOD : d.cac < 500 ? AMBER : '#E05A2E', fontWeight: 700 }}>${d.cac.toLocaleString()}/new</span>
              : <span style={{ color: FAINT }}>no data</span>}
            {' '}({d.newCusts} customers, ${d.invest.toLocaleString()} spent)
          </span>
        ))}
      </div>
      {dmClippedShops.length > 0 && (
        <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>
          * Chart x-axis capped at ${dmXMax.toLocaleString()} for readability.
          {dmClippedShops.map(d => ` ${d.name}: $${d.cac!.toLocaleString()}/new (${d.newCusts} attributed customers, $${d.invest.toLocaleString()} spent).`)}
          {' '}Low attribution count may reflect address-match limitations rather than campaign inefficiency.
        </div>
      )}
    </Card>
  ) : null;

  const channelNote = (
    <div className="c2ui" style={{ fontSize: 12, color: FAINT, lineHeight: 1.6, padding: '4px 2px 12px' }}>
      <strong style={{ color: INK2 }}>Channel taxonomy:</strong>{' '}
      <span style={{ color: '#4A90D9' }}>Google Ads / LSA</span> — intent capture, 0–10 day lag, near-instantaneous.{' '}
      <span style={{ color: AMBER }}>Direct Mail</span> — demand generation, 2–6 week lag (Weibull curve); postcard → customer holds → branded search → call is common.{' '}
      <span style={{ color: '#9B7BE0' }}>Referral Networks</span> (RepairPal, Costco Auto, AAA AAR) — fixed monthly placement fee, no decay curve; measure on gross profit per RO and 12-month retention, not CAC.
      {' '}Branded search volume is partly a downstream signal of postcard and referral activity — not an independent demand driver.
    </div>
  );

  // ── distributed lag model card ──────────────────────────────────────────
  const lagModelCard = (
    <Card id="lag-model" eyebrow="Attribution Science" title="Distributed Lag Model"
      sub="Postcard response curve · attribution overlap · per-shop DM investment vs. new customers">

      {/* Top row: response curve + attribution overlap */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>

        {/* Cumulative response curve */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 2 }}>
            Postcard Response Curve — Cumulative
          </div>
          <div style={{ fontSize: 11, color: FAINT, marginBottom: 10 }}>
            Weibull model β=1.5 θ=0.84 months · median 20 days · 90th pct 45 days
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={responseCDFData} margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
              <CartesianGrid stroke="#F0F1F3" strokeDasharray="2 5" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: FAINT, fontSize: 10 }} axisLine={false} tickLine={false}
                tickFormatter={d => `Day ${d}`} />
              <YAxis tick={{ fill: FAINT, fontSize: 10 }} axisLine={false} tickLine={false}
                tickFormatter={v => `${v}%`} domain={[0, 100]} />
              <Tooltip formatter={(v: any) => [`${v}%`, 'Customers arrived']}
                labelFormatter={d => `Day ${d} after mailing`} />
              <ReferenceLine y={50} stroke={AMBER} strokeDasharray="3 3"
                label={{ value: '50% — Day 20', position: 'insideTopLeft', fill: AMBER, fontSize: 10 }} />
              <ReferenceLine y={90} stroke="#9B7BE0" strokeDasharray="3 3"
                label={{ value: '90% — Day 45', position: 'insideTopLeft', fill: '#9B7BE0', fontSize: 10 }} />
              <Line type="monotone" dataKey="pct" stroke={AMBER} strokeWidth={2.5} dot={{ r: 3, fill: AMBER }} name="Cumulative %" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Attribution overlap */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK2 }}>Attribution Overlap</div>
          <div style={{ background: '#FFF8ED', border: `1px solid ${AMBER}60`, borderRadius: 8, padding: '10px 14px', fontSize: 12, color: INK2, lineHeight: 1.75 }}>
            <span style={{ background: AMBER + '30', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>Postcard mailed → customer visits</span>
            <br />↓ Upswell matches address ✓<br />
            <span style={{ background: '#4A90D920', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>Same customer also clicks Google Ad</span>
            <br />↓ WhatConverts call attributed to Google Ads<br />
            → <span style={{ color: AMBER, fontWeight: 700 }}>Both channels claim credit</span>
          </div>
          <div style={{ fontSize: 11, color: FAINT, lineHeight: 1.6 }}>
            Upswell attributes by postal address match — independent of WhatConverts. But if a mailed customer later clicks a Google Ad and calls, WhatConverts also credits Google Ads for that call. This means the same customer may appear in both the DM and Google Ads totals.
          </div>
          <div style={{ background: '#F0F7F0', border: '1px solid #2E7D3230', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#2E7D32', marginBottom: 3 }}>Holdout Experiment Design</div>
            <div style={{ fontSize: 11, color: '#376B3A', lineHeight: 1.6 }}>
              Pause postcards in 2–3 ZIP codes matched on demographics + shop proximity.
              Track new-customer rate for 6 months. If new customers drop in holdout ZIPs, DM is generating genuine incremental demand.
            </div>
          </div>
        </div>
      </div>

      {/* Per-shop DM investment vs new customers grid */}
      {allShopsLagData.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 4 }}>
            DM Investment vs. New Customers — All Shops
          </div>
          <div style={{ fontSize: 11, color: FAINT, marginBottom: 14, lineHeight: 1.6 }}>
            Orange bars = monthly DM investment (left axis, $). Blue bars = Upswell address-matched new customers (right axis, count).
            The lag between orange and blue bars is the postcard response time. Months with investment but zero customers may still be working — the Weibull curve puts 90% of response within 45 days.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {allShopsLagData.map(shop => (
              <div key={shop.num}>
                <div style={{ fontSize: 11, fontWeight: 700, color: INK2, marginBottom: 4 }}>{shop.name}</div>
                <ResponsiveContainer width="100%" height={170}>
                  <BarChart data={shop.rows} barGap={2} barCategoryGap="25%"
                    margin={{ top: 4, right: 44, left: 10, bottom: 4 }}>
                    <CartesianGrid stroke="#F0F1F3" strokeDasharray="2 5" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: FAINT, fontSize: 9 }} axisLine={false} tickLine={false}
                      interval="preserveStartEnd" />
                    <YAxis yAxisId="invest" orientation="left" tick={{ fill: FAINT, fontSize: 9 }} axisLine={false} tickLine={false}
                      tickFormatter={v => `$${Math.round(v / 1000)}k`} />
                    <YAxis yAxisId="custs" orientation="right" tick={{ fill: FAINT, fontSize: 9 }} axisLine={false} tickLine={false}
                      allowDecimals={false} />
                    <Tooltip content={({ active, payload, label: lbl }: any) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div style={{ background: 'rgba(255,255,255,0.97)', border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 12px', minWidth: 170 }}>
                          <div style={{ fontWeight: 700, color: INK, marginBottom: 3, fontSize: 12 }}>{lbl}</div>
                          {payload.map((p: any) => (
                            <div key={p.dataKey} style={{ fontSize: 11, color: p.color, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                              <span>{p.name}</span>
                              <span style={{ fontWeight: 600 }}>
                                {p.dataKey === 'dmInvest' ? `$${(p.value as number).toLocaleString()}` : `${p.value}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    }} />
                    <Bar yAxisId="invest" dataKey="dmInvest" name="DM Invest ($)" fill={AMBER} radius={[2, 2, 0, 0]} />
                    <Bar yAxisId="custs"  dataKey="newCusts" name="New Customers" fill="#4A90D9" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 10 }}>
            Upswell address-match attribution only. Some customers may have visited but weren't matched (PO boxes, work addresses, recent moves).
          </div>
        </div>
      )}
    </Card>
  );

  // ── referral network cohort card ───────────────────────────────────────────
  // Chain-average GP/appt (RepairPal proxy used for Costco/AAA breakeven)
  const chainAppts    = referralCohort.reduce((s, r) => s + r.rpAppts, 0);
  const chainGp       = referralCohort.reduce((s, r) => s + r.rpGp, 0);
  const chainGpPerAppt = chainAppts > 0 ? Math.round(chainGp / chainAppts) : 250;

  const referralCohortCard = referralCohort.length > 0 ? (
    <Card id="referral-cohort" eyebrow="Referral Networks" title="Cohort Analysis"
      sub="RepairPal economics per shop · Costco / AAA listing fee breakeven · Postcards per-shop economics" right={filterBar}>

      {/* RepairPal table */}
      {referralCohort.some(r => r.rpAppts > 0) && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 10 }}>
            RepairPal — Per-Shop Economics
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${LINE}` }}>
                  {['Shop', 'Appts', 'Revenue', 'GP$', 'Cost (QB)', 'Net', 'Avg RO', 'GP/Appt', 'ROI'].map(h => (
                    <th key={h} style={{
                      padding: '6px 10px', textAlign: h === 'Shop' ? 'left' : 'right',
                      color: FAINT, fontWeight: 500, whiteSpace: 'nowrap', fontSize: 11,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {referralCohort.filter(r => r.rpAppts > 0 || r.rpCost > 0).map((r, i) => (
                  <tr key={r.num} style={{ borderBottom: `1px solid ${LINE}30`, background: i % 2 === 1 ? '#FAFBFC' : 'transparent' }}>
                    <td style={{ padding: '7px 10px', color: INK, fontWeight: 500, whiteSpace: 'nowrap' }}>{r.name}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>{r.rpAppts.toLocaleString()}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>${r.rpRevenue.toLocaleString()}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>${r.rpGp.toLocaleString()}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>${r.rpCost.toLocaleString()}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700,
                      color: r.rpNet >= 0 ? GOOD : '#E05A2E' }}>
                      {r.rpNet >= 0 ? '+' : ''}{r.rpNet < 0 ? '-' : ''}${Math.abs(r.rpNet).toLocaleString()}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>${r.rpAvgRO.toLocaleString()}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>${r.rpGpPerAppt}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700,
                      color: r.rpRoiPct != null && r.rpRoiPct >= 0 ? GOOD : '#E05A2E' }}>
                      {r.rpRoiPct != null ? `${r.rpRoiPct > 0 ? '+' : ''}${r.rpRoiPct}%` : '—'}
                    </td>
                  </tr>
                ))}
                {/* Chain total row */}
                {(() => {
                  const rows = referralCohort.filter(r => r.rpAppts > 0 || r.rpCost > 0);
                  if (rows.length < 2) return null;
                  const totAppts = rows.reduce((s, r) => s + r.rpAppts, 0);
                  const totRev   = rows.reduce((s, r) => s + r.rpRevenue, 0);
                  const totGp    = rows.reduce((s, r) => s + r.rpGp, 0);
                  const totCost  = rows.reduce((s, r) => s + r.rpCost, 0);
                  const totNet   = totGp - totCost;
                  const totRoi   = totCost > 0 ? Math.round((totNet / totCost) * 100) : null;
                  return (
                    <tr style={{ borderTop: `2px solid ${LINE}`, background: 'transparent' }}>
                      <td style={{ padding: '7px 10px', color: INK, fontWeight: 700 }}>Chain total</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>{totAppts.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>${totRev.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>${totGp.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>${totCost.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: totNet >= 0 ? GOOD : '#E05A2E' }}>
                        {totNet >= 0 ? '+' : '-'}${Math.abs(totNet).toLocaleString()}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>
                        ${totAppts > 0 ? Math.round(totRev / totAppts).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>
                        ${chainGpPerAppt}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: totRoi != null && totRoi >= 0 ? GOOD : '#E05A2E' }}>
                        {totRoi != null ? `${totRoi > 0 ? '+' : ''}${totRoi}%` : '—'}
                      </td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 8 }}>
            Cost = actual QuickBooks payments (subscription + per-RO commission).
            GP$ = revenue × {Math.round(EST_GP_PCT * 100)}% (chain avg GP).
            ROI = (GP$ − cost) ÷ cost. Positive ROI means RepairPal is profitable after fees.
          </div>
        </div>
      )}

      {/* Costco / AAA table */}
      {referralCohort.some(r => r.costcoTotal > 0 || r.aaaTotal > 0) && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 4 }}>
            Costco Auto / AAA AAR — Listing Fee Breakeven
          </div>
          <div style={{ fontSize: 11, color: FAINT, marginBottom: 10 }}>
            Customer counts not tracked separately for Costco/AAA.
            Breakeven = listing fee ÷ chain-avg RepairPal GP/appointment (${chainGpPerAppt}/appt proxy).
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${LINE}` }}>
                  {['Shop', 'Costco (period)', 'AAA (period)', 'Total', 'Monthly avg', 'Breakeven (appts/mo)'].map(h => (
                    <th key={h} style={{
                      padding: '6px 10px', textAlign: h === 'Shop' ? 'left' : 'right',
                      color: FAINT, fontWeight: 500, whiteSpace: 'nowrap', fontSize: 11,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {referralCohort.filter(r => r.costcoTotal > 0 || r.aaaTotal > 0).map((r, i) => {
                  const total    = r.costcoTotal + r.aaaTotal;
                  const monthly  = visibleMonths.length > 0 ? Math.round(total / visibleMonths.length) : 0;
                  const breakEven = chainGpPerAppt > 0 ? (monthly / chainGpPerAppt).toFixed(1) : '—';
                  return (
                    <tr key={r.num} style={{ borderBottom: `1px solid ${LINE}30`, background: i % 2 === 1 ? '#FAFBFC' : 'transparent' }}>
                      <td style={{ padding: '7px 10px', color: INK, fontWeight: 500, whiteSpace: 'nowrap' }}>{r.name}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>
                        {r.costcoTotal > 0 ? `$${r.costcoTotal.toLocaleString()}` : '—'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>
                        {r.aaaTotal > 0 ? `$${r.aaaTotal.toLocaleString()}` : '—'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>${total.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>
                        {monthly > 0 ? `$${monthly.toLocaleString()}` : '—'}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: GOOD }}>
                        {breakEven}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 8 }}>
            Breakeven = monthly listing fee ÷ ${chainGpPerAppt} chain-avg RepairPal GP/appt.
            A breakeven of 0.5 means one visit every 2 months covers the fee — a very low bar for an active listing.
          </div>
        </div>
      )}

      {/* Postcards / Direct Mail per-shop table */}
      {data.upswell && (() => {
        const dmRows = SHOPS_WITH_MARKETING.map(num => {
          let invest = 0, newCusts = 0, newRev = 0;
          for (const mo of visibleMonths) {
            const u = data.upswell!.byShop[num]?.[mo];
            if (u) { invest += u.dmInvestment; newCusts += u.dmNewCustomers; newRev += u.dmNewRevenue; }
          }
          const gp  = Math.round(newRev * EST_GP_PCT);
          const net = gp - Math.round(invest);
          const cac = newCusts > 0 ? Math.round(invest / newCusts) : null;
          return { num, name: SHOP_NAMES[num] ?? num, invest: Math.round(invest), newCusts, newRev: Math.round(newRev), gp, net, cac };
        }).filter(r => r.invest > 0);
        if (!dmRows.length) return null;
        const totInvest = dmRows.reduce((s, r) => s + r.invest, 0);
        const totCusts  = dmRows.reduce((s, r) => s + r.newCusts, 0);
        const totRev    = dmRows.reduce((s, r) => s + r.newRev, 0);
        const totGp     = dmRows.reduce((s, r) => s + r.gp, 0);
        const totNet    = totGp - totInvest;
        const totCac    = totCusts > 0 ? Math.round(totInvest / totCusts) : null;
        return (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: INK2, marginBottom: 4 }}>
              Postcards (Upswell Direct Mail) — Per-Shop Economics
            </div>
            <div style={{ fontSize: 11, color: FAINT, marginBottom: 10 }}>
              Address-match attribution · new customers (first visit) only · filtered to selected period.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${LINE}` }}>
                    {['Shop', 'Investment', 'New Customers', 'Revenue', 'GP$', 'Net', 'CAC'].map(h => (
                      <th key={h} style={{
                        padding: '6px 10px', textAlign: h === 'Shop' ? 'left' : 'right',
                        color: FAINT, fontWeight: 500, whiteSpace: 'nowrap', fontSize: 11,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dmRows.map((r, i) => (
                    <tr key={r.num} style={{ borderBottom: `1px solid ${LINE}30`, background: i % 2 === 1 ? '#FAFBFC' : 'transparent' }}>
                      <td style={{ padding: '7px 10px', color: INK, fontWeight: 500, whiteSpace: 'nowrap' }}>{r.name}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>${r.invest.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>{r.newCusts.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>{r.newRev > 0 ? `$${r.newRev.toLocaleString()}` : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK2 }}>{r.gp > 0 ? `$${r.gp.toLocaleString()}` : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700,
                        color: r.net >= 0 ? GOOD : '#E05A2E' }}>
                        {r.net >= 0 ? '+' : '-'}${Math.abs(r.net).toLocaleString()}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>
                        {r.cac != null ? `$${r.cac.toLocaleString()}` : '—'}
                      </td>
                    </tr>
                  ))}
                  {dmRows.length >= 2 && (
                    <tr style={{ borderTop: `2px solid ${LINE}`, background: 'transparent' }}>
                      <td style={{ padding: '7px 10px', color: INK, fontWeight: 700 }}>Chain total</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>${totInvest.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>{totCusts.toLocaleString()}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>{totRev > 0 ? `$${totRev.toLocaleString()}` : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>{totGp > 0 ? `$${totGp.toLocaleString()}` : '—'}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700,
                        color: totNet >= 0 ? GOOD : '#E05A2E' }}>
                        {totNet >= 0 ? '+' : '-'}${Math.abs(totNet).toLocaleString()}
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'right', color: INK, fontWeight: 600 }}>
                        {totCac != null ? `$${totCac.toLocaleString()}` : '—'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: FAINT, marginTop: 8 }}>
              Net = GP$ − investment. GP$ = revenue × {Math.round(EST_GP_PCT * 100)}% (chain avg).
              Montana and newer shops may show high CAC due to address-match limitations — see Direct Mail Detail chart.
            </div>
          </div>
        );
      })()}
    </Card>
  ) : null;

  return (
    <div>
      {roiCard}
      {newCustChart}
      {spendChart}
      {channelNote}
      {referralCohortCard}
      {dmShopCard}
      {lagModelCard}
      {cacCard}
      {attrCard}
    </div>
  );
}
