// CONCEPT 2 — Employee View. Placeholder until the luxury rebuild lands;
// both roles allowed, mirroring the production /employee page.
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ConceptShell } from '@/components/concept2/kit';
import Concept2Employee from '@/components/concept2/Concept2Employee';

export const dynamic = 'force-dynamic';

const EMP_SECTIONS = [
  { id: 'golden', label: 'Golden Mango' },
  { id: 'trophies', label: 'Trophy Standings' },
  { id: 'operations', label: 'Operations' },
];

export default async function Concept2EmployeePage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  return (
    <ConceptShell active="employee" title="Employee View" sub="Recognition & operations · live data" sections={EMP_SECTIONS} email={session.email}>
      <Concept2Employee role={session.role} />
    </ConceptShell>
  );
}
