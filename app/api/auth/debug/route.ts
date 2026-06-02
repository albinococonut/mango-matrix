// Diagnostic — reports whether the Google auth env vars are present at
// runtime, WITHOUT leaking any actual values. Safe to leave deployed; the
// worst it discloses is "this env var exists" + its length + a partial
// fingerprint of the first/last chars so we can spot trailing-whitespace
// or wrong-value bugs without exposing secrets.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function describe(v: string | undefined) {
  if (v === undefined) return { present: false };
  if (v === '') return { present: true, empty: true };
  return {
    present: true,
    length: v.length,
    first2: v.slice(0, 2),
    last2: v.slice(-2),
    hasLeadingSpace: v[0] === ' ',
    hasTrailingSpace: v[v.length - 1] === ' ',
  };
}

export async function GET() {
  return NextResponse.json({
    GOOGLE_AUTH_CLIENT_ID: describe(process.env.GOOGLE_AUTH_CLIENT_ID),
    GOOGLE_AUTH_CLIENT_SECRET: describe(process.env.GOOGLE_AUTH_CLIENT_SECRET),
    EXECUTIVE_EMAILS: describe(process.env.EXECUTIVE_EMAILS),
    GOOGLE_AUTH_REDIRECT_URI: describe(process.env.GOOGLE_AUTH_REDIRECT_URI),
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  });
}
