import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ConceptShell } from '@/components/concept2/kit';
import MarketingDashboard from '@/components/concept2/MarketingDashboard';

export const dynamic = 'force-dynamic';

const SECTIONS = [
  { id: 'new-customers',  label: 'New Customers' },
  { id: 'spend',          label: 'Marketing Spend' },
  { id: 'postcards',      label: 'Postcard Campaigns' },
  { id: 'attribution',    label: 'Attribution (coming soon)' },
];

export default async function MarketingPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  if (session.role !== 'executive') redirect('/employee');
  return (
    <ConceptShell
      active="marketing"
      title="Marketing"
      sub="New customers · spend by category · postcard attribution"
      sections={SECTIONS}
      email={session.email}
      role={session.role}
    >
      <MarketingDashboard />
    </ConceptShell>
  );
}
