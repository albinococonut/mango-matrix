import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ConceptShell } from '@/components/concept2/kit';
import CallRecordingsSection from '@/components/CallRecordingsSection';

export const dynamic = 'force-dynamic';

export default async function CallRecordingsPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  return (
    <ConceptShell active="call-recordings" title="Call Recordings" sub="Trailing 7 days · inbound & outbound · by shop" email={session.email}>
      <CallRecordingsSection />
    </ConceptShell>
  );
}
