// CONCEPT 2 — To Do. Auth mirrors the production /todo page exactly. The
// concept-2 chrome (frosted sidebar + cream/orb background + fonts) wraps the
// Concept2TodoSection — a parallel of components/TodoSection.tsx that
// preserves every interactive behavior byte-for-byte (presence heartbeat,
// optimistic POST mutations to /api/callback/{id} · /api/rebook/{id} ·
// /api/declined-job/{id}, recovered-ledger sync, auto-poll, sessionStorage
// shop/tab persistence) but renders with the concept2 design language
// (frosted surfaces, serif headlines, confident type, gold accents).
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { ConceptShell } from '@/components/concept2/kit';
import Concept2TodoSection from '@/components/concept2/Concept2TodoSection';

export const dynamic = 'force-dynamic';

export default async function Concept2TodoPage() {
  const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
  if (!session) redirect('/login');
  return (
    <ConceptShell active="todo" title="To Do" sub="Per-shop action queue · live presence · optimistic mutations" email={session.email} role={session.role}>
      <Concept2TodoSection userEmail={session.email} />
    </ConceptShell>
  );
}
