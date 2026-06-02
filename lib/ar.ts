// Accounts Receivable model. Tekmetric has no historical AR-snapshot endpoint,
// so "AR right now" is derived from open ACCRECV repair orders, and the trend
// is (a) real daily snapshots we store going forward, plus (b) an approximate
// reconstruction of how TODAY's still-open AR accumulated (clearly labelled —
// it cannot see invoices that have since been paid off).

import type { RepairOrder } from './tekmetric';
import { c2d, searchCustomersByPhone } from './tekmetric';
import { SHOP_BY_TEKMETRIC_ID } from './shops';
import { readCache, writeCache } from './cache';

const DAY = 86_400_000;

export interface ARLine {
  customerId: number;
  customerName: string;
  shopNum: string;
  shopName: string;
  roNumber: number;
  invoiceDate: string;       // ISO
  daysOverdue: number;
  balance: number;           // dollars owed on this RO
  status: string;            // Tekmetric RO status name
  aged: boolean;             // invoice older than 12 months — legacy/aged AR
}

/** An RO is AR when it's posted to receivables with money still owed. */
export function isAR(o: RepairOrder): boolean {
  if (o.repairOrderStatus?.code !== 'ACCRECV') return false;
  return o.totalSales - o.amountPaid > 0;
}

export function arInvoiceDate(o: RepairOrder): string {
  return o.postedDate || o.completedDate || o.createdDate;
}

export function arDaysOverdue(o: RepairOrder, now = Date.now()): number {
  const t = new Date(arInvoiceDate(o)).getTime();
  return Math.max(0, Math.floor((now - t) / DAY));
}

export type ARMode = 'over30' | 'new' | 'total';

export function matchesMode(days: number, mode: ARMode): boolean {
  if (mode === 'over30') return days > 30;
  if (mode === 'new') return days < 7;
  return true; // total
}

// ---- customer-name resolution (durable cache; names are ~static) ----------

const NAME_KEY = (id: number) => `arc_name_${id}`;
const BASE = process.env.TEKMETRIC_BASE_URL || 'https://shop.tekmetric.com/api/v1';

let tok: { v: string; exp: number } | null = null;
async function token(): Promise<string> {
  if (tok && tok.exp > Date.now() + 60_000) return tok.v;
  const b = Buffer.from(`${process.env.TEKMETRIC_CLIENT_ID}:${process.env.TEKMETRIC_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${b}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', cache: 'no-store',
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = await r.json();
  tok = { v: j.access_token, exp: Date.now() + 12 * 3600_000 };
  return tok.v;
}

function nameFrom(j: any): string {
  const f = (j.firstName || '').trim();
  const l = (j.lastName || '').trim();
  const n = `${f}${l ? ' ' + l : ''}`.trim();
  return n || `Account #${j.id}`;
}

/**
 * Resolve customer display names, reading the durable cache first and fetching
 * at most `cap` misses (paced, with the same 429 backoff Tekmetric needs).
 * Unresolved ids fall back to "Account #id" and get filled on a later call /
 * the daily snapshot job.
 */
export async function resolveCustomerNames(ids: number[], cap = 80): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const misses: number[] = [];
  for (const id of ids) {
    const c = await readCache<string>(NAME_KEY(id));
    if (c) out.set(id, c);
    else misses.push(id);
  }
  let fetched = 0;
  for (const id of misses) {
    if (fetched >= cap) { out.set(id, `Account #${id}`); continue; }
    try {
      const t = await token();
      let name = `Account #${id}`;
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await fetch(`${BASE}/customers/${id}`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
        if (r.status === 429) { await new Promise((res) => setTimeout(res, Math.min(6000, 400 * 2 ** attempt))); continue; }
        if (r.ok) { name = nameFrom(await r.json()); }
        break;
      }
      out.set(id, name);
      if (!name.startsWith('Account #')) await writeCache(NAME_KEY(id), name);
      fetched++;
      await new Promise((res) => setTimeout(res, 120));
    } catch {
      out.set(id, `Account #${id}`);
    }
  }
  return out;
}

