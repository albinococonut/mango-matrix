'use client';

// ExecSidebar — 3-category navigation for executive users.
//
// Categories:
//   • Diagnostic   → /diagnostic (operational analytics, projection, opportunity, etc.)
//   • Review       → /review     (corporate finance review — formerly Finance View)
//   • Employee View → /employee   (what employees see; execs use this to preview)
//
// Sublinks under each category are page-scoped anchors (#id) that the section
// components on each page expose. The active category is determined from the
// URL via usePathname; only the active category's sublinks are rendered.

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { nameFromEmail } from '@/lib/format';

type Category = 'diagnostic' | 'review' | 'employee';

const CATEGORIES: { id: Category; label: string; href: string }[] = [
  { id: 'diagnostic', label: 'Diagnostic',    href: '/diagnostic' },
  { id: 'review',     label: 'Weekly Review',  href: '/review' },
  { id: 'employee',   label: 'Employee View', href: '/employee' },
];

// Routes that live UNDER Employee View — rendered indented beneath it and
// always visible (they're navigation destinations, not page anchors, so they
// must stay reachable from any page).
const EMPLOYEE_CHILDREN: { label: string; href: string }[] = [
  { label: 'To Do', href: '/todo' },
  { label: 'TV',    href: '/tv' },
];

const SUBLINKS: Record<Category, { id: string; label: string }[]> = {
  diagnostic: [
    { id: 'projection',   label: 'Revenue Projection' },
    { id: 'overview',     label: 'Operational Diagnostics' },
    { id: 'opportunity',  label: 'Revenue Opportunity' },
    { id: 'comparison',   label: 'Revenue Comparison' },
    { id: 'performance',  label: 'Shop Performance' },
    { id: 'receivables',  label: 'Accounts Receivable' },
    { id: 'trends',       label: 'Performance Trends' },
  ],
  review: [
    { id: 'vitals',       label: 'Company Performance' },
    { id: 'gp-goal',      label: 'GP $ Goal' },
    { id: 'shops',        label: 'Shop-by-Shop Review' },
    { id: 'diagnostic',   label: 'Diagnostic Callouts' },
    { id: 'ar',           label: 'Accounts Receivable' },
    { id: 'waterfall',    label: 'Financial Waterfall' },
    { id: 'expenses',     label: 'Expense Classification' },
  ],
  employee: [
    { id: 'golden',       label: 'Golden Mango' },
    { id: 'trophies',     label: 'Trophy Standings' },
    { id: 'operations',   label: 'Operations' },
  ],
};

// Active TOP-LEVEL category (drives which anchor sublinks render). The
// Employee-View children (/todo, /tv) are NOT top-level — they highlight
// themselves via pathname — so this returns null on those routes.
function activeFromPath(pathname: string | null): Category | null {
  if (pathname?.startsWith('/review'))   return 'review';
  if (pathname?.startsWith('/todo'))     return null;
  if (pathname?.startsWith('/tv'))       return null;
  if (pathname?.startsWith('/employee')) return 'employee';
  return 'diagnostic';
}

export default function ExecSidebar({ onLogout, email }: { onLogout: () => void; email?: string }) {
  const pathname = usePathname();
  const active = activeFromPath(pathname);
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside className="hidden lg:flex flex-col items-center w-14 shrink-0 sticky top-0 h-screen border-r border-mango-line bg-white/70 backdrop-blur py-7">
        <button onClick={() => setCollapsed(false)} aria-label="Expand sidebar"
          className="text-mango-muted hover:text-mango-ink hover:bg-mango-bg rounded-lg p-2 transition">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside className="hidden lg:flex flex-col w-64 shrink-0 sticky top-0 h-screen border-r border-mango-line bg-white/70 backdrop-blur px-4 py-7">
      <div className="flex items-start justify-between gap-2 px-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="Mango Automotive" className="h-12 w-auto object-contain object-left self-start shrink-0 mb-1.5" />
        <button onClick={() => setCollapsed(true)} aria-label="Collapse sidebar"
          className="text-mango-faint hover:text-mango-ink hover:bg-mango-bg rounded-lg p-1.5 transition shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>
      <div className="text-[13px] font-semibold tracking-[-0.01em] text-mango-ink mb-7 px-1"
        style={{ fontFamily: "'Sora', system-ui, sans-serif" }}>
        The Mango Matrix
      </div>

      <nav className="flex-1 flex flex-col gap-1 overflow-y-auto">
        {CATEGORIES.map((c) => {
          const isActive = c.id === active;
          return (
            <div key={c.id} className="flex flex-col">
              <Link href={c.href}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-[13.5px] font-semibold transition ${
                  isActive
                    ? 'bg-mango-orange/10 text-mango-orange'
                    : 'text-mango-ink hover:bg-mango-bg'
                }`}
                style={isActive ? { color: '#C97A1F' } : undefined}>
                <span>{c.label}</span>
                {isActive && <span className="text-[10px]" style={{ color: '#C97A1F' }}>●</span>}
              </Link>
              {isActive && SUBLINKS[c.id].length > 0 && (
                <div className="mt-1 ml-2 mb-1 pl-3 border-l border-mango-line/60 flex flex-col gap-0.5">
                  {SUBLINKS[c.id].map((s) => (
                    <a key={s.id} href={`#${s.id}`}
                      className="text-[12px] text-mango-muted hover:text-mango-ink hover:bg-mango-bg rounded-md px-2 py-1 transition">
                      {s.label}
                    </a>
                  ))}
                </div>
              )}
              {/* To Do + TV — indented routes nested under Employee View,
                  always visible so they're reachable from any page. */}
              {c.id === 'employee' && (
                <div className="mt-1 ml-2 mb-2 pl-3 border-l border-mango-line/60 flex flex-col gap-0.5">
                  {EMPLOYEE_CHILDREN.map((ch) => {
                    const childActive = !!pathname && (pathname === ch.href || pathname.startsWith(ch.href + '/'));
                    return (
                      <Link key={ch.href} href={ch.href}
                        className={`text-[12.5px] font-medium rounded-md px-2 py-1 transition ${
                          childActive
                            ? 'bg-mango-orange/10 text-mango-orange'
                            : 'text-mango-muted hover:text-mango-ink hover:bg-mango-bg'
                        }`}
                        style={childActive ? { color: '#C97A1F' } : undefined}>
                        {ch.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {email && (
        <div className="mt-4 px-3 text-[11px] text-mango-faint truncate" title={`Signed in as ${email}`}>
          Signed in as <span className="text-mango-ink">{nameFromEmail(email) || email}</span>
        </div>
      )}
      <button onClick={onLogout}
        className="mt-1 text-left text-[12px] text-mango-faint hover:text-mango-ink rounded-lg px-3 py-2 transition hover:bg-mango-bg">
        Sign out
      </button>
    </aside>
  );
}
