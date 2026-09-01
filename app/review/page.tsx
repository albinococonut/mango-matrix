import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ConceptShell } from '@/components/concept2/kit';
import Concept2Review from '@/components/concept2/Concept2Review';

export const dynamic = 'force-dynamic';

const REVIEW_SECTIONS = [
  { id: 'gp-goal', label: 'GP $ Goal' },
  { id: 'shops', label: 'Shop-by-Shop' },
  { id: 'diagnostic', label: 'Diagnostic Callouts' },
  { id: 'ar', label: 'Accounts Receivable' },
  { id: 'waterfall', label: 'Financial Waterfall' },
  { id: 'expenses', label: 'Expense Classification' },
];

export default async function ReviewPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  if (session.role !== 'executive') redirect('/employee');
  return (
    <ConceptShell active="review" title="Weekly Review" sub="Corporate finance review · frozen weekly · A/R live" sections={REVIEW_SECTIONS} email={session.email} role={session.role}>
      <Concept2Review />
    </ConceptShell>
  );
}
