// Canonical shop map - matches both Tekmetric IDs and WhatConverts profile numbering.
// 008 does not exist (per dev brief). 18346 is the secondary Yuma instance, hidden from leaderboards.

export type ShopNum = '001' | '002' | '003' | '004' | '005' | '006' | '007' | '009';

export interface Shop {
  num: ShopNum;
  name: string;
  tekmetricId: number;
  tekmetricIdSecondary?: number;
  timezone: string;
  city: string;
  state: string;
  // Brief section 6 notes - used for FBR retail/fleet defaults
  defaultFleetMix: 'mostly_retail' | 'mostly_fleet' | 'balanced';
  // Ramping flag from brief section 9
  openedAt?: string;
  color: string;       // chart color
  googlePlaceId?: string;
}

export const SHOPS: Shop[] = [
  { num: '001', name: 'Cottonwood',  tekmetricId: 2892,  timezone: 'America/Denver',  city: 'Albuquerque',  state: 'NM', defaultFleetMix: 'balanced',      openedAt: '2018-01-01', color: '#EC4899' /* pink */,      googlePlaceId: 'ChIJUUobG0dxIocR90y74Lu6TFc' },
  { num: '002', name: 'The Heights', tekmetricId: 4011,  timezone: 'America/Denver',  city: 'Albuquerque',  state: 'NM', defaultFleetMix: 'balanced',      openedAt: '2019-06-01', color: '#F97316' /* orange */,    googlePlaceId: 'ChIJW8j4-B2fGIcRirMety19QHY' },
  { num: '003', name: 'Downtown',    tekmetricId: 3785,  timezone: 'America/Denver',  city: 'Albuquerque',  state: 'NM', defaultFleetMix: 'mostly_fleet',  openedAt: '2020-01-01', color: '#F5C518' /* yellow */,    googlePlaceId: 'ChIJ_ZjznI0NIocRHpXTCeWCM5s' },
  { num: '004', name: 'Pellicano',   tekmetricId: 11565, timezone: 'America/Denver',  city: 'El Paso',      state: 'TX', defaultFleetMix: 'mostly_fleet',  openedAt: '2025-01-01', color: '#15803D' /* deep green */, googlePlaceId: 'ChIJXb-A9KFE54YRi77I5uKZh3o' },
  { num: '005', name: 'Las Cruces',  tekmetricId: 8878,  timezone: 'America/Denver',  city: 'Las Cruces',   state: 'NM', defaultFleetMix: 'mostly_fleet',  openedAt: '2024-01-01', color: '#06B6D4' /* cyan */,       googlePlaceId: 'ChIJnylEKl093oYRmO08JnQTJz0' },
  { num: '006', name: 'Yuma',        tekmetricId: 7492,  tekmetricIdSecondary: 18346, timezone: 'America/Phoenix', city: 'Yuma', state: 'AZ', defaultFleetMix: 'mostly_fleet', openedAt: '2022-01-01', color: '#3B82F6' /* blue */,      googlePlaceId: 'ChIJWUstMEhf1oAR5KYI-F-l5pE' },
  { num: '007', name: 'Montana',     tekmetricId: 11253, timezone: 'America/Denver',  city: 'El Paso',      state: 'TX', defaultFleetMix: 'mostly_retail', openedAt: '2024-10-01', color: '#8B5CF6' /* purple */,    googlePlaceId: 'ChIJeaQeSHhb54YRy_dP6d5wOzQ' },
  { num: '009', name: 'The Valley',  tekmetricId: 16116, timezone: 'America/Denver',  city: 'Albuquerque',  state: 'NM', defaultFleetMix: 'mostly_retail', openedAt: '2026-01-01', color: '#EF4444' /* red */,       googlePlaceId: 'ChIJUwcdeDtzIocRneLazjKards' },
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

export function isRampingShop(shop: Shop, asOf: Date = new Date()): boolean {
  if (!shop.openedAt) return false;
  const opened = new Date(shop.openedAt);
  const days = (asOf.getTime() - opened.getTime()) / 86_400_000;
  return days < 90;
}
