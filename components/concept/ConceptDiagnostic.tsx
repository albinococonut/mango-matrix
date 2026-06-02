'use client';

// ─────────────────────────────────────────────────────────────────────────
// CONCEPT ONLY — high-fidelity visual redesign draft of the Diagnostic view.
// Not wired to live data; uses representative figures. Production components
// and the real /diagnostic page are untouched. Every section / KPI / panel
// from the real Diagnostic view is reproduced — only the visual language is
// elevated (warm-ivory luxury OS, frosted glass, editorial type, and a
// luminous blue→coral heat spectrum instead of traffic-light colors).
// ─────────────────────────────────────────────────────────────────────────

import { useState } from 'react';

// ── palette derived from the gradient reference ───────────────────────────
const INK = '#22201C';
const INK2 = '#5C564E';
const FAINT = '#938C81';
const LINE = 'rgba(34,32,28,0.08)';
const AMBER = '#E8863E';   // primary warm accent (the "mango" sun, refined)
const CORAL = '#EE6B43';
const BLUE = '#5FA9D6';    // cool accent

// Heat spectrum, best (cool/calm) → worst (warm/attention). No green/red
// traffic lights — a continuous luminous temperature scale.
const HEAT_STOPS: [number, [number, number, number]][] = [
  [1.00, [122, 192, 230]], // sky blue
  [0.80, [139, 205, 197]], // teal
  [0.60, [193, 214, 142]], // chartreuse
  [0.44, [242, 206, 112]], // warm gold
  [0.28, [240, 166, 92]],  // amber
  [0.00, [237, 104, 66]],  // coral
];
function heatRGB(score: number): [number, number, number] {
  const s = Math.max(0, Math.min(1, score));
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const [hi, c1] = HEAT_STOPS[i];
    const [lo, c2] = HEAT_STOPS[i + 1];
    if (s <= hi && s >= lo) {
      const t = (s - lo) / (hi - lo);
      return [0, 1, 2].map((k) => Math.round(c2[k] + (c1[k] - c2[k]) * t)) as [number, number, number];
    }
  }
  return HEAT_STOPS[s >= 1 ? 0 : HEAT_STOPS.length - 1][1];
}
// Soft luminous cell fill — diffused, atmospheric, never a flat saturated block.
function heatCell(score: number): React.CSSProperties {
  const [r, g, b] = heatRGB(score);
  return {
    background: `radial-gradient(135% 160% at 28% -10%, rgba(${r},${g},${b},0.50), rgba(${r},${g},${b},0.16) 70%, rgba(${r},${g},${b},0.08))`,
    boxShadow: `inset 0 0 0 1px rgba(${r},${g},${b},0.28)`,
  };
}
function heatDot(score: number): string {
  const [r, g, b] = heatRGB(score);
  return `rgb(${r},${g},${b})`;
}
function norm(v: number, lo: number, hi: number, invert = false): number {
  const t = (v - lo) / (hi - lo);
  const c = Math.max(0, Math.min(1, t));
  return invert ? 1 - c : c;
}

