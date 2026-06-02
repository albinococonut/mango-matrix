// CONCEPT 2 — TV wall display. Full-bleed (no sidebar) per the original
// constraint: the 1920×1080 pixel-lock + CSS transform scale-to-fit math
// cannot survive a chromed shell. Concept2TVDashboard inherits that exact
// scale logic plus every data fetch from the production TVDashboard; only
// the visual chrome has been rebuilt in concept2's design language
// (frosted ivory tiles, Fraunces serif headlines, gold-thread accents,
// atmospheric cream background) — sizes and contrast tuned for 10–12 ft
// shop-floor legibility so the original "readable across the room"
// requirement is preserved.
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Concept2TVDashboard from '@/components/concept2/Concept2TVDashboard';

export const dynamic = 'force-dynamic';

export default async function Concept2TvPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/concept2/tv');
  return <Concept2TVDashboard />;
}
