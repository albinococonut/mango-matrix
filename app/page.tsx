// Root — role-based redirect to the new dashboard category routes.
//   • exec     → /diagnostic
//   • employee → /employee
//   • no role  → /login

import { cookies } from 'next/headers';
import { COOKIE_NAME, verifyRoleCookie } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const role = await verifyRoleCookie(cookies().get(COOKIE_NAME)?.value);
  if (!role) redirect('/login');
  if (role === 'executive') redirect('/diagnostic');
  redirect('/employee');
}
