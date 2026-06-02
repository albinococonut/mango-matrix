'use client';

// Sign-in landing page. Google OAuth restricted to @mangoautomotive.com is
// the only path in — the shared-password fallback has been retired.
//
// The sign-in CTA is a plain <a href> (not a JS-handled <button>) so it
// works even if a runtime JS error breaks the page — the link still
// navigates to the OAuth start route and the ?next= param is appended
// only when JS is healthy enough to read window.location.

import { useEffect, useState } from 'react';

export default function LoginPage() {
  // Surface Google-OAuth callback errors landed via ?error=...&attempted=...
  const [oauthErr, setOauthErr] = useState<string | null>(null);
  // Build a full sign-in URL including ?next= from the current page once we
  // hydrate. Server-rendered fallback is the plain start URL.
  const [signInHref, setSignInHref] = useState('/api/auth/google/start');

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);

    // Carry forward any ?next= so post-sign-in we land where the user
    // originally tried to go.
    const next = qs.get('next') || '/';
    setSignInHref(`/api/auth/google/start?next=${encodeURIComponent(next)}`);

    const err = qs.get('error');
    if (!err) return;
    if (err === 'domain') {
      const attempted = qs.get('attempted');
      setOauthErr(
        attempted
          ? `${attempted} is not a @mangoautomotive.com address.`
          : 'Only @mangoautomotive.com accounts can sign in.'
      );
    } else if (err === 'email_not_verified') {
      setOauthErr('Your Google account email is not verified.');
    } else if (err === 'state_mismatch' || err === 'missing_code_or_state') {
      setOauthErr('Google sign-in was interrupted. Please try again.');
    } else if (err === 'not_configured') {
      setOauthErr('Google sign-in is not configured. Contact an admin.');
    } else {
      setOauthErr(`Google sign-in failed: ${err}`);
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-mango-bg">
      <div className="card w-full max-w-sm space-y-5">
        <h1 className="text-xl font-semibold">The Mango Matrix</h1>

        <a
          href={signInHref}
          className="w-full py-2.5 bg-white border border-mango-line rounded-md font-medium text-mango-ink hover:border-mango-orange transition flex items-center justify-center gap-2.5 cursor-pointer no-underline"
        >
          {/* Google "G" mark */}
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92c1.71-1.57 2.68-3.9 2.68-6.61z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26a5.41 5.41 0 0 1-3.04.85c-2.34 0-4.32-1.58-5.03-3.71H.96v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.97 10.7A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.16.29-1.7V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3.01-2.34z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.43 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.96l3.01 2.34C4.68 5.17 6.66 3.58 9 3.58z" />
          </svg>
          Sign in with Google
        </a>
        <p className="text-[11px] text-mango-muted text-center -mt-1">
          Sign in with your <span className="font-semibold">@mangoautomotive.com</span> account.
        </p>
        {oauthErr && <p className="text-sm text-mango-red text-center">{oauthErr}</p>}
      </div>
    </div>
  );
}
