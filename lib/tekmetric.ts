// Server-only Tekmetric client. Keep all secrets here.

const BASE = process.env.TEKMETRIC_BASE_URL || 'https://shop.tekmetric.com/api/v1';
const CLIENT_ID = process.env.TEKMETRIC_CLIENT_ID;
const CLIENT_SECRET = process.env.TEKMETRIC_CLIENT_SECRET;

interface TokenCache {
  token: string;
  expiresAt: number;
}
let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('TEKMETRIC_CLIENT_ID / TEKMETRIC_CLIENT_SECRET not configured');
  }
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const tokenCtrl = new AbortController();
  const tokenTimer = setTimeout(() => tokenCtrl.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
      signal: tokenCtrl.signal,
    });
  } finally {
    clearTimeout(tokenTimer);
  }
  if (!res.ok) throw new Error(`Tekmetric token error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  // Tokens typically last 24h but doc isn't explicit; refresh after 12h to be safe.
  tokenCache = { token: json.access_token, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
  return tokenCache.token;
}

async function authedFetch(path: string, params?: Record<string, string | number | undefined>) {
  const token = await getAccessToken();
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  // Tekmetric throttles aggressive callers with 429. Back off exponentially and retry.
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const fetchCtrl = new AbortController();
    const fetchTimer = setTimeout(() => fetchCtrl.abort(), 15000);
    let res: Response;
    let body: any;
    try {
      res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
        signal: fetchCtrl.signal,
      });
      // Read body while timer is still active — prevents a hang if the server
      // sends headers quickly but then stalls delivering the response body.
      body = res.status === 429 ? null : await (res.ok ? res.json() : res.text());
    } finally {
      clearTimeout(fetchTimer);
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      // Cap retry-after at 30s — Tekmetric occasionally sends absurdly large
      // values (e.g. 3600) that would hang the function past Vercel's timeout.
      const delay = retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : Math.min(8000, 500 * 2 ** attempt);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Tekmetric ${path} ${res.status}: ${String(body).slice(0, 300)}`);
    }
    return body;
  }
  throw new Error(`Tekmetric ${path} 429: exhausted retries`);
}

// ---- Domain types (subset of fields we use) ----

export interface RepairOrder {
  id: number;
  repairOrderNumber: number;
  shopId: number;
  customerId: number;
  vehicleId: number;
  technicianId: number | null;
  serviceWriterId: number | null;
  completedDate: string | null;
  postedDate: string | null;
  // money values are in cents
  laborSales: number;
  partsSales: number;
  subletSales: number;
  discountTotal: number;
  feeTotal: number;
  taxes: number;
  totalSales: number;
  amountPaid: number;
  jobs: Job[];
  repairOrderStatus: { id: number; code: string; name: string };
  customerConcerns?: { id: number; concern: string }[];
  leadSource?: string | null;
  createdDate: string;
  updatedDate: string;
  customerTimeOut?: string | null;
}

export interface Job {
  id: number;
  repairOrderId: number;
  vehicleId: number;
  customerId: number;
  name: string;
  authorized: boolean;
  authorizedDate: string | null;
  selected: boolean;
  technicianId: number | null;
  note: string | null;
  cannedJobId: number | null;
  jobCategoryName: string;
  partsTotal: number;
  laborTotal: number;
  discountTotal: number;
  feeTotal: number;
  subtotal: number;
  archived: boolean;
  laborHours: number;
  parts: Part[];
  labor: { rate: number; hours: number; technicianId: number | null; complete: boolean }[];
}

export interface Part {
  quantity: number;
  brand: string;
  name: string;
  partNumber: string;
  cost: number; // cents
  retail: number; // cents
  partType?: { code: string; name: string };
  partStatus?: { code: string; name: string };
}

export interface Appointment {
  id: number;
  shopId: number;
  customerId: number | null;
  vehicleId: number | null;
  startTime: string;
  endTime: string;
  description: string | null;
  notes: string | null;
  createdDate: string;
  updatedDate: string;
  // status fields vary; we treat presence of customerId + startTime as bookable
}

// ---- Public API ----

export async function listShops() {
  return authedFetch('/shops') as Promise<
    Array<{ id: number; name: string; nickname: string; timeZoneId: string }>
  >;
}

export interface ROFilter {
  shopId: number;
  postedDateStart: string; // ISO
  postedDateEnd: string;
  size?: number;
}

// Fetch ROs that were CREATED in the given range regardless of posted status.
// This captures open/work-in-progress tickets that have no postedDate yet.
export async function fetchROsByCreatedDate(shopId: number, createdStart: string, createdEnd: string): Promise<RepairOrder[]> {
  const out: RepairOrder[] = [];
  let page = 0;
  while (true) {
    const data = (await authedFetch('/repair-orders', {
      shop: shopId,
      createdDateStart: createdStart,
      createdDateEnd: createdEnd,
      page,
      size: 200,
    })) as { content: RepairOrder[]; last: boolean };
    out.push(...data.content.map((ro) => ro.shopId ? ro : { ...ro, shopId }));
    if (data.last) break;
    page++;
    if (page > 500) break;
  }
  return out;
}

