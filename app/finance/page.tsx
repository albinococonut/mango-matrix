// /finance is the legacy route — preserved as a permanent redirect to /review
// so any bookmarked or shared links keep working.

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function FinancePage() {
  redirect('/review');
}
