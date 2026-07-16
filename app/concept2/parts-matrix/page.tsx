import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import PartsMatrixUsage from '@/components/concept2/PartsMatrixUsage';

export const dynamic = 'force-dynamic';

export default async function PartsMatrixPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  if (session.role !== 'executive') redirect('/employee');
  return <PartsMatrixUsage email={session.email ?? ''} />;
}
