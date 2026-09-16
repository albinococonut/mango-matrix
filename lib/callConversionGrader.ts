// Call Conversion Grader — grades inbound WhatConverts/RC calls on booking quality.
// Follows the same pattern as lib/salesEffectiveness.ts:
//   • Individual grades cached 30 days at cc_grade:{leadId}
//   • Shop summary (last-7-day window) cached at cc_shop:{shopNum}
//
// Rubric weights: Greeting 15 | Listening 25 | Value 20 | Appointment Close 25 | Closing 15

import Anthropic from '@anthropic-ai/sdk';
import { fetchAllLeads as fetchAllLeadsWC, isEligibleCall } from './whatconverts';
import { readCache, writeCache } from './cache';
import { SHOP_BY_NUM, ShopNum, SHOPS } from './shops';
import { resolveRange } from './dates';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

export const CC_GRADE_CACHE_KEY = (leadId: string | number) => `cc_grade:${leadId}`;
export const CC_SHOP_CACHE_KEY = (shopNum: string) => `cc_shop:${shopNum}`;

// Minimum duration (seconds) — filters out dropped/too-short calls
const MIN_DURATION_SEC = 45;

export interface CallConversionGrade {
  leadId: string;
  shopNum: string;
  startTime: string;          // ISO — date_created from WC/RC
  durationSeconds: number;
  contentUri?: string;        // RC recording URI for the audio proxy
  overallScore: number;       // 0–100
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  appointmentBooked: boolean;
  summary: string;
  naturalExample?: string;
  hospitality?: 'Exceptional' | 'Strong' | 'Inconsistent' | 'Poor';
  coachingOpportunity?: string;
  gradedAt: string;
}

export interface CallConversionShopCache {
  shopNum: string;
  shopName: string;
  computedAt: string;
  windowStart: string;
  windowEnd: string;
  avgScore: number;
  totalGraded: number;
  grades: CallConversionGrade[];
}

// ── Claude grader ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a call quality evaluator for Mango Automotive, an independent auto repair chain. You review INBOUND calls — when a customer called us to inquire about service.

Your job: evaluate how well our service advisor handled the call. Grade the advisor, not the customer.

DIMENSIONS (each 0–4):
1. GREETING & PRESENCE (15%): warm, energetic, gave name and shop name
   4 = enthusiastic and personalized, instantly puts the customer at ease
   3 = friendly and professional, covered the basics well
   2 = adequate but flat or robotic
   1 = cold, or missed name/shop name
   0 = extremely poor

2. LISTENING & DISCOVERY (25%): truly understood the customer's need, asked good questions
   4 = probed deeply, made the customer feel heard, uncovered the real concern
   3 = understood the need, asked at least one good follow-up question
   2 = got the basics but didn't dig deeper
   1 = passive only, no real discovery
   0 = ignored the customer's situation

3. VALUE COMMUNICATION (20%): explained what Mango offers, built confidence and trust
   4 = compelling case for Mango, made the customer feel they're in the right hands
   3 = explained service clearly, set good expectations
   2 = minimal value framing, mostly just price/availability
   1 = little to no value communication
   0 = none

4. APPOINTMENT CLOSE (25%): moved toward booking, handled pushback, confirmed the appointment
   4 = proactively offered a time, overcame ALL objections smoothly, confirmed booking
   3 = pushed for the appointment, kept momentum even when objections weren't fully resolved — CALL RESULTED IN A BOOKING
   2 = attempted to book, had trouble with objections, call may or may not have booked
   1 = weak close, didn't proactively ask for the appointment
   0 = no attempt to close

5. CLOSING WARMTH (15%): thanked the customer, confirmed details, left them feeling good
   4 = warm, memorable send-off; customer leaves excited about the appointment
   3 = professional, confirmed the details, genuine thank-you
   2 = adequate but rushed or forgettable
   1 = abrupt or cold ending
   0 = no real close

CALIBRATION — use the full 0–4 scale, not just 2–3:
- A call where the advisor books the appointment, handles the basics well, and the customer feels taken care of = score 3 on most dimensions → overall ~80 (B/B+). This is a GOOD call, not an average one.
- A truly exceptional call that would be used as training material = 3.5–4 across dimensions → 90+ (A).
- A mediocre call that books but left obvious opportunities on the table = 2 on most = ~65 (C+).
- A call that failed to book with no compelling reason = 1–2 on close = ~50 or below.

Important: if the appointment was booked, that is a meaningful positive outcome. A 3 ("pushed for booking, kept momentum even with objections") is appropriate for APPOINTMENT CLOSE on any call that resulted in a booked appointment, unless the close was truly exceptional (4) or the advisor stumbled badly getting there (2).

overallScore = round((greeting×0.15 + listening×0.25 + value×0.20 + appointmentClose×0.25 + closing×0.15) / 4 × 100)

