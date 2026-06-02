'use client';

// ExecShell — shared layout wrapper for executive pages.
// Provides the sidebar (4 categories) + main content area + mobile brand
// bar. Used by /diagnostic, /review, /employee, /todo (when exec).
//
// The sidebar only renders at lg+ viewport (≥1024px). Below that, a mobile
// brand bar with horizontal-scrollable category nav replaces it.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import CardFullscreenButtons from '@/components/CardFullscreenButtons';
import ExecSidebar from '@/components/ExecSidebar';
import type { Role } from '@/lib/auth';
import { nameFromEmail } from '@/lib/format';

const MOBILE_CATEGORIES = [
  { href: '/diagnostic', label: 'Diagnostic' },
  { href: '/review',     label: 'Weekly Review' },
  { href: '/employee',   label: 'Employee View' },
  { href: '/todo',       label: 'To Do' },
  { href: '/tv',         label: 'TV' },
];

async function doLogout() {
  await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logout: true }) });
  window.location.href = '/login';
}

export default function ExecShell({
  role, email, children,
}: { role: Role; email?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-mango-bg flex">
      <CardFullscreenButtons />
      <ExecSidebar onLogout={doLogout} email={email} />
      <main className="flex-1 min-w-0 px-5 lg:px-10 py-7 lg:py-9 max-w-[1600px] mx-auto w-full">
        {/* Mobile brand bar — sidebar is hidden on small screens, so this
            replicates the category nav. Hidden on lg+ where the sidebar
            has the logo + nav. */}
        <div className="lg:hidden mb-7 pb-4 border-b border-mango-line">
          <div className="flex items-center justify-between gap-3 mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Mango Automotive" className="h-10 w-auto object-contain shrink-0" />
            <span className="text-[15px] font-semibold text-mango-ink truncate"
              style={{ fontFamily: "'Sora', system-ui, sans-serif" }}>
              The Mango Matrix
            </span>
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              {email && <span className="text-[10px] text-mango-faint truncate max-w-[140px]" title={`Signed in as ${email}`}>{nameFromEmail(email) || email}</span>}
              <button onClick={doLogout} className="text-[12px] text-mango-faint hover:text-mango-ink">Sign out</button>
            </div>
          </div>
          <nav className="flex items-center gap-1 overflow-x-auto -mx-1 px-1 text-[13px] font-semibold">
            {MOBILE_CATEGORIES.map(c => {
              const active = pathname === c.href || pathname?.startsWith(c.href + '/');
              return (
                <Link key={c.href} href={c.href}
                  className={`shrink-0 px-3 py-1.5 rounded-md transition ${active ? 'bg-mango-orange/10 text-mango-orange' : 'text-mango-muted hover:text-mango-ink hover:bg-mango-bg'}`}>
                  {c.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {children}
      </main>
    </div>
  );
}
