// Technician name lookup. Tekmetric's /employees endpoint returns first/last
// names; we cache them keyed by employee.id so the dashboard can show "Ryan A."
// instead of "Tech 296947". Tech rosters change slowly, so the cache stays warm
// for 24 hours.

import { isFresh, readCache, writeCache } from './cache';
import { SHOPS } from './shops';

const CACHE_KEY = 'tech_names';
const FRESH_MS = 24 * 60 * 60 * 1000;
const API = 'https://shop.tekmetric.com/api/v1';

interface TechName { firstName: string; lastName: string; shopNum: string }
type Lookup = Record<string, TechName>; // techId -> name

async function getToken(): Promise<string> {
  const id = process.env.TEKMETRIC_CLIENT_ID;
  const secret = process.env.TEKMETRIC_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Tekmetric creds missing');
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return (await r.json()).access_token;
}

async function fetchEmployeesForShop(token: string, shopId: number): Promise<any[]> {
  const all: any[] = [];
  for (let page = 0; page < 10; page++) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(`${API}/employees?shop=${shopId}&page=${page}&size=200`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
      });
      if (r.status === 429) { await new Promise(res => setTimeout(res, 1000 * (attempt + 1))); continue; }
      if (!r.ok) return all;
      const txt = await r.text();
      if (!txt) return all;
      const j = JSON.parse(txt);
      all.push(...(j.content || []));
      if (j.last) return all;
      break;
    }
  }
  return all;
}

/** Returns a map of techId -> { firstName, lastName, shopNum }. Cached 24h. */
export async function getTechnicianNames(): Promise<Lookup> {
  if (await isFresh(CACHE_KEY, FRESH_MS)) {
    const cached = await readCache<Lookup>(CACHE_KEY);
    if (cached) return cached;
  }
  const token = await getToken();
  const out: Lookup = {};
  for (const shop of SHOPS) {
    try {
      const employees = await fetchEmployeesForShop(token, shop.tekmetricId);
      for (const e of employees) {
        if (!e.canPerformWork) continue;
        out[String(e.id)] = { firstName: e.firstName || '', lastName: e.lastName || '', shopNum: shop.num };
      }
      if (shop.tekmetricIdSecondary) {
        const more = await fetchEmployeesForShop(token, shop.tekmetricIdSecondary);
        for (const e of more) {
          if (!e.canPerformWork) continue;
          out[String(e.id)] = { firstName: e.firstName || '', lastName: e.lastName || '', shopNum: shop.num };
        }
      }
    } catch (e) {
      // Skip the shop on error so we still cache what we got.
    }
  }
  await writeCache(CACHE_KEY, out);
  return out;
}

/** Format "Ryan A." from a record. Falls back to "Tech 1234" if no name. */
export function displayName(techId: number | string, names: Lookup): string {
  const e = names[String(techId)];
  if (!e || !e.firstName) return `Tech ${techId}`;
  const lastInitial = e.lastName?.[0] ? ` ${e.lastName[0]}.` : '';
  return `${e.firstName}${lastInitial}`;
}
