// Canonical shop map - matches both Tekmetric IDs and WhatConverts profile numbering.
// 008 does not exist (per dev brief). 18346 is the secondary Yuma instance, hidden from leaderboards.

export type ShopNum = '001' | '002' | '003' | '004' | '005' | '006' | '007' | '009';

export interface Shop {
  num: ShopNum;
  name: string;
  tekmetricId: number;
  tekmetricIdSecondary?: number;
  // When true the secondary Tekmetric ID is a fleet-only / government account
  // (e.g. Yuma's USPS post-office contract on 18346). It must be EXCLUDED from
  // all retail metrics, ARO, close-rate, and performance comparisons so that
  // fleet volumes don't distort the per-car economics shown in the dashboard.
  tekmetricIdSecondaryFleetOnly?: boolean;
  timezone: string;
  city: string;
  state: string;
  district: string;   // metro grouping for district-level rollups
  // Brief section 6 notes - used for FBR retail/fleet defaults
  defaultFleetMix: 'mostly_retail' | 'mostly_fleet' | 'balanced';
  // Ramping flag from brief section 9
  openedAt?: string;
  color: string;       // chart color
  googlePlaceId?: string;
  // Physical bays — used by Finance View for "Revenue per Bay per Week".
  // Back-calculated from MightyMangos_BaselineFinancials weekly rev-per-bay /
  // actual revenue. Update if a shop adds/removes bays.
  bays: number;
}

export const SHOPS: Shop[] = [
  { num: '001', name: 'Cottonwood',  tekmetricId: 2892,  timezone: 'America/Denver',  city: 'Albuquerque',  state: 'NM', district: 'Albuquerque', defaultFleetMix: 'balanced',      openedAt: '2018-01-01', bays: 12, color: '#F5A623' /* mango */,      googlePlaceId: 'ChIJUUobG0dxIocR90y74Lu6TFc' },
  { num: '002', name: 'The Heights', tekmetricId: 4011,  timezone: 'America/Denver',  city: 'Albuquerque',  state: 'NM', district: 'Albuquerque', defaultFleetMix: 'balanced',      openedAt: '2019-06-01', bays: 9,  color: '#18B6C9' /* bright teal */,    googlePlaceId: 'ChIJW8j4-B2fGIcRirMety19QHY' },
  { num: '003', name: 'Downtown',    tekmetricId: 3785,  timezone: 'America/Denver',  city: 'Albuquerque',  state: 'NM', district: 'Albuquerque', defaultFleetMix: 'mostly_fleet',  openedAt: '2020-01-01', bays: 9,  color: '#FF6B4A' /* coral */,    googlePlaceId: 'ChIJ_ZjznI0NIocRHpXTCeWCM5s' },
  { num: '004', name: 'Pellicano',   tekmetricId: 11565, timezone: 'America/Denver',  city: 'El Paso',      state: 'TX', district: 'El Paso',      defaultFleetMix: 'mostly_fleet',  openedAt: '2025-01-01', bays: 9,  color: '#4FB477' /* fresh green */, googlePlaceId: 'ChIJXb-A9KFE54YRi77I5uKZh3o' },
  { num: '005', name: 'Las Cruces',  tekmetricId: 8878,  timezone: 'America/Denver',  city: 'Las Cruces',   state: 'NM', district: 'Las Cruces',   defaultFleetMix: 'mostly_fleet',  openedAt: '2024-01-01', bays: 14, color: '#9B7BE0' /* violet */,       googlePlaceId: 'ChIJnylEKl093oYRmO08JnQTJz0' },
  { num: '006', name: 'Yuma',        tekmetricId: 7492,  tekmetricIdSecondary: 18346, tekmetricIdSecondaryFleetOnly: true, timezone: 'America/Phoenix', city: 'Yuma', state: 'AZ', district: 'Yuma', defaultFleetMix: 'mostly_fleet', openedAt: '2022-01-01', bays: 14, color: '#FFC72C' /* sunny gold */, googlePlaceId: 'ChIJWUstMEhf1oAR5KYI-F-l5pE' },
  { num: '007', name: 'Montana',     tekmetricId: 11253, timezone: 'America/Denver',  city: 'El Paso',      state: 'TX', district: 'El Paso',      defaultFleetMix: 'mostly_retail', openedAt: '2024-10-01', bays: 6,  color: '#FF8FB1' /* warm pink */,    googlePlaceId: 'ChIJeaQeSHhb54YRy_dP6d5wOzQ' },
  { num: '009', name: 'The Valley',  tekmetricId: 16116, timezone: 'America/Denver',  city: 'Albuquerque',  state: 'NM', district: 'Albuquerque', defaultFleetMix: 'mostly_retail', openedAt: '2026-01-01', bays: 6,  color: '#6FB1FF' /* sky blue */,       googlePlaceId: 'ChIJUwcdeDtzIocRneLazjKards' },
];

export const SHOP_BY_NUM: Record<ShopNum, Shop> = Object.fromEntries(
  SHOPS.map((s) => [s.num, s])
) as Record<ShopNum, Shop>;

export const SHOP_BY_TEKMETRIC_ID: Record<number, Shop> = SHOPS.reduce(
  (acc, s) => {
    acc[s.tekmetricId] = s;
    if (s.tekmetricIdSecondary) acc[s.tekmetricIdSecondary] = s;
    return acc;
  },
  {} as Record<number, Shop>
);

// Districts = metro groupings. Order matters (UI lists them this way).
export const DISTRICTS: { name: string; shopNums: ShopNum[] }[] = (() => {
  const order: string[] = [];
  const m = new Map<string, ShopNum[]>();
  for (const s of SHOPS) {
    if (!m.has(s.district)) { m.set(s.district, []); order.push(s.district); }
    m.get(s.district)!.push(s.num);
  }
  return order.map((name) => ({ name, shopNums: m.get(name)! }));
})();

export function districtOf(num: ShopNum): string {
  return SHOP_BY_NUM[num]?.district ?? 'Other';
}

export function isRampingShop(shop: Shop, asOf: Date = new Date()): boolean {
  if (!shop.openedAt) return false;
  const opened = new Date(shop.openedAt);
  const days = (asOf.getTime() - opened.getTime()) / 86_400_000;
  return days < 90;
}
