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
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
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
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 500 * 2 ** attempt);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tekmetric ${path} ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json();
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
  jobCategoryName: string;
  partsTotal: number;
  laborTotal: number;
  discountTotal: number;
  feeTotal: number;
  subtotal: number;
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
  partType: { code: string; name: string };
  partStatus: { code: string; name: string };
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
    out.push(...data.content);
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

// ---- Helpers ----

/** Cents -> dollars. Tekmetric returns money in integer cents. */
export const c2d = (cents: number) => cents / 100;
