// Daily Ticker API. ONE route file for all methods (Hobby function-count
// discipline — same reasoning as the exec-metrics dispatcher).
//
//   GET  /api/ticker              → public: {text, source} for the intranet ticker (CORS *)
//   GET  /api/ticker?override=1   → executive: current override row (admin UI)
//   GET  /api/ticker?context=1    → Bearer TICKER_CRON_SECRET: generation context
//                                   {recent, override, trophyTail, generatedAt}
//   POST /api/ticker              → Bearer TICKER_CRON_SECRET: publish today's auto line
//   PUT  /api/ticker              → executive: upsert the admin override (id=1)
//
// Full operating spec: TICKER_SYSTEM.md at the repo root.
//
// NOTE: /api/ticker is exempted in middleware.ts (public GET). Auth is
// enforced per-branch here instead.

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/serverAuth';
import { SHOPS } from '@/lib/shops';
import { readLatestGoldenMango, readRecentTrophyWeeks } from '@/lib/goldenMango';
import {
  clearOverride,
  deleteHistoryRow,
  getActiveOverride,
  getCurrentTicker,
  getOverrideRow,
  hasTickerStore,
  insertHistory,
  isTickerPriority,
  recentTickers,
  saveOverride,
} from '@/lib/ticker';

export const dynamic = 'force-dynamic';

// The ticker text is public (it scrolls on the intranet for every employee),
// so a wildcard origin is fine.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
} as const;

