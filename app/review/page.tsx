// Review — corporate finance review (formerly /finance). Executive only.
// Employees get redirected to /employee.

import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import FinanceView from '@/components/FinanceView';
import ExecShell from '@/components/ExecShell';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  if (session.role !== 'executive') redirect('/employee');
  return (
    <ExecShell role={session.role} email={session.email}>
      <FinanceView />
    </ExecShell>
  );
}
