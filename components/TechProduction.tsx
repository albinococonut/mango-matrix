'use client';

import { useEffect, useState } from 'react';
import { Wrench, ChevronDown, ChevronUp, ArrowUpDown, BarChart3, Table2, LayoutGrid, Info } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';
import { num, pct } from '@/lib/format';
import { SHOP_BY_NUM } from '@/lib/shops';
import { TrophyIcon } from './Trophy';
import MangoTierIcon, { tierFor, MangoTier } from './MangoTierIcon';
import { WindowToggle } from './AppointmentBookedRate';

type WindowKind = 'rolling' | 'this_week';

interface TechRow {
  technicianId: number;
  techName?: string;
  shopNum: string;
  shopName: string;
  billedHours: number;
  jobs: number;
  efficiency: number;
}

const TIER_TEXT: Record<MangoTier, string> = { legendary: '#C2410C', golden: '#E08E1A', ripe: '#F5A623' };

const CARD_TIER = {
  legendary: {
    frame: 'linear-gradient(135deg,#FFE08A,#F4B400,#E0731C,#FFE08A)',
    art: 'radial-gradient(circle at 50% 38%, #FFEFC2 0%, #F7B23E 48%, #E0731C 100%)',
    rays: 'repeating-conic-gradient(from 0deg at 50% 42%, rgba(255,255,255,0.16) 0deg 6deg, transparent 6deg 18deg)',
    chip: '#E0731C', stars: 3, holo: 0.5,
  },
  golden: {
    frame: 'linear-gradient(135deg,#FBD976,#F4B400,#F5C451)',
    art: 'radial-gradient(circle at 50% 40%, #FFF2CC 0%, #F6C657 60%, #E3A11E 100%)',
    rays: 'repeating-conic-gradient(from 0deg at 50% 42%, rgba(255,255,255,0.12) 0deg 6deg, transparent 6deg 20deg)',
    chip: '#C97A1F', stars: 2, holo: 0.32,
  },
  ripe: {
    frame: 'linear-gradient(135deg,#FFE6BE,#FFD09A,#EDE7DC)',
    art: 'radial-gradient(circle at 50% 42%, #FFF7EA 0%, #FFE0B0 70%, #FFC97E 100%)',
    rays: 'none',
    chip: '#F5A623', stars: 1, holo: 0.16,
  },
} as const;

// Hover/focus tooltip that explains the card-tier thresholds. Shown next to
// the title only in cards mode (the tiers only apply to the card leaderboard).
// Pure CSS group-hover so it works without any tooltip library; also opens on
// keyboard focus for accessibility.
function TierLegendTooltip() {
  const rows: { swatch: MangoTier; label: string; range: string }[] = [
    { swatch: 'legendary', label: 'Big gold crown', range: '110%+ efficiency' },
    { swatch: 'golden', label: 'Small crown', range: '100–109%' },
    { swatch: 'ripe', label: 'Plain mango (no crown)', range: '90–99%' },
  ];
  return (
    <span className="group relative inline-flex align-middle" tabIndex={0}>
      <Info className="w-[15px] h-[15px] text-mango-faint hover:text-mango-ink cursor-help" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-[280px] -translate-x-1/2 rounded-xl border border-mango-line bg-white p-3 text-left opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100"
      >
        <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.12em] text-mango-muted">
          Card tiers (this week)
        </span>
        {rows.map((r) => (
          <span key={r.swatch} className="mb-2 flex items-center gap-2.5 last:mb-1.5">
            <span className="shrink-0">
              <MangoTierIcon tier={r.swatch} size={30} />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[12.5px] font-semibold text-mango-ink">{r.label}</span>
              <span className="text-[11px] text-mango-muted tnum">{r.range}</span>
            </span>
          </span>
        ))}
        <span className="mt-1 block border-t border-mango-line pt-1.5 text-[11px] text-mango-faint">
          Below 90% doesn&apos;t earn a card. Efficiency = billed hours ÷ expected hours
          (8.5/working day, scaled to days elapsed).
        </span>
      </span>
    </span>
  );
}

