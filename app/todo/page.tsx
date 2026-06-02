// To Do — per-shop action queue for missed callbacks and customers who
// didn't rebook. Both roles allowed (advisors + managers + execs).
// Executives keep the ExecShell sidebar so they can navigate back; everyone
// else gets the minimal EmployeeShell.

import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import ExecShell from '@/components/ExecShell';
import EmployeeShell from '@/components/EmployeeShell';
import TodoSection from '@/components/TodoSection';

export const dynamic = 'force-dynamic';

export default async function TodoPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  const content = (
    <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
      <TodoSection userEmail={session.email} />
    </main>
  );
  if (session.role === 'executive') {
    return <ExecShell role={session.role} email={session.email}>{content}</ExecShell>;
  }
  return <EmployeeShell role={session.role} email={session.email}>{content}</EmployeeShell>;
}
