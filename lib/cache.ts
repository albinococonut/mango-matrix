// File-backed cache. Keeps Vercel cold starts cheap and Tekmetric API friendly.
// On Vercel deploy with no filesystem persistence, swap this for KV or Redis.

import fs from 'fs/promises';
import path from 'path';

// Vercel serverless functions can only write to /tmp. Locally we keep cache in
// the project so it survives across `npm run dev` restarts.
const ROOT = process.env.CACHE_DIR
  || (process.env.VERCEL ? '/tmp/mango-cache' : path.join(process.cwd(), 'data', 'cache'));

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const buf = await fs.readFile(path.join(ROOT, `${key}.json`), 'utf8');
    return JSON.parse(buf) as T;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  await fs.mkdir(ROOT, { recursive: true });
  await fs.writeFile(path.join(ROOT, `${key}.json`), JSON.stringify(value));
}

export async function isFresh(key: string, maxAgeMs: number): Promise<boolean> {
  try {
    const s = await fs.stat(path.join(ROOT, `${key}.json`));
    return Date.now() - s.mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}