// ---- customer contact (name + phone) + vehicle resolution ----------------
// Used by the Missed Rebooks expansion on the FBR leaderboard — managers
// need a callable phone number and the vehicle the customer just dropped
// off, alongside the customer name. Cached durably; cap per-call fetches so
// a single warm doesn't burst Tekmetric.

// Bumped prefix from v1 → v2 to evict cached `phone: '[object Object]'`
// entries written before the recursive extractor below was in place. Old
// keys orphan out via natural TTL.
const CONTACT_KEY = (id: number) => `arc_contact_v2_${id}`;
const VEHICLE_KEY = (id: number) => `tek_vehicle_${id}`;

// Phone-to-customerId lookup cache. Sentinel -1 means "we asked Tekmetric and
// it had no matching customer" — important to cache misses so we don't hit
// the API every page load for first-time callers.
const PHONE_LOOKUP_KEY = (shopId: number, digits: string) => `tek_phone_cust_v1_${shopId}_${digits}`;
const PHONE_LOOKUP_NOT_FOUND = -1;

/**
 * Resolve a batch of phones → Tekmetric customerId for a given shop. Uses
 * Upstash KV for memoization (both hits and misses are cached so repeat
 * page loads stay fast). Bounded `apiCap` cap on live Tekmetric calls per
 * invocation so a busy page doesn't burst the API; unresolved phones fall
 * through and will be filled on the next request.
 */
export async function lookupTekmetricCustomerIdsByPhone(
  shopId: number, phoneDigitsList: string[], apiCap = 25,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const valid = phoneDigitsList.filter(p => p && p.length >= 7);
  if (!valid.length) return out;
  // Phase 1: parallel KV reads. Sequential reads of ~80 keys via Upstash HTTP
  // are slow enough to push past Vercel function timeouts; Promise.all keeps
  // total wall-clock under a second even at full load.
  const cached = await Promise.all(valid.map(p => readCache<number>(PHONE_LOOKUP_KEY(shopId, p))));
  const misses: string[] = [];
  valid.forEach((p, i) => {
    const v = cached[i];
    if (typeof v === 'number') {
      if (v !== PHONE_LOOKUP_NOT_FOUND) out.set(p, v);
    } else {
      misses.push(p);
    }
  });
  // Phase 2: live API for up-to-`apiCap` misses, in parallel.
  const toQuery = misses.slice(0, apiCap);
  await Promise.all(toQuery.map(async p => {
    const id = await searchCustomersByPhone(shopId, p);
    await writeCache(PHONE_LOOKUP_KEY(shopId, p), id ?? PHONE_LOOKUP_NOT_FOUND);
    if (id) out.set(p, id);
  }));
  return out;
}

export interface CustomerContact { name: string; phone?: string }

/**
 * Tekmetric's customer endpoint returns phones in inconsistent shapes:
 *   - plain string:  "(555) 123-4567"
 *   - number:        5551234567
 *   - nested object: { number: "(555)...", type: "MOBILE", primary: true }
 *   - nested array:  [{ number, type, primary }, ...]
 *   - missing
 * Recurse through whatever we got, looking for a primitive number/string.
 */
function extractPhone(raw: any): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') return raw.trim() || undefined;
  if (typeof raw === 'number') return String(raw);
  if (Array.isArray(raw)) {
    // Prefer entries flagged primary, then the first valid extraction.
    const primary = raw.find(x => x && x.primary === true);
    if (primary) {
      const p = extractPhone(primary);
      if (p) return p;
    }
    for (const item of raw) {
      const p = extractPhone(item);
      if (p) return p;
    }
    return undefined;
  }
  if (typeof raw === 'object') {
    const candidate = raw.number ?? raw.phoneNumber ?? raw.value ?? raw.phone;
    return extractPhone(candidate);
  }
  return undefined;
}

function contactFrom(j: any): CustomerContact {
  const phone = extractPhone(j.phone) ?? extractPhone(j.cellPhone) ?? extractPhone(j.workPhone) ?? extractPhone(j.phones);
  return { name: nameFrom(j), phone };
}

