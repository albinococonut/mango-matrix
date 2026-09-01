import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import Concept2Diagnostic from '@/components/concept2/Concept2Diagnostic';

export const dynamic = 'force-dynamic';

export default async function DiagnosticPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  if (session.role !== 'executive') redirect('/employee');
  return <Concept2Diagnostic role={session.role} />;
}
