'use client';

// Mia Mango — the REAL Mango Automotive brand vector (public/mia-mango.svg,
// supplied by the user). Transparent, scalable, never boxed on white. Tiers
// are dressed up Pokémon-style: a big gold crown for Legendary, a smaller
// crown for Golden, none for Ripe — plus a soft tier aura.

export type MangoTier = 'legendary' | 'golden' | 'ripe';

const AURA: Record<MangoTier, string> = {
  legendary: 'radial-gradient(circle, rgba(244,180,0,0.50) 0%, rgba(245,166,35,0.20) 45%, transparent 70%)',
  golden:    'radial-gradient(circle, rgba(244,180,0,0.34) 0%, rgba(245,166,35,0.12) 50%, transparent 72%)',
  ripe:      'radial-gradient(circle, rgba(255,183,77,0.22) 0%, transparent 68%)',
};

function Crown({ w, big }: { w: number; big: boolean }) {
  // 5-point royal crown for legendary, 3-point coronet for golden.
  return (
    <svg width={w} height={w * 0.72} viewBox="0 0 100 72" fill="none"
      style={{ filter: 'drop-shadow(0 2px 3px rgba(124,72,12,0.45))' }}>
      <defs>
        <linearGradient id="cr" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE8A3" />
          <stop offset="0.5" stopColor="#F4B400" />
          <stop offset="1" stopColor="#D9822B" />
        </linearGradient>
      </defs>
      {big ? (
        <path d="M8 60 L4 20 L26 40 L50 6 L74 40 L96 20 L92 60 Z" fill="url(#cr)"
          stroke="#C9742A" strokeWidth="2.5" strokeLinejoin="round" />
      ) : (
        <path d="M14 58 L10 26 L34 42 L50 16 L66 42 L90 26 L86 58 Z" fill="url(#cr)"
          stroke="#C9742A" strokeWidth="2.5" strokeLinejoin="round" />
      )}
      <rect x="6" y="58" width="88" height="11" rx="3" fill="url(#cr)" stroke="#C9742A" strokeWidth="2" />
      {big && <>
        <circle cx="50" cy="9" r="5" fill="#FF5B8A" stroke="#fff" strokeWidth="1.4" />
        <circle cx="6" cy="22" r="3.6" fill="#7FD0FF" />
        <circle cx="94" cy="22" r="3.6" fill="#7FD0FF" />
        <circle cx="50" cy="64" r="3.4" fill="#FF5B8A" />
        <circle cx="26" cy="64" r="2.8" fill="#7FD0FF" />
        <circle cx="74" cy="64" r="2.8" fill="#7FD0FF" />
      </>}
      {!big && <circle cx="50" cy="63" r="3" fill="#FF5B8A" />}
    </svg>
  );
}

export default function MangoTierIcon({ tier, size = 64 }: { tier: MangoTier; size?: number }) {
  // Mia svg is 337×443.5 (portrait). `size` = rendered height.
  const w = Math.round(size * (337 / 443.5));
  // Legendary crown is intentionally OVERSIZED for championship drama —
  // big and bold, but lifted so it sits ON her head, face still visible.
  const crownW = Math.round(size * (tier === 'legendary' ? 0.92 : 0.42));
  const legendary = tier === 'legendary';
  return (
    <span className="relative inline-flex items-end justify-center" style={{ width: w, height: size }}>
      <span className="absolute inset-[-34%] rounded-full pointer-events-none" style={{ background: AURA[tier] }} />
      {tier !== 'ripe' && (
        <span className="absolute z-20" style={{
          // Lifted a touch so Mia's leaf still peeks out, and nudged left so
          // it sits centered over her head (the SVG head sits left of center).
          top: legendary ? -crownW * 0.52 : -crownW * 0.36,
          left: '50%', transform: `translateX(-57%) rotate(-7deg)`,
        }}>
          <Crown w={crownW} big={legendary} />
          {legendary && (
            <>
              {[
                { t: '-12%', l: '-14%', s: 11 },
                { t: '4%', l: '104%', s: 9 },
                { t: '52%', l: '-22%', s: 8 },
                { t: '70%', l: '108%', s: 10 },
                { t: '-20%', l: '46%', s: 7 },
              ].map((p, i) => (
                <svg key={i} className="gm-cr-spark absolute" width={p.s} height={p.s} viewBox="0 0 24 24"
                  style={{ top: p.t, left: p.l, animationDelay: `${i * 0.42}s` }}>
                  <path d="M12 0 L14.6 9.4 L24 12 L14.6 14.6 L12 24 L9.4 14.6 L0 12 L9.4 9.4 Z" fill="#FFF3C4" />
                </svg>
              ))}
            </>
          )}
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/mia-mango.svg"
        alt="Mia Mango"
        height={size}
        draggable={false}
        className="relative object-contain select-none drop-shadow-[0_6px_10px_rgba(124,72,12,0.28)]"
        style={{ height: size, width: 'auto' }}
      />
      <style jsx>{`
        .gm-cr-spark {
          filter: drop-shadow(0 0 4px rgba(255,210,90,0.95));
          animation: gm-cr-tw 2.2s ease-in-out infinite;
        }
        @keyframes gm-cr-tw {
          0%, 60%, 100% { opacity: 0; transform: scale(0.3) rotate(0deg); }
          18%, 32% { opacity: 1; transform: scale(1) rotate(35deg); }
        }
        @media (prefers-reduced-motion: reduce) { .gm-cr-spark { animation: none; opacity: 0.9; } }
      `}</style>
    </span>
  );
}

export function tierFor(efficiency: number): MangoTier {
  // Crown ONLY at/above 100%. 90–100% = plain Mia (no crown). Below 90% the
  // tech isn't listed at all (filtered in TechProduction).
  if (efficiency >= 1.10) return 'legendary';   // big crown
  if (efficiency >= 1.00) return 'golden';      // smaller crown
  return 'ripe';                                // plain Mia, no crown
}
