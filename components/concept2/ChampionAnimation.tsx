'use client';

import { useEffect } from 'react';
import { TrophyIcon } from '@/components/Trophy';
import { INK, INK2 } from './kit';

const GOLD = '#C9A227';
const CONFETTI_COLORS = [
  '#C9A227', '#E8863E', '#3E8E5E', '#3E9CB0',
  '#B5631F', '#8B5CF6', '#EC4899', '#F59E0B',
];

interface ChampProps {
  shopNum: string;
  shopName: string;
  score: number;
  medals: { gold: number; silver: number; bronze: number };
  revenue: number;
  gpPct: number;
  cars: number;
  isTie?: boolean;
  tiedShopNames?: string[];
}

const usd = (n: number) => '$' + Math.round(n || 0).toLocaleString('en-US');

export default function ChampionAnimation({ champion, onDismiss }: { champion: ChampProps; onDismiss: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onDismiss]);

  const title = champion.isTie
    ? (champion.tiedShopNames || [champion.shopName]).join(' · ')
    : champion.shopName;

  return (
    <>
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-30px) rotate(0deg) scale(1); opacity: 1; }
          80%  { opacity: 0.7; }
          100% { transform: translateY(110vh) rotate(780deg) scale(0.4); opacity: 0; }
        }
        @keyframes champ-entrance {
          from { opacity: 0; transform: scale(0.88) translateY(48px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes trophy-float {
          0%,100% { transform: translateX(-50%) translateY(0) rotate(-2deg); }
          50%     { transform: translateX(-50%) translateY(-14px) rotate(2deg); }
        }
        @keyframes gold-pulse {
          0%,100% { box-shadow: 0 0 40px rgba(201,162,39,0.25); }
          50%     { box-shadow: 0 0 80px rgba(201,162,39,0.5); }
        }
        @media (prefers-reduced-motion: reduce) {
          .c-anim-confetti { display: none !important; }
          .c-anim-card     { animation: none !important; }
          .c-anim-trophy   { animation: none !important; }
          .c-anim-glow     { animation: none !important; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onDismiss}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(18,14,8,0.88)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      />

      {/* Confetti layer */}
      <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none', overflow: 'hidden' }}>
        {Array.from({ length: 80 }).map((_, i) => {
          const left = ((i * 137.508) % 100).toFixed(2);
          const delay = ((i * 0.37) % 4).toFixed(2);
          const dur = (2.4 + (i % 7) * 0.38).toFixed(2);
          const size = 8 + (i % 4) * 4;
          const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
          const rot = (i * 47) % 360;
          const isCircle = i % 5 === 0;
          return (
            <div
              key={i}
              className="c-anim-confetti"
              style={{
                position: 'absolute',
                top: `${-10 - (i % 25) * 2}px`,
                left: `${left}%`,
                width: size,
                height: isCircle ? size : Math.round(size * 0.45),
                borderRadius: isCircle ? '50%' : 2,
                background: color,
                transform: `rotate(${rot}deg)`,
                animation: `confetti-fall ${dur}s ${delay}s ease-in infinite`,
              }}
            />
          );
        })}
      </div>

      {/* Main card wrapper — centers content */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px 16px',
          pointerEvents: 'none',
        }}
      >
        <div
          className="c-anim-card"
          onClick={(e) => e.stopPropagation()}
          style={{
            pointerEvents: 'auto',
            maxWidth: 680,
            width: '100%',
            maxHeight: '95vh',
            overflowY: 'auto',
            borderRadius: 32,
            background: 'linear-gradient(180deg, rgba(255,254,247,0.99) 0%, rgba(255,250,235,0.97) 100%)',
            border: '1.5px solid rgba(201,162,39,0.45)',
            overflow: 'hidden',
            animation: 'champ-entrance 0.55s cubic-bezier(0.22, 1, 0.36, 1) both, gold-pulse 3s 0.55s ease-in-out infinite',
          }}
        >
          {/* Gold top stripe */}
          <div style={{
            height: 7,
            background: `linear-gradient(90deg, transparent 2%, ${GOLD} 18%, rgba(255,235,80,1) 50%, ${GOLD} 82%, transparent 98%)`,
          }} />

          {/* Team photo */}
          <div style={{ position: 'relative', width: '100%', height: 'min(340px, 48vw)', background: 'rgba(240,235,224,0.6)' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/shop-photos/${encodeURIComponent(`${champion.shopNum} team photo.jpg`)}`}
              alt={`${champion.shopName} team`}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.15'; }}
            />
            {/* Gradient overlay at the bottom */}
            <div aria-hidden style={{
              position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%',
              background: 'linear-gradient(transparent, rgba(18,14,8,0.65))',
            }} />
            {/* Trophy floating at the bottom edge */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/the-golden-mango.png"
              alt=""
              className="c-anim-trophy"
              style={{
                position: 'absolute', bottom: -28, left: '50%',
                transform: 'translateX(-50%)',
                width: 'clamp(90px, 18vw, 148px)', height: 'auto',
                filter: 'drop-shadow(0 12px 28px rgba(100,65,5,0.55)) drop-shadow(0 0 48px rgba(201,162,39,0.45))',
                animation: 'trophy-float 3s ease-in-out infinite',
                zIndex: 2,
              }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          </div>

          {/* Text content */}
          <div style={{ padding: '48px 40px 40px', textAlign: 'center' }}>
            {/* Eyebrow */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 14 }}>
              <TrophyIcon rank={1} size={22} />
              <span className="c2ui" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.30em', textTransform: 'uppercase', color: GOLD }}>
                The Golden Mango
              </span>
              <TrophyIcon rank={1} size={22} />
            </div>

            {/* Shop name — the hero */}
            <h1 className="c2disp" style={{
              fontSize: 'clamp(40px, 9vw, 72px)',
              fontWeight: 500,
              letterSpacing: '-0.03em',
              lineHeight: 0.93,
              color: INK,
              marginBottom: 32,
            }}>
              {title}
            </h1>

            {/* Medal + score row */}
            <div style={{
              display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 28,
              marginBottom: 32, flexWrap: 'wrap',
            }}>
              {[
                { rank: 1, count: champion.medals.gold, label: 'Gold' },
                { rank: 2, count: champion.medals.silver, label: 'Silver' },
                { rank: 3, count: champion.medals.bronze, label: 'Bronze' },
              ].map(({ rank, count, label }) => (
                <div key={rank} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TrophyIcon rank={rank as 1|2|3} size={28} />
                    <span className="c2disp" style={{ fontSize: 38, color: INK, letterSpacing: '-0.02em' }}>{count}</span>
                  </div>
                  <span className="c2ui" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK2 }}>{label}</span>
                </div>
              ))}
              <div style={{ width: 1, height: 52, background: 'rgba(34,32,28,0.1)', margin: '0 4px', alignSelf: 'center' }} />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                <span className="c2disp" style={{ fontSize: 38, color: GOLD, letterSpacing: '-0.02em' }}>{champion.score}</span>
                <span className="c2ui" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK2 }}>Score</span>
              </div>
            </div>

            {/* Stats */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
              padding: '24px 0', margin: '0 0 32px',
              borderTop: '1px solid rgba(34,32,28,0.1)',
              borderBottom: '1px solid rgba(34,32,28,0.1)',
            }}>
              {[
                { label: 'Revenue', value: champion.revenue > 0 ? usd(champion.revenue) : '—' },
                { label: 'GP %', value: champion.gpPct > 0 ? `${(champion.gpPct * 100).toFixed(1)}%` : '—' },
                { label: 'Cars', value: champion.cars > 0 ? String(champion.cars) : '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <span className="c2disp" style={{ fontSize: 28, color: INK, letterSpacing: '-0.02em' }}>{value}</span>
                  <span className="c2ui" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK2 }}>{label}</span>
                </div>
              ))}
            </div>

            {/* Dismiss */}
            <button
              onClick={onDismiss}
              className="c2ui"
              style={{
                background: GOLD,
                color: '#fff',
                border: 'none',
                borderRadius: 100,
                padding: '16px 56px',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                boxShadow: `0 10px 28px -8px rgba(201,162,39,0.55)`,
                transition: 'transform 0.12s, opacity 0.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.transform = 'scale(1.03)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1)'; }}
            >
              Let&apos;s Go! 🏆
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
