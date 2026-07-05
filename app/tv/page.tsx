import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Concept2TVDashboard from '@/components/concept2/Concept2TVDashboard';

export const dynamic = 'force-dynamic';

export default async function TvPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/tv');
  return <Concept2TVDashboard />;
}