// Exported so the TV view (/tv) can render the exact same Pokemon-style
// trading card without forking the design. Pass a no-op onClick on TV since
// the dashboard is non-interactive.
//
// `variant`:
//   - 'default' (dashboard, employee page): tall 270×370 portrait card —
//     top bar, art window, name plate, stat block stacked vertically.
//   - 'compact' (TV /tv view): LANDSCAPE — top bar across the top, then a
//     row with Mia's art window on the left and {name plate + stat block}
//     stacked on the right. Same components, just shorter so a 3×2 grid
//     of these fits the TV tile without clipping.
export function TechCard({ r, rank, onClick, variant = 'default' }: {
  r: TechRow; rank: number; onClick: () => void; variant?: 'default' | 'compact';
}) {
  const tier = tierFor(r.efficiency);
  const C = CARD_TIER[tier];
  const effColor = r.efficiency >= 1 ? '#3F9A6A' : r.efficiency >= 0.75 ? '#E08E1A' : '#D1675A';
  const compact = variant === 'compact';

  // Shared elements rendered the same way in both layouts. Splitting them
  // into local renderers keeps the JSX below readable while we branch on
  // portrait vs landscape composition.
  //
  // In compact mode we drop the "Power level" text label so the top bar
  // doesn't force the card to be wider than the 3-col grid cell. The
  // stars stay (they communicate the rarity tier just as well).
  const topBar = (
    <div className={`relative z-10 flex items-center justify-between ${compact ? 'px-2 pt-1.5' : 'px-3 pt-2.5'}`}>
      <span className={`inline-flex items-center justify-center ${compact ? 'w-5 h-5 text-[9px]' : 'w-7 h-7 text-[11px]'} rounded-full font-bold tnum`}
        style={{ background: '#FFFFFFAA', color: C.chip, boxShadow: `inset 0 0 0 1.5px ${C.chip}` }}>
        {rank <= 3 ? <TrophyIcon rank={rank as 1 | 2 | 3} size={compact ? 12 : 15} /> : rank}
      </span>
      <span className="inline-flex items-center gap-1.5">
        {!compact && (
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-mango-muted">Power level</span>
        )}
        <span className={`${compact ? 'text-[10px]' : 'text-[11px]'} tracking-[0.12em]`} style={{ color: C.chip }}>
          {'★'.repeat(C.stars)}<span style={{ opacity: 0.25 }}>{'★'.repeat(3 - C.stars)}</span>
        </span>
      </span>
    </div>
  );

  const artWindow = (
    <div
      // In compact (landscape) mode we use `items-center` so Mia sits
      // visually centered in the art window — the previous `items-end`
      // shoved her against the tier label and left a big orange gap above.
      className={`relative overflow-hidden flex justify-center ${
        compact
          ? 'rounded-lg items-center'
          : 'mx-3 mt-1.5 h-[178px] rounded-xl pb-2 items-end'
      }`}
      style={{ background: C.art, ...(compact ? { width: 92, height: '100%' } : {}) }}
    >
      {C.rays !== 'none' && (
        <div className="absolute inset-0 opacity-70 gm-spin" style={{ background: C.rays }} />
      )}
      {tier === 'legendary' && [...Array(5)].map((_, i) => (
        <span key={i} className="gm-spark absolute rounded-full"
          style={{
            width: 5 - (i % 2), height: 5 - (i % 2), background: '#FFF7DA',
            top: `${[14, 70, 24, 80, 46][i]}%`, left: `${[16, 22, 82, 74, 50][i]}%`,
            animationDelay: `${i * 0.5}s`,
          }} />
      ))}
      <span className={`relative z-10 drop-shadow-[0_8px_10px_rgba(124,72,12,0.30)] ${compact ? '-mt-1.5' : ''}`}>
        <MangoTierIcon tier={tier} size={compact ? 84 : 104} />
      </span>
      <div className="gm-foil absolute inset-0 pointer-events-none" style={{ opacity: C.holo }} />
      <span className={`absolute bottom-0.5 left-0 right-0 text-center font-bold uppercase ${compact ? 'text-[7px] tracking-[0.14em]' : 'text-[10px] tracking-[0.22em]'}`}
        style={{ color: '#FFFFFF', textShadow: '0 1px 3px rgba(124,72,12,0.55)' }}>
        {tier}
      </span>
    </div>
  );

  const namePlate = (
    <div className={compact ? 'px-1 pt-1' : 'px-4 pt-3'}>
      {/* In compact: drop the horizontal padding from px-2 → px-1 (saves
          8px), drop `truncate`, and allow up to 2 lines via line-clamp-2
          + break-words so longer single names ("Salvador") aren't clipped
          to "Salva..." and multi-word names ("Christopher Garcia") can
          wrap instead of truncating. */}
      <div className={`${compact ? 'text-[13px] line-clamp-2 break-words' : 'text-[16px] truncate'} font-bold text-mango-ink leading-tight`}>{r.techName || `Tech ${r.technicianId}`}</div>
      <div className={`${compact ? 'text-[10px]' : 'text-[12px]'} text-mango-muted truncate`}>{r.shopName}</div>
    </div>
  );

  // `mt-auto` pushes the block to the bottom of its flex parent — needed
  // in the portrait default so the stat block hugs the bottom of the
  // card, but in landscape compact mode it created a vertical gap
  // between the name plate and the stat block. Compact omits mt-auto;
  // the right column uses justify-center so name + stats sit tight.
  //
  // LAYOUT difference between variants:
  //   default (portrait): efficiency on the LEFT, hours+jobs on the RIGHT,
  //                       items-end justify-between
  //   compact (landscape): efficiency stacked ABOVE hours · jobs (single
  //                       line), so the stat block is narrower and the
  //                       right column has more room for the tech name
  const statBg = `linear-gradient(135deg, ${effColor}26 0%, ${effColor}10 60%, transparent 100%)`;

  const statBlock = compact ? (
    // Fully vertical stack: % → EFFICIENCY label → hours → jobs.
    //
    // Sizing math: the right column is only ~74px wide (3-col TV grid).
    // "100%" at 22px tabular-nums is ~52px wide — once the stat block
    // had mx-2 (16px) + px-2 (16px), the content area dropped to ~46px
    // and the `%` overflowed the card's `overflow-hidden` clip. Fixed by
    // dropping the horizontal margin so the stat block goes edge-to-edge
    // inside the right column, tightening internal padding to px-1.5,
    // and shrinking the % from 22→18 so it has breathing room.
    <div className="mb-1 mx-1 px-1.5 py-1.5 rounded-lg flex flex-col" style={{ background: statBg }}>
      <span className="text-[18px] font-extrabold leading-none tnum" style={{ color: effColor }}>
        {pct(r.efficiency)}
      </span>
      <span className="text-[7px] font-bold uppercase tracking-[0.14em] text-mango-faint mt-0.5">Efficiency</span>
      <span className="text-[11px] font-bold text-mango-ink tnum mt-1 leading-tight">{r.billedHours.toFixed(1)}h</span>
      <span className="text-[10px] text-mango-muted tnum leading-tight">{num(r.jobs)} jobs</span>
    </div>
  ) : (
    <div className="mx-4 my-3 px-4 py-3 mt-auto rounded-xl flex items-end justify-between"
      style={{ background: statBg }}>
      <div>
        <div className="text-[2rem] font-extrabold leading-none tracking-[-0.02em] tnum" style={{ color: effColor }}>
          {pct(r.efficiency)}
        </div>
        <div className="mt-0.5 text-[9px] tracking-[0.18em] font-bold uppercase text-mango-faint">Efficiency</div>
      </div>
      <div className="text-right">
        <div className="text-[14px] font-bold text-mango-ink tnum">{r.billedHours.toFixed(1)}h</div>
        <div className="text-[11px] text-mango-muted tnum">{num(r.jobs)} jobs</div>
      </div>
    </div>
  );

  return (
    <button
      onClick={onClick}
      // `min-w-0` + `min-h-0` lets the button shrink below its content's
      // intrinsic size when placed in a CSS grid cell — without these, a
      // card whose tech name was longer than the cell would force the
      // column wider and push neighboring cards off-screen.
      className={`gm-card group relative flex flex-col rounded-[18px] ${compact ? 'p-[2px]' : 'p-[3px]'} text-left transition-all duration-200 hover:-translate-y-1.5 w-full h-full min-w-0 min-h-0`}
      style={{ background: C.frame, boxShadow: `0 6px 22px ${C.chip}33, 0 1px 2px rgba(31,41,55,0.06)` }}
    >
      <div className={`relative flex flex-col ${compact ? 'rounded-[13px]' : 'rounded-[15px]'} overflow-hidden w-full h-full min-w-0`} style={{ background: '#FFFDF7' }}>
        {topBar}
        {compact ? (
          // LANDSCAPE: art on the left (fixed 86px wide, fills height),
          // name + stats stacked on the right.
          <div className="flex flex-row flex-1 min-h-0 gap-1.5 px-2 pb-1.5 mt-1">
            {artWindow}
            {/* justify-center vertically centers name + stat block as a
                stack, so when the row is taller than the content the slack
                splits above + below instead of forming a single gap
                between name and stats. */}
            <div className="flex flex-col flex-1 min-w-0 justify-center">
              {namePlate}
              {statBlock}
            </div>
          </div>
        ) : (
          // PORTRAIT (default): vertical stack — unchanged dashboard layout.
          <>
            {artWindow}
            {namePlate}
            {statBlock}
          </>
        )}
      </div>
    </button>
  );
}

