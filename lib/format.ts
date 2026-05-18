// Display formatters. All money rendered as USD with no decimals unless told otherwise.

const usdNoDec = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const usdTwoDec = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('en-US');

export const usd = (n: number) => usdNoDec.format(n);
export const usdCents = (n: number) => usdTwoDec.format(n);
export const num = (n: number) => intFmt.format(n);
export const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
export const pctAlready = (n: number, digits = 1) => `${n.toFixed(digits)}%`;
export const signed = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
