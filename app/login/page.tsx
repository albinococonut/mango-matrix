'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    const next = new URLSearchParams(window.location.search).get('next') || '/';
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    setLoading(false);
    if (res.ok) {
      window.location.href = next;
    } else {
      setErr('Incorrect password');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-mango-bg">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Mango Automotive Dashboard</h1>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Enter password"
          className="w-full px-3 py-2 border border-mango-line rounded-md focus:outline-none focus:border-mango-orange"
          autoFocus
        />
        {err && <p className="text-sm text-mango-red">{err}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-mango-ink text-white rounded-md font-medium disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Log In'}
        </button>
      </form>
    </div>
  );
}
