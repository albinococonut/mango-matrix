'use client';

// Shared concept2 luxury kit — the bespoke visual system (palette, heat
// gradient, formatters, frosted primitives) + the ConceptShell (frosted
// sidebar + cream/orb background + page header) used by every /concept2 page.
// This is concept1's design language extracted once so all concept2 pages
// share it. Fonts (.c2disp / .c2ui) are provided by app/concept2/layout.tsx.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// ── palette + heat spectrum ────────────────────────────────────────────────
export const INK = '#22201C', INK2 = '#5C564E', FAINT = '#938C81', LINE = 'rgba(34,32,28,0.08)';
export const AMBER = '#E8863E';
export const GOOD = '#3E8E5E', BAD = '#C05A2E', WARN = '#B5631F';
export const COOL = '#3E9CB0';

const HEAT_STOPS: [number, [number, number, number]][] = [
  [1.00, [122, 192, 230]], [0.80, [139, 205, 197]], [0.60, [193, 214, 142]],
  [0.44, [242, 206, 112]], [0.28, [240, 166, 92]], [0.00, [237, 104, 66]],
];
export function heatRGB(s0: number): [number, number, number] {
  const s = Math.max(0, Math.min(1, s0));
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const [hi, c1] = HEAT_STOPS[i]; const [lo, c2] = HEAT_STOPS[i + 1];
    if (s <= hi && s >= lo) { const t = (s - lo) / (hi - lo); return [0, 1, 2].map((k) => Math.round(c2[k] + (c1[k] - c2[k]) * t)) as [number, number, number]; }
  }
  return HEAT_STOPS[s >= 1 ? 0 : HEAT_STOPS.length - 1][1];
}
export function heatCell(score: number): React.CSSProperties {
  const [r, g, b] = heatRGB(score);
  return { background: `radial-gradient(135% 160% at 28% -10%, rgba(${r},${g},${b},0.50), rgba(${r},${g},${b},0.16) 70%, rgba(${r},${g},${b},0.08))`, boxShadow: `inset 0 0 0 1px rgba(${r},${g},${b},0.28)` };
}
export const heatDot = (s: number) => { const [r, g, b] = heatRGB(s); return `rgb(${r},${g},${b})`; };
export function norm(v: number, lo: number, hi: number, invert = false): number { const t = (v - lo) / (hi - lo); const c = Math.max(0, Math.min(1, t)); return invert ? 1 - c : c; }

// ── formatters ──────────────────────────────────────────────────────────────
export const usd = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US');
export const usd0 = usd;
export const usdK = (n: number) => (Math.abs(n) >= 1000 ? '$' + (n / 1000).toFixed(Math.abs(n) >= 100000 ? 0 : 1) + 'k' : '$' + Math.round(n || 0));
export const pctS = (v: number, dp = 0) => (v * 100).toFixed(dp) + '%';

export const safe = async <T,>(url: string): Promise<T | null> => { try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) return null; return (await r.json()) as T; } catch { return null; } };

