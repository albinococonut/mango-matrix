import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ConceptShell } from '@/components/concept2/kit';
import Concept2Employee from '@/components/concept2/Concept2Employee';

export const dynamic = 'force-dynamic';

const EMP_SECTIONS = [
  { id: 'golden', label: 'Golden Mango' },
  { id: 'trophies', label: 'Trophy Standings' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'tech', label: 'Tech Production' },
  { id: 'comebacks', label: 'Comebacks' },
  { id: 'call-conversion', label: 'Call Conversion' },
  { id: 'sales-effectiveness', label: 'Sales Effectiveness' },
  { id: 'todos', label: 'To-Dos' },
  { id: 'receivables', label: 'Accounts Receivable' },
];

export default async function EmployeePage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  return (
    <ConceptShell active="employee" sections={EMP_SECTIONS} email={session.email} role={session.role}>
      <Concept2Employee role={session.role} />
    </ConceptShell>
  );
}
