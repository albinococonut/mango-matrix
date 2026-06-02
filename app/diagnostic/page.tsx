// Diagnostic — operational analytics dashboard. Executive only.
// Employees hitting this URL get redirected to /employee.

import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Dashboard from '@/components/Dashboard';
import ExecShell from '@/components/ExecShell';

export const dynamic = 'force-dynamic';

export default async function DiagnosticPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  if (session.role !== 'executive') redirect('/employee');
  return (
    <ExecShell role={session.role} email={session.email}>
      <Dashboard role={session.role} category="diagnostic" />
    </ExecShell>
  );
}
