'use client';

// The Mango Power Meter — tech production as an arcade-style power ladder.
// Each technician is a mango that visually evolves with efficiency
// (billed hours / 42.5 available hours). Five tiers, from a dim unripe mango
// up to a flaming Legendary mango. Framer Motion drives float / glow / shimmer;
// CSS handles the cheap stuff. Data + math are untouched — this is purely the
// visual layer that replaces the old inline efficiency bar.

import { motion } from 'framer-motion';
import { SHOP_BY_NUM } from '@/lib/shops';

export interface TechRow {
  technicianId: number;
  techName?: string;
  shopNum: string;
  shopName: string;
  billedHours: number;
  jobs: number;
  efficiency: number; // billed / 42.5
}

type Tier = 'Unripe' | 'Ripening' | 'Ripe' | 'Golden' | 'Legendary';

function tierFor(eff: number): Tier {
  if (eff >= 1.2) return 'Legendary';
  if (eff >= 1.0) return 'Golden';
  if (eff >= 0.8) return 'Ripe';
  if (eff >= 0.6) return 'Ripening';
  return 'Unripe';
}

const TIER_STYLE: Record<Tier, {
  body: string; bodyHi: string; leaf: string; glow: string; ring: string; label: string;
}> = {
  Unripe:    { body: '#5a7d2a', bodyHi: '#7fae3c', leaf: '#3f6b1f', glow: 'rgba(120,160,60,0.25)',  ring: '#4b6b27', label: '#9bbf63' },
  Ripening:  { body: '#9a902a', bodyHi: '#c9bf3f', leaf: '#4f7a23', glow: 'rgba(210,190,70,0.35)',  ring: '#9a8f2a', label: '#d8cf6a' },
  Ripe:      { body: '#e8902a', bodyHi: '#ffc24d', leaf: '#3f7a23', glow: 'rgba(255,170,60,0.55)',  ring: '#e8902a', label: '#ffc24d' },
  Golden:    { body: '#f5c451', bodyHi: '#ffe9a8', leaf: '#caa23a', glow: 'rgba(255,200,80,0.7)',   ring: '#ffdf70', label: '#ffe9a8' },
  Legendary: { body: '#ffb800', bodyHi: '#fff1c2', leaf: '#ff7a00', glow: 'rgba(255,120,0,0.8)',    ring: '#ff0066', label: '#ffd56b' },
};

function firstName(r: TechRow) {
  return (r.techName || `Tech ${r.technicianId}`).trim().split(/\s+/)[0];
}

