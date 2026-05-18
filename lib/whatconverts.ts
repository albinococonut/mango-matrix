// Server-only WhatConverts client. One token:secret pair per shop.

import { ShopNum, SHOP_BY_NUM } from './shops';
import { resolveRange } from './dates';

const BASE = 'https://app.whatconverts.com/api/v1';

function credsForShop(num: ShopNum): { token: string; secret: string } {
  const raw = process.env[`WHATCONVERTS_${num}`];
  if (!raw) throw new Error(`WHATCONVERTS_${num} not configured`);
  // Stored as "token:secret"
  const [token, secret] = raw.split(':');
  if (!token || !secret) throw new Error(`WHATCONVERTS_${num} malformed: expected token:secret`);
  return { token, secret };
}

export interface Lead {
  account_id: number;
  profile_id: number;
  profile: string;
  lead_id: number;
  lead_type: string;
  lead_status: string;
  date_created: string;
  lead_state: string;
  contact_name: string;
  contact_phone_number: string;
  spam: boolean;
  duplicate: boolean;
  call_duration_seconds: number;
  call_status: string;
  caller_name: string;
  caller_city: string;
  caller_state: string;
  call_transcription: string;
  recording?: string;
  play_recording?: string;
  // WhatConverts' own AI analysis
  lead_analysis?: {
    'Call Outcome'?: string;
    'Lead Qualification'?: string;
    'Lead Summary'?: string;
    'Sales Agent'?: string;
    'Intent Detection'?: string;
    'Keyword Detection'?: string;
    'Sentiment Detection'?: string;
    'Customer Type'?: string;
  };
}

export interface LeadFilter {
  shop: ShopNum;
  startDate: string;        // YYYY-MM-DD
  endDate: string;          // YYYY-MM-DD
  leadType?: 'phone_call' | 'web_form' | 'chat' | 'text';
}

async function authedGet(shop: ShopNum, path: string, params: Record<string, string | number>) {
  const { token, secret } = credsForShop(shop);
  const basic = Buffer.from(`${token}:${secret}`).toString('base64');
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`WhatConverts ${path} shop ${shop} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function fetchAllLeads(f: LeadFilter): Promise<Lead[]> {
  const out: Lead[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const data = (await authedGet(f.shop, '/leads', {
      start_date: f.startDate,
      end_date: f.endDate,
      lead_type: f.leadType ?? 'phone_call',
      per_page: 250,
      page_number: page,
    })) as { leads: Lead[]; total_pages: number };
    out.push(...(data.leads || []));
    totalPages = data.total_pages || 1;
    page++;
    if (page > 100) break;
  }
  return out;
}

/** WhatConverts' own AI classification - good baseline. */
export function isBookedBaseline(lead: Lead): boolean {
  return (lead.lead_analysis?.['Call Outcome'] || '') === 'Appointment Scheduled';
}

/** Calls we exclude entirely (spam, dropped, wrong number). */
export function isEligibleCall(lead: Lead): boolean {
  if (lead.spam) return false;
  const outcome = lead.lead_analysis?.['Call Outcome'] || '';
  if (outcome === 'Non-Lead - Wrong Number, Spam, or Vendor') return false;
  if (outcome === 'Technical Issue - Call Dropped or Audio Problem') return false;
  if (!lead.call_transcription || lead.call_transcription.length < 30) return false;
  return true;
}

// --- WTD aggregation across all shops ---

export interface ShopBookedRate {
  shopNum: string;
  shopName: string;
  totalCalls: number;
  eligible: number;
  booked: number;
  bookedRatePct: number; // 0..100
}

export interface BookedRateSnapshot {
  windowStart: string;
  windowEnd: string;
  computedAt: string;
  classifier: 'whatconverts_baseline' | 'claude_strict';
  shops: ShopBookedRate[];
  chain: { eligible: number; booked: number; bookedRatePct: number };
}

import type { ShopNum as ShopNumT } from './shops';

export async function computeWtdBookedRate(
  isBooked: (lead: Lead) => boolean = isBookedBaseline
): Promise<BookedRateSnapshot> {
  const range = resolveRange('wtd');
  const startDate = range.startISO.slice(0, 10);
  const endDate = range.endISO.slice(0, 10);
  const shops = (Object.keys(SHOP_BY_NUM) as ShopNumT[]);
  const out: ShopBookedRate[] = [];
  for (const num of shops) {
    try {
      const leads = await fetchAllLeads({ shop: num, startDate, endDate });
      const eligible = leads.filter(isEligibleCall);
      const booked = eligible.filter(isBooked).length;
      out.push({
        shopNum: num,
        shopName: SHOP_BY_NUM[num].name,
        totalCalls: leads.length,
        eligible: eligible.length,
        booked,
        bookedRatePct: eligible.length ? Math.round((booked / eligible.length) * 1000) / 10 : 0,
      });
    } catch (e: any) {
      // If a single shop's API key is bad, surface it but don't take down the chart
      out.push({
        shopNum: num,
        shopName: SHOP_BY_NUM[num].name,
        totalCalls: 0, eligible: 0, booked: 0, bookedRatePct: 0,
      });
    }
  }
  const totalElig = out.reduce((s, r) => s + r.eligible, 0);
  const totalBooked = out.reduce((s, r) => s + r.booked, 0);
  return {
    windowStart: startDate,
    windowEnd: endDate,
    computedAt: new Date().toISOString(),
    classifier: 'whatconverts_baseline',
    shops: out,
    chain: {
      eligible: totalElig,
      booked: totalBooked,
      bookedRatePct: totalElig ? Math.round((totalBooked / totalElig) * 1000) / 10 : 0,
    },
  };
}
