// Cache with a durable backend when available, file-backed fallback otherwise.
//
// THE PROBLEM THIS SOLVES: on Vercel Hobby, serverless /tmp is per-instance and
// ephemeral. The cron warms one instance's /tmp; a browser request hits a
// different cold instance and sees nothing → sections look empty on refresh.
//
// FIX: if an Upstash Redis REST store is provisioned (Vercel KV / Upstash —
// free tier), use it. It's shared across every instance and survives cold
// starts, so the cron writes once and every browser read is instant. If those
// env vars are absent, we fall back to the original /tmp file cache so local
// dev and un-provisioned deploys keep working unchanged.
//
// Provision (one-time, ~2 min): Vercel dashboard → Storage → Create →
// Upstash Redis (Free) → connect to this project. Vercel auto-injects
// KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL/TOKEN).

import fs from 'fs/promises';
import path from 'path';
import { gzipSync, gunzipSync } from 'zlib';

// Values above this size are gzip+base64 encoded with a "gz:" sentinel before
// going to Redis (JSON compresses ~8×, so this keeps mid-size windows under
// Upstash's request limit). Reads transparently detect the sentinel, so old
// uncompressed values still parse — fully backward compatible.
const GZIP_MIN_BYTES = 8 * 1024;

function encodeEnvelope(env: Envelope<unknown>): string {
  const s = JSON.stringify(env);
  return s.length > GZIP_MIN_BYTES ? 'gz:' + gzipSync(s).toString('base64') : s;
}

function decodeEnvelope<T>(raw: string): Envelope<T> {
  if (raw.startsWith('gz:')) {
    return JSON.parse(gunzipSync(Buffer.from(raw.slice(3), 'base64')).toString('utf8')) as Envelope<T>;
  }
  return JSON.parse(raw) as Envelope<T>;
}

const REDIS_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);

const ROOT =
  process.env.CACHE_DIR ||
  (process.env.VERCEL ? '/tmp/mango-cache' : path.join(process.cwd(), 'data', 'cache'));

// We wrap every value in an envelope so the freshness timestamp travels with
// the data — one Redis round-trip serves both readCache and isFresh callers
// (within a request we also memoize to avoid a duplicate GET).
interface Envelope<T> { t: number; v: T }

const reqMemo = new Map<string, { at: number; env: Envelope<unknown> | null }>();
const MEMO_MS = 2000; // collapse readCache+isFresh of the same key in one request

async function redisCmd(args: (string | number)[]): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(REDIS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`redis ${args[0]} ${r.status}`);
    const j = await r.json();
    return j.result;
  } finally {
    clearTimeout(timer);
  }
}

async function getEnvelope<T>(key: string): Promise<Envelope<T> | null> {
  const memo = reqMemo.get(key);
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.env as Envelope<T> | null;
  let env: Envelope<T> | null = null;
  try {
    if (USE_REDIS) {
      const raw = await redisCmd(['GET', `mango:${key}`]);
      env = raw ? decodeEnvelope<T>(raw as string) : null;
    } else {
      const buf = await fs.readFile(path.join(ROOT, `${key}.json`), 'utf8');
      const stat = await fs.stat(path.join(ROOT, `${key}.json`));
      env = { t: stat.mtimeMs, v: JSON.parse(buf) as T };
    }
  } catch {
    env = null;
  }
  reqMemo.set(key, { at: Date.now(), env });
  return env;
}

export async function readCache<T>(key: string): Promise<T | null> {
  const env = await getEnvelope<T>(key);
  return env ? env.v : null;
}

// Hard ceiling on a single persisted value. JSON RO windows gzip ~8×, so a
// ~2 MB encoded value is a multi-MB raw window — those bloated the 256 MB
// Upstash tier to exhaustion. Anything bigger is served from memory and never
// persisted (the caller still has the data in hand).
const MAX_PERSIST_BYTES = 1_500_000;

export interface WriteOpts {
  /** Expire the key after this many seconds (Redis EX). Use for large,
   *  regenerable, dated windows so they can't accumulate forever. Omit for
   *  durable artifacts (snapshots, current-AR, indices, heartbeats). */
  ttlSeconds?: number;
}

export async function writeCache(key: string, value: unknown, opts: WriteOpts = {}): Promise<void> {
  const env: Envelope<unknown> = { t: Date.now(), v: value };
  reqMemo.set(key, { at: Date.now(), env });
  // Caching is best-effort: a value too large for the backend (e.g. a huge
  // YTD RO window) must NOT throw — the caller already holds the data in
  // memory and returns it. We just skip persisting it.
  try {
    if (USE_REDIS) {
      const payload = encodeEnvelope(env);
      if (payload.length > MAX_PERSIST_BYTES) {
        console.warn(`[cache] "${key}" too large to persist (${(payload.length / 1048576).toFixed(1)} MB encoded) — served from memory`);
        return;
      }
      const cmd = ['SET', `mango:${key}`, payload];
      if (opts.ttlSeconds && opts.ttlSeconds > 0) cmd.push('EX', String(Math.floor(opts.ttlSeconds)));
      await redisCmd(cmd);
      return;
    }
    await fs.mkdir(ROOT, { recursive: true });
    await fs.writeFile(path.join(ROOT, `${key}.json`), JSON.stringify(value));
  } catch (e) {
    console.warn(`[cache] skipped persisting "${key}" (${(e as any)?.message || e}) — value not cached, served from memory`);
  }
}

export async function isFresh(key: string, maxAgeMs: number): Promise<boolean> {
  const env = await getEnvelope(key);
  if (!env) return false;
  return Date.now() - env.t < maxAgeMs;
}

/** Epoch-ms of when `key` was last written, or null if absent. */
export async function cacheUpdatedAt(key: string): Promise<number | null> {
  const env = await getEnvelope(key);
  return env ? env.t : null;
}