// ── frosted primitives ──────────────────────────────────────────────────────
export function Card({ id, eyebrow, title, sub, right, children, pad = true, colHeader = false }: { id?: string; eyebrow?: string; title?: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; pad?: boolean; colHeader?: boolean }) {
  return (
    <section id={id} className="scroll-mt-6 mb-7">
      <div className="rounded-[26px] border" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255,255,255,0.82))', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', borderColor: 'rgba(237,220,206,0.85)', boxShadow: '0 1px 0 rgba(255,255,255,0.95) inset, 0 20px 54px -26px rgba(40,34,26,0.24), 0 3px 10px -3px rgba(40,34,26,0.09)' }}>
        {(eyebrow || title || right) && (
          colHeader ? (
            <div className="px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
              <div>
                {eyebrow && <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>{eyebrow}</div>}
                {title && <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.01em' }}>{title}</h2>}
                {sub && <div className="c2ui text-[12.5px] mt-1" style={{ color: INK2 }}>{sub}</div>}
              </div>
              {right && <div className="flex flex-wrap gap-2 mt-3">{right}</div>}
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
              <div className="min-w-0">
                {eyebrow && <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: FAINT }}>{eyebrow}</div>}
                {title && <h2 className="c2disp leading-tight mt-1" style={{ color: INK, fontSize: 25, letterSpacing: '-0.01em' }}>{title}</h2>}
                {sub && <div className="c2ui text-[12.5px] mt-1" style={{ color: INK2 }}>{sub}</div>}
              </div>
              {right && <div className="shrink-0">{right}</div>}
            </div>
          )
        )}
        <div className={pad ? 'px-6 py-5' : ''}>{children}</div>
      </div>
    </section>
  );
}
export function Dropdown({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: { key: string; label: string }[] }) {
  return (
    <div className="relative inline-block">
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="c2ui appearance-none rounded-lg pl-3.5 pr-8 py-1.5 text-[12.5px] font-semibold cursor-pointer c2-select"
        style={{ background: '#fff', color: INK, border: `1px solid rgba(237,220,206,1)`, boxShadow: '0 1px 3px rgba(31,41,55,0.07)' }}>
        {opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={INK2} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"><path d="M6 9l6 6 6-6" /></svg>
    </div>
  );
}
export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-full p-1" style={{ background: 'rgba(34,32,28,0.05)', border: `1px solid ${LINE}` }}>
      {tabs.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} className="c2ui rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition" style={value === k ? { background: '#fff', color: INK, boxShadow: '0 1px 3px rgba(0,0,0,0.14), 0 1px 2px rgba(0,0,0,0.08)' } : { color: INK2, background: 'transparent' }}>{label}</button>
      ))}
    </div>
  );
}
export function BigStat({ label, value, sub, color }: { label: string; value: string; sub?: React.ReactNode; color?: string }) {
  return (<div><div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: FAINT }}>{label}</div><div className="c2disp tabular-nums leading-none mt-1.5" style={{ color: color || INK, fontSize: 44, letterSpacing: '-0.02em' }}>{value}</div>{sub && <div className="c2ui text-[12.5px] mt-2" style={{ color: INK2 }}>{sub}</div>}</div>);
}
export function MiniStat({ label, value }: { label: string; value: string }) {
  return (<div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.55)', border: `1px solid ${LINE}` }}><div className="c2disp tabular-nums leading-none" style={{ color: INK, fontSize: 22, letterSpacing: '-0.01em' }}>{value}</div><div className="c2ui text-[12.5px] mt-1.5" style={{ color: FAINT }}>{label}</div></div>);
}
export function ForecastBar({ worst, expected, best }: { worst: number; expected: number; best: number }) {
  const span = Math.max(1, best - worst); const pos = Math.max(4, Math.min(96, ((expected - worst) / span) * 100));
  return (<div className="w-full"><div className="relative h-2.5 rounded-full" style={{ background: 'rgba(34,32,28,0.06)' }}><div className="absolute inset-y-0 left-[8%] right-[8%] rounded-full" style={{ background: 'linear-gradient(90deg, rgba(95,169,214,0.45), rgba(242,206,112,0.55), rgba(232,134,62,0.55))' }} /><div className="absolute -top-1 rounded-full" style={{ left: `calc(${pos}% - 9px)`, width: 18, height: 18, background: '#fff', boxShadow: '0 0 0 4px rgba(232,134,62,0.25), 0 2px 6px rgba(40,34,26,0.25)' }} /></div><div className="c2ui mt-2 flex justify-between text-[12.5px] tabular-nums" style={{ color: FAINT }}><span>{usdK(worst)} worst</span><span style={{ color: INK, fontWeight: 600 }}>{usdK(expected)} expected</span><span>{usdK(best)} best</span></div></div>);
}

// Soft pill (status chips, etc.)
export function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' | 'cool' }) {
  const map: Record<string, { c: string; bg: string }> = {
    good: { c: GOOD, bg: 'rgba(62,142,94,0.12)' }, warn: { c: WARN, bg: 'rgba(181,99,31,0.12)' },
    bad: { c: BAD, bg: 'rgba(192,90,46,0.12)' }, cool: { c: COOL, bg: 'rgba(62,156,176,0.12)' },
    neutral: { c: INK2, bg: 'rgba(34,32,28,0.06)' },
  };
  const s = map[tone] || map.neutral;
  return <span className="c2ui inline-flex items-center rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold" style={{ color: s.c, background: s.bg }}>{children}</span>;
}

