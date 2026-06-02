// Concept2 index — redirects to /concept2/diagnostic so the bare /concept2/
// URL doesn't 404. The diagnostic is the canonical entry point (matches
// concept1's /concept/diagnostic pattern); the sidebar nav inside the
// ConceptShell handles every other concept2 page from there.

import { redirect } from 'next/navigation';

export default function Concept2Index() {
  redirect('/concept2/diagnostic');
}