Respond ONLY with valid JSON — no markdown, no commentary, no trailing text.`;

async function gradeCall(transcript: string, durationSec: number): Promise<{
  overallScore: number;
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  appointmentBooked: boolean;
  summary: string;
  naturalExample?: string;
  hospitality?: 'Exceptional' | 'Strong' | 'Inconsistent' | 'Poor';
  coachingOpportunity?: string;
} | null> {
  const client = new Anthropic();
  const userMsg = `TRANSCRIPT (${Math.round(durationSec / 60)}m ${durationSec % 60}s):
${transcript.slice(0, 8000)}

Evaluate this call and respond with JSON:
{
  "dimensions": { "greeting": 0-4, "listening": 0-4, "value": 0-4, "appointmentClose": 0-4, "closing": 0-4 },
  "overallScore": 0-100,
  "overallGrade": "A"|"B"|"C"|"D"|"F",
  "appointmentBooked": true|false,
  "summary": "2–3 sentences on what the advisor did well",
  "naturalExample": "exact quote from the call showing their best moment, or null",
  "hospitality": "Exceptional"|"Strong"|"Inconsistent"|"Poor",
  "coachingOpportunity": "one specific improvement, or null"
}`;

  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    });
    const text = resp.content.find(b => b.type === 'text')?.text ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    const score = Math.max(0, Math.min(100, Math.round(obj.overallScore ?? 0)));
    const grade: 'A' | 'B' | 'C' | 'D' | 'F' =
      score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
    return {
      overallScore: score,
      overallGrade: grade,
      appointmentBooked: !!obj.appointmentBooked,
      summary: obj.summary ?? '',
      naturalExample: obj.naturalExample ?? undefined,
      hospitality: obj.hospitality ?? undefined,
      coachingOpportunity: obj.coachingOpportunity ?? undefined,
    };
  } catch {
    return null;
  }
}

// ── Main warm function ────────────────────────────────────────────────────────

export async function warmCallConversionsForShop(shopNum: string, opts: { bust?: boolean } = {}): Promise<string> {
  const shop = SHOP_BY_NUM[shopNum as ShopNum];
  if (!shop) return `unknown shop ${shopNum}`;
  if (!process.env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY not set — skipping';

  const w = resolveRange('last_7_days');
  const startDate = w.startISO.slice(0, 10);
  const endDate = w.endISO.slice(0, 10);

  let leads;
  try {
    leads = await fetchAllLeadsWC({ shop: shopNum as ShopNum, startDate, endDate, leadType: 'phone_call' });
  } catch (e: any) {
    return `fetch failed: ${e?.message}`;
  }

  // Filter to eligible calls with enough transcript + duration
  const eligible = leads.filter(l =>
    isEligibleCall(l) &&
    (l.call_duration_seconds ?? 0) >= MIN_DURATION_SEC &&
    l.call_transcription &&
    l.call_transcription.length >= 100
  );

  // Grade (skip if already cached), up to 30 per run
  const toGrade = eligible.slice(0, 30);
  const grades: CallConversionGrade[] = [];
  let graded = 0;
  let cached = 0;

  for (const lead of toGrade) {
    const key = CC_GRADE_CACHE_KEY(lead.lead_id);
    if (!opts.bust) {
      const existing = await readCache<CallConversionGrade>(key);
      if (existing) {
        grades.push(existing);
        cached++;
        continue;
      }
    }

    const result = await gradeCall(lead.call_transcription ?? '', lead.call_duration_seconds ?? 0);
    if (!result) continue;

    const grade: CallConversionGrade = {
      leadId: String(lead.lead_id),
      shopNum,
      startTime: lead.date_created,
      durationSeconds: lead.call_duration_seconds ?? 0,
      contentUri: (lead as any).recording ?? lead.play_recording ?? undefined,
      ...result,
      gradedAt: new Date().toISOString(),
    };

    await writeCache(key, grade, { ttlSeconds: 30 * 24 * 3600 });
    grades.push(grade);
    graded++;
  }

  // Write shop summary
  const totalGraded = grades.length;
  const avgScore = totalGraded
    ? Math.round((grades.reduce((s, g) => s + g.overallScore, 0) / totalGraded) * 10) / 10
    : 0;

  const shopCache: CallConversionShopCache = {
    shopNum,
    shopName: shop.name,
    computedAt: new Date().toISOString(),
    windowStart: startDate,
    windowEnd: endDate,
    avgScore,
    totalGraded,
    grades,
  };

  await writeCache(CC_SHOP_CACHE_KEY(shopNum), shopCache, { ttlSeconds: 7 * 24 * 3600 });
  return `graded ${graded} new, ${cached} cached — ${totalGraded} total for ${shop.name}`;
}
