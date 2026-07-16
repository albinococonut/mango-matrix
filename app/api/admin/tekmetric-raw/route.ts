// Temporary debug route — inspect raw Tekmetric RO + canned-jobs fields.
// DELETE THIS FILE after inspection.
import { NextRequest, NextResponse } from 'next/server';
import { getRole } from '@/lib/serverAuth';

const CLIENT_ID = process.env.TEKMETRIC_CLIENT_ID;
const CLIENT_SECRET = process.env.TEKMETRIC_CLIENT_SECRET;
const BASE = process.env.TEKMETRIC_BASE_URL || 'https://shop.tekmetric.com/api/v1';

async function getToken(): Promise<string> {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID!, client_secret: CLIENT_SECRET! }),
  });
  const d = await res.json() as any;
  return d.access_token;
}

async function apiFetch(token: string, path: string, params?: Record<string, any>) {
  const url = new URL(`${BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const role = await getRole(req);
  if (role !== 'executive') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const shopId = Number(req.nextUrl.searchParams.get('shopId') || '88');
  const token = await getToken();

  // Fetch one recent RO with full job/parts detail
  const ros = await apiFetch(token, '/repair-orders', {
    shop: shopId,
    size: 1,
    page: 0,
    sort: 'createdDate,desc',
  }) as any;

  const sampleRo = ros?.content?.[0] ?? null;
  const sampleJob = sampleRo?.jobs?.[0] ?? null;
  const samplePart = sampleJob?.parts?.[0] ?? null;

  // Try canned-jobs endpoint
  let cannedJobs: any = null;
  try {
    cannedJobs = await apiFetch(token, '/canned-jobs', { shop: shopId, size: 5 });
  } catch { cannedJobs = { error: 'endpoint not available' }; }

  // Try parts-matrix endpoint
  let partsMatrix: any = null;
  try {
    partsMatrix = await apiFetch(token, '/parts-matrix', { shop: shopId });
  } catch { partsMatrix = { error: 'endpoint not available' }; }

  return NextResponse.json({
    sampleRoKeys: sampleRo ? Object.keys(sampleRo) : null,
    sampleJobKeys: sampleJob ? Object.keys(sampleJob) : null,
    samplePartKeys: samplePart ? Object.keys(samplePart) : null,
    sampleJob,
    samplePart,
    cannedJobsSample: cannedJobs,
    partsMatrixSample: partsMatrix,
  });
}
