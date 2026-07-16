import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ConceptShell } from '@/components/concept2/kit';
import Concept2TodoSection from '@/components/concept2/Concept2TodoSection';

export const dynamic = 'force-dynamic';

export default async function TodoPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  return (
    <ConceptShell active="todo" title="To Do" sub="Per-shop action queue · live presence · optimistic mutations" email={session.email}>
      <Concept2TodoSection userEmail={session.email} />
    </ConceptShell>
  );
}
