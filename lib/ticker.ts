// Daily Ticker storage helpers. See TICKER_SYSTEM.md for the full operating
// spec (generation rules, precedence, repetition rules).
//
// Precedence: an ACTIVE admin override (enabled + inside its time window)
// always wins and is shown verbatim; otherwise the most recent history line
// (published daily by the Claude cron job); otherwise nothing.
//
// STORAGE: Upstash Redis via lib/cache.ts (readCache/writeCache) — the same
// KV store the rest of the dashboard uses. No Postgres involved; production
// has no DATABASE_URL. Keys (cache.ts adds the "mango:" prefix):
//   ticker:override — JSON of the single override row
//   ticker:history  — JSON array of up to 50 lines, newest first
//
// All functions degrade gracefully when the Redis env vars are unset
// (hasTickerStore() guard → API returns 501 / {text:null, source:'none'}).

import { readCache, writeCache } from '@/lib/cache';

const OVERRIDE_KEY = 'ticker:override';
const HISTORY_KEY = 'ticker:history';
const HISTORY_MAX = 50;

export const TICKER_PRIORITIES = [
  'Leadership Announcement',
  'Company News',
  'Recognition',
  'Event',
  'Emergency',
] as const;
export type TickerPriority = (typeof TICKER_PRIORITIES)[number];

export function isTickerPriority(v: unknown): v is TickerPriority {
  return typeof v === 'string' && (TICKER_PRIORITIES as readonly string[]).includes(v);
}

/** True when the Upstash Redis REST store is configured (same envs lib/cache.ts uses). */
export function hasTickerStore(): boolean {
  return !!(
    (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
    (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
  );
}

export interface TickerOverrideRow {
  id: number; // always 1 — single logical row
  enabled: boolean;
  message: string;
  priority: string;
  starts_at: string | null;
  ends_at: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface TickerHistoryRow {
  id: number; // epoch-ms at insert; unique enough for a once-a-day writer
  text: string;
  topic: string | null;
  source: string;
  created_at: string;
}

export interface CurrentTicker {
  text: string | null;
  source: 'override' | 'auto' | 'none';
  priority?: string;
}

/** The raw override row, regardless of enabled/window. Null if no store or never saved. */
export async function getOverrideRow(): Promise<TickerOverrideRow | null> {
  if (!hasTickerStore()) return null;
  return (await readCache<TickerOverrideRow>(OVERRIDE_KEY)) ?? null;
}

/** The override row iff enabled AND now is inside [starts_at, ends_at] (nulls unbounded). */
export async function getActiveOverride(): Promise<TickerOverrideRow | null> {
  const row = await getOverrideRow();
  if (!row || !row.enabled) return null;
  const now = Date.now();
  if (row.starts_at && new Date(row.starts_at).getTime() > now) return null;
  if (row.ends_at && new Date(row.ends_at).getTime() < now) return null;
  return row;
}

async function readHistory(): Promise<TickerHistoryRow[]> {
  if (!hasTickerStore()) return [];
  const arr = await readCache<TickerHistoryRow[]>(HISTORY_KEY);
  return Array.isArray(arr) ? arr : [];
}

/** Last n published ticker lines, newest first. Used for repetition checks. */
export async function recentTickers(n = 14): Promise<TickerHistoryRow[]> {
  return (await readHistory()).slice(0, n);
}

/**
 * What the intranet should display right now.
 * Active override message (verbatim, never rewritten) > latest auto line > none.
 */
export async function getCurrentTicker(): Promise<CurrentTicker> {
  const ov = await getActiveOverride();
  if (ov && ov.message.trim()) {
    return { text: ov.message, source: 'override', priority: ov.priority };
  }
  const [latest] = await recentTickers(1);
  if (latest) return { text: latest.text, source: 'auto' };
  return { text: null, source: 'none' };
}

/** Upsert the single override row. Caller must have validated inputs. */
export async function saveOverride(input: {
  enabled: boolean;
  message: string;
  priority: TickerPriority;
  starts_at: string | null;
  ends_at: string | null;
  updated_by: string | null;
}): Promise<TickerOverrideRow> {
  const row: TickerOverrideRow = {
    id: 1,
    enabled: input.enabled,
    message: input.message,
    priority: input.priority,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    updated_by: input.updated_by,
    updated_at: new Date().toISOString(),
  };
  await writeCache(OVERRIDE_KEY, row);
  return row;
}

/** Remove the override (disable it). */
export async function clearOverride(): Promise<void> {
  if (!hasTickerStore()) return;
  const row = await getOverrideRow();
  if (!row) return;
  await writeCache(OVERRIDE_KEY, { ...row, enabled: false, message: '' });
}

/** Delete a single history row by id. */
export async function deleteHistoryRow(id: number): Promise<void> {
  if (!hasTickerStore()) return;
  const history = await readHistory();
  await writeCache(HISTORY_KEY, history.filter((r) => r.id !== id));
}

/** Insert a published ticker line (the daily Claude job calls this via POST /api/ticker). */
export async function insertHistory(text: string, topic: string | null, source = 'auto'): Promise<TickerHistoryRow> {
  const row: TickerHistoryRow = {
    id: Date.now(),
    text,
    topic,
    source,
    created_at: new Date().toISOString(),
  };
  const history = [row, ...(await readHistory())].slice(0, HISTORY_MAX);
  await writeCache(HISTORY_KEY, history);
  return row;
}