export async function resolveCustomerContacts(ids: number[], cap = 80): Promise<Map<number, CustomerContact>> {
  const out = new Map<number, CustomerContact>();
  const misses: number[] = [];
  for (const id of ids) {
    const c = await readCache<CustomerContact>(CONTACT_KEY(id));
    if (c) out.set(id, c);
    else misses.push(id);
  }
  let fetched = 0;
  for (const id of misses) {
    if (fetched >= cap) { out.set(id, { name: `Account #${id}` }); continue; }
    try {
      const t = await token();
      let contact: CustomerContact = { name: `Account #${id}` };
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await fetch(`${BASE}/customers/${id}`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
        if (r.status === 429) { await new Promise((res) => setTimeout(res, Math.min(6000, 400 * 2 ** attempt))); continue; }
        if (r.ok) contact = contactFrom(await r.json());
        break;
      }
      out.set(id, contact);
      if (!contact.name.startsWith('Account #')) await writeCache(CONTACT_KEY(id), contact);
      fetched++;
      await new Promise((res) => setTimeout(res, 120));
    } catch {
      out.set(id, { name: `Account #${id}` });
    }
  }
  return out;
}

export async function resolveVehicles(ids: number[], cap = 80): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const misses: number[] = [];
  for (const id of ids) {
    const c = await readCache<string>(VEHICLE_KEY(id));
    if (c) out.set(id, c);
    else misses.push(id);
  }
  let fetched = 0;
  for (const id of misses) {
    if (fetched >= cap) { out.set(id, `Vehicle #${id}`); continue; }
    try {
      const t = await token();
      let display = `Vehicle #${id}`;
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await fetch(`${BASE}/vehicles/${id}`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
        if (r.status === 429) { await new Promise((res) => setTimeout(res, Math.min(6000, 400 * 2 ** attempt))); continue; }
        if (r.ok) {
          const v = await r.json();
          const yr = v.year ? `${v.year} ` : '';
          const make = v.make || '';
          const model = v.model || '';
          const built = `${yr}${make}${make && model ? ' ' : ''}${model}`.trim();
          if (built) display = built;
        }
        break;
      }
      out.set(id, display);
      if (!display.startsWith('Vehicle #')) await writeCache(VEHICLE_KEY(id), display);
      fetched++;
      await new Promise((res) => setTimeout(res, 120));
    } catch {
      out.set(id, `Vehicle #${id}`);
    }
  }
  return out;
}

// ---- build the AR line list (sorted highest owed → lowest) ----------------

export function buildARLines(
  orders: RepairOrder[],
  names: Map<number, string>,
  mode: ARMode,
  now = Date.now(),
): ARLine[] {
  const lines: ARLine[] = [];
  for (const o of orders) {
    if (!isAR(o)) continue;
    const days = arDaysOverdue(o, now);
    if (!matchesMode(days, mode)) continue;
    const meta = SHOP_BY_TEKMETRIC_ID[o.shopId];
    lines.push({
      customerId: o.customerId,
      customerName: names.get(o.customerId) || `Account #${o.customerId}`,
      shopNum: meta?.num ?? String(o.shopId),
      shopName: meta?.name ?? `Shop ${o.shopId}`,
      roNumber: o.repairOrderNumber,
      invoiceDate: arInvoiceDate(o),
      daysOverdue: days,
      balance: c2d(o.totalSales - o.amountPaid),
      status: o.repairOrderStatus?.name || 'Accounts Receivable',
      aged: days > 365, // older than 12 months → legacy/aged AR
    });
  }
  return lines.sort((a, b) => b.balance - a.balance);
}

export interface ARSummary {
  total: number;
  count: number;
  byShop: { shopNum: string; shopName: string; amount: number; count: number }[];
}

export function summarize(lines: ARLine[]): ARSummary {
  const by = new Map<string, { shopName: string; amount: number; count: number }>();
  let total = 0;
  for (const l of lines) {
    total += l.balance;
    const e = by.get(l.shopNum) ?? { shopName: l.shopName, amount: 0, count: 0 };
    e.amount += l.balance; e.count += 1;
    by.set(l.shopNum, e);
  }
  return {
    total: Math.round(total),
    count: lines.length,
    byShop: [...by.entries()]
      .map(([shopNum, v]) => ({ shopNum, shopName: v.shopName, amount: Math.round(v.amount), count: v.count }))
      .sort((a, b) => b.amount - a.amount),
  };
}

