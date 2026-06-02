// /tv — wall-mounted single-screen dashboard. Designed at exactly
// 1920×1080 px and scaled to fit any 16:9 TV via CSS transform.
//
// Auth: same exec/employee cookie as the rest of the app. Sign in once
// on the TV's browser with the Google account that owns it; the 30-day
// session keeps it alive without re-auth.

import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import TVDashboard from '@/components/TVDashboard';

export const dynamic = 'force-dynamic';

export default async function TvPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/tv');
  return <TVDashboard />;
}