// ── formatting ─────────────────────────────────────────────────────────────
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const usd0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const usdK = (n: number) =>
  Math.abs(n) >= 1000 ? '$' + (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : '$' + Math.round(n);

// ── representative data (8 shops, 4 districts) ─────────────────────────────
interface Shop {
  num: string; name: string; district: string;
  rev: number; goal: number; gpPct: number; cars: number; carsTarget: number;
  aro: number; close: number; conv: number; rebook: number; comebacks: number;
  hours: number; hoursTarget: number; ramping?: boolean;
}
const SHOPS: Shop[] = [
  { num: '001', name: 'Cottonwood',  district: 'Albuquerque', rev: 52400, goal: 54000, gpPct: 57.2, cars: 71, carsTarget: 73, aro: 738, close: 58, conv: 47, rebook: 41, comebacks: 1850, hours: 286, hoursTarget: 300 },
  { num: '002', name: 'The Heights', district: 'Albuquerque', rev: 50100, goal: 49000, gpPct: 59.1, cars: 66, carsTarget: 66, aro: 759, close: 61, conv: 52, rebook: 44, comebacks: 920,  hours: 268, hoursTarget: 272 },
  { num: '003', name: 'Downtown',    district: 'Albuquerque', rev: 41200, goal: 44000, gpPct: 55.8, cars: 58, carsTarget: 59, aro: 710, close: 54, conv: 39, rebook: 33, comebacks: 2600, hours: 232, hoursTarget: 244 },
  { num: '004', name: 'Pellicano',   district: 'El Paso',     rev: 28800, goal: 32000, gpPct: 54.1, cars: 41, carsTarget: 43, aro: 702, close: 49, conv: 35, rebook: 28, comebacks: 3100, hours: 188, hoursTarget: 216, ramping: true },
  { num: '005', name: 'Las Cruces',  district: 'Las Cruces',  rev: 53900, goal: 51000, gpPct: 60.3, cars: 70, carsTarget: 68, aro: 770, close: 63, conv: 55, rebook: 47, comebacks: 780,  hours: 300, hoursTarget: 300 },
  { num: '006', name: 'Yuma',        district: 'Yuma',        rev: 48600, goal: 51000, gpPct: 56.9, cars: 67, carsTarget: 68, aro: 725, close: 57, conv: 44, rebook: 38, comebacks: 1980, hours: 278, hoursTarget: 292 },
  { num: '007', name: 'Montana',     district: 'El Paso',     rev: 19800, goal: 21000, gpPct: 53.2, cars: 29, carsTarget: 28, aro: 683, close: 46, conv: 33, rebook: 25, comebacks: 1450, hours: 132, hoursTarget: 140 },
  { num: '009', name: 'The Valley',  district: 'Albuquerque', rev: 37400, goal: 41000, gpPct: 55.1, cars: 53, carsTarget: 55, aro: 706, close: 51, conv: 41, rebook: 31, comebacks: 2200, hours: 214, hoursTarget: 228 },
];
const SHOP_DOT: Record<string, string> = {
  '001': '#E8863E', '002': '#3FB6C6', '003': '#EE6B43', '004': '#6FB58A',
  '005': '#9B86D6', '006': '#F2C541', '007': '#E68FAC', '009': '#6FA8E0',
};

const CHAIN = {
  current: SHOPS.reduce((s, x) => s + x.rev, 0),       // 332,200
  goal: SHOPS.reduce((s, x) => s + x.goal, 0),          // 343,000
  cars: SHOPS.reduce((s, x) => s + x.cars, 0),          // 455
  projected: 352400,
  worst: 331000, best: 377000,
  elapsed: 4.8,
};
const CHAIN_GP$ = SHOPS.reduce((s, x) => s + x.rev * x.gpPct / 100, 0);
const CHAIN_GPPCT = (CHAIN_GP$ / CHAIN.current) * 100;
const CHAIN_ARO = CHAIN.current / CHAIN.cars;
const CHAIN_REBOOK = 38.6;
const CHAIN_CONV = 45.0;
const CHAIN_COMEBACKS = SHOPS.reduce((s, x) => s + x.comebacks, 0);

// ── primitives ─────────────────────────────────────────────────────────────
function Card({ id, eyebrow, title, sub, right, children, pad = true }: {
  id?: string; eyebrow?: string; title?: string; sub?: string;
  right?: React.ReactNode; children: React.ReactNode; pad?: boolean;
}) {
  return (
    <section id={id} className="scroll-mt-6 mb-7">
      <div
        className="rounded-[26px] border"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.58))',
          backdropFilter: 'blur(22px)',
          WebkitBackdropFilter: 'blur(22px)',
          borderColor: 'rgba(255,255,255,0.75)',
          boxShadow: '0 1px 0 rgba(255,255,255,0.9) inset, 0 18px 48px -28px rgba(40,34,26,0.30), 0 2px 8px -4px rgba(40,34,26,0.10)',
        }}
      >
        {(eyebrow || title || right) && (
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
            <div className="min-w-0">
              {eyebrow && (
                <div className="cui text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>{eyebrow}</div>
              )}
              {title && (
                <h2 className="cdisplay leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.01em' }}>{title}</h2>
              )}
              {sub && <div className="cui text-[12.5px] mt-1" style={{ color: INK2 }}>{sub}</div>}
            </div>
            {right && <div className="shrink-0">{right}</div>}
          </div>
        )}
        <div className={pad ? 'px-6 py-5' : ''}>{children}</div>
      </div>
    </section>
  );
}

function Pill({ children, active, tone = 'neutral' }: { children: React.ReactNode; active?: boolean; tone?: 'neutral' | 'accent' }) {
  return (
    <span
      className="cui inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition"
      style={{
        background: active ? 'rgba(232,134,62,0.12)' : 'rgba(255,255,255,0.6)',
        color: active ? '#B5631F' : INK2,
        border: `1px solid ${active ? 'rgba(232,134,62,0.30)' : 'rgba(34,32,28,0.10)'}`,
      }}
    >
      {children}
    </span>
  );
}

function Chevron() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-full p-1" style={{ background: 'rgba(34,32,28,0.05)', border: `1px solid ${LINE}` }}>
      {tabs.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)}
          className="cui rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition"
          style={value === k
            ? { background: '#fff', color: INK, boxShadow: '0 1px 4px rgba(40,34,26,0.12)' }
            : { color: INK2, background: 'transparent' }}>
          {label}
        </button>
      ))}
    </div>
  );
}

