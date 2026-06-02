// Employee View — Golden Mango / Trophies / Operations.
// Both roles allowed. Executives keep the ExecShell sidebar so navigation is
// consistent with every other menu item (Diagnostic / Review / To Do). The
// page content is identical either way, so an exec still sees exactly what an
// employee sees — just framed by the sidebar. Non-execs get the minimal
// EmployeeShell top bar.

import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Dashboard from '@/components/Dashboard';
import ExecShell from '@/components/ExecShell';
import EmployeeShell from '@/components/EmployeeShell';

export const dynamic = 'force-dynamic';

export default async function EmployeePage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  const content = <Dashboard role={session.role} category="employee" />;
  if (session.role === 'executive') {
    return <ExecShell role={session.role} email={session.email}>{content}</ExecShell>;
  }
  return (
    <EmployeeShell role={session.role} email={session.email}>
      {content}
    </EmployeeShell>
  );
}
