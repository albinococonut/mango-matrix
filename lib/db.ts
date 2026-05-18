// Postgres client. Single shared connection pool for the Next.js server.
// Works with any Postgres (Vercel Postgres, Supabase, Neon, Railway, local).
// Throws a CLEAR error at first use if DATABASE_URL is not set so other
// features keep working even when the GBP integration isn't configured.

import postgres from 'postgres';

declare global {
  // eslint-disable-next-line no-var
  var __pg__: ReturnType<typeof postgres> | undefined;
}

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

export function sql() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL not configured. Provision a Postgres database (Vercel Postgres, Supabase, ' +
      'Neon, etc.) and add DATABASE_URL to .env.local. Then run db/migrations/001_gbp_init.sql.'
    );
  }
  if (!globalThis.__pg__) {
    globalThis.__pg__ = postgres(process.env.DATABASE_URL, {
      ssl: process.env.DATABASE_URL.includes('sslmode=disable') ? false : 'require',
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    });
  }
  return globalThis.__pg__;
}