// ── ConceptShell — frosted sidebar + cream/orb background + page header ──────
type NavId = 'diagnostic' | 'review' | 'employee' | 'todo' | 'tv' | 'parts-matrix';
const NAV: { id: NavId; label: string; href: string }[] = [
  { id: 'diagnostic', label: 'Diagnostic', href: '/diagnostic' },
  { id: 'review', label: 'Weekly Review', href: '/review' },
  { id: 'parts-matrix', label: 'Parts Pricing', href: '/parts-matrix' },
  { id: 'employee', label: 'Employee View', href: '/employee' },
];
const EMP_CHILDREN: { id: NavId; label: string; href: string }[] = [
  { id: 'todo', label: 'To Do', href: '/todo' },
  { id: 'tv', label: 'TV', href: '/tv' },
];

async function doLogout() {
  await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logout: true }) });
  window.location.href = '/login';
}

function Orbs() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden style={{ overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '-12%', right: '-8%', width: 720, height: 720, borderRadius: '50%', filter: 'blur(140px)', background: 'radial-gradient(circle, rgba(95,169,214,0.18), rgba(95,169,214,0) 70%)' }} />
      <div style={{ position: 'absolute', top: '24%', left: '-10%', width: 680, height: 680, borderRadius: '50%', filter: 'blur(160px)', background: 'radial-gradient(circle, rgba(242,206,112,0.10), rgba(242,206,112,0) 70%)' }} />
      <div style={{ position: 'absolute', bottom: '-14%', left: '30%', width: 760, height: 760, borderRadius: '50%', filter: 'blur(170px)', background: 'radial-gradient(circle, rgba(232,134,62,0.08), rgba(232,134,62,0) 72%)' }} />
      <div style={{ position: 'absolute', top: '4%', left: '38%', width: 520, height: 520, borderRadius: '50%', filter: 'blur(130px)', background: 'radial-gradient(circle, rgba(139,205,197,0.14), rgba(139,205,197,0) 72%)' }} />
    </div>
  );
}

