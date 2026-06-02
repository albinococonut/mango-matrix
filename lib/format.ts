// Display formatters. All money rendered as USD with no decimals unless told otherwise.

const usdNoDec = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const usdTwoDec = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('en-US');

export const usd = (n: number) => usdNoDec.format(n);
export const usdCents = (n: number) => usdTwoDec.format(n);
// Compact: $44,658 → $44.7k · $1,234,567 → $1.2M. For dense cards.
export const usdK = (n: number) => {
  const a = Math.abs(n); const sign = n < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 10_000)    return `${sign}$${(a / 1000).toFixed(0)}k`;
  if (a >= 1_000)     return `${sign}$${(a / 1000).toFixed(1)}k`;
  return `${sign}$${a.toFixed(0)}`;
};
export const num = (n: number) => intFmt.format(n);
// Friendly display name from an email's local part: jesse@… → "Jesse",
// jane.doe@… → "Jane Doe". Falls back to the full email if it can't parse.
export const nameFromEmail = (email?: string): string => {
  if (!email) return '';
  const local = email.split('@')[0] || '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (!parts.length) return email;
  return parts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};
export const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
export const pctAlready = (n: number, digits = 1) => `${n.toFixed(digits)}%`;
export const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
