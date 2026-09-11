// Google Ads API v18 integration.
// Fetches campaign-level performance data (spend, clicks, impressions, conversions).
// Credentials come from Vercel env vars set during setup:
//   GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
//   GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN

const ADS_API_VERSION = 'v18';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ADS_BASE = `https://googleads.googleapis.com/${ADS_API_VERSION}`;

export interface GoogleAdsCampaignRow {
  campaignId: string;
  campaignName: string;
  status: string;
  costMicros: number;          // cost in micros (divide by 1_000_000 for $)
  clicks: number;
  impressions: number;
  conversions: number;
  date?: string;               // present when querying by day
}

export interface GoogleAdsAccountSummary {
  customerId: string;
  descriptiveName: string;
  currencyCode: string;
  campaigns: GoogleAdsCampaignRow[];
  totalCostMicros: number;
  totalClicks: number;
  totalImpressions: number;
  totalConversions: number;
  fetchedAt: string;
}

async function getAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.GOOGLE_ADS_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? '',
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN ?? '',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body: params });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Google Ads token refresh failed: ' + JSON.stringify(data));
  }
  return data.access_token as string;
}

function adsHeaders(accessToken: string, loginCustomerId?: string): HeadersInit {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '',
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) h['login-customer-id'] = loginCustomerId;
  return h;
}

export async function listAccessibleCustomers(): Promise<string[]> {
  const token = await getAccessToken();
  const res = await fetch(`${ADS_BASE}/customers:listAccessibleCustomers`, {
    headers: adsHeaders(token),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('listAccessibleCustomers failed: ' + JSON.stringify(data));
  // Returns resource names like "customers/1234567890"
  return (data.resourceNames ?? []).map((n: string) => n.replace('customers/', ''));
}

export async function fetchCampaignStats(
  customerId: string,
  startDate: string,   // YYYY-MM-DD
  endDate: string,     // YYYY-MM-DD
  loginCustomerId?: string,
): Promise<GoogleAdsCampaignRow[]> {
  const token = await getAccessToken();
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `.trim();

  const res = await fetch(`${ADS_BASE}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers: adsHeaders(token, loginCustomerId),
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`fetchCampaignStats(${customerId}) failed: ` + JSON.stringify(data));

  return (data.results ?? []).map((r: any) => ({
    campaignId: r.campaign?.id ?? '',
    campaignName: r.campaign?.name ?? '',
    status: r.campaign?.status ?? '',
    costMicros: Number(r.metrics?.costMicros ?? 0),
    clicks: Number(r.metrics?.clicks ?? 0),
    impressions: Number(r.metrics?.impressions ?? 0),
    conversions: Number(r.metrics?.conversions ?? 0),
  }));
}

export interface PhoneCallWeekRow {
  weekISO: string;      // YYYY-MM-DD (Monday start, from segments.week)
  campaignId: string;
  campaignName: string;
  phoneCalls: number;
}

export async function fetchPhoneCallsByWeek(
  customerId: string,
  startDate: string,   // YYYY-MM-DD
  endDate: string,     // YYYY-MM-DD
  loginCustomerId?: string,
): Promise<PhoneCallWeekRow[]> {
  const token = await getAccessToken();
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      segments.week,
      metrics.phone_calls
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
      AND metrics.phone_calls > 0
    ORDER BY segments.week ASC
  `.trim();

  const res = await fetch(`${ADS_BASE}/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    headers: adsHeaders(token, loginCustomerId),
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`fetchPhoneCallsByWeek(${customerId}) failed: ` + JSON.stringify(data));

  return (data.results ?? []).map((r: any) => ({
    weekISO: r.segments?.week ?? '',
    campaignId: r.campaign?.id ?? '',
    campaignName: r.campaign?.name ?? '',
    phoneCalls: Number(r.metrics?.phoneCalls ?? 0),
  })).filter((r: PhoneCallWeekRow) => r.weekISO && r.phoneCalls > 0);
}

export async function fetchAccountSummary(
  customerId: string,
  startDate: string,
  endDate: string,
  loginCustomerId?: string,
): Promise<GoogleAdsAccountSummary> {
  const campaigns = await fetchCampaignStats(customerId, startDate, endDate, loginCustomerId);
  const totalCostMicros = campaigns.reduce((s, c) => s + c.costMicros, 0);
  const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
  const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0);

  return {
    customerId,
    descriptiveName: '',
    currencyCode: 'USD',
    campaigns,
    totalCostMicros,
    totalClicks,
    totalImpressions,
    totalConversions,
    fetchedAt: new Date().toISOString(),
  };
}