function Mango({ tier, size = 88 }: { tier: Tier; size?: number }) {
  const s = TIER_STYLE[tier];
  const legendary = tier === 'Legendary';
  const golden = tier === 'Golden' || legendary;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {/* Aura / glow */}
      <motion.div
        aria-hidden
        style={{
          position: 'absolute', inset: -size * 0.18, borderRadius: '50%',
          background: `radial-gradient(circle, ${s.glow} 0%, transparent 68%)`,
        }}
        animate={{ opacity: legendary ? [0.55, 1, 0.55] : golden ? [0.4, 0.85, 0.4] : [0.25, 0.5, 0.25], scale: legendary ? [1, 1.12, 1] : [1, 1.05, 1] }}
        transition={{ duration: legendary ? 1.4 : 2.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Legendary energy flames */}
      {legendary && (
        <motion.div
          aria-hidden
          style={{
            position: 'absolute', inset: -size * 0.12, borderRadius: '50%',
            background: 'conic-gradient(from 0deg, #ff0066, #ff7a00, #ffb800, #ff0066)',
            filter: 'blur(7px)', opacity: 0.55,
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
        />
      )}
      {/* Mango body */}
      <motion.svg
        width={size} height={size} viewBox="0 0 100 100"
        style={{ position: 'relative', display: 'block', filter: golden ? `drop-shadow(0 0 10px ${s.glow})` : 'none' }}
        animate={{ y: [0, -5, 0], rotate: legendary ? [-3, 3, -3] : [-1.5, 1.5, -1.5] }}
        transition={{ duration: legendary ? 2.2 : 3.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <defs>
          <radialGradient id={`mg-${tier}`} cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor={s.bodyHi} />
            <stop offset="65%" stopColor={s.body} />
            <stop offset="100%" stopColor={s.ring} />
          </radialGradient>
        </defs>
        {/* leaf + stem */}
        <path d="M52 16 q10 -10 20 -6 q-4 11 -16 13 z" fill={s.leaf} />
        <rect x="49" y="14" width="3" height="9" rx="1.5" fill={s.leaf} />
        {/* teardrop mango */}
        <path
          d="M50 22 C74 22 86 44 84 64 C82 84 64 92 50 92 C36 92 18 84 16 64 C14 44 26 22 50 22 Z"
          fill={`url(#mg-${tier})`}
          stroke={s.ring}
          strokeWidth="1.5"
        />
        {/* shine */}
        <ellipse cx="38" cy="44" rx="9" ry="14" fill="#ffffff" opacity={tier === 'Unripe' ? 0.12 : 0.28} transform="rotate(-22 38 44)" />
        {/* shimmer sweep for Golden / Legendary */}
        {golden && (
          <motion.rect
            x="-40" y="0" width="26" height="100" fill="#ffffff" opacity={0.35}
            transform="skewX(-18)"
            animate={{ x: [-40, 120] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.4 }}
          />
        )}
      </motion.svg>
    </div>
  );
}

export default function MangoPowerMeter({ rows }: { rows: TechRow[] }) {
  const ranked = [...rows].sort((a, b) => b.efficiency - a.efficiency);

  return (
    <div
      className="rounded-2xl p-4 sm:p-6"
      style={{ background: 'radial-gradient(circle at 30% 0%, #1c2230 0%, #0f1115 70%)' }}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {ranked.map((r, i) => {
          const tier = tierFor(r.efficiency);
          const s = TIER_STYLE[tier];
          const shopColor = SHOP_BY_NUM[r.shopNum as keyof typeof SHOP_BY_NUM]?.color || '#94A3B8';
          const isLeader = i === 0 && r.efficiency > 0;
          return (
            <motion.div
              key={`${r.technicianId}-${r.shopNum}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: Math.min(i * 0.04, 0.5) }}
              whileHover={{ y: -6, scale: 1.025 }}
              className="relative rounded-2xl p-4 flex flex-col items-center text-center overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.045)',
                border: `1px solid ${isLeader ? '#ffdf70' : 'rgba(255,255,255,0.08)'}`,
                boxShadow: isLeader ? '0 0 0 1px rgba(255,223,112,0.4), 0 10px 36px rgba(255,184,0,0.28)' : 'none',
              }}
            >
              {/* shop color accent bar */}
              <div className="absolute top-0 left-0 right-0 h-1" style={{ background: shopColor }} />

              {/* rank badge */}
              <div
                className="absolute top-2 left-2 text-[10px] font-black px-1.5 py-0.5 rounded-md tabular-nums"
                style={{ background: 'rgba(0,0,0,0.35)', color: s.label }}
              >
                #{i + 1}
              </div>

              {/* Top Producer crown */}
              {isLeader && (
                <motion.div
                  className="absolute top-1.5 right-2 text-base"
                  animate={{ rotate: [-8, 8, -8], y: [0, -2, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  title="Top Producer"
                >
                  👑
                </motion.div>
              )}

              <div className="mt-3 mb-1">
                <Mango tier={tier} />
              </div>

              {/* tier label */}
              <div
                className="text-[10px] font-black uppercase tracking-[0.18em] mb-1"
                style={{ color: s.label }}
              >
                {tier}
              </div>

              <div className="text-white font-bold text-base leading-tight">{firstName(r)}</div>
              <div className="flex items-center gap-1.5 mt-0.5 mb-2">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: shopColor }} />
                <span className="text-white/55 text-[11px]">{r.shopName}</span>
              </div>

              <div className="flex items-end gap-3">
                <div className="flex flex-col">
                  <span className="font-black tabular-nums leading-none" style={{ fontSize: '1.6rem', color: s.label }}>
                    {Math.round(r.efficiency * 100)}%
                  </span>
                  <span className="text-white/45 text-[9px] uppercase tracking-widest mt-0.5">Efficiency</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-bold tabular-nums leading-none text-white/90" style={{ fontSize: '1.05rem' }}>
                    {r.billedHours.toFixed(1)}
                  </span>
                  <span className="text-white/45 text-[9px] uppercase tracking-widest mt-0.5">Billed hrs</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