export default function TechProduction() {
  const [rows, setRows] = useState<TechRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<'cards' | 'table' | 'chart'>('cards');
  const [detail, setDetail] = useState<TechRow | null>(null);
  const [windowKind, setWindowKind] = useState<WindowKind>('this_week');
  // Table-only sort state. Default = billed hours desc (the column most
  // operationally meaningful for a roster scan). Click any header to toggle.
  type SortCol = 'rank' | 'techName' | 'shopName' | 'billedHours' | 'jobs' | 'efficiency';
  const [sortCol, setSortCol] = useState<SortCol>('billedHours');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    const range = windowKind === 'this_week' ? 'this_week' : 'last_7_days';
    (async () => {
      setError(null);
      try {
        const res = await fetch(`/api/tech-production?range=${range}`);
        if (!res.ok) { if (!cancelled) setError(`Server returned ${res.status}`); return; }
        const d = await res.json();
        if (cancelled) return;
        if (d.error) { setError(d.error); return; }
        setRows(d.rows || []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Network error');
      }
    })();
    return () => { cancelled = true; };
  }, [windowKind]);

  const TOP_N = 10;
  // Cards mode is the leaderboard — only techs at/above 90% efficiency
  // qualify for a card (per spec; anything below isn't a "performer" win).
  // Table mode is a roster: it shows EVERY tech the API returned so you can
  // scan or export the whole staff. "Show all" expands the top-N truncation
  // in either mode; in table mode it reveals the full company.
  const listed = (() => {
    if (mode !== 'table') return (rows || []).filter((r) => r.efficiency >= 0.90);
    const all = (rows || []).slice();
    const dir = sortDir === 'asc' ? 1 : -1;
    all.sort((a, b) => {
      if (sortCol === 'techName')   return dir * (a.techName || `Tech ${a.technicianId}`).localeCompare(b.techName || `Tech ${b.technicianId}`);
      if (sortCol === 'shopName')   return dir * a.shopName.localeCompare(b.shopName);
      if (sortCol === 'billedHours') return dir * (a.billedHours - b.billedHours);
      if (sortCol === 'jobs')        return dir * (a.jobs - b.jobs);
      if (sortCol === 'efficiency')  return dir * (a.efficiency - b.efficiency);
      // 'rank' falls back to efficiency-desc for stable ordering since rank
      // isn't a stored field; clicking # while in default state cycles dir.
      return dir * (a.efficiency - b.efficiency);
    });
    return all;
  })();
  const display = showAll ? listed : listed.slice(0, TOP_N);
  const expandLabel = mode === 'table' ? 'employees' : 'technicians';

  function onSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      // Numeric columns default to desc on first click (largest-first reads
      // naturally for hours / jobs / efficiency / rank). String columns
      // default to asc (A→Z).
      setSortDir(col === 'techName' || col === 'shopName' ? 'asc' : 'desc');
    }
  }

  const shopTotals = (() => {
    const m = new Map<string, { shopNum: string; shopName: string; hours: number; jobs: number }>();
    for (const r of rows || []) {
      const e = m.get(r.shopNum) || { shopNum: r.shopNum, shopName: r.shopName, hours: 0, jobs: 0 };
      e.hours += r.billedHours; e.jobs += r.jobs; m.set(r.shopNum, e);
    }
    return [...m.values()].sort((a, b) => b.hours - a.hours);
  })();

  const seg = (active: boolean) =>
    `p-1.5 rounded-md transition ${active ? 'bg-mango-ink text-white' : 'text-mango-muted hover:text-mango-ink'}`;

  return (
    <div className="card mb-8">
      {/* Header row: title on the left, WindowToggle in the upper-right
          corner — matches the layout of every other rolling-7d/this-week
          section (FBR, Call Conversion, Comebacks, Google Ratings, Return
          Customers). View-mode buttons get their own row below.
          The toggle is wrapped with `ml-auto` so it stays right-aligned even
          when the title block's subtitle text changes width on flip and
          would otherwise force the toggle to wrap to the next line and
          left-align. */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <Wrench className="w-[18px] h-[18px] text-mango-faint shrink-0" />
          <div className="min-w-0">
            <h2 className="section-h flex items-center gap-1.5">
              Tech Production — {windowKind === 'this_week' ? 'This Week' : 'Rolling 7 Days'}
              {mode === 'cards' && <TierLegendTooltip />}
            </h2>
            <p className="section-sub mt-0.5">
              {windowKind === 'this_week'
                ? 'Mon → today · authorized labor on revenue-realized ROs · efficiency denominator scales with elapsed working days'
                : 'Rolling 7 days · 100% = 42.5 available hrs/tech · authorized labor on revenue-realized ROs'}
            </p>
          </div>
        </div>
        <div className="ml-auto shrink-0">
          <WindowToggle value={windowKind} onChange={setWindowKind} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end">
        <div className="flex items-center gap-1 bg-mango-bg rounded-lg p-1">
          <button onClick={() => setMode('cards')} title="Cards" className={seg(mode === 'cards')}><LayoutGrid className="w-4 h-4" /></button>
          <button onClick={() => setMode('table')} title="Table" className={seg(mode === 'table')}><Table2 className="w-4 h-4" /></button>
          <button onClick={() => setMode('chart')} title="Hours by shop" className={seg(mode === 'chart')}><BarChart3 className="w-4 h-4" /></button>
        </div>
      </div>

      {error ? (
        <div className="mt-5 p-4 bg-mango-red/10 border border-mango-red/30 rounded-xl text-sm">
          <div className="font-semibold text-mango-red mb-1">Couldn't load Tech Production</div>
          <div className="text-mango-muted">{error}</div>
        </div>
      ) : !rows ? (
        <div className="h-[320px] mt-5 animate-pulse bg-mango-bg rounded-xl" />
      ) : mode === 'cards' ? (
        display && display.length > 0 ? (
          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {display.map((r, i) => (
              <TechCard key={`${r.technicianId}-${r.shopNum}`} r={r} rank={i + 1} onClick={() => setDetail(r)} />
            ))}
          </div>
        ) : (() => {
          // No tech at 90%+ yet (typical on Monday morning). Fall back to a
          // top-5 leaderboard so the widget still informs instead of going
          // dark. Cards earn their tier once efficiency catches up to the
          // elapsed-working-days denominator.
          const topByEff = [...(rows || [])].sort((a, b) => b.efficiency - a.efficiency).slice(0, 5);
          if (topByEff.length === 0) {
            return <div className="mt-5 py-8 text-center text-sm text-mango-muted">No technician billing posted yet for this window.</div>;
          }
          return (
            <div className="mt-5">
              <div className="mb-3 rounded-xl px-4 py-3 text-sm bg-mango-amber/10 border border-mango-amber/30">
                <span className="font-semibold text-mango-ink">No tech at 90%+ yet</span>
                <span className="text-mango-muted"> — week is still young. Top performers so far below; cards unlock as billed hours catch up to the elapsed working-days denominator.</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-mango-line">
                <table className="w-full text-sm">
                  <thead className="text-xs font-medium text-mango-muted bg-mango-bg/50">
                    <tr>
                      <th className="py-2.5 px-3 text-left">#</th>
                      <th className="py-2.5 px-3 text-left">Technician</th>
                      <th className="py-2.5 px-3 text-left">Shop</th>
                      <th className="py-2.5 px-3 text-right">Billed Hrs</th>
                      <th className="py-2.5 px-3 text-right">Jobs</th>
                      <th className="py-2.5 px-3 text-right">Efficiency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topByEff.map((r, i) => (
                      <tr key={`${r.technicianId}-${r.shopNum}`} className="border-t border-mango-line/60 hover:bg-mango-bg/40 cursor-pointer" onClick={() => setDetail(r)}>
                        <td className="py-2.5 px-3 text-mango-muted">{i + 1}</td>
                        <td className="py-2.5 px-3 font-medium text-mango-ink">{r.techName || `Tech ${r.technicianId}`}</td>
                        <td className="py-2.5 px-3 text-mango-muted">{r.shopName}</td>
                        <td className="py-2.5 px-3 text-right tnum">{r.billedHours.toFixed(1)}</td>
                        <td className="py-2.5 px-3 text-right tnum">{num(r.jobs)}</td>
                        <td className={`py-2.5 px-3 text-right font-semibold tnum ${r.efficiency >= 0.75 ? 'text-mango-amber' : 'text-mango-red'}`}>{pct(r.efficiency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()
      ) : mode === 'table' ? (
        <div className="mt-5 overflow-x-auto rounded-xl border border-mango-line">
          <table className="w-full text-sm">
            <thead className="text-xs font-medium text-mango-muted bg-mango-bg/50">
              <tr>
                <SortableTh col="rank"        align="left"  current={sortCol} dir={sortDir} onSort={onSort}>#</SortableTh>
                <SortableTh col="techName"    align="left"  current={sortCol} dir={sortDir} onSort={onSort}>Technician</SortableTh>
                <SortableTh col="shopName"    align="left"  current={sortCol} dir={sortDir} onSort={onSort}>Shop</SortableTh>
                <SortableTh col="billedHours" align="right" current={sortCol} dir={sortDir} onSort={onSort}>Billed Hrs</SortableTh>
                <SortableTh col="jobs"        align="right" current={sortCol} dir={sortDir} onSort={onSort}>Jobs</SortableTh>
                <SortableTh col="efficiency"  align="right" current={sortCol} dir={sortDir} onSort={onSort}>Efficiency</SortableTh>
              </tr>
            </thead>
            <tbody>
              {display?.map((r, i) => (
                <tr key={`${r.technicianId}-${r.shopNum}`} className="border-t border-mango-line/60 hover:bg-mango-bg/40 cursor-pointer" onClick={() => setDetail(r)}>
                  <td className="py-2.5 px-3 text-mango-muted">
                    <span className="inline-flex items-center gap-1.5">{i + 1}{i < 3 && <TrophyIcon rank={(i + 1) as 1 | 2 | 3} size={14} />}</span>
                  </td>
                  <td className="py-2.5 px-3 font-medium text-mango-ink">{r.techName || `Tech ${r.technicianId}`}</td>
                  <td className="py-2.5 px-3 text-mango-muted">{r.shopName}</td>
                  <td className="py-2.5 px-3 text-right tnum">{r.billedHours.toFixed(1)}</td>
                  <td className="py-2.5 px-3 text-right tnum">{num(r.jobs)}</td>
                  <td className={`py-2.5 px-3 text-right font-semibold tnum ${r.efficiency >= 1 ? 'text-mango-green' : r.efficiency >= 0.75 ? 'text-mango-amber' : 'text-mango-red'}`}>{pct(r.efficiency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-5" style={{ width: '100%', height: Math.max(280, shopTotals.length * 38 + 40) }}>
          <ResponsiveContainer>
            <BarChart
              data={shopTotals.map(s => ({ name: s.shopName, hours: Number(s.hours.toFixed(1)), jobs: s.jobs }))}
              layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 8 }}
            >
              <XAxis type="number" tick={{ fontSize: 11, fill: '#9AA1AC' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: '#6B7280' }} interval={0} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #ECEEF1' }}
                formatter={(val: any, _k, ctx: any) => [`${val} hrs · ${num(ctx.payload.jobs)} jobs`, ctx.payload.name]} />
              <Bar dataKey="hours" radius={[0, 6, 6, 0]} label={{ position: 'right', fontSize: 11, fill: '#6B7280', formatter: (v: any) => `${v} hrs` }}>
                {shopTotals.map((s, i) => <Cell key={i} fill="#F5A623" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {listed.length > TOP_N && (
        <button onClick={() => setShowAll(!showAll)} className="mt-5 w-full pt-3 border-t border-mango-line text-sm font-medium text-mango-muted hover:text-mango-ink flex items-center justify-center gap-1.5">
          {showAll ? `Show top ${TOP_N}` : `Show all ${listed.length} ${expandLabel}`}
          <ChevronDown className={`w-4 h-4 transition-transform ${showAll ? 'rotate-180' : ''}`} />
        </button>
      )}

      {/* Technician detail drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-mango-ink/30" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-card max-w-sm w-full p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center"><MangoTierIcon tier={tierFor(detail.efficiency)} size={84} /></div>
            <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: TIER_TEXT[tierFor(detail.efficiency)] }}>
              {tierFor(detail.efficiency)}
            </div>
            <div className="mt-2 text-xl font-semibold text-mango-ink">{detail.techName || `Tech ${detail.technicianId}`}</div>
            <div className="text-[13px] text-mango-muted">{detail.shopName}</div>
            <div className="my-5 h-px w-full bg-mango-line" />
            <div className="grid grid-cols-3 gap-3">
              {[['Efficiency', pct(detail.efficiency)], ['Billed Hrs', detail.billedHours.toFixed(1)], ['Jobs', num(detail.jobs)]].map(([l, v]) => (
                <div key={l} className="rounded-xl bg-mango-bg py-3">
                  <div className="text-[15px] font-semibold text-mango-ink tnum">{v}</div>
                  <div className="text-[10px] uppercase tracking-wide text-mango-faint mt-0.5">{l}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setDetail(null)} className="mt-5 text-[13px] text-mango-muted hover:text-mango-ink">Close</button>
          </div>
        </div>
      )}

      <style jsx>{`
        .gm-spin { animation: gm-spin 22s linear infinite; }
        @keyframes gm-spin { to { transform: rotate(360deg); } }
        .gm-spark { animation: gm-tw 2.6s ease-in-out infinite; box-shadow: 0 0 6px 1px rgba(255,240,190,0.9); }
        @keyframes gm-tw { 0%,72%,100% { opacity: 0; transform: scale(0.3); } 14%,26% { opacity: 1; transform: scale(1); } }
        /* holographic foil sweep — sits over the art window */
        .gm-foil {
          background: linear-gradient(115deg,
            transparent 18%, rgba(255,255,255,0.55) 32%, rgba(180,230,255,0.35) 42%,
            rgba(255,210,150,0.40) 50%, rgba(255,255,255,0.55) 60%, transparent 76%);
          background-size: 280% 280%;
          background-position: 120% 0;
          mix-blend-mode: soft-light;
        }
        .gm-card:hover .gm-foil { transition: background-position 0.9s ease; background-position: -40% 0; }
        @media (prefers-reduced-motion: reduce) {
          .gm-spin, .gm-spark { animation: none; }
        }
      `}</style>
    </div>
  );
}

// Sortable column header. Click to toggle sort direction on that column;
// clicking a different column makes that the new sort column with its
// natural default direction (asc for strings, desc for numbers).
function SortableTh({
  col, align, current, dir, onSort, children,
}: {
  col: 'rank' | 'techName' | 'shopName' | 'billedHours' | 'jobs' | 'efficiency';
  align: 'left' | 'right';
  current: string;
  dir: 'asc' | 'desc';
  onSort: (col: any) => void;
  children: React.ReactNode;
}) {
  const active = current === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`py-2.5 px-3 ${align === 'right' ? 'text-right' : 'text-left'} cursor-pointer select-none hover:text-mango-ink transition`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {children}
        {active
          ? (dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
          : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </span>
    </th>
  );
}