export async function fetchAllRepairOrders(f: ROFilter): Promise<RepairOrder[]> {
  const out: RepairOrder[] = [];
  let page = 0;
  while (true) {
    const data = (await authedFetch('/repair-orders', {
      shop: f.shopId,
      postedDateStart: f.postedDateStart,
      postedDateEnd: f.postedDateEnd,
      page,
      size: f.size ?? 200,
    })) as { content: RepairOrder[]; last: boolean; totalPages: number };
    // Stamp shopId onto every RO so callers can filter by shop after
    // concatenating results from multiple shops (e.g. rosForChain). The
    // Tekmetric API endpoint is scoped to one shop via ?shop=<id> so the
    // field may not be present in the response body — stamping it here
    // guarantees r.shopId is always the correct numeric Tekmetric shop ID.
    out.push(...data.content.map((ro) => ro.shopId ? ro : { ...ro, shopId: f.shopId }));
    if (data.last) break;
    page++;
    if (page > 500) break; // safety
  }
  return out;
}

export interface AppointmentFilter {
  shopId: number;
  startTimeFrom: string; // ISO
  startTimeTo: string;
  size?: number;
}

export async function fetchAllAppointments(f: AppointmentFilter): Promise<Appointment[]> {
  // KNOWN ISSUE: Tekmetric `/appointments` accepts startTimeFrom/startTimeTo with 200 OK
  // but does NOT respect them server-side (returns rows outside the window).
  // Until we confirm the right param names with Tekmetric docs, we pull all and filter client-side.
  const out: Appointment[] = [];
  let page = 0;
  const from = new Date(f.startTimeFrom).getTime();
  const to = new Date(f.startTimeTo).getTime();
  while (true) {
    const data = (await authedFetch('/appointments', {
      shop: f.shopId,
      startTimeFrom: f.startTimeFrom,
      startTimeTo: f.startTimeTo,
      page,
      size: f.size ?? 200,
    })) as { content: Appointment[]; last: boolean };
    for (const a of data.content) {
      const t = new Date(a.startTime).getTime();
      if (t >= from && t <= to) out.push(a);
    }
    if (data.last) break;
    page++;
    if (page > 500) break;
  }
  return out;
}

// ---- Bulk customer phone index ----
// Fetch every customer for a shop (paginated) and return a phone-digits →
// customerId map. Used by marketing attribution to match WC callers to TM
// customers in one sweep instead of one API call per caller phone.

export async function buildCustomerPhoneIndex(shopId: number): Promise<Map<string, number>> {
  const map = new Map<string, number>(); // normalized last-10-digits → customerId
  let page = 0;
  while (true) {
    const data = await authedFetch('/customers', { shop: shopId, page, size: 200 }) as {
      content: any[];
      last: boolean;
    };
    for (const c of data.content) {
      const phones = collectPhoneDigits(c);
      for (const raw of phones) {
        const norm = raw.replace(/\D/g, '').slice(-10);
        if (norm.length >= 7 && !map.has(norm)) {
          map.set(norm, c.id as number);
        }
      }
    }
    if (data.last) break;
    page++;
    if (page > 500) break;
  }
  console.log(`[TM] shop ${shopId} — phone index built: ${map.size} unique phones`);
  return map;
}

// ---- Customer-by-phone search ----
// Used by the To Do queue's missed-callbacks tab to decide whether a caller
// is already a Tekmetric customer (so we can deep-link to their record) or a
// first-time lead (no link). Tekmetric's `/customers?search=` field matches
// across name + phone fields, so we re-verify the digit match against each
// returned customer's phones before claiming a hit.

export async function searchCustomersByPhone(shopId: number, phoneDigits: string): Promise<number | null> {
  if (!phoneDigits || phoneDigits.length < 7) return null;
  try {
    const data = await authedFetch('/customers', { shop: shopId, search: phoneDigits, size: 5 }) as any;
    const content: any[] = Array.isArray(data?.content) ? data.content : (Array.isArray(data) ? data : []);
    if (!content.length) return null;
    // Compare on the last 10 digits — US numbers may or may not carry a "1"
    // country prefix in either source.
    const target = phoneDigits.slice(-10);
    for (const c of content) {
      const phones = collectPhoneDigits(c);
      if (phones.some(p => p.endsWith(target) || target.endsWith(p) || p.includes(target))) {
        return c.id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Walk a Tekmetric customer object and pull every digit string that looks
// like a phone. Restricted to keys whose names suggest phone-ness so we
// don't accidentally match account ids or vehicle numbers.
function collectPhoneDigits(c: any): string[] {
  const out = new Set<string>();
  function walk(v: any, key?: string) {
    if (v == null) return;
    const keyLooksPhoney = !!key && /phone|tel|mobile|cell|number/i.test(key);
    if (typeof v === 'string') {
      if (keyLooksPhoney) {
        const digits = v.replace(/\D/g, '');
        if (digits.length >= 7) out.add(digits);
      }
      return;
    }
    if (typeof v === 'number') {
      if (keyLooksPhoney) {
        const s = String(v);
        if (s.length >= 7) out.add(s);
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) walk(item, key);
      return;
    }
    if (typeof v === 'object') {
      for (const k of Object.keys(v)) walk(v[k], k);
    }
  }
  walk(c);
  return Array.from(out);
}

// ---- Helpers ----

/** Cents -> dollars. Tekmetric returns money in integer cents. */
export const c2d = (cents: number) => cents / 100;