// ---- trend ----------------------------------------------------------------
//
// We deliberately do NOT reconstruct history. Tekmetric only tells us AR as it
// is *right now*; what AR was on any past day is unknowable (invoices since
// paid are gone). So the trend is exactly the real daily snapshots we capture
// going forward — one dot today, two tomorrow, and so on.

// ---- daily snapshot store -------------------------------------------------

export interface ARSnapshot { date: string; total: number; over30: number; new: number; perShop?: Record<string, number> }
const SNAP_KEY = (d: string) => `ar_snapshot_${d}`;
const SNAP_INDEX = 'ar_snapshot_index';

export async function readSnapshots(): Promise<ARSnapshot[]> {
  const idx = (await readCache<string[]>(SNAP_INDEX)) || [];
  const out: ARSnapshot[] = [];
  for (const d of idx) {
    const s = await readCache<ARSnapshot>(SNAP_KEY(d));
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function writeSnapshot(s: ARSnapshot): Promise<void> {
  await writeCache(SNAP_KEY(s.date), s);
  const idx = (await readCache<string[]>(SNAP_INDEX)) || [];
  if (!idx.includes(s.date)) {
    idx.push(s.date);
    idx.sort();
    await writeCache(SNAP_INDEX, idx);
  }
}

export async function hasSnapshot(date: string): Promise<boolean> {
  return !!(await readCache<ARSnapshot>(SNAP_KEY(date)));
}

/** Total / >30 / new dollar totals from a set of AR orders (snapshot math). */
export function snapshotTotals(orders: RepairOrder[], now = Date.now()): { total: number; over30: number; new: number } {
  let total = 0, over30 = 0, fresh = 0;
  for (const o of orders) {
    if (!isAR(o)) continue;
    const bal = c2d(o.totalSales - o.amountPaid);
    const days = arDaysOverdue(o, now);
    total += bal;
    if (days > 30) over30 += bal;
    if (days < 7) fresh += bal;
  }
  return { total: Math.round(total), over30: Math.round(over30), new: Math.round(fresh) };
}

// ---- current open AR (durable, refreshed once daily after close) ----------
//
// "Open AR right now" is range-independent — the chart's date range only
// scopes the trend, never the live totals. We store this slice durably per
// mode so the page serves it instantly and never cold-pulls the YTD RO
// window on the request path. The after-close cron rewrites it once a day.

// Bumped namespace from `ar_current_` → `ar_current_v2_` when the live AR
// pull was widened from YTD-only to a trailing 24-month lookback. Old keys
// remain on prod (served by the older code path) until prod deploys; the new
// namespace guarantees no cross-contamination during QC.
export const AR_CURRENT_KEY = (mode: ARMode) => `ar_current_v2_${mode}`;

export interface CurrentAR {
  summary: ARSummary;
  customers: (ARLine & { totalOwedByCustomer: number })[];
  liveTotals: { total: number; over30: number; new: number };
  agedTotal: number;         // sum of balances on invoices >12 months old
  namesResolved: number;
  computedAt: string;
}

// Build the current-AR slice from already-fetched YTD ROs. The daily cron
// already holds the YTD ROs, so calling this there adds no Tekmetric calls.
export async function currentARFromRos(ros: RepairOrder[], mode: ARMode): Promise<CurrentAR> {
  const arOrders = ros.filter(isAR);
  const ids = Array.from(new Set(arOrders.map((o) => o.customerId)));
  const names = await resolveCustomerNames(ids, 20);
  const allLines = buildARLines(arOrders, names, 'total');
  const owedByCustomer = new Map<number, number>();
  for (const l of allLines) owedByCustomer.set(l.customerId, (owedByCustomer.get(l.customerId) || 0) + l.balance);
  const customers = buildARLines(arOrders, names, mode).map((l) => ({
    ...l,
    totalOwedByCustomer: Math.round(owedByCustomer.get(l.customerId) || l.balance),
  }));
  const agedTotal = Math.round(allLines.filter((l) => l.aged).reduce((s, l) => s + l.balance, 0));
  return {
    summary: summarize(customers),
    customers,
    liveTotals: snapshotTotals(arOrders),
    agedTotal,
    namesResolved: ids.length,
    computedAt: new Date().toISOString(),
  };
}
