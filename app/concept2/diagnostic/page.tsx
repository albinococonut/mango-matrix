// CONCEPT 2 (rebuilt) — concept1's bespoke luxury design, driven by LIVE data.
//
// The earlier token-reskin of the production components didn't capture
// concept1's look, so it's gone. This is concept1's exact visual system
// (frosted glass, diffused luminous heat cells, oversized editorial KPIs, airy
// layout) rendered from the real production APIs — no metric or graph behavior
// is changed, only fed real numbers. Auth-gated like /diagnostic; live data
// only renders on a domain where the viewer is signed in.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Fraunces, Inter } from 'next/font/google';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import Concept2Diagnostic from '@/components/concept2/Concept2Diagnostic';

const display = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap', weight: ['400', '500', '600'] });
const ui = Inter({ subsets: ['latin'], variable: '--font-ui', display: 'swap', weight: ['400', '500', '600', '700'] });

export const dynamic = 'force-dynamic';

export default async function Concept2DiagnosticPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  if (session.role !== 'executive') redirect('/employee');

  return (
    <div className={`${display.variable} ${ui.variable}`}>
      <style>{`
        /* font-weight: 500 matches concept-1's .cdisplay — see the same
           comment in app/concept2/layout.tsx. */
        .c2disp { font-family: var(--font-display), Georgia, 'Times New Roman', serif; font-weight: 500; }
        .c2ui { font-family: var(--font-ui), -apple-system, system-ui, sans-serif; }
      `}</style>
      <Concept2Diagnostic />
    </div>
  );
}
