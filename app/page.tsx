// Server component. Reads the signed role cookie on the server, then renders
// the Dashboard client component with the role baked in. The cookie is verified
// here so no exec-only content ships to employee browsers via SSR markup.

import { cookies } from 'next/headers';
import { COOKIE_NAME, verifyRoleCookie } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Dashboard from '@/components/Dashboard';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const role = await verifyRoleCookie(cookies().get(COOKIE_NAME)?.value);
  if (!role) {
    // Middleware should normally redirect first, but belt-and-suspenders.
    redirect('/login');
  }
  return <Dashboard role={role} />;
}
