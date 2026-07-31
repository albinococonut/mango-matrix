'use client';

// To Do — per-shop action queue. Three categories live in tabs at the top
// so a manager doesn't have to scroll through one big list:
//   • Salvageable Callbacks — calls that didn't book but AI thinks could
//   • Customers Who Didn't Rebook — visits this week with no future appt
//   • Declined Jobs — Tekmetric jobs > 30d old the customer never authorized
//
// Each tab shows its own $ at stake; the grand total sits above the tabs.
// Per-shop on purpose — chain-wide rollups live elsewhere; this is the view
// an advisor or manager actually works from. Shop selection persists via
// sessionStorage so it survives tab switches.
//
// Interaction: a single checkbox per row marks it done. Done rows fade to
// half opacity, get a strikethrough, and reorder to the bottom of the list
// via framer-motion `layout` animations. Unchecking floats the row back up.
// "Recovered" (green check) and "Not Recovered" (X) are BOTH terminal —
// the manager's verdict is final; no background sweep resurfaces a
// checked row. See the matching comment in components/TodoSection.tsx.

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ListChecks, CalendarX, Repeat, Wrench, Check, X, ExternalLink, MessageSquare, PlayCircle, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { usd, usdK } from '@/lib/format';
import { SHOPS, SHOP_BY_NUM } from '@/lib/shops';

const SHOP_SS_KEY  = 'todoShop:v1';
const TAB_SS_KEY   = 'todoTab:v1';

type Tab = 'callbacks' | 'rebooks' | 'declined' | 'guava';

// A row's resolution, normalized across the three queues:
//   • open          — still on the call list (counts toward $ at stake)
//   • recovered     — manager checked it off (a "win"; counts toward the
//                     "customers recovered this week" tally)
//   • not_recovered — manager worked it but the customer was lost (closes the
//                     row WITHOUT crediting a recovery). Maps to the backend's
//                     pre-existing `not_salvageable` status.
type ResKind = 'open' | 'recovered' | 'not_recovered';

// Normalize a server resolutionStatus into a ResKind. The three queues use
// slightly different words for "win" (resolved / won) — collapse them here.
function serverKind(status: string): ResKind {
  if (status === 'won' || status === 'resolved') return 'recovered';
  if (status === 'not_salvageable') return 'not_recovered';
  return 'open';
}

// True if `iso` falls in the current Mon–Sun week (chain-local enough for a
// browser-side check). Used to scope which visibly-recovered feed rows count
// toward "recovered this week". A missing timestamp is treated as in-week so a
// checkmarked row is never silently dropped from the tally.
function isThisWeek(iso?: string): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  if (!t) return true;
  const now = new Date();
  const diffToMon = (now.getDay() + 6) % 7; // 0=Mon … 6=Sun
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMon).getTime();
  return t >= monday && t < monday + 7 * 86_400_000;
}

type RebookRow = {
  shopNum: string;
  shopName: string;
  roId: number;
  customerId: number;
  customerName: string;
  phone?: string;
  vehicle?: string;
  postedDate: string;
  resolutionStatus: 'open' | 'won' | 'not_salvageable';
  resolvedAt?: string;
  resolvedBy?: string;                // email of last actor (server-authoritative)
  _localStatus?: ResKind | null;      // optimistic override; null = use server state
  _localCheckedAt?: string;
  _localResolvedBy?: string;          // optimistic actor (current user's email)
};

type CallbackRow = {
  shopNum: string;
  shopName: string;
  leadId: number;
  dateCreated: string;
  callerName: string;
  callerPhone: string;
  callDurationSeconds: number;
  probability: number;
  reason: string;
  angle: string;
  estimatedMissedRevenue: number;
  resolutionStatus: 'open' | 'resolved' | 'not_salvageable';
  resolvedAt?: string;
  resolvedBy?: string;
  tekmetricCustomerId?: number;   // set iff this caller matches an existing Tekmetric customer
  transcriptPreview?: string;
  recording?: string;
  _localStatus?: ResKind | null;
  _localCheckedAt?: string;
  _localResolvedBy?: string;
};

type DeclinedJobRowT = {
  shopNum: string;
  shopName: string;
  shopId?: number;
  jobId: number;
  roId: number;
  customerId: number;
  customerName: string;
  phone?: string;
  jobName: string;
  jobSubtotal: number;          // dollars
  declinedDate: string;
  resolutionStatus: 'open' | 'won' | 'not_salvageable';
  resolvedAt?: string;
  resolvedBy?: string;
  _localStatus?: ResKind | null;
  _localCheckedAt?: string;
  _localResolvedBy?: string;
};

function formatRelative(iso: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!t) return '—';
  const diffMs = Date.now() - t;
  const days = Math.floor(diffMs / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor(diffMs / 3_600_000);
    if (hours <= 0) return 'just now';
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Date phrasing for Re-Book rows: managers think "when did we close this RO,"
 * not "X hours ago." Examples: "today", "yesterday", "Monday" (within last
 * 6 days), "Aug 12" (older this year), "Aug 12, 2024" (different year).
 */
function formatClosedDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const t = d.getTime();
  if (!t) return '—';
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function tekmetricRoUrl(shopId: number, roId: number): string {
  return `https://shop.tekmetric.com/admin/shop/${shopId}/repair-orders/${roId}`;
}

function tekmetricCustomerUrl(shopId: number, customerId: number): string {
  return `https://shop.tekmetric.com/admin/shop/${shopId}/customers/${customerId}`;
}

function shopIdForNum(num: string): number | undefined {
  const meta = SHOP_BY_NUM[num as keyof typeof SHOP_BY_NUM];
  return meta?.tekmetricId;
}

function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return String(raw);
}

/**
 * Display name for an actor email. Everyone is @mangoautomotive.com, so the
 * local part is enough on a busy row — full email lives in the title
 * tooltip in case there's ever a name collision.
 */