// big editorial KPI number
function BigStat({ label, value, sub, color }: { label: string; value: string; sub?: React.ReactNode; color?: string }) {
  return (
    <div>
      <div className="cui text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>{label}</div>
      <div className="cdisplay tabular-nums leading-none mt-1.5" style={{ color: color || INK, fontSize: 44, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div className="cui text-[12.5px] mt-2" style={{ color: INK2 }}>{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }}>
      <div className="cdisplay tabular-nums leading-none" style={{ color: INK, fontSize: 22, letterSpacing: '-0.01em' }}>{value}</div>
      <div className="cui text-[11px] mt-1.5" style={{ color: FAINT }}>{label}</div>
    </div>
  );
}

// ── Section: Header / control strip ────────────────────────────────────────
function HeaderStrip() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div>
        <div className="cui text-[11px] font-semibold uppercase tracking-[0.22em] mb-1" style={{ color: AMBER }}>The Mango Matrix</div>
        <h1 className="cdisplay leading-none" style={{ color: INK, fontSize: 40, letterSpacing: '-0.02em' }}>Diagnostic</h1>
        <div className="cui text-[12.5px] mt-2" style={{ color: INK2 }}>Operational analytics · multi-state portfolio · 8 locations</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Pill active><span className="font-semibold">This Week</span><Chevron /></Pill>
        <Pill>All Shops <Chevron /></Pill>
        <span className="cui text-[11.5px] flex items-center gap-1.5" style={{ color: FAINT }}>
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#6FB58A' }} />
          Updated 5:12 PM MT
        </span>
      </div>
    </div>
  );
}

// ── Section: Revenue Projection ────────────────────────────────────────────
function ForecastBar({ worst, expected, best }: { worst: number; expected: number; best: number }) {
  const span = Math.max(1, best - worst);
  const pos = Math.max(4, Math.min(96, ((expected - worst) / span) * 100));
  return (
    <div className="w-full">
      <div className="relative h-2.5 rounded-full overflow-visible" style={{ background: 'rgba(34,32,28,0.06)' }}>
        <div className="absolute inset-y-0 left-[8%] right-[8%] rounded-full"
          style={{ background: 'linear-gradient(90deg, rgba(95,169,214,0.45), rgba(242,206,112,0.55), rgba(232,134,62,0.55))' }} />
        <div className="absolute -top-1 h-4.5 w-4.5 rounded-full" style={{ left: `calc(${pos}% - 9px)`, width: 18, height: 18, background: '#fff', boxShadow: '0 0 0 4px rgba(232,134,62,0.25), 0 2px 6px rgba(40,34,26,0.25)' }} />
      </div>
      <div className="cui mt-2 flex justify-between text-[11px] tabular-nums" style={{ color: FAINT }}>
        <span>{usdK(worst)} worst</span><span style={{ color: INK, fontWeight: 600 }}>{usdK(expected)} expected</span><span>{usdK(best)} best</span>
      </div>
    </div>
  );
}

