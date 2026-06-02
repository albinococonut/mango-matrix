// Shared chrome for every /concept2 page: loads the luxury fonts once
// (Fraunces for display/KPIs, Inter for UI) and exposes them as the
// .c2disp / .c2ui classes the concept2 kit uses. No auth here — each page
// keeps its own role gate, exactly like the production routes.

import { Fraunces, Inter } from 'next/font/google';

const display = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap', weight: ['400', '500', '600'] });
const ui = Inter({ subsets: ['latin'], variable: '--font-ui', display: 'swap', weight: ['400', '500', '600', '700'] });

export default function Concept2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${display.variable} ${ui.variable}`}>
      <style>{`
        /* font-weight: 500 (medium) matches concept-1's .cdisplay so the
           Fraunces serif carries the same presence at every size. Without
           this, .c2disp defaulted to weight 400 (regular) and every section
           title / hero number read lighter than the concept-1 reference —
           even after we bumped the sizes. */
        .c2disp { font-family: var(--font-display), Georgia, 'Times New Roman', serif; font-weight: 500; }
        .c2ui { font-family: var(--font-ui), -apple-system, system-ui, sans-serif; }
      `}</style>
      {children}
    </div>
  );
}
