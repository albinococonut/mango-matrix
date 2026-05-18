// Helpers for API routes to read the role from the request and enforce
// executive-only endpoints. Keep this lightweight so it can be imported by any
// route without dragging in heavy deps.

import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, Role, verifyRoleCookie } from './auth';

export async function getRole(req: NextRequest): Promise<Role | null> {
  return verifyRoleCookie(req.cookies.get(COOKIE_NAME)?.value);
}

/**
 * Wraps a route handler so it only runs if the caller is an executive.
 * Returns 403 otherwise. Use as:
 *   export const GET = requireExecutive(async (req) => { ... })
 */
export function requireExecutive<T extends (req: NextRequest) => Promise<Response> | Response>(handler: T): T {
  return (async (req: NextRequest) => {
    const role = await getRole(req);
    if (role !== 'executive') {
      return NextResponse.json({ error: 'executive role required' }, { status: 403 });
    }
    return handler(req);
  }) as T;
}