function shortActor(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

/**
 * Customer-name block — used by all three row types so the "click here to
 * jump to Tekmetric" affordance reads identically across the queues.
 *
 *  - When we have a Tekmetric customer record, the name is a prominent
 *    orange link with an arrow icon and an "Existing customer" pill
 *    underneath. The pill is its own clickable target so a mis-aimed click
 *    still works.
 *  - When there's no Tekmetric record (first-time caller), the name renders
 *    as plain ink-colored text with a "New caller" subdued pill. No link —
 *    the previous phone-search URL just landed on an empty Tekmetric
 *    search, which looked broken.
 */
function CustomerLink({ name, customerUrl, existing }: {
  name: string; customerUrl?: string; existing: boolean;
}) {
  if (customerUrl) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5 min-w-0">
        <a
          href={customerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-mango-orange hover:text-mango-orange/80 underline decoration-mango-orange/40 underline-offset-2 hover:decoration-mango-orange/80 transition"
        >
          {name}
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <a
          href={customerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold rounded-full px-1.5 py-0.5 bg-mango-orange/12 text-mango-orange hover:bg-mango-orange/20 transition"
        >
          Existing customer →
        </a>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-start gap-0.5 min-w-0">
      <span className="font-semibold text-mango-ink">{name}</span>
      {!existing && (
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold rounded-full px-1.5 py-0.5 bg-mango-line/40 text-mango-muted">
          New caller — not in Tekmetric
        </span>
      )}
    </span>
  );
}

// Effective resolution kind — local optimistic state takes priority over
// server state so a click feels instant.
function rowKind<T extends { _localStatus?: ResKind | null; resolutionStatus: string }>(row: T): ResKind {
  return row._localStatus ?? serverKind(row.resolutionStatus);
}
// "Done" = anything that's left the open call list (recovered OR not recovered).
function isDone<T extends { _localStatus?: ResKind | null; resolutionStatus: string }>(row: T): boolean {
  return rowKind(row) !== 'open';
}

// When did this row get marked done? Prefer local timestamp (just clicked)
// over server resolvedAt (cached).
function checkedAt<T extends { _localCheckedAt?: string; resolvedAt?: string }>(row: T): string | undefined {
  return row._localCheckedAt || row.resolvedAt;
}

// Who marked it done? Same preference: optimistic local actor wins over the
// last server-persisted actor.
function checkedBy<T extends { _localResolvedBy?: string; resolvedBy?: string }>(row: T): string | undefined {
  return row._localResolvedBy || row.resolvedBy;
}

// Concept2 design: this file is a parallel of components/TodoSection.tsx.
// All interactive logic — presence heartbeat, optimistic mutations, recovery
// ledger sync, auto-poll, sessionStorage shop/tab persistence — is preserved
// byte-for-byte. Only the visual chrome (outer card, header, shop pills,
// summary cards, tab buttons, row backgrounds) is restyled to match the
// concept2 design language: frosted surfaces, serif headlines (c2disp),
// Inter UI body (c2ui), confident type scale.
export default function Concept2TodoSection({ userEmail }: { userEmail?: string }) {
  const [callbacks, setCallbacks] = useState<CallbackRow[] | null>(null);
  const [rebooks, setRebooks] = useState<RebookRow[] | null>(null);
  const [declined, setDeclined] = useState<DeclinedJobRowT[] | null>(null);
  const [salesEff, setSalesEff] = useState<any>(null);
  const [callbackErr, setCallbackErr] = useState<string | null>(null);
  const [rebookErr, setRebookErr] = useState<string | null>(null);
  const [declinedErr, setDeclinedErr] = useState<string | null>(null);

  const [aroByShop, setAroByShop] = useState<Record<string, number>>({});
  // Per-shop SET of recovered entry-ids from the durable ledger
  // (/api/todo/recovered). Authoritative for recoveries that have since left
  // the rolling feed; unioned client-side with the rows currently shown as
  // recovered so visibly-checkmarked customers always get credited too.
  const [recoveredLedgerByShop, setRecoveredLedgerByShop] = useState<Record<string, string[]>>({});

  // Initialize from static defaults so server and client render identically
  // (prevents hydration mismatch). Restore saved session values after mount.
  const [shopNum, setShopNum] = useState<string>(SHOPS[0].num);
  useEffect(() => {
    try { const s = window.sessionStorage.getItem(SHOP_SS_KEY); if (s) setShopNum(s); } catch {}
  }, []);
  useEffect(() => { try { window.sessionStorage.setItem(SHOP_SS_KEY, shopNum); } catch {} }, [shopNum]);

  const [tab, setTab] = useState<Tab>('callbacks');
  useEffect(() => {
    try { const t = window.sessionStorage.getItem(TAB_SS_KEY) as Tab; if (t) setTab(t); } catch {}
  }, []);
  useEffect(() => { try { window.sessionStorage.setItem(TAB_SS_KEY, tab); } catch {} }, [tab]);

  // ---- Live presence ---------------------------------------------------
  // Active = other users currently viewing /todo within the last ~45 s.
  // We heartbeat every 15 s with our current shop so others know which
  // shop we're working. Page Visibility API drops us off the list within
  // ~5 s of switching to a different tab.
  const [activeUsers, setActiveUsers] = useState<Array<{ email: string; shopNum: string; lastSeenAt: string }>>([]);
  useEffect(() => {
    let alive = true;
    const HEARTBEAT_MS = 15_000;

    const heartbeat = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const r = await fetch('/api/todo/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'heartbeat', shopNum }),
          cache: 'no-store',
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!alive) return;
        if (Array.isArray(j?.active)) setActiveUsers(j.active);
      } catch {}
    };

    // Fire-and-forget leave beacon. sendBeacon survives page unload /
    // navigation in a way fetch doesn't.
    const leaveBeacon = () => {
      try {
        if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
        const body = JSON.stringify({ action: 'leave' });
        navigator.sendBeacon('/api/todo/presence', new Blob([body], { type: 'application/json' }));
      } catch {}
    };

    // Initial heartbeat + interval.
    heartbeat();
    const id = window.setInterval(heartbeat, HEARTBEAT_MS);

    // Visibility-aware: drop off when hidden, ping immediately when visible.
    const onVisibility = () => {
      if (document.hidden) leaveBeacon();
      else heartbeat();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Best-effort leave on unload / navigation.
    window.addEventListener('pagehide', leaveBeacon);

    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', leaveBeacon);
      leaveBeacon();
    };
  }, [shopNum]);

  // Map a target ResKind to each queue's backend action verb. "recovered" is
  // a win (resolved / won); "not_recovered" closes without crediting a
  // recovery (not_salvageable); "open" reopens the row.
  const callbackAction = (k: ResKind) => (k === 'recovered' ? 'resolve' : k === 'not_recovered' ? 'not_salvageable' : 'reopen');
  const winAction      = (k: ResKind) => (k === 'recovered' ? 'won'     : k === 'not_recovered' ? 'not_salvageable' : 'reopen');

  // Pull the authoritative per-shop "recovered this week" counts from the
  // durable ledger. Called on mount, every poll, and right after a row action.
  const refreshRecoveredCounts = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetch('/api/todo/recovered', { cache: 'no-store', signal });
      if (!r.ok) return;
      const d = await r.json();
      if (d?.byShop && typeof d.byShop === 'object') setRecoveredLedgerByShop(d.byShop);
    } catch {}
  }, []);

  const setCallbackStatus = useCallback(async (leadId: number, kind: ResKind, rowShopNum: string) => {
    const nowIso = new Date().toISOString();
    setCallbacks(prev => prev?.map(c =>
      c.leadId === leadId
        ? {
            ...c,
            _localStatus: kind,
            _localCheckedAt: kind === 'open' ? undefined : nowIso,
            _localResolvedBy: kind === 'open' ? undefined : userEmail,
          }
        : c
    ) ?? null);
    try {
      await fetch(`/api/callback/${leadId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: callbackAction(kind), shopNum: rowShopNum }),
      });
      refreshRecoveredCounts();   // reconcile the durable weekly tally
    } catch {
      // Drop the optimistic override so the next poll's server state wins.
      setCallbacks(prev => prev?.map(c => c.leadId === leadId ? { ...c, _localStatus: null } : c) ?? null);
    }
  }, [userEmail, refreshRecoveredCounts]);

  const setRebookStatus = useCallback(async (roId: number, kind: ResKind, rowShopNum: string) => {
    const nowIso = new Date().toISOString();
    setRebooks(prev => prev?.map(r =>
      r.roId === roId
        ? {
            ...r,
            _localStatus: kind,
            _localCheckedAt: kind === 'open' ? undefined : nowIso,
            _localResolvedBy: kind === 'open' ? undefined : userEmail,
          }
        : r
    ) ?? null);
    try {
      await fetch(`/api/rebook/${roId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: winAction(kind), shopNum: rowShopNum }),
      });
      refreshRecoveredCounts();
    } catch {
      setRebooks(prev => prev?.map(r => r.roId === roId ? { ...r, _localStatus: null } : r) ?? null);
    }
  }, [userEmail, refreshRecoveredCounts]);

  const setDeclinedStatus = useCallback(async (jobId: number, kind: ResKind, rowShopNum: string) => {
    const nowIso = new Date().toISOString();
    setDeclined(prev => prev?.map(d =>
      d.jobId === jobId
        ? {
            ...d,
            _localStatus: kind,
            _localCheckedAt: kind === 'open' ? undefined : nowIso,
            _localResolvedBy: kind === 'open' ? undefined : userEmail,
          }
        : d
    ) ?? null);
    try {
      await fetch(`/api/declined-job/${jobId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: winAction(kind), shopNum: rowShopNum }),
      });
      refreshRecoveredCounts();
    } catch {
      setDeclined(prev => prev?.map(d => d.jobId === jobId ? { ...d, _localStatus: null } : d) ?? null);
    }
  }, [userEmail, refreshRecoveredCounts]);

  // ---- Cross-user live polling -----------------------------------------
  //
  // The 3 feeds (callbacks, rebooks, declined) are refetched on mount AND
  // every POLL_MS so any logged-in user sees other users' checks land
  // without a manual refresh. When merging fresh server data, we
  // preserve each row's local optimistic state IF the server hasn't
  // caught up yet — so a poll that fires mid-click can't flicker the
  // checkbox back to its pre-click state.
  const POLL_MS = 20_000;

  function mergeWithLocal<T extends {
    _localStatus?: ResKind | null;
    _localCheckedAt?: string;
    _localResolvedBy?: string;
    resolutionStatus: string;
  }>(
    prev: T[] | null,
    fresh: T[],
    keyOf: (r: T) => string | number,
  ): T[] {
    const prevById = new Map<string | number, T>((prev ?? []).map(r => [keyOf(r), r]));
    return fresh.map(newRow => {
      const oldRow = prevById.get(keyOf(newRow));
      if (!oldRow || oldRow._localStatus == null) return newRow;
      // The user's most recent click set an optimistic kind. If the server has
      // caught up to it, drop the override and trust fresh server state (which
      // also carries OTHER users' updates). Otherwise preserve the optimistic
      // kind so a poll firing mid-write can't flicker the row back.
      if (serverKind(newRow.resolutionStatus) === oldRow._localStatus) return newRow;
      return {
        ...newRow,
        _localStatus: oldRow._localStatus,
        _localCheckedAt: oldRow._localCheckedAt,
        _localResolvedBy: oldRow._localResolvedBy,
      };
    });
  }

  const refetchAll = useCallback(async (signal?: AbortSignal) => {
    // Each feed is independent; failures in one shouldn't kill the others.
    // For background polls we leave existing data in place on error (only
    // log to console) so the UI doesn't flash empty.
    const noStore: RequestInit = { cache: 'no-store', signal };
    const aborted = () => signal?.aborted;

    await Promise.all([
      (async () => {
        try {
          const r = await fetch('/api/extras?view=missed-callbacks', noStore);
          if (!r.ok) { if (!aborted()) setCallbackErr(`HTTP ${r.status}`); return; }
          const d = await r.json();
          if (aborted()) return;
          if (!Array.isArray(d?.shops)) { setCallbackErr('unexpected shape'); return; }
          setCallbackErr(null);
          const flat: CallbackRow[] = [];
          const aroMap: Record<string, number> = {};
          for (const s of d.shops) {
            if (s.pending) continue;
            for (const c of (s.calls || [])) {
              flat.push({
                shopNum: s.shopNum, shopName: s.shopName,
                leadId: c.leadId, dateCreated: c.dateCreated,
                callerName: c.callerName, callerPhone: c.callerPhone,
                callDurationSeconds: c.callDurationSeconds,
                probability: c.probability, reason: c.reason, angle: c.angle,
                estimatedMissedRevenue: c.estimatedMissedRevenue,
                resolutionStatus: (c.resolution?.status ?? 'open') as CallbackRow['resolutionStatus'],
                resolvedAt: c.resolution?.resolvedAt,
                resolvedBy: c.resolution?.resolvedBy,
                tekmetricCustomerId: typeof c.tekmetricCustomerId === 'number' ? c.tekmetricCustomerId : undefined,
                transcriptPreview: c.transcriptPreview ?? undefined,
                recording: c.recording ?? undefined,
              });
            }
          }
          if (d.aroByShop && typeof d.aroByShop === 'object') {
            for (const [k, v] of Object.entries(d.aroByShop)) if (typeof v === 'number') aroMap[k] = v;
          }
          setCallbacks(prev => mergeWithLocal(prev, flat, c => c.leadId));
          setAroByShop(prev => ({ ...prev, ...aroMap }));
        } catch (e: any) {
          if (e?.name === 'AbortError') return;
          // Don't blow away existing data on a polling error — surface only
          // on the very first load (when callbacks is still null).
          setCallbacks(prev => prev ?? []);
          setCallbackErr(prev => prev ?? e?.message ?? 'network');
        }
      })(),
      (async () => {
        try {
          const r = await fetch('/api/extras?view=missed-rebooks', noStore);
          if (!r.ok) { if (!aborted()) setRebookErr(`HTTP ${r.status}`); return; }
          const d = await r.json();
          if (aborted()) return;
          if (!Array.isArray(d?.shops)) { setRebookErr('unexpected shape'); return; }
          setRebookErr(null);
          const flat: RebookRow[] = [];
          for (const s of d.shops) {
            if (s.pending) continue;
            for (const c of (s.customers || [])) {
              flat.push({
                shopNum: s.shopNum, shopName: s.shopName,
                roId: c.roId, customerId: c.customerId,
                customerName: c.customerName, phone: c.phone, vehicle: c.vehicle,
                postedDate: c.postedDate,
                resolutionStatus: (c.resolution?.status ?? 'open') as RebookRow['resolutionStatus'],
                resolvedAt: c.resolution?.resolvedAt,
                resolvedBy: c.resolution?.resolvedBy,
              });
            }
          }
          setRebooks(prev => mergeWithLocal(prev, flat, r => r.roId));
        } catch (e: any) {
          if (e?.name === 'AbortError') return;
          setRebooks(prev => prev ?? []);
          setRebookErr(prev => prev ?? e?.message ?? 'network');
        }
      })(),
      (async () => {
        try {
          const r = await fetch('/api/extras?view=declined-jobs', noStore);
          if (!r.ok) { if (!aborted()) setDeclinedErr(`HTTP ${r.status}`); return; }
          const d = await r.json();
          if (aborted()) return;
          if (!Array.isArray(d?.shops)) { setDeclinedErr('unexpected shape'); return; }
          setDeclinedErr(null);
          const flat: DeclinedJobRowT[] = [];
          for (const s of d.shops) {
            if (s.pending) continue;
            for (const j of (s.jobs || [])) {
              flat.push({
                shopNum: s.shopNum, shopName: s.shopName, shopId: s.shopId,
                jobId: j.jobId, roId: j.roId, customerId: j.customerId,
                customerName: j.customerName, phone: j.phone,
                jobName: j.jobName, jobSubtotal: j.jobSubtotal,
                declinedDate: j.declinedDate,
                resolutionStatus: (j.resolution?.status ?? 'open') as DeclinedJobRowT['resolutionStatus'],
                resolvedAt: j.resolution?.resolvedAt,
                resolvedBy: j.resolution?.resolvedBy,
              });
            }
          }
          setDeclined(prev => mergeWithLocal(prev, flat, d => d.jobId));
        } catch (e: any) {
          if (e?.name === 'AbortError') return;
          setDeclined(prev => prev ?? []);
          setDeclinedErr(prev => prev ?? e?.message ?? 'network');
        }
      })(),
      (async () => {
        try {
          const r = await fetch('/api/extras?view=sales-effectiveness', noStore);
          if (aborted()) return;
          if (r.ok) setSalesEff(await r.json());
        } catch { /* swallow — not critical */ }
      })(),
    ]);
  }, []);

  // Initial load + 20s polling. Aborts any in-flight fetch on unmount so
  // we don't dispatch setState on a dead component. The recovered-this-week
  // tally polls on the same cadence so other users' recoveries land too.
  useEffect(() => {
    const ctrl = new AbortController();
    refetchAll(ctrl.signal);
    refreshRecoveredCounts(ctrl.signal);
    const id = window.setInterval(() => {
      refetchAll(ctrl.signal);
      refreshRecoveredCounts(ctrl.signal);
    }, POLL_MS);
    return () => { ctrl.abort(); window.clearInterval(id); };
  }, [refetchAll, refreshRecoveredCounts]);

  const aro = aroByShop[shopNum] || 0;

  // Per-shop slice. Show everything (don't filter completed), but sort so
  // open rows sit at the top in priority order and done rows sink to the
  // bottom, newest-completed first.
  const callbacksForShop = (callbacks ?? []).filter(c => c.shopNum === shopNum);
  const sortedCallbacks = callbacksForShop.slice().sort((a, b) => {
    const ad = isDone(a) ? 1 : 0;
    const bd = isDone(b) ? 1 : 0;
    if (ad !== bd) return ad - bd;
    if (ad === 1) return (checkedAt(b) || '').localeCompare(checkedAt(a) || '');
    return (b.estimatedMissedRevenue - a.estimatedMissedRevenue) || (b.probability - a.probability);
  });
  const openCallbacks = callbacksForShop.filter(c => !isDone(c));

  const rebooksForShop = (rebooks ?? []).filter(r => r.shopNum === shopNum);
  const sortedRebooks = rebooksForShop.slice().sort((a, b) => {
    const ad = isDone(a) ? 1 : 0;
    const bd = isDone(b) ? 1 : 0;
    if (ad !== bd) return ad - bd;
    if (ad === 1) return (checkedAt(b) || '').localeCompare(checkedAt(a) || '');
    return (b.postedDate || '').localeCompare(a.postedDate || '');
  });
  const openRebooks = rebooksForShop.filter(r => !isDone(r));

  const declinedForShop = (declined ?? []).filter(d => d.shopNum === shopNum);
  const sortedDeclined = declinedForShop.slice().sort((a, b) => {
    const ad = isDone(a) ? 1 : 0;
    const bd = isDone(b) ? 1 : 0;
    if (ad !== bd) return ad - bd;
    if (ad === 1) return (checkedAt(b) || '').localeCompare(checkedAt(a) || '');
    return b.jobSubtotal - a.jobSubtotal;
  });
  const openDeclined = declinedForShop.filter(d => !isDone(d));

  // Needs Guava — sales effectiveness calls scoring < 3 that haven't been handled
  const shopSEData = (salesEff?.shops ?? []).find((s: any) => s.shopNum === shopNum);
  const guavaGrades: any[] = (shopSEData?.grades ?? []).filter((g: any) => g.needsCoaching && !g.handled);

  // $ at stake — only the open rows count.
  const callbackDollars = openCallbacks.reduce((s, c) => s + c.estimatedMissedRevenue, 0);
  const rebookDollars = aro > 0 ? openRebooks.length * aro : 0;
  const declinedDollars = openDeclined.reduce((s, d) => s + d.jobSubtotal, 0);
  const grandTotalDollars = callbackDollars + rebookDollars + declinedDollars;

  // Customers recovered this week (this shop) = the UNION of:
  //   • the durable ledger (recoveries that may have since left the feed), and
  //   • rows we currently SHOW as recovered this week (so visibly-checkmarked
  //     customers get credit even if they predate the ledger).
  // Deduped by the same `cb:`/`rb:`/`dj:` id scheme the ledger uses.
  const recoveredIds = new Set<string>(recoveredLedgerByShop[shopNum] || []);
  for (const c of callbacksForShop)
    if (rowKind(c) === 'recovered' && isThisWeek(checkedAt(c))) recoveredIds.add(`cb:${c.leadId}`);
  for (const r of rebooksForShop)
    if (rowKind(r) === 'recovered' && isThisWeek(checkedAt(r))) recoveredIds.add(`rb:${r.roId}`);
  for (const d of declinedForShop)
    if (rowKind(d) === 'recovered' && isThisWeek(checkedAt(d))) recoveredIds.add(`dj:${d.jobId}`);
  const recoveredThisWeek = recoveredIds.size;

  // Customers marked not recoverable this week (not_salvageable across all queues)
  const notRecoverableIds = new Set<string>();
  for (const c of callbacksForShop)
    if (rowKind(c) === 'not_recovered' && isThisWeek(checkedAt(c))) notRecoverableIds.add(`cb:${c.leadId}`);
  for (const r of rebooksForShop)
    if (rowKind(r) === 'not_recovered' && isThisWeek(checkedAt(r))) notRecoverableIds.add(`rb:${r.roId}`);
  for (const d of declinedForShop)
    if (rowKind(d) === 'not_recovered' && isThisWeek(checkedAt(d))) notRecoverableIds.add(`dj:${d.jobId}`);
  const notRecoverableThisWeek = notRecoverableIds.size;

  const allLoading = callbacks === null && rebooks === null && declined === null;

  // Filter out the viewer's own entry from the displayed presence list —
  // they know they're here. Sort by lastSeenAt so the freshest pings
  // surface first. The "(you)" indicator could go on the eyebrow if we
  // want, but the simpler thing is to just suppress self.
  const otherActiveUsers = activeUsers.filter(u => u.email !== userEmail);

  return (
    <div className="rounded-[26px] border mb-6" style={{
      // Frosted ivory surface — same chrome as every other concept2 card.
      background: 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255,255,255,0.82))',
      backdropFilter: 'blur(22px)',
      WebkitBackdropFilter: 'blur(22px)',
      borderColor: 'rgba(255,255,255,0.75)',
      boxShadow: '0 18px 48px -28px rgba(40,34,26,0.30), 0 2px 8px -4px rgba(40,34,26,0.08)',
    }}>
      <div className="px-7 pt-6 pb-5" style={{ borderBottom: '1px solid rgba(34,32,28,0.10)' }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'rgba(34,32,28,0.55)' }}>Operations · Action Queue</div>
            <h2 className="c2disp leading-tight mt-1" style={{ color: '#221F1A', fontSize: 30, letterSpacing: '-0.02em' }}>To Do — Calls to Make Today</h2>
            <p className="c2ui text-[13px] mt-1.5" style={{ color: '#5C5852' }}>Pick a shop, then a queue. Recoveries count toward this week's trophy.</p>
          </div>

          {/* Presence chips — concept2 reskin: white-frosted pill with c2ui
              type. Same data path (15s heartbeat) as production. */}
          {otherActiveUsers.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
              <span className="c2ui text-[11.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'rgba(34,32,28,0.55)' }}>Active now</span>
              {otherActiveUsers.map(u => {
                const sameShop = u.shopNum === shopNum;
                const shopMeta = SHOP_BY_NUM[u.shopNum as keyof typeof SHOP_BY_NUM];
                return (
                  <span key={u.email}
                    className="c2ui inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12.5px]"
                    style={{ background: 'rgba(255,255,255,0.7)', boxShadow: 'inset 0 0 0 1px rgba(34,32,28,0.10)' }}
                    title={`${u.email} · viewing ${shopMeta?.name ?? u.shopNum}`}>
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="font-medium" style={{ color: '#221F1A' }}>{shortActor(u.email)}</span>
                    {!sameShop && shopMeta && (
                      <span style={{ color: 'rgba(34,32,28,0.55)' }}>· {shopMeta.name}</span>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="px-7 pt-5 pb-3">
        {/* Shop selector — concept2 reskin: each pill is its own frosted
            chip with a colored dot for shop identity. Active shop fills with
            the shop's color (same chromatic anchor used everywhere else). */}
        <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em] mb-2.5" style={{ color: 'rgba(34,32,28,0.55)' }}>Shop</div>
        <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1 -mx-1 px-1">
          {SHOPS.map(s => {
            const active = s.num === shopNum;
            return (
              <button
                key={s.num}
                onClick={() => setShopNum(s.num)}
                className="c2ui shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-semibold transition"
                style={active
                  ? { background: s.color, color: '#fff', boxShadow: '0 4px 14px -6px rgba(40,34,26,0.30)' }
                  : { background: 'rgba(255,255,255,0.6)', color: '#221F1A', boxShadow: 'inset 0 0 0 1px rgba(34,32,28,0.10)' }}
                aria-pressed={active}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: active ? 'rgba(255,255,255,0.85)' : s.color, boxShadow: active ? 'none' : `0 0 0 3px ${s.color}22` }}
                />
                {s.name}
              </button>
            );
          })}
        </div>

        {/* Summary cards — concept2 reskin: confident Fraunces numbers in
            frosted panels, eyebrow above. Two stats: $ at stake (warm) and
            recovered this week (cool). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(232,134,62,0.22) 0%, rgba(255,244,232,0.55) 60%, rgba(255,255,255,0) 100%)' }}>
            <div className="c2ui text-[11.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#8E3F22' }}>Revenue at stake · this shop</div>
            <div className="c2disp tabular-nums leading-none mt-2" style={{ color: '#221F1A', fontSize: 44, letterSpacing: '-0.03em' }}>{grandTotalDollars > 0 ? usdK(grandTotalDollars) : '—'}</div>
            <div className="c2ui text-[12.5px] mt-2" style={{ color: '#5C5852' }}>Sum of open callbacks, missed re-books, and old declined jobs.</div>
          </div>
          <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(91,170,89,0.22) 0%, rgba(232,248,232,0.55) 60%, rgba(255,255,255,0) 100%)' }}
            title="Open items checked off as recovered this week (across all three queues for this shop)">
            <div className="c2ui text-[11.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#2F6E3A' }}>Customers recovered · this week</div>
            <div className="c2disp tabular-nums leading-none mt-2" style={{ color: '#221F1A', fontSize: 44, letterSpacing: '-0.03em' }}>{recoveredThisWeek}</div>
            <div className="c2ui text-[12.5px] mt-2" style={{ color: '#5C5852' }}>Counts toward this week's To-Do trophy and the Golden Mango ceremony.</div>
            {notRecoverableThisWeek > 0 && (
              <div className="c2ui text-[11.5px] mt-2" style={{ color: 'rgba(34,32,28,0.45)' }}>{notRecoverableThisWeek} customer{notRecoverableThisWeek !== 1 ? 's' : ''} not recoverable this week</div>
            )}
          </div>
        </div>
      </div>

      <div className="px-7 pb-6">
        {/* Tab pills + body sit inside the unified frosted card. */}

      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        <TabButton active={tab === 'callbacks'} onClick={() => setTab('callbacks')} icon={<CalendarX className="w-3.5 h-3.5" />}
          label="Salvageable Callbacks" count={openCallbacks.length} subtotal={callbackDollars} loading={callbacks === null}
          color={{ bg: '#18B6C9', text: '#0E7490', shadow: '0 4px 14px -6px rgba(14,116,144,0.30)', tint: 'rgba(24,182,201,0.10)' }} />
        <TabButton active={tab === 'rebooks'} onClick={() => setTab('rebooks')} icon={<Repeat className="w-3.5 h-3.5" />}
          label="Didn't Rebook" count={openRebooks.length} subtotal={rebookDollars} loading={rebooks === null}
          color={{ bg: '#5B9BD5', text: '#1E40AF', shadow: '0 4px 14px -6px rgba(30,64,175,0.25)', tint: 'rgba(91,155,213,0.10)' }} />
        <TabButton active={tab === 'declined'} onClick={() => setTab('declined')} icon={<Wrench className="w-3.5 h-3.5" />}
          label="Declined Jobs" count={openDeclined.length} subtotal={declinedDollars} loading={declined === null}
          color={{ bg: '#C9412A', text: '#7F1D1D', shadow: '0 4px 14px -6px rgba(185,28,28,0.28)', tint: 'rgba(201,65,42,0.09)' }} />
        <TabButton active={tab === 'guava'} onClick={() => setTab('guava')} icon={<TrendingUp className="w-3.5 h-3.5" />}
          label="Needs Guava" count={guavaGrades.length} subtotal={0} loading={salesEff === null} hideSubtotal
          color={{ bg: '#9B7BE0', text: '#5B21B6', shadow: '0 4px 14px -6px rgba(91,33,182,0.25)', tint: 'rgba(155,123,224,0.10)' }} />
      </div>

      {allLoading && <div className="text-xs text-mango-muted italic py-3">Loading…</div>}

      {tab === 'callbacks' && (
        <TabBody err={callbackErr} loading={callbacks === null} count={callbacksForShop.length} openCount={openCallbacks.length} emptyText="Nothing to call back this shop right now ✓">
          <TaskList>
            {sortedCallbacks.slice(0, 100).map(c => (
              <CallbackRowView key={c.leadId} c={c} onSet={setCallbackStatus} />
            ))}
          </TaskList>
          {sortedCallbacks.length > 100 && (
            <div className="text-[11px] text-mango-muted italic text-center pt-2">Showing top 100 of {sortedCallbacks.length}.</div>
          )}
        </TabBody>
      )}

      {tab === 'rebooks' && (
        <TabBody err={rebookErr} loading={rebooks === null} count={rebooksForShop.length} openCount={openRebooks.length} emptyText="Every eligible customer this week rebooked ✓">
          <TaskList>
            {sortedRebooks.slice(0, 150).map(r => (
              <RebookRowView key={`${r.shopNum}-${r.roId}`} r={r} onSet={setRebookStatus} />
            ))}
          </TaskList>
          {sortedRebooks.length > 150 && (
            <div className="text-[11px] text-mango-muted italic text-center pt-2">Showing top 150 of {sortedRebooks.length}.</div>
          )}
        </TabBody>
      )}

      {tab === 'declined' && (
        <TabBody err={declinedErr} loading={declined === null} count={declinedForShop.length} openCount={openDeclined.length} emptyText="No declined jobs older than 30 days for this shop ✓">
          <TaskList>
            {sortedDeclined.slice(0, 150).map(d => (
              <DeclinedJobRowView key={d.jobId} d={d} onSet={setDeclinedStatus} />
            ))}
          </TaskList>
          {sortedDeclined.length > 150 && (
            <div className="text-[11px] text-mango-muted italic text-center pt-2">Showing top 150 of {sortedDeclined.length}.</div>
          )}
        </TabBody>
      )}

      {tab === 'guava' && (
        <GuavaTabBody grades={guavaGrades} shopNum={shopNum} loading={salesEff === null}
          onHandled={(callId) => {
            setSalesEff((prev: any) => {
              if (!prev) return prev;
              return { ...prev, shops: prev.shops.map((s: any) => s.shopNum !== shopNum ? s : {
                ...s, grades: s.grades.map((g: any) => g.callId === callId ? { ...g, handled: true } : g),
              }) };
            });
          }} />
      )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, count, subtotal, loading, color, hideSubtotal }: {
  active: boolean; onClick: () => void; icon: React.ReactNode;
  label: string; count: number; subtotal: number; loading: boolean;
  color: { bg: string; text: string; shadow: string; tint: string };
  hideSubtotal?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="c2ui shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] transition"
      style={active
        ? { background: color.bg, color: '#fff', boxShadow: color.shadow }
        : { background: color.tint, color: color.text, boxShadow: `inset 0 0 0 1px ${color.bg}40` }}
    >
      {icon}
      <span className="font-semibold">{label}</span>
      <span className="text-[12px] tabular-nums" style={{ color: active ? 'rgba(255,255,255,0.78)' : `${color.text}99` }}>
        {loading ? '…' : hideSubtotal ? `${count}` : `${count} · ${subtotal > 0 ? usdK(subtotal) : '$0'}`}
      </span>
    </button>
  );
}

function TabBody({ err, loading, count, openCount, emptyText, children }: {
  err: string | null; loading: boolean; count: number; openCount: number; emptyText: string; children: React.ReactNode;
}) {
  if (err) return <div className="text-xs text-mango-red py-3">Couldn't load: {err}</div>;
  if (loading) return <div className="text-xs text-mango-muted italic py-3">Loading…</div>;
  if (count === 0) return <div className="text-xs text-mango-green py-3">{emptyText}</div>;
  if (openCount === 0) return (
    <>
      <div className="text-xs text-mango-green py-3">{emptyText}</div>
      {children}
    </>
  );
  return <>{children}</>;
}

function TaskList({ children }: { children: React.ReactNode }) {
  // No AnimatePresence — exit fades on tab/shop switches caused the old
  // list to dissolve while the new tab was already highlighted, which made
  // the selection look out of sync. Rows still animate position changes
  // via motion.div layout below when a single row gets checked/unchecked.
  return <motion.div layout className="space-y-2">{children}</motion.div>;
}

// The "recovered" checkbox (left control). Green + check when recovered.
// On hover it explains what checking it means, so the green check reads
// unambiguously as "recovered" rather than a generic "done".
function RecoverCheckbox({ recovered, onChange }: { recovered: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-label={recovered ? 'Recovered — click to undo' : 'Mark customer recovered'}
      aria-checked={recovered}
      role="checkbox"
      title={recovered
        ? 'Recovered ✓ — counts toward this week’s recovered customers. Click to undo.'
        : 'Mark recovered — we won this customer back (counts toward this week’s tally)'}
      className={`group shrink-0 mt-0.5 w-6 h-6 rounded-full border flex items-center justify-center transition ${
        recovered
          ? 'bg-emerald-500 border-emerald-500 text-white'
          : 'bg-white border-mango-line hover:border-emerald-400 hover:bg-emerald-50/40'
      }`}
    >
      {/* When recovered: solid check. When open: a faint check appears on
          hover so it's obvious this button "recovers" the customer. */}
      <Check className={`w-3.5 h-3.5 transition ${recovered ? 'opacity-100' : 'opacity-0 group-hover:opacity-40 text-emerald-500'}`} strokeWidth={3} />
    </button>
  );
}

// The "Not Recovered" control (right side). Ghost when the row is open;
// filled grey when the row is already marked not-recovered (click to undo).
function NotRecoveredButton({ active, onChange }: { active: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={active}
      title={active
        ? 'Not recovered — this customer was lost (does NOT count as a recovery). Click to undo.'
        : 'Not recovered — worked it but couldn’t win them back (closes the row without crediting a recovery)'}
      className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide transition ${
        active
          ? 'bg-mango-muted/15 border-mango-muted/40 text-mango-muted'
          : 'bg-white border-mango-line text-mango-faint hover:border-mango-red/40 hover:text-mango-red'
      }`}
    >
      <X className="w-3 h-3" strokeWidth={3} />
      Not recovered
    </button>
  );
}

// Animated row wrapper — uses motion.div layout so reorders animate. Done
// rows (recovered OR not-recovered) fade their content to half opacity; the
// controls stay full-color so it's obvious how to undo.
function TaskRow({
  rowKey, kind, onRecover, onNotRecover, completedAt, completedBy, children,
}: {
  rowKey: string | number; kind: ResKind;
  onRecover: () => void; onNotRecover: () => void;
  completedAt?: string; completedBy?: string; children: React.ReactNode;
}) {
  const done = kind !== 'open';
  const recovered = kind === 'recovered';
  return (
    <motion.div
      layout="position"
      key={rowKey}
      transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.6 }}
      className="flex items-start gap-3 p-3 rounded-lg border border-mango-line bg-white"
    >
      <RecoverCheckbox recovered={recovered} onChange={onRecover} />
      <motion.div
        animate={{ opacity: done ? 0.45 : 1 }}
        transition={{ duration: 0.18 }}
        className={`min-w-0 flex-1 ${done ? 'line-through decoration-mango-muted' : ''}`}
      >
        {children}
      </motion.div>
      <div className="shrink-0 flex flex-col items-end gap-1 mt-0.5">
        {/* Status badge + who/when, shown once the row is actioned. */}
        {recovered ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            <Check className="w-3 h-3" strokeWidth={3} /> Recovered
          </span>
        ) : (
          // Open or not-recovered → offer the "Not recovered" toggle.
          <NotRecoveredButton active={kind === 'not_recovered'} onChange={onNotRecover} />
        )}
        {done && (completedAt || completedBy) && (
          <div className="flex flex-col items-end gap-0.5">
            {completedAt && (
              <span className={`text-[10px] uppercase tracking-wide ${recovered ? 'text-emerald-700/80' : 'text-mango-faint'}`}>
                {formatRelative(completedAt)}
              </span>
            )}
            {completedBy && (
              <span className="text-[10px] text-mango-faint" title={`Marked by ${completedBy}`}>
                by {shortActor(completedBy)}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function CallbackRowView({ c, onSet }: { c: CallbackRow; onSet: (leadId: number, kind: ResKind, shopNum: string) => void }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const kind = rowKind(c);
  const done = kind !== 'open';
  const phoneStr = c.callerPhone == null ? '' : String(c.callerPhone);
  const shopId = shopIdForNum(c.shopNum);
  const customerUrl = shopId && c.tekmetricCustomerId
    ? tekmetricCustomerUrl(shopId, c.tekmetricCustomerId)
    : undefined;

  // Concept2 design tokens (matches kit.tsx)
  const INK   = '#221F1A';
  const INK2  = '#5C5852';
  const FAINT = '#938C81';
  const LINE  = 'rgba(34,32,28,0.10)';
  const LINE_STRONG = 'rgba(34,32,28,0.08)';

  // Probability tier — card background tinted to signal urgency (concept2 pattern)
  const probHigh = c.probability >= 0.65;
  const probMid  = c.probability >= 0.45;
  const cardBg      = probHigh ? 'rgba(192,90,46,0.07)' : probMid ? 'rgba(176,120,32,0.06)' : 'rgba(255,255,255,0.60)';
  const cardBorder  = probHigh ? '1px solid rgba(192,90,46,0.22)' : probMid ? '1px solid rgba(176,120,32,0.18)' : `1px solid ${LINE}`;
  const badgeBg     = probHigh ? 'rgba(192,90,46,0.12)' : probMid ? 'rgba(176,120,32,0.10)' : 'rgba(34,32,28,0.06)';
  const badgeColor  = probHigh ? '#8E3F22' : probMid ? '#7A5200' : FAINT;

  return (
    <motion.div
      layout="position"
      key={c.leadId}
      transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.6 }}
      animate={{ opacity: done ? 0.42 : 1 }}
      className="rounded-2xl p-4"
      style={{ background: cardBg, border: cardBorder }}
    >
      {/* Header: name + badge + controls */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <CustomerLink name={c.callerName || 'Unknown caller'} customerUrl={customerUrl} existing={false} />
          <span
            className="c2ui shrink-0 text-[10.5px] font-bold uppercase tracking-[0.12em] rounded-full px-2.5 py-0.5"
            style={{ background: badgeBg, color: badgeColor }}
          >
            {(c.probability * 100).toFixed(0)}%
          </span>
        </div>

        {/* Concept2-native action controls */}
        <div className="shrink-0 flex items-center gap-1.5">
          {kind === 'recovered' ? (
            <button
              onClick={() => onSet(c.leadId, 'open', c.shopNum)}
              className="c2ui inline-flex items-center gap-1 rounded-full text-[10.5px] font-semibold uppercase tracking-wide px-2.5 py-1 transition"
              style={{ background: 'rgba(62,142,94,0.12)', border: '1px solid rgba(62,142,94,0.28)', color: '#2F6E3A' }}
              title="Recovered — click to undo"
            >
              <Check className="w-3 h-3" strokeWidth={3} /> Recovered
            </button>
          ) : kind === 'not_recovered' ? (
            <button
              onClick={() => onSet(c.leadId, 'open', c.shopNum)}
              className="c2ui inline-flex items-center gap-1 rounded-full text-[10.5px] font-semibold uppercase tracking-wide px-2.5 py-1 transition"
              style={{ background: 'rgba(34,32,28,0.06)', border: `1px solid ${LINE}`, color: FAINT }}
              title="Not recovered — click to undo"
            >
              <X className="w-3 h-3" strokeWidth={3} /> Not recovered
            </button>
          ) : (
            <>
              <button
                onClick={() => onSet(c.leadId, 'not_recovered', c.shopNum)}
                className="c2ui inline-flex items-center gap-1 rounded-full text-[10.5px] font-medium px-2.5 py-1 transition"
                style={{ background: 'rgba(255,255,255,0.65)', border: `1px solid ${LINE}`, color: FAINT }}
                title="Not recovered — worked it but couldn't win them back"
              >
                <X className="w-3 h-3" strokeWidth={2.5} /> Not recovered
              </button>
              <button
                onClick={() => onSet(c.leadId, 'recovered', c.shopNum)}
                className="c2ui inline-flex items-center justify-center w-7 h-7 rounded-full transition"
                style={{ background: 'rgba(255,255,255,0.65)', border: `1px solid ${LINE}`, color: FAINT }}
                title="Mark recovered — counts toward this week's tally"
              >
                <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Phone — display numeral */}
      <div className="mt-2">
        {phoneStr
          ? <div className="c2disp tabular-nums leading-none" style={{ color: INK, fontSize: 20, letterSpacing: '-0.01em' }}>{formatPhone(phoneStr)}</div>
          : <div className="c2ui text-[13px]" style={{ color: FAINT, fontStyle: 'italic' }}>no phone on file</div>}
      </div>

      {/* Reason */}
      {c.reason && <div className="c2ui mt-1.5 text-[12.5px]" style={{ color: INK2 }}>{c.reason}</div>}

      {/* Angle */}
      {c.angle && (
        <div className="c2ui mt-0.5 text-[12px]" style={{ color: FAINT }}>
          <span style={{ color: INK2, fontWeight: 600 }}>Angle:</span>{' '}{c.angle}
        </div>
      )}

      {/* Footer: time · est. lost · media buttons */}
      <div className="mt-3 pt-2.5 flex items-end justify-between gap-2" style={{ borderTop: `1px solid ${LINE_STRONG}` }}>
        <div className="flex items-center gap-3">
          {c.estimatedMissedRevenue > 0 && (
            <div>
              <div className="c2ui text-[10.5px] uppercase tracking-[0.12em]" style={{ color: FAINT }}>Est. lost</div>
              <div className="c2disp tabular-nums" style={{ color: '#8E3F22', fontSize: 16, fontWeight: 600 }}>
                {usd(Math.round(c.estimatedMissedRevenue))}
              </div>
            </div>
          )}
          <div className="c2ui text-[11px]" style={{ color: FAINT }}>{formatRelative(c.dateCreated)}</div>
        </div>

        {(c.transcriptPreview || c.recording) && (
          <div className="flex items-center gap-1.5">
            {c.transcriptPreview && (
              <button
                onClick={() => setShowTranscript(v => !v)}
                className="c2ui inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-full transition"
                style={showTranscript
                  ? { background: 'rgba(232,134,62,0.12)', border: '1px solid rgba(232,134,62,0.35)', color: '#B5631F' }
                  : { background: 'rgba(255,255,255,0.65)', border: `1px solid ${LINE}`, color: INK2 }}
              >
                <MessageSquare className="w-3 h-3" /> Transcript
              </button>
            )}
            {/* Recording always opens in a new tab — WhatConverts player or direct audio */}
            {c.recording && (
              <a
                href={c.recording}
                target="_blank"
                rel="noreferrer"
                className="c2ui inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-full transition"
                style={{ background: 'rgba(255,255,255,0.65)', border: `1px solid ${LINE}`, color: INK2 }}
              >
                <PlayCircle className="w-3 h-3" /> Recording
              </a>
            )}
          </div>
        )}
      </div>

      {/* Done: who/when */}
      {done && (checkedAt(c) || checkedBy(c)) && (
        <div className="c2ui flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: FAINT }}>
          {checkedAt(c) && <span>{formatRelative(checkedAt(c)!)}</span>}
          {checkedBy(c) && <span>· by {shortActor(checkedBy(c)!)}</span>}
        </div>
      )}

      {/* Transcript expand */}
      {showTranscript && c.transcriptPreview && (
        <div
          className="c2ui mt-2 text-[12px] whitespace-pre-wrap rounded-xl p-3 max-h-48 overflow-y-auto"
          style={{ background: 'rgba(255,255,255,0.55)', color: INK2, border: `1px solid ${LINE}`, lineHeight: 1.6 }}
        >
          {c.transcriptPreview}
        </div>
      )}
    </motion.div>
  );
}

function RebookRowView({ r, onSet }: { r: RebookRow; onSet: (roId: number, kind: ResKind, shopNum: string) => void }) {
  const kind = rowKind(r);
  const phoneStr = r.phone == null ? '' : String(r.phone);
  const shopId = shopIdForNum(r.shopNum);
  const customerUrl = shopId && r.customerId ? tekmetricCustomerUrl(shopId, r.customerId) : undefined;

  return (
    <TaskRow
      rowKey={`${r.shopNum}-${r.roId}`}
      kind={kind}
      onRecover={() => onSet(r.roId, kind === 'recovered' ? 'open' : 'recovered', r.shopNum)}
      onNotRecover={() => onSet(r.roId, kind === 'not_recovered' ? 'open' : 'not_recovered', r.shopNum)}
      completedAt={checkedAt(r)}
      completedBy={checkedBy(r)}
    >
      <div className="flex items-start gap-2 flex-wrap">
        <CustomerLink name={r.customerName} customerUrl={customerUrl} existing={true} />
        {r.postedDate && <span className="text-[11px] text-mango-muted mt-1">· closed {formatClosedDate(r.postedDate)}</span>}
      </div>
      {phoneStr ? (
        <div className="text-lg font-semibold text-mango-ink tabular-nums mt-1 tracking-wide">{formatPhone(phoneStr)}</div>
      ) : (
        <div className="text-sm text-mango-muted italic mt-1">no phone on file</div>
      )}
      {r.vehicle && <div className="text-xs text-mango-ink/80 mt-1">{r.vehicle}</div>}
    </TaskRow>
  );
}

function DeclinedJobRowView({ d, onSet }: { d: DeclinedJobRowT; onSet: (jobId: number, kind: ResKind, shopNum: string) => void }) {
  const kind = rowKind(d);
  const phoneStr = d.phone == null ? '' : String(d.phone);
  const shopId = d.shopId ?? shopIdForNum(d.shopNum);
  const roUrl = shopId ? tekmetricRoUrl(shopId, d.roId) : undefined;
  const customerUrl = shopId && d.customerId ? tekmetricCustomerUrl(shopId, d.customerId) : undefined;

  return (
    <TaskRow
      rowKey={d.jobId}
      kind={kind}
      onRecover={() => onSet(d.jobId, kind === 'recovered' ? 'open' : 'recovered', d.shopNum)}
      onNotRecover={() => onSet(d.jobId, kind === 'not_recovered' ? 'open' : 'not_recovered', d.shopNum)}
      completedAt={checkedAt(d)}
      completedBy={checkedBy(d)}
    >
      <div className="flex items-start gap-2 flex-wrap">
        <CustomerLink name={d.customerName} customerUrl={customerUrl} existing={true} />
        <span className="text-[11px] text-mango-muted mt-1">· declined {formatRelative(d.declinedDate)}</span>
      </div>
      {phoneStr ? (
        <div className="text-lg font-semibold text-mango-ink tabular-nums mt-1 tracking-wide">{formatPhone(phoneStr)}</div>
      ) : (
        <div className="text-sm text-mango-muted italic mt-1">no phone on file</div>
      )}
      <div className="text-xs text-mango-ink/85 mt-1 font-medium">{d.jobName}</div>
      <div className="flex items-baseline justify-between mt-1.5">
        <div>
          {roUrl && (
            <a href={roUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-mango-muted hover:text-mango-orange">
              RO in Tekmetric <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase text-mango-muted leading-none">quoted</div>
          <div className="text-sm font-bold text-mango-red tabular-nums">{d.jobSubtotal > 0 ? usd(Math.round(d.jobSubtotal)) : '—'}</div>
        </div>
      </div>
    </TaskRow>
  );
}

// ── Needs Guava tab ──────────────────────────────────────────────────────────

const SCORE_COLOR = (s: number) => {
  if (s >= 4) return '#5BAA59';
  if (s >= 3) return '#A8CE5A';
  if (s >= 2) return '#F5E580';
  if (s >= 1) return '#F4B65C';
  return '#C9412A';
};

function GuavaTabBody({ grades, shopNum, loading, onHandled }: {
  grades: any[]; shopNum: string; loading: boolean; onHandled: (callId: string) => void;
}) {
  if (loading) return <div className="text-xs text-mango-muted italic py-3">Loading…</div>;
  if (grades.length === 0) return (
    <div className="text-xs py-3" style={{ color: '#5BAA59' }}>
      No calls needing coaching this week for this shop ✓
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="text-[11.5px] text-mango-muted mb-3">
        Outbound inspection-result calls that scored below 3/5. Click a row to expand and mark as handled.
      </div>
      {grades.map((g: any) => <GuavaRow key={g.callId} grade={g} shopNum={shopNum} onHandled={onHandled} />)}
    </div>
  );
}

function GuavaRow({ grade, shopNum, onHandled }: { grade: any; shopNum: string; onHandled: (callId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const date = new Date(grade.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' });
  const mins = Math.floor(grade.durationSeconds / 60);
  const secs = grade.durationSeconds % 60;
  const dur = `${mins}:${String(secs).padStart(2, '0')}`;

  const handleMark = async () => {
    setMarking(true);
    try {
      await fetch('/api/extras?view=sales-effectiveness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopNum, callId: grade.callId }),
      });
      onHandled(grade.callId);
    } catch { /* swallow */ } finally { setMarking(false); }
  };

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(34,32,28,0.10)', background: 'rgba(255,255,255,0.7)' }}>
      <button className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/80 transition" onClick={() => setOpen(o => !o)}>
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-[12px] font-bold text-white flex-shrink-0"
          style={{ background: SCORE_COLOR(grade.overallScore) }}>{grade.overallGrade}</span>
        <div className="flex-1 min-w-0">
          <div className="c2ui text-[12.5px] font-semibold">{date} · {dur}</div>
          <div className="c2ui text-[11px] text-mango-muted mt-0.5 line-clamp-1">{grade.summary}</div>
        </div>
        <span className="c2ui text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ background: `${SCORE_COLOR(grade.overallScore)}22`, color: SCORE_COLOR(grade.overallScore) }}>
          {grade.overallScore.toFixed(1)}/5
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-mango-muted flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-mango-muted flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3 border-t space-y-2" style={{ borderColor: 'rgba(34,32,28,0.08)', background: 'rgba(249,247,243,0.6)' }}>
          <p className="c2ui text-[12px] mt-3">{grade.summary}</p>

          {grade.ticketCoverage?.omittedItems?.length > 0 && (
            <div>
              <div className="c2ui text-[10.5px] font-semibold uppercase tracking-wide text-mango-muted mb-1">Items skipped on call</div>
              {grade.ticketCoverage.omittedItems.map((it: any, i: number) => (
                <div key={i} className="flex items-center gap-2 c2ui text-[11.5px]">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: it.severity === 'safety-critical' ? '#DC2626' : '#F4B65C' }} />
                  <span className="font-medium">{it.name}</span>
                  {it.amount && it.amount !== 'unknown' && <span className="text-mango-muted">{it.amount}</span>}
                </div>
              ))}
            </div>
          )}

          {grade.improvements?.length > 0 && (
            <div>
              <div className="c2ui text-[10.5px] font-semibold uppercase tracking-wide text-mango-muted mb-1">Coaching points</div>
              <ol className="space-y-0.5 list-decimal list-inside">
                {grade.improvements.map((imp: string, i: number) => <li key={i} className="c2ui text-[11.5px]">{imp}</li>)}
              </ol>
            </div>
          )}

          {grade.weakestMoment && (
            <p className="c2ui text-[11.5px] italic px-2.5 py-1.5 rounded-lg"
              style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.12)' }}>
              {grade.weakestMoment}
            </p>
          )}

          <button onClick={handleMark} disabled={marking}
            className="c2ui text-[11.5px] font-semibold px-3 py-1.5 rounded-lg border transition disabled:opacity-50"
            style={{ borderColor: 'rgba(34,32,28,0.12)', background: 'rgba(255,255,255,0.8)' }}>
            {marking ? 'Saving…' : '✓ Mark as handled'}
          </button>
        </div>
      )}
    </div>
  );
}
