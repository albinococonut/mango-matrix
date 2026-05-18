'use client';

// Trophy icon by rank: 1 = gold, 2 = silver, 3 = bronze.

export function TrophyIcon({ rank, size = 16 }: { rank: 1 | 2 | 3; size?: number }) {
  const color = rank === 1 ? '#F5C518' : rank === 2 ? '#9CA3AF' : '#C2814B';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-label={`Rank ${rank}`} style={{ flexShrink: 0 }}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" fill={color} fillOpacity="0.25" />
    </svg>
  );
}
