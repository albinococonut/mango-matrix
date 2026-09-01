import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ConceptShell } from '@/components/concept2/kit';
import MarketingDashboard from '@/components/concept2/MarketingDashboard';

export const dynamic = 'force-dynamic';

const SECTIONS = [
  { id: 'channel-roi',       label: 'Return on Marketing' },
  { id: 'new-customers',     label: 'New Customers' },
  { id: 'spend',             label: 'Marketing Spend' },
  { id: 'referral-cohort',   label: 'Cohort Analysis' },
  { id: 'dm-shop-roas',      label: 'Direct Mail by Shop' },
  { id: 'lag-model',         label: 'Lag Model' },
  { id: 'attribution',       label: 'Cost per New Customer' },
  { id: 'channel-attribution', label: 'Channel Attribution' },
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