export function ConceptShell({
  active, eyebrow = 'The Mango Matrix', title, sub, sections, headerRight, email, children,
}: {
  active: NavId; eyebrow?: string; title?: string; sub?: string;
  sections?: { id: string; label: string }[]; headerRight?: React.ReactNode; email?: string; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const allMobile = [...NAV, ...EMP_CHILDREN];

  // Collapse state — persisted to localStorage so the user's choice survives
  // page navigation, matching production's ExecSidebar UX. Initial render
  // uses `false` to match what the server renders; useEffect hydrates from
  // storage on mount. There's a brief flicker on first paint if the user
  // collapsed it before — the trade-off vs forcing a render-blocking inline
  // script. Subsequent loads are instant.
  const COLLAPSE_KEY = 'c2_sidebar_collapsed_v1';
  const [collapsed, setCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { if (window.localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true); } catch { /* private mode / quota */ }
  }, []);

  // Track which section is in view so the sub-nav item highlights automatically.
  useEffect(() => {
    if (!sections?.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting);
        if (hit.length) setActiveSection(hit[0].target.id);
      },
      { rootMargin: '-8% 0px -82% 0px', threshold: 0 },
    );
    sections.forEach((s) => { const el = document.getElementById(s.id); if (el) obs.observe(el); });
    // Also initialise from hash on first mount
    if (window.location.hash) setActiveSection(window.location.hash.slice(1));
    return () => obs.disconnect();
  }, [sections]);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* */ }
      return next;
    });
  };

  // Top-level + child-level nav item — left-bar active state (no full fill),
  // serif label, generous spacing. The bar carries the active signal so the
  // label is left to read as plain typography.
  const NavLink = ({ href, label, on, size = 'top' }: { href: string; label: string; on: boolean; size?: 'top' | 'child' }) => (
    <Link href={href} className="relative flex items-center pl-5 pr-3 transition" style={{ paddingTop: size === 'top' ? 12 : 9, paddingBottom: size === 'top' ? 12 : 9 }}>
      {on && <span className="absolute left-0 rounded-r-sm" style={{ top: 6, bottom: 6, width: 3, background: AMBER, boxShadow: '2px 0 8px rgba(232,134,62,0.30)' }} />}
      <span className={on && size === 'top' ? 'c2disp' : 'c2ui'} style={{ color: on ? '#B5631F' : (size === 'top' ? INK2 : INK2), fontSize: on && size === 'top' ? 19 : size === 'top' ? 15 : 14, letterSpacing: on && size === 'top' ? '-0.01em' : 0, fontWeight: size === 'top' ? 500 : 500 }}>{label}</span>
    </Link>
  );
  // Collapsed-mode nav rail — vertical column of single-letter initials so
  // identity is preserved while the column shrinks to ~56px. Active item
  // still gets the amber bar so the visual signal is consistent across the
  // expanded/collapsed states.
  const railItem = (href: string, label: string, on: boolean, initial: string) => (
    <Link key={href} href={href} className="relative flex items-center justify-center w-10 h-10 rounded-lg transition" title={label} style={{ background: on ? 'rgba(232,134,62,0.10)' : 'transparent' }}>
      {on && <span className="absolute left-0 rounded-r-sm" style={{ top: 6, bottom: 6, width: 3, background: AMBER }} />}
      <span className="c2disp" style={{ color: on ? '#B5631F' : INK2, fontSize: 15, letterSpacing: '-0.01em', fontWeight: 500 }}>{initial}</span>
    </Link>
  );
  const ChevronLeft = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
  );
  const ChevronRight = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
  );
  const goldRule = <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(232,134,62,0.45), transparent)' }} />;

  return (
    <div className="relative min-h-screen c2ui" style={{ color: INK, background: '#FBFAF8' }}>
      <Orbs />
      <div className="relative z-10 flex">
        {/* Sidebar — frosted column with gold-ruled wordmark, left-bar active
            state, and a refined sub-anchor list under the active category.
            Collapsible to a ~56px rail of single-letter nav links + a
            chevron-right to expand. Matches the production ExecSidebar UX. */}
        {collapsed ? (
          <aside className="hidden lg:flex flex-col items-center w-14 shrink-0 sticky top-0 h-screen py-7 gap-2" style={{ background: 'linear-gradient(180deg, rgba(253,248,242,0.76), rgba(251,244,236,0.56))', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', borderRight: '1px solid rgba(237,220,206,0.75)' }}>
            {/* Expand toggle */}
            <button onClick={toggleCollapsed} aria-label="Expand sidebar" className="flex items-center justify-center w-10 h-10 rounded-lg transition" style={{ color: INK2 }} title="Expand sidebar">
              {ChevronRight}
            </button>
            <div className="my-2 w-8">{goldRule}</div>
            {/* Top-level rail items + sub-items as single-letter initials. */}
            <div className="flex flex-col items-center gap-1">
              {NAV.map((c) => railItem(c.href, c.label, c.id === active, c.label.charAt(0)))}
              {/* Employee children — initials TD / TV to distinguish */}
              {EMP_CHILDREN.map((ch) => railItem(ch.href, ch.label, ch.id === active, ch.id === 'todo' ? 'T' : 'V'))}
            </div>
            {/* Footer — sign-out icon only */}
            <div className="mt-auto flex flex-col items-center gap-2 pb-1">
              <div className="w-8">{goldRule}</div>
              <button onClick={doLogout} aria-label="Sign out" title={email ? `Sign out · ${email}` : 'Sign out'} className="flex items-center justify-center w-10 h-10 rounded-lg transition" style={{ color: INK2 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              </button>
            </div>
          </aside>
        ) : (
          <aside className="hidden lg:flex flex-col w-64 shrink-0 sticky top-0 h-screen py-7" style={{ background: 'linear-gradient(180deg, rgba(253,248,242,0.76), rgba(251,244,236,0.56))', backdropFilter: 'blur(22px)', WebkitBackdropFilter: 'blur(22px)', borderRight: '1px solid rgba(237,220,206,0.75)' }}>
            {/* Wordmark + collapse toggle */}
            <div className="px-5">
              {goldRule}
              <div className="py-4 flex items-start justify-between gap-2">
                <div className="min-w-0 flex items-center gap-2.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logo.png" alt="Mango Automotive" className="h-8 w-auto object-contain shrink-0" />
                  <div className="c2disp leading-tight" style={{ color: INK, fontSize: 16, letterSpacing: '-0.02em' }}>The Mango Matrix</div>
                </div>
                <button onClick={toggleCollapsed} aria-label="Collapse sidebar" title="Collapse sidebar" className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition -mt-0.5" style={{ color: FAINT }}>
                  {ChevronLeft}
                </button>
              </div>
              {goldRule}
            </div>

            {/* Nav */}
            <nav className="flex-1 flex flex-col gap-0.5 overflow-y-auto pt-5">
              {NAV.map((c) => {
                const on = c.id === active;
                return (
                  <div key={c.id} className="flex flex-col">
                    <NavLink href={c.href} label={c.label} on={on} size="top" />
                    {on && sections && sections.length > 0 && (
                      <div className="mt-0.5 mb-2 pl-5 pr-3 flex flex-col gap-0">
                        {sections.map((s) => {
                          const sOn = activeSection === s.id;
                          return (
                            <a key={s.id} href={`#${s.id}`} onClick={() => setActiveSection(s.id)}
                              className="c2ui relative flex items-center rounded-md py-1.5 pl-4 pr-2 text-[14px] transition"
                              style={{ color: sOn ? '#B5631F' : INK2, fontWeight: sOn ? 600 : 400, letterSpacing: '0.005em' }}>
                              {sOn && <span className="absolute left-0 rounded-r-sm" style={{ top: 4, bottom: 4, width: 2, background: AMBER, boxShadow: '2px 0 6px rgba(232,134,62,0.25)' }} />}
                              {s.label}
                            </a>
                          );
                        })}
                      </div>
                    )}
                    {c.id === 'employee' && (
                      <div className="mb-1">
                        {EMP_CHILDREN.map((ch) => <NavLink key={ch.id} href={ch.href} label={ch.label} on={ch.id === active} size="child" />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>

            {/* Footer — divider, identity, sign out */}
            <div className="mt-4 px-5">
              {goldRule}
              {email && <div className="mt-4 c2ui text-[12.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: FAINT }}>Signed in as</div>}
              {email && <div className="mt-1 c2ui text-[13px] truncate" style={{ color: INK }} title={email}>{email}</div>}
              <button onClick={doLogout} className="mt-3 c2ui text-[12px] transition" style={{ color: FAINT }}>Sign out</button>
            </div>
          </aside>
        )}

        {/* Main */}
        <main className="flex-1 min-w-0 mx-auto w-full max-w-[1320px] px-5 lg:px-10 py-8 lg:py-10">
          {/* Mobile nav bar */}
          <div className="lg:hidden mb-6 pb-4" style={{ borderBottom: `1px solid ${LINE}` }}>
            <nav className="flex items-center gap-1 overflow-x-auto text-[13px] font-semibold">
              {allMobile.map((c) => {
                const on = c.id === active;
                return <Link key={c.id} href={c.href} className="c2ui shrink-0 rounded-full px-3 py-1.5 transition" style={on ? { background: 'rgba(232,134,62,0.14)', color: '#B5631F', boxShadow: '0 1px 4px rgba(232,134,62,0.22)' } : { color: INK2 }}>{c.label}</Link>;
              })}
            </nav>
          </div>

          {/* Header — only rendered when title is provided */}
          {(title || headerRight) && (
            <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
              <div>
                {eyebrow && <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.22em] mb-1" style={{ color: AMBER }}>{eyebrow}</div>}
                {title && <h1 className="c2disp c2-page-h1 leading-none" style={{ color: INK, fontSize: 40, letterSpacing: '-0.02em' }}>{title}</h1>}
                {sub && <div className="c2ui text-[12.5px] mt-2" style={{ color: INK2 }}>{sub}</div>}
              </div>
              {headerRight && <div className="shrink-0">{headerRight}</div>}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

export function LoadingSkeleton() {
  return (<div className="space-y-4">{[0, 1, 2, 3].map((i) => <div key={i} className="rounded-[26px] c2-shimmer" style={{ height: i === 0 ? 220 : 160, background: 'rgba(255,255,255,0.5)', border: `1px solid rgba(237,220,206,0.7)` }} />)}</div>);
}