const NO_STORE_MESSAGE =
  'Ticker storage is not configured: the Upstash Redis env vars (KV_REST_API_URL / ' +
  'KV_REST_API_TOKEN) are not set in this environment.';

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.TICKER_CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${secret}`;
}

/** Validate a ticker line: non-empty single line, ≤ 280 chars. Returns error or null. */
function validateLine(text: unknown): string | null {
  if (typeof text !== 'string') return 'text must be a string';
  const t = text.trim();
  if (!t) return 'text must be non-empty';
  if (/[\r\n]/.test(t)) return 'text must be a single line (no line breaks)';
  if (t.length > 280) return `text must be ≤ 280 characters (got ${t.length})`;
  return null;
}

/** Parse an optional timestamp field: null/undefined/'' → null; else valid ISO date. */
function parseWhen(v: unknown, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false, error: `${field} must be an ISO timestamp string or null` };
  const d = new Date(v);
  if (isNaN(d.getTime())) return { ok: false, error: `${field} is not a valid timestamp` };
  return { ok: true, value: d.toISOString() };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // --- Generation context for the daily Claude job -----------------------
  if (sp.get('context') === '1') {
    if (!cronAuthorized(req)) {
      return NextResponse.json({ error: 'invalid or missing TICKER_CRON_SECRET bearer token' }, { status: 403 });
    }
    const [recent, override, goldenMangoData, trophyWeeks] = await Promise.all([
      recentTickers(14),
      getActiveOverride(),
      readLatestGoldenMango(),
      readRecentTrophyWeeks(4),
    ]);
    const shopNames = Object.fromEntries(SHOPS.map((s) => [s.num, s.name]));
    const currentStandings = goldenMangoData ? {
      periodStart: goldenMangoData.periodStart,
      revenue: goldenMangoData.categoryRankings?.revenue ?? [],
      gp: goldenMangoData.categoryRankings?.gp ?? [],
      tech: goldenMangoData.categoryRankings?.tech ?? [],
      comebacks: goldenMangoData.categoryRankings?.comebacks ?? [],
      overall: goldenMangoData.standings.map((s) => s.shopNum),
    } : null;
    const goldenMango = goldenMangoData ? {
      shopNum: goldenMangoData.shopNum,
      shopName: goldenMangoData.shopName,
      defendingSince: goldenMangoData.defendingSince,
      isTie: goldenMangoData.isTie,
      tiedShopNames: goldenMangoData.tiedShopNames,
    } : null;
    return NextResponse.json({
      recent,
      override,
      trophyTail: trophyWeeks,
      currentStandings,
      goldenMango,
      shopNames,
      generatedAt: new Date().toISOString(),
      storeConfigured: hasTickerStore(),
    });
  }

  // --- Admin UI: full history list --------------------------------------
  if (sp.get('history') === '1') {
    const session = await getSession(req);
    if (session?.role !== 'executive') {
      return NextResponse.json({ error: 'executive role required' }, { status: 403 });
    }
    if (!hasTickerStore()) {
      return NextResponse.json({ error: NO_STORE_MESSAGE }, { status: 501 });
    }
    return NextResponse.json({ history: await recentTickers(50) });
  }

  // --- Admin UI: raw override row ---------------------------------------
  if (sp.get('override') === '1') {
    const session = await getSession(req);
    if (session?.role !== 'executive') {
      return NextResponse.json({ error: 'executive role required' }, { status: 403 });
    }
    if (!hasTickerStore()) {
      return NextResponse.json({ error: NO_STORE_MESSAGE }, { status: 501 });
    }
    return NextResponse.json({ override: await getOverrideRow() });
  }

  // --- Public: current ticker text ---------------------------------------
  const current = await getCurrentTicker();
  return NextResponse.json(current, { headers: CORS_HEADERS });
}

// Daily Claude job publishes the day's line here.
export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'invalid or missing TICKER_CRON_SECRET bearer token' }, { status: 403 });
  }
  if (!hasTickerStore()) {
    return NextResponse.json({ error: NO_STORE_MESSAGE }, { status: 501 });
  }
  let body: { text?: unknown; topic?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON: {text, topic?}' }, { status: 400 });
  }
  const err = validateLine(body.text);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const topic = typeof body.topic === 'string' && body.topic.trim() ? body.topic.trim() : null;
  const row = await insertHistory((body.text as string).trim(), topic, 'auto');
  return NextResponse.json({ ok: true, row });
}

// Delete: ?id=<number> removes a history row; no id param clears the override.
export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (session?.role !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  if (!hasTickerStore()) {
    return NextResponse.json({ error: NO_STORE_MESSAGE }, { status: 501 });
  }
  const idParam = req.nextUrl.searchParams.get('id');
  if (idParam) {
    const id = Number(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: 'id must be a number' }, { status: 400 });
    await deleteHistoryRow(id);
    return NextResponse.json({ ok: true });
  }
  await clearOverride();
  return NextResponse.json({ ok: true });
}

// Admin override upsert (executive only).
export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  if (session?.role !== 'executive') {
    return NextResponse.json({ error: 'executive role required' }, { status: 403 });
  }
  if (!hasTickerStore()) {
    return NextResponse.json({ error: NO_STORE_MESSAGE }, { status: 501 });
  }
  let body: {
    enabled?: unknown; message?: unknown; priority?: unknown;
    starts_at?: unknown; ends_at?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON: {enabled, message, priority, starts_at, ends_at}' }, { status: 400 });
  }

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }
  // An enabled override needs a real message; a disabled one may be empty.
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (body.enabled) {
    const err = validateLine(message);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  } else if (message && (/[\r\n]/.test(message) || message.length > 280)) {
    return NextResponse.json({ error: 'message must be a single line ≤ 280 characters' }, { status: 400 });
  }
  // Priority is optional — defaults to 'Company News' when omitted.
  const priority = body.priority ?? 'Company News';
  if (!isTickerPriority(priority)) {
    return NextResponse.json(
      { error: "priority must be one of: 'Leadership Announcement', 'Company News', 'Recognition', 'Event', 'Emergency'" },
      { status: 400 },
    );
  }
  const starts = parseWhen(body.starts_at, 'starts_at');
  if (!starts.ok) return NextResponse.json({ error: starts.error }, { status: 400 });
  const ends = parseWhen(body.ends_at, 'ends_at');
  if (!ends.ok) return NextResponse.json({ error: ends.error }, { status: 400 });
  if (starts.value && ends.value && new Date(starts.value) >= new Date(ends.value)) {
    return NextResponse.json({ error: 'ends_at must be after starts_at' }, { status: 400 });
  }

  const row = await saveOverride({
    enabled: body.enabled,
    message,
    priority,
    starts_at: starts.value,
    ends_at: ends.value,
    updated_by: session.email ?? null,
  });
  return NextResponse.json({ ok: true, override: row });
}
