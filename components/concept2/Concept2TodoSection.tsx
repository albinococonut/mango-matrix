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
import { ListChecks, CalendarX, Repeat, Wrench, Check, X, ExternalLink } from 'lucide-react';
import { usd, usdK } from '@/lib/format';
import { SHOPS, SHOP_BY_NUM } from '@/lib/shops';

const SHOP_SS_KEY  = 'todoShop:v1';
const TAB_SS_KEY   = 'todoTab:v1';

type Tab = 'callbacks' | 'rebooks' | 'declined';

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
  const [callbackErr, setCallbackErr] = useState<string | null>(null);
  const [rebookErr, setRebookErr] = useState<string | null>(null);
  const [declinedErr, setDeclinedErr] = useState<string | null>(null);

  const [aroByShop, setAroByShop] = useState<Record<string, number>>({});
  // Per-shop SET of recovered entry-ids from the durable ledger
  // (/api/todo/recovered). Authoritative for recoveries that have since left
  // the rolling feed; unioned client-side with the rows currently shown as
  // recovered so visibly-checkmarked customers always get credited too.
  const [recoveredLedgerByShop, setRecoveredLedgerByShop] = useState<Record<string, string[]>>({});

  const [shopNum, setShopNum] = useState<string>(() => {
    if (typeof window === 'undefined') return SHOPS[0].num;
    return window.sessionStorage.getItem(SHOP_SS_KEY) || SHOPS[0].num;
  });
  useEffect(() => { try { window.sessionStorage.setItem(SHOP_SS_KEY, shopNum); } catch {} }, [shopNum]);

  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'callbacks';
    return (window.sessionStorage.getItem(TAB_SS_KEY) as Tab) || 'callbacks';
  });
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

  const allLoading = callbacks === null && rebooks === null && declined === null;

  // Filter out the viewer's own entry from the displayed presence list —
  // they know they're here. Sort by lastSeenAt so the freshest pings
  // surface first. The "(you)" indicator could go on the eyebrow if we
  // want, but the simpler thing is to just suppress self.
  const otherActiveUsers = activeUsers.filter(u => u.email !== userEmail);

  return (
    <div className="rounded-[26px] border mb-6" style={{
      // Frosted ivory surface — same chrome as every other concept2 card.
      background: 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.58))',
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
          <div className="rounded-2xl p-5" style={{ background: 'rgba(232,134,62,0.10)', boxShadow: 'inset 0 0 0 1px rgba(232,134,62,0.30)' }}>
            <div className="c2ui text-[11.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#8E3F22' }}>Revenue at stake · this shop</div>
            <div className="c2disp tabular-nums leading-none mt-2" style={{ color: '#221F1A', fontSize: 44, letterSpacing: '-0.03em' }}>{grandTotalDollars > 0 ? usdK(grandTotalDollars) : '—'}</div>
            <div className="c2ui text-[12.5px] mt-2" style={{ color: '#5C5852' }}>Sum of open callbacks, missed re-books, and old declined jobs.</div>
          </div>
          <div className="rounded-2xl p-5" style={{ background: 'rgba(91,170,89,0.10)', boxShadow: 'inset 0 0 0 1px rgba(91,170,89,0.30)' }}
            title="Open items checked off as recovered this week (across all three queues for this shop)">
            <div className="c2ui text-[11.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#2F6E3A' }}>Customers recovered · this week</div>
            <div className="c2disp tabular-nums leading-none mt-2" style={{ color: '#221F1A', fontSize: 44, letterSpacing: '-0.03em' }}>{recoveredThisWeek}</div>
            <div className="c2ui text-[12.5px] mt-2" style={{ color: '#5C5852' }}>Counts toward this week's To-Do trophy and the Golden Mango ceremony.</div>
          </div>
        </div>
      </div>

      <div className="px-7 pb-6">
        {/* Tab pills + body sit inside the unified frosted card. */}

      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        <TabButton active={tab === 'callbacks'} onClick={() => setTab('callbacks')} icon={<CalendarX className="w-3.5 h-3.5" />}
          label="Salvageable Callbacks" count={openCallbacks.length} subtotal={callbackDollars} loading={callbacks === null} />
        <TabButton active={tab === 'rebooks'} onClick={() => setTab('rebooks')} icon={<Repeat className="w-3.5 h-3.5" />}
          label="Didn't Rebook" count={openRebooks.length} subtotal={rebookDollars} loading={rebooks === null} />
        <TabButton active={tab === 'declined'} onClick={() => setTab('declined')} icon={<Wrench className="w-3.5 h-3.5" />}
          label="Declined Jobs" count={openDeclined.length} subtotal={declinedDollars} loading={declined === null} />
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
      </div>
    </div>
  );
}