function ProjectionSection() {
  const [tab, setTab] = useState<'portfolio' | 'districts' | 'shops'>('portfolio');
  const pace = CHAIN.current / CHAIN.goal;
  const districts = ['Albuquerque', 'Las Cruces', 'El Paso', 'Yuma'].map((d) => {
    const list = SHOPS.filter((s) => s.district === d);
    return {
      name: d,
      rev: list.reduce((a, s) => a + s.rev, 0),
      goal: list.reduce((a, s) => a + s.goal, 0),
      cars: list.reduce((a, s) => a + s.cars, 0),
      projected: Math.round(list.reduce((a, s) => a + s.rev, 0) * 1.06),
    };
  });
  return (
    <Card id="projection" eyebrow="Forecast" title="Revenue Projection"
      right={<Tabs value={tab} onChange={(v) => setTab(v as any)} tabs={[['portfolio', 'Portfolio'], ['districts', 'Districts'], ['shops', 'Shop-by-Shop']]} />}>
      {/* live facts strip */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 mb-5 cui text-[13px]" style={{ color: INK2 }}>
        <span>Current Revenue <span className="cdisplay tabular-nums" style={{ color: INK, fontSize: 16 }}>{usd(CHAIN.current)}</span></span>
        <span>Period Elapsed <span className="cdisplay tabular-nums" style={{ color: INK, fontSize: 16 }}>{CHAIN.elapsed.toFixed(1)} days / 5 day week</span></span>
        <span>This Week&rsquo;s Goal <span className="cdisplay tabular-nums" style={{ color: INK, fontSize: 16 }}>{usd(CHAIN.goal)}</span></span>
      </div>

      {tab === 'portfolio' && (
        <div className="rounded-3xl p-6" style={{ background: 'linear-gradient(160deg, rgba(95,169,214,0.10), rgba(242,206,112,0.08) 55%, rgba(232,134,62,0.10))', border: `1px solid ${LINE}` }}>
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 items-center">
            <div>
              <BigStat label="Projected · This Week" value={usd(CHAIN.projected)}
                color={INK}
                sub={<span style={{ color: '#3E8E5E' }} className="font-semibold">+{usdK(CHAIN.projected - CHAIN.goal)} vs goal · pacing {(pace * 100).toFixed(0)}%</span>} />
              <div className="mt-5"><ForecastBar worst={CHAIN.worst} expected={CHAIN.projected} best={CHAIN.best} /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="Projected cars" value={String(CHAIN.cars)} />
              <MiniStat label="Projected ARO" value={usd0(CHAIN_ARO)} />
              <MiniStat label="Projected GP $" value={usdK(CHAIN_GP$)} />
              <MiniStat label="GP %" value={CHAIN_GPPCT.toFixed(1) + '%'} />
              <MiniStat label="Confidence" value="86%" />
              <MiniStat label="Districts" value="4" />
            </div>
          </div>
        </div>
      )}

      {tab === 'districts' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {districts.map((d) => {
            const sc = norm(d.rev / d.goal, 0.82, 1.04);
            return (
              <div key={d.name} className="rounded-3xl p-5" style={{ ...heatCell(sc), border: 'none' }}>
                <div className="flex items-baseline justify-between">
                  <div className="cdisplay" style={{ color: INK, fontSize: 19 }}>{d.name}</div>
                  <div className="cui text-[11px] font-semibold uppercase tracking-wide" style={{ color: INK2 }}>{Math.round(d.rev / d.goal * 100)}% of goal</div>
                </div>
                <div className="cdisplay tabular-nums mt-2" style={{ color: INK, fontSize: 30, letterSpacing: '-0.02em' }}>{usd(d.projected)}</div>
                <div className="cui text-[12px] mt-2 flex gap-4" style={{ color: INK2 }}>
                  <span>{d.cars} cars</span><span>Goal {usdK(d.goal)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'shops' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {SHOPS.map((s) => {
            const sc = norm(s.rev / s.goal, 0.80, 1.05);
            const gap = s.rev - s.goal;
            return (
              <div key={s.num} className="rounded-3xl p-5" style={{ ...heatCell(sc), border: 'none' }}>
                <div className="flex items-center justify-between">
                  <div className="cdisplay" style={{ color: INK, fontSize: 17 }}>{s.name}</div>
                  <span className="cui text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5" style={{ background: 'rgba(255,255,255,0.6)', color: INK2 }}>{s.district}</span>
                </div>
                <div className="cdisplay tabular-nums mt-2" style={{ color: INK, fontSize: 28, letterSpacing: '-0.02em' }}>{usd(s.rev)}</div>
                <div className="cui text-[12px] font-semibold mt-1" style={{ color: gap >= 0 ? '#3E8E5E' : '#C05A2E' }}>
                  {gap >= 0 ? '+' : '−'}{usdK(Math.abs(gap))} vs goal
                  {s.ramping && <span className="ml-2 font-medium" style={{ color: INK2 }}>· ramping</span>}
                </div>
                <div className="cui text-[11.5px] mt-2 flex gap-3" style={{ color: INK2 }}>
                  <span>{s.cars} cars</span><span>{usd0(s.aro)} ARO</span><span>{s.gpPct.toFixed(0)}% GP</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Section: Operational Diagnostics (revenue tree, GP tree, signals) ──────
function DiagNode({ title, value, target, detail, score, lift }: {
  title: string; value: string; target?: string; detail?: string; score: number; lift?: string;
}) {
  return (
    <div className="rounded-2xl p-4" style={{ ...heatCell(score), border: 'none' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="cui text-[12px] font-semibold" style={{ color: INK }}>{title}</div>
          {target && <div className="cui text-[11px] mt-0.5" style={{ color: INK2 }}>{target}</div>}
        </div>
        <span className="inline-block w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ background: heatDot(score), boxShadow: `0 0 8px ${heatDot(score)}` }} />
      </div>
      <div className="cdisplay tabular-nums mt-2" style={{ color: INK, fontSize: 26, letterSpacing: '-0.01em' }}>{value}</div>
      {detail && <div className="cui text-[11.5px] mt-1" style={{ color: INK2 }}>{detail}</div>}
      {lift && (
        <div className="cui text-[11.5px] mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: 'rgba(255,255,255,0.6)', color: '#B5631F', fontWeight: 600 }}>
          ↑ {lift} recoverable
        </div>
      )}
    </div>
  );
}

function DiagnosticsSection() {
  return (
    <Card id="overview" eyebrow="Operational Diagnostics" title="What&rsquo;s broken → why → what fixing it is worth">
      {/* Revenue diagnostic */}
      <div className="mb-6">
        <div className="cui text-[12px] font-semibold uppercase tracking-[0.14em] mb-3" style={{ color: FAINT }}>Revenue diagnostic</div>
        <div className="rounded-2xl p-5 mb-3" style={{ ...heatCell(norm(CHAIN.current / CHAIN.goal, 0.82, 1.04)), border: 'none' }}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="cui text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: INK2 }}>Revenue · pacing below goal</div>
              <div className="cdisplay tabular-nums mt-1" style={{ color: INK, fontSize: 40, letterSpacing: '-0.02em' }}>{usd(CHAIN.current)}</div>
            </div>
            <div className="cui text-[13px]" style={{ color: INK2 }}>
              vs prorated goal <span className="cdisplay tabular-nums" style={{ color: INK, fontSize: 15 }}>{usd(CHAIN.goal)}</span> · gap <span className="cdisplay tabular-nums" style={{ color: '#C05A2E' }}>{usdK(CHAIN.goal - CHAIN.current)}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <DiagNode title="Car Count" target="vs target 457" value={String(CHAIN.cars)} detail="2 cars under pace" score={norm(CHAIN.cars / 457, 0.85, 1.03)} lift={usdK(1460)} />
          <DiagNode title="ARO" target="vs benchmark $750" value={usd0(CHAIN_ARO)} detail="$20 below benchmark" score={norm(CHAIN_ARO, 690, 775)} lift={usdK(9100)} />
          <DiagNode title="Call Conversion" target="vs target 55%" value={CHAIN_CONV.toFixed(0) + '%'} detail="318 qualified calls" score={norm(CHAIN_CONV, 33, 56)} lift={usdK(18400)} />
        </div>
      </div>

      {/* Gross profit diagnostic */}
      <div className="mb-6">
        <div className="cui text-[12px] font-semibold uppercase tracking-[0.14em] mb-3" style={{ color: FAINT }}>Gross profit diagnostic</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <DiagNode title="Blended GP %" target="vs 58% company target" value={CHAIN_GPPCT.toFixed(1) + '%'} detail={`GP $ ${usdK(CHAIN_GP$)}`} score={norm(CHAIN_GPPCT, 53, 60)} lift={usdK(3300)} />
          <DiagNode title="Parts GP %" target="vs 52% target" value="49.4%" detail="Matrix leakage on tires" score={norm(49.4, 44, 53)} lift={usdK(5600)} />
          <DiagNode title="Labor GP %" target="vs 68% target" value="66.1%" detail="Effective labor rate soft" score={norm(66.1, 60, 69)} lift={usdK(4200)} />
        </div>
      </div>

      {/* Operational signals */}
      <div>
        <div className="cui text-[12px] font-semibold uppercase tracking-[0.14em] mb-3" style={{ color: FAINT }}>Operational signals</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <DiagNode title="Re-Book Rate" target="forward-booking" value={CHAIN_REBOOK.toFixed(1) + '%'} detail="Chain, this week" score={norm(CHAIN_REBOOK, 25, 48)} />
          <DiagNode title="Comebacks" target="revenue lost" value={usdK(CHAIN_COMEBACKS)} detail="comeback ROs this week" score={norm(CHAIN_COMEBACKS, 4000, 14000, true)} />
          <DiagNode title="Close Rate" target="estimate → authorized" value="54%" detail="chain blended" score={norm(54, 44, 64)} />
        </div>
      </div>
    </Card>
  );
}

// ── Section: Revenue Opportunity ───────────────────────────────────────────
function OpportunitySection() {
  const rows = [
    { lever: 'Call conversion → 55%', impact: 18400, ease: 'moderate' as const, why: '318 qualified calls / wk' },
    { lever: 'ARO → $750 benchmark', impact: 9100, ease: 'easy' as const, why: 'Declined-job follow-through' },
    { lever: 'Parts GP matrix', impact: 5600, ease: 'easy' as const, why: 'Tire & brake margin' },
    { lever: 'Labor GP / effective rate', impact: 4200, ease: 'moderate' as const, why: 'Tech efficiency + rate' },
    { lever: 'Comeback reduction', impact: 3800, ease: 'hard' as const, why: 'QC on top-3 shops' },
    { lever: 'Car count → pace', impact: 1460, ease: 'moderate' as const, why: 'Missed callbacks queue' },
  ];
  const total = rows.reduce((s, r) => s + r.impact, 0);
  const max = Math.max(...rows.map((r) => r.impact));
  const easeTone: Record<string, string> = { easy: '#3E8E5E', moderate: '#B5631F', hard: '#C05A2E' };
  return (
    <Card id="opportunity" eyebrow="Revenue Opportunity" title="Recoverable revenue this week"
      right={<div className="text-right"><div className="cdisplay tabular-nums" style={{ color: AMBER, fontSize: 30 }}>{usd(total)}</div><div className="cui text-[11px]" style={{ color: FAINT }}>weekly upside</div></div>}>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.lever} className="flex items-center gap-4">
            <div className="w-52 shrink-0">
              <div className="cui text-[13px] font-semibold" style={{ color: INK }}>{r.lever}</div>
              <div className="cui text-[11px]" style={{ color: FAINT }}>{r.why}</div>
            </div>
            <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.05)' }}>
              <div className="h-full rounded-full" style={{ width: `${(r.impact / max) * 100}%`, background: 'linear-gradient(90deg, rgba(242,206,112,0.9), rgba(232,134,62,0.95))' }} />
            </div>
            <div className="cdisplay tabular-nums w-20 text-right" style={{ color: INK, fontSize: 16 }}>{usdK(r.impact)}</div>
            <span className="cui w-20 text-right text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: easeTone[r.ease] }}>{r.ease}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Section: Revenue Comparison (bars) ─────────────────────────────────────
function ComparisonSection() {
  const [metric, setMetric] = useState<'rev' | 'cars' | 'aro'>('rev');
  const cfg = {
    rev: { label: 'Revenue', val: (s: Shop) => s.rev, fmt: (n: number) => usdK(n) },
    cars: { label: 'Cars', val: (s: Shop) => s.cars, fmt: (n: number) => String(n) },
    aro: { label: 'ARO', val: (s: Shop) => s.aro, fmt: (n: number) => usd0(n) },
  }[metric];
  const sorted = [...SHOPS].sort((a, b) => cfg.val(b) - cfg.val(a));
  const max = Math.max(...sorted.map(cfg.val));
  return (
    <Card id="comparison" eyebrow="Revenue Comparison" title="Shop-by-shop"
      right={<Tabs value={metric} onChange={(v) => setMetric(v as any)} tabs={[['rev', 'Revenue'], ['cars', 'Cars'], ['aro', 'ARO']]} />}>
      <div className="space-y-3">
        {sorted.map((s) => (
          <div key={s.num} className="flex items-center gap-4">
            <div className="cui w-28 shrink-0 text-[13px] font-medium flex items-center gap-2" style={{ color: INK }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: SHOP_DOT[s.num] }} />{s.name}
            </div>
            <div className="flex-1 h-7 rounded-lg overflow-hidden relative" style={{ background: 'rgba(34,32,28,0.04)' }}>
              <div className="h-full rounded-lg" style={{ width: `${(cfg.val(s) / max) * 100}%`, background: `linear-gradient(90deg, ${SHOP_DOT[s.num]}66, ${SHOP_DOT[s.num]}cc)` }} />
            </div>
            <div className="cdisplay tabular-nums w-20 text-right" style={{ color: INK, fontSize: 16 }}>{cfg.fmt(cfg.val(s))}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Section: Shop Performance Heatmap (the centerpiece) ────────────────────
const HEAT_METRICS: { key: string; label: string; display: (s: Shop) => string; score: (s: Shop) => number }[] = [
  { key: 'rev', label: 'Revenue', display: (s) => usdK(s.rev), score: (s) => norm(s.rev / s.goal, 0.82, 1.04) },
  { key: 'gpPct', label: 'GP %', display: (s) => s.gpPct.toFixed(1) + '%', score: (s) => norm(s.gpPct, 53, 60) },
  { key: 'gp$', label: 'GP $', display: (s) => usdK(s.rev * s.gpPct / 100), score: (s) => norm(s.gpPct, 53, 60) },
  { key: 'cars', label: 'Cars', display: (s) => String(s.cars), score: (s) => norm(s.cars / s.carsTarget, 0.85, 1.04) },
  { key: 'aro', label: 'ARO', display: (s) => usd0(s.aro), score: (s) => norm(s.aro, 690, 775) },
  { key: 'close', label: 'Close', display: (s) => s.close + '%', score: (s) => norm(s.close, 46, 64) },
  { key: 'conv', label: 'Call Conv', display: (s) => s.conv + '%', score: (s) => norm(s.conv, 33, 56) },
  { key: 'rebook', label: 'Re-Book', display: (s) => s.rebook + '%', score: (s) => norm(s.rebook, 25, 48) },
  { key: 'comebacks', label: 'Comebacks', display: (s) => usdK(s.comebacks), score: (s) => norm(s.comebacks, 600, 3200, true) },
  { key: 'hours', label: 'Hours', display: (s) => String(s.hours), score: (s) => norm(s.hours / s.hoursTarget, 0.82, 1.02) },
];
function HeatmapSection() {
  return (
    <Card id="performance" eyebrow="Shop Performance" title="Performance heatmap"
      sub="Every shop × every metric. Cooler = on pace, warmer = needs attention."
      right={
        <div className="flex items-center gap-2 cui text-[11px]" style={{ color: FAINT }}>
          <span>On track</span>
          <span className="rounded-full" style={{ width: 96, height: 8, background: 'linear-gradient(90deg, rgb(122,192,230), rgb(139,205,197), rgb(193,214,142), rgb(242,206,112), rgb(240,166,92), rgb(237,104,66))' }} />
          <span>Attention</span>
        </div>
      } pad={false}>
      <div className="overflow-x-auto px-6 py-5">
        <table className="w-full border-separate" style={{ borderSpacing: '6px' }}>
          <thead>
            <tr>
              <th className="cui text-left text-[11px] font-semibold uppercase tracking-wide pb-1" style={{ color: FAINT }}>Shop</th>
              {HEAT_METRICS.map((m) => (
                <th key={m.key} className="cui text-center text-[10.5px] font-semibold uppercase tracking-wide pb-1 px-1" style={{ color: FAINT }}>{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SHOPS.map((s) => (
              <tr key={s.num}>
                <td className="cui pr-3 text-[13px] font-medium whitespace-nowrap" style={{ color: INK }}>
                  <span className="inline-flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full" style={{ background: SHOP_DOT[s.num] }} />{s.name}</span>
                </td>
                {HEAT_METRICS.map((m) => {
                  const sc = m.score(s);
                  return (
                    <td key={m.key} className="rounded-xl text-center align-middle" style={{ ...heatCell(sc), minWidth: 74, height: 46 }}>
                      <span className="cdisplay tabular-nums" style={{ color: INK, fontSize: 14.5 }}>{m.display(s)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Section: Performance Trends (area chart) ───────────────────────────────
function TrendsSection() {
  const [metric, setMetric] = useState<'rev' | 'gp' | 'conv'>('rev');
  const series = {
    rev: { label: 'Revenue', data: [298, 311, 305, 322, 318, 330, 326, 332], fmt: (n: number) => '$' + n + 'k' },
    gp: { label: 'GP %', data: [55.8, 56.1, 56.4, 56.9, 57.2, 56.8, 57.0, 57.0], fmt: (n: number) => n.toFixed(1) + '%' },
    conv: { label: 'Call Conversion', data: [41, 43, 42, 45, 44, 46, 45, 45], fmt: (n: number) => n + '%' },
  }[metric];
  const W = 720, H = 180, pad = 8;
  const min = Math.min(...series.data), max = Math.max(...series.data);
  const pts = series.data.map((v, i) => {
    const x = pad + (i / (series.data.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / (max - min || 1)) * (H - pad * 2);
    return [x, y];
  });
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = `${line} L ${pts[pts.length - 1][0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z`;
  const weeks = ['8w', '7w', '6w', '5w', '4w', '3w', '2w', 'now'];
  return (
    <Card id="trends" eyebrow="Performance Trends" title="Last 8 weeks"
      right={<Tabs value={metric} onChange={(v) => setMetric(v as any)} tabs={[['rev', 'Revenue'], ['gp', 'GP %'], ['conv', 'Conversion']]} />}>
      <div className="w-full overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }} preserveAspectRatio="none">
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(232,134,62,0.30)" />
              <stop offset="55%" stopColor="rgba(242,206,112,0.16)" />
              <stop offset="100%" stopColor="rgba(95,169,214,0.04)" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#trendFill)" />
          <path d={line} fill="none" stroke="#E8863E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4.5 : 2.5} fill="#fff" stroke="#E8863E" strokeWidth="2" />)}
        </svg>
        <div className="cui flex justify-between mt-2 text-[11px] tabular-nums" style={{ color: FAINT }}>
          {weeks.map((w, i) => <span key={i}>{w}</span>)}
        </div>
        <div className="cui mt-3 text-[12.5px]" style={{ color: INK2 }}>
          {series.label} · latest <span className="cdisplay" style={{ color: INK, fontSize: 15 }}>{series.fmt(series.data[series.data.length - 1])}</span>
        </div>
      </div>
    </Card>
  );
}

// ── Section: Accounts Receivable ───────────────────────────────────────────
function ARSection() {
  const buckets = [
    { label: 'Current', amt: 142000, c: 'rgb(122,192,230)' },
    { label: '1–30 days', amt: 58000, c: 'rgb(139,205,197)' },
    { label: '31–60 days', amt: 24000, c: 'rgb(242,206,112)' },
    { label: '61–90 days', amt: 11000, c: 'rgb(240,166,92)' },
    { label: '90+ days', amt: 7000, c: 'rgb(237,104,66)' },
  ];
  const total = buckets.reduce((s, b) => s + b.amt, 0);
  return (
    <Card id="receivables" eyebrow="Accounts Receivable" title="Aging"
      right={<div className="text-right"><div className="cdisplay tabular-nums" style={{ color: INK, fontSize: 28 }}>{usd(total)}</div><div className="cui text-[11px]" style={{ color: FAINT }}>total outstanding</div></div>}>
      <div className="h-4 w-full rounded-full overflow-hidden flex" style={{ border: `1px solid ${LINE}` }}>
        {buckets.map((b) => <div key={b.label} style={{ width: `${(b.amt / total) * 100}%`, background: b.c }} />)}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5">
        {buckets.map((b) => (
          <div key={b.label} className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }}>
            <div className="flex items-center gap-2 cui text-[11px]" style={{ color: FAINT }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: b.c }} />{b.label}
            </div>
            <div className="cdisplay tabular-nums mt-1.5" style={{ color: INK, fontSize: 20 }}>{usdK(b.amt)}</div>
            <div className="cui text-[11px] mt-0.5" style={{ color: INK2 }}>{((b.amt / total) * 100).toFixed(0)}%</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Section: Return Customers ──────────────────────────────────────────────
function ReturnCustomersSection() {
  const rows = SHOPS.map((s) => ({ ...s, ret: Math.round(s.rebook * 0.92 + 18) })).sort((a, b) => b.ret - a.ret);
  return (
    <Card id="return-customers" eyebrow="Return Customers" title="Retention leaderboard">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="cui text-[11px] font-semibold uppercase tracking-wide" style={{ color: FAINT }}>
              <th className="text-left pb-3 pl-1">#</th>
              <th className="text-left pb-3">Shop</th>
              <th className="text-left pb-3">District</th>
              <th className="text-right pb-3">Return rate</th>
              <th className="text-left pb-3 pl-6 w-1/3">vs chain</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const sc = norm(s.ret, 38, 66);
              return (
                <tr key={s.num} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td className="cdisplay py-3 pl-1" style={{ color: FAINT, fontSize: 15 }}>{i + 1}</td>
                  <td className="cui py-3 text-[13.5px] font-medium" style={{ color: INK }}>
                    <span className="inline-flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full" style={{ background: SHOP_DOT[s.num] }} />{s.name}</span>
                  </td>
                  <td className="cui py-3 text-[12.5px]" style={{ color: INK2 }}>{s.district}</td>
                  <td className="cdisplay tabular-nums py-3 text-right" style={{ color: INK, fontSize: 17 }}>{s.ret}%</td>
                  <td className="py-3 pl-6">
                    <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(34,32,28,0.05)' }}>
                      <div className="h-full rounded-full" style={{ width: `${sc * 100}%`, background: heatDot(sc) }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── page ───────────────────────────────────────────────────────────────────
export default function ConceptDiagnostic() {
  return (
    <div className="relative min-h-screen cui" style={{ color: INK, background: '#F1ECE3' }}>
      {/* ambient luminous fog — diffused heat atmosphere, not loud gradients */}
      <div className="pointer-events-none fixed inset-0 z-0" aria-hidden style={{ overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-12%', right: '-8%', width: 720, height: 720, borderRadius: '50%', filter: 'blur(120px)', background: 'radial-gradient(circle, rgba(95,169,214,0.30), rgba(95,169,214,0) 70%)' }} />
        <div style={{ position: 'absolute', top: '24%', left: '-10%', width: 680, height: 680, borderRadius: '50%', filter: 'blur(130px)', background: 'radial-gradient(circle, rgba(242,206,112,0.26), rgba(242,206,112,0) 70%)' }} />
        <div style={{ position: 'absolute', bottom: '-14%', left: '30%', width: 760, height: 760, borderRadius: '50%', filter: 'blur(140px)', background: 'radial-gradient(circle, rgba(232,134,62,0.22), rgba(232,134,62,0) 72%)' }} />
        <div style={{ position: 'absolute', top: '4%', left: '38%', width: 520, height: 520, borderRadius: '50%', filter: 'blur(120px)', background: 'radial-gradient(circle, rgba(139,205,197,0.20), rgba(139,205,197,0) 72%)' }} />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1280px] px-5 lg:px-10 py-8 lg:py-10">
        {/* concept banner */}
        <div className="cui inline-flex items-center gap-2 rounded-full px-3 py-1 mb-6 text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ background: 'rgba(255,255,255,0.6)', border: `1px solid ${LINE}`, color: FAINT }}>
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: AMBER }} />
          Redesign concept · preview only · not production
        </div>

        <HeaderStrip />
        <ProjectionSection />
        <DiagnosticsSection />
        <OpportunitySection />
        <ComparisonSection />
        <HeatmapSection />
        <TrendsSection />
        <ARSection />
        <ReturnCustomersSection />

        <footer className="cui text-center text-[11px] py-8" style={{ color: FAINT }}>
          The Mango Matrix · Diagnostic · concept draft · representative figures
        </footer>
      </div>
    </div>
  );
}
