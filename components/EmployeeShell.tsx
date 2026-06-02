'use client';

// EmployeeShell — minimal layout used by /employee for both roles, and by
// /todo when the viewer is NOT an executive. Brand bar + nav links + a
// small exec-only "Dashboards" affordance so an exec previewing /employee
// can still escape back to Diagnostic / Review / To Do.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@/lib/auth';
import { nameFromEmail } from '@/lib/format';

async function doLogout() {
  await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logout: true }) });
  window.location.href = '/login';
}

export default function EmployeeShell({ role, email, children }: { role?: Role; email?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isTodo = pathname?.startsWith('/todo');
  const isTv = pathname?.startsWith('/tv');
  // "The Golden Mango" is the default highlight on /employee. Don't highlight
  // it on /todo or /tv even though the prefix doesn't match either of them.
  const isEmployee = !isTodo && !isTv;
  return (
    <div className="min-h-screen bg-mango-bg">
      <main className="px-5 lg:px-10 py-7 lg:py-9 max-w-[1600px] mx-auto w-full">
        <div className="flex items-center justify-between gap-3 mb-7 pb-4 border-b border-mango-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Mango Automotive" className="h-10 w-auto object-contain shrink-0" />
          <nav className="flex items-center gap-2 text-[13px] font-semibold flex-wrap" style={{ fontFamily: "'Sora', system-ui, sans-serif" }}>
            <Link href="/employee" className={`px-3 py-1.5 rounded-md transition ${isEmployee ? 'bg-mango-orange/10 text-mango-orange' : 'text-mango-muted hover:text-mango-ink'}`}>
              The Golden Mango
            </Link>
            <Link href="/todo" className={`px-3 py-1.5 rounded-md transition ${isTodo ? 'bg-mango-orange/10 text-mango-orange' : 'text-mango-muted hover:text-mango-ink'}`}>
              To Do
            </Link>
            <Link href="/tv" className={`px-3 py-1.5 rounded-md transition ${isTv ? 'bg-mango-orange/10 text-mango-orange' : 'text-mango-muted hover:text-mango-ink'}`}>
              TV
            </Link>
          </nav>
          <div className="flex flex-col items-end gap-0.5">
            {email && <span className="text-[11px] text-mango-faint truncate max-w-[200px]" title={`Signed in as ${email}`}>Signed in as {nameFromEmail(email) || email}</span>}
            <button onClick={doLogout} className="text-[12px] text-mango-faint hover:text-mango-ink">Sign out</button>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