// Concept2 reskin: deeper-ink fill on active, frosted off-white on inactive.
// Same data shape, same a11y, same hover affordance — just visually unified
// with the rest of the concept2 design language.
function TabButton({ active, onClick, icon, label, count, subtotal, loading }: {
  active: boolean; onClick: () => void; icon: React.ReactNode;
  label: string; count: number; subtotal: number; loading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="c2ui shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] transition"
      style={active
        ? { background: '#221F1A', color: '#fff', boxShadow: '0 4px 14px -6px rgba(40,34,26,0.30)' }
        : { background: 'rgba(255,255,255,0.6)', color: '#221F1A', boxShadow: 'inset 0 0 0 1px rgba(34,32,28,0.12)' }}
    >
      {icon}
      <span className="font-semibold">{label}</span>
      <span className="text-[12px] tabular-nums" style={{ color: active ? 'rgba(255,255,255,0.75)' : 'rgba(34,32,28,0.55)' }}>
        {loading ? '…' : `${count} · ${subtotal > 0 ? usdK(subtotal) : '$0'}`}
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
  const kind = rowKind(c);
  const phoneStr = c.callerPhone == null ? '' : String(c.callerPhone);
  // Link only if we have a verified Tekmetric customer match. The previous
  // phone-search URL has been dropped — too often it just landed on an
  // empty Tekmetric search page, which looked broken.
  const shopId = shopIdForNum(c.shopNum);
  const customerUrl = shopId && c.tekmetricCustomerId
    ? tekmetricCustomerUrl(shopId, c.tekmetricCustomerId)
    : undefined;
  const probColor = c.probability >= 0.65 ? '#8B1F1F' : c.probability >= 0.45 ? '#7A5300' : '#6B7280';
  const probBg   = c.probability >= 0.65 ? '#FDE2E2' : c.probability >= 0.45 ? '#FFE9B8' : '#F2EFE7';

  return (
    <TaskRow
      rowKey={c.leadId}
      kind={kind}
      onRecover={() => onSet(c.leadId, kind === 'recovered' ? 'open' : 'recovered', c.shopNum)}
      onNotRecover={() => onSet(c.leadId, kind === 'not_recovered' ? 'open' : 'not_recovered', c.shopNum)}
      completedAt={checkedAt(c)}
      completedBy={checkedBy(c)}
    >
      <div className="flex items-start gap-2 flex-wrap">
        <CustomerLink name={c.callerName || 'Unknown caller'} customerUrl={customerUrl} existing={false} />
        <span className="inline-block text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 mt-1" style={{ background: probBg, color: probColor }}>
          {(c.probability * 100).toFixed(0)}%
        </span>
        <span className="text-[11px] text-mango-muted mt-1">· called {formatRelative(c.dateCreated)}</span>
      </div>
      {phoneStr ? (
        <div className="text-lg font-semibold text-mango-ink tabular-nums mt-1 tracking-wide">{formatPhone(phoneStr)}</div>
      ) : (
        <div className="text-sm text-mango-muted italic mt-1">no phone on file</div>
      )}
      <div className="text-xs text-mango-ink/80 mt-1">{c.reason || '—'}</div>
      {c.angle && <div className="text-xs text-mango-ink/70 mt-0.5 italic"><span className="font-medium not-italic">Angle:</span> {c.angle}</div>}
      <div className="flex items-baseline justify-between mt-1.5">
        <span className="text-[10px] uppercase text-mango-muted">est. lost</span>
        <span className="text-sm font-bold text-mango-red tabular-nums" title="Salvageability probability × shop ARO from last 7 days">
          {c.estimatedMissedRevenue > 0 ? usd(Math.round(c.estimatedMissedRevenue)) : '—'}
        </span>
      </div>
    </TaskRow>
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
