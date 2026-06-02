// CONCEPT PREVIEW — high-fidelity visual redesign draft of the Diagnostic view.
// Standalone + public (representative data only) so it's viewable on a Vercel
// preview URL without the prod auth cookie. The real /diagnostic page and all
// production components are untouched.
//
// Type system: Fraunces (high-contrast editorial serif) stands in for
// Canela / Editorial New for headlines + oversized KPI numbers; Inter carries
// the dense UI/body — matching the brief's "editorial + premium product" pairing.

import type { Metadata } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import ConceptDiagnostic from '@/components/concept/ConceptDiagnostic';

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600'],
});
const ui = Inter({ subsets: ['latin'], variable: '--font-ui', display: 'swap', weight: ['400', '500', '600', '700'] });

export const metadata: Metadata = { title: 'Mango Matrix — Diagnostic (concept)' };
export const dynamic = 'force-static';

export default function ConceptDiagnosticPage() {
  return (
    <div className={`${display.variable} ${ui.variable}`}>
      {/* Scoped font helpers for the concept tree only. */}
      <style>{`
        .cdisplay { font-family: var(--font-display), Georgia, 'Times New Roman', serif; font-weight: 500; }
        .cui { font-family: var(--font-ui), -apple-system, system-ui, sans-serif; }
      `}</style>
      <ConceptDiagnostic />
    </div>
  );
}
