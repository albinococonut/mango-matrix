// Sales Effectiveness — grades outbound "inspection results" calls where the
// advisor presents the ticket to the customer and asks for authorization.
//
// Pipeline per shop (round-robin cron, one shop per tick):
//   1. Fetch last-7-days outbound RC calls with Whisper transcripts
//   2. Match each call to the customer's open Tekmetric RO via phone lookup
//   3. Grade with Claude using the detailed 9-dimension rubric
//   4. Cache individual grades for 30 days; write shop summary to Redis

import Anthropic from '@anthropic-ai/sdk';
import { fetchOutboundCalls } from './ringcentral';
import { fetchROsByCreatedDate, searchCustomersByPhone } from './tekmetric';
import type { Job } from './tekmetric';
import { readCache, writeCache } from './cache';
import { SHOP_BY_NUM, ShopNum } from './shops';
import { resolveRange } from './dates';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const GRADE_CACHE_KEY = (callId: string) => `sales_eff_grade:${callId}`;
const SHOP_CACHE_KEY = (shopNum: string) => `sales_eff_shop:${shopNum}`;
const HANDLED_KEY = (shopNum: string) => `sales_eff_handled:${shopNum}`;
export const SE_WARM_IDX_KEY = 'sales_eff_warm_idx';

// --- Types ---

export interface SalesGrade {
  callId: string;
  startTime: string;
  durationSeconds: number;
  customerPhone: string;
  extensionNumber: string;
  roNumber: number | null;
  overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  overallScore: number; // 0–5
  summary: string;
  ticketCoverage: {
    totalItems: number;
    mentionedItems: number;
    omittedItems: Array<{ name: string; severity: string; amount: string }>;
    totalValueCents: number;
    omittedValueCents: number;
  };
  dimensionScores: Record<string, number | null>;
  improvements: string[];
  strongestMoment: string;
  weakestMoment: string;
  needsCoaching: boolean;
}

export interface SalesEffectivenessShopCache {
  shopNum: string;
  shopName: string;
  computedAt: string;
  windowStart: string;
  windowEnd: string;
  avgScore: number;
  totalGraded: number;
  needsCoachingCount: number;
  grades: SalesGrade[];
}

// --- Ticket formatter ---

export function formatTicket(jobs: Job[]): string {
  const active = jobs.filter(j => !j.archived);
  if (active.length === 0) return '(no line items)';
  let total = 0;
  const lines = active.map(j => {
    const dollars = j.subtotal / 100;
    total += dollars;
    return `- ${j.name} — $${dollars.toFixed(2)}`;
  });
  lines.push(`Total recommended: $${total.toFixed(2)}`);
  return lines.join('\n');
}

// --- Claude grader ---

const SYSTEM_PROMPT = `You are a call quality grader for Mango Automotive, an independent auto repair shop. You review "inspection results" calls — the calls advisors make to a customer once the vehicle has been inspected in the shop, to present the findings and get authorization to do the work.

You will be given TWO inputs:
  1. THE TICKET: the list of recommended repairs from the inspection. Each line is an item the shop is proposing to do, usually with a price attached.
  2. THE TRANSCRIPT: what the advisor and customer actually said on the phone.

Your job is to grade the advisor on how completely and effectively they presented the ticket, and whether they closed on authorization.

You must never invent details. Quote directly from the transcript when giving reasons. Never guess about ticket items that aren't listed. You grade the advisor, not the customer.

SALES PHILOSOPHY (what we teach advisors on inspection calls):
1. Present the whole ticket. Every recommended item gets mentioned by name. The most common failure is "cherry-picking" — only mentioning cheap/easy items and burying the expensive ones.
2. Prioritize by severity. Safety-critical items first (brakes, tires, steering, anything that could strand or hurt the customer). Then active problems. Then preventive maintenance.
3. Explain what and why. For each item, briefly say what's wrong and what could happen if it isn't fixed.
4. Anchor the warranty. Mention our 5 year / 60,000 mile warranty at least once.
5. Give one total. After walking through the items, give a single total dollar figure for everything.
6. Ask for authorization. End by explicitly asking "can we go ahead with all of this?" — not "let us know."
7. Handle objections without discounting. When a customer pushes back, the answer is the warranty, the risk of not doing it, and the fact that the car is already in the bay.
8. Personalize and stay professional. Use the customer's name. Warm and confident, not pushy.

GRADING RUBRIC — score each dimension 0–5:
  5 = excellent  4 = strong  3 = adequate  2 = weak  1 = poor  0 = absent  null = N/A

Dimensions:
  A. openingRapport — greeted, confirmed right person, smooth transition
  B. ticketCompleteness [MOST IMPORTANT] — did the advisor mention every item on the ticket?
  C. prioritization — safety-critical items first, didn't bury expensive items
  D. explanationPerItem — explained what was wrong and why it matters for each item
  E. warrantyPitch — mentioned the 5yr/60k warranty at least once
  F. totalPresentation — gave a clear total dollar figure
  G. objectionHandling — held the line when customer pushed back; didn't say "you could skip that"
  H. authorizationAsk — explicitly asked for approval; not a soft "let us know"
  I. personalization — used customer's name, spoke about their specific vehicle

Before scoring, enumerate every item on the ticket in your working notes, then check which ones were mentioned in the transcript. An item is "mentioned" only if the advisor named the repair clearly enough that the customer would recognize it. Vague references don't count. If the transcript is missing speaker labels and it's ambiguous, note that and grade conservatively.

Respond ONLY with a valid JSON object in exactly this shape (no markdown, no explanation outside the JSON):
{
  "overallGrade": "A"|"B"|"C"|"D"|"F",
  "overallScore": <number 0-5, average of scored (non-null) dimensions>,
  "summary": "<2-3 sentences: what went well, where it fell short, especially completeness gaps>",
  "ticketCoverage": {
    "totalItems": <number>,
    "mentionedItems": <number>,
    "omittedItems": [{"name": "<exact item name from ticket>", "severity": "safety-critical|problem|preventive|unknown", "amount": "<dollar amount or unknown>"}]
  },
  "dimensionScores": {
    "openingRapport": <0-5 or null>,
    "ticketCompleteness": <0-5>,
    "prioritization": <0-5 or null>,
    "explanationPerItem": <0-5>,
    "warrantyPitch": <0-5>,
    "totalPresentation": <0-5 or null>,
    "objectionHandling": <0-5 or null>,
    "authorizationAsk": <0-5>,
    "personalization": <0-5>
  },
  "improvements": ["<specific action tied to a moment in the call>", "<second action>"],
  "strongestMoment": "<direct quote — why it worked>",
  "weakestMoment": "<direct quote — why it fell short — exactly what they should have said instead>",
  "needsCoaching": <true if overallScore < 3.0>
}`;

let _client: Anthropic | null = null;
function getClient() {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

async function gradeCall(
  transcript: string,
  ticketText: string | null,
  callId: string,
  startTime: string,
  durationSeconds: number,
  customerPhone: string,
  extensionNumber: string,
  roNumber: number | null,
): Promise<SalesGrade> {
  const ticket = ticketText ?? '(ticket not available — grade based on transcript only; mark ticketCompleteness as null)';
  const userPrompt = `Grade this call.\n\nTHE TICKET:\n${ticket}\n\nTHE TRANSCRIPT:\n${transcript}`;

  let raw: any = null;
  try {
    const msg = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      raw = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    }
  } catch (e: any) {
    console.error(`[sales-eff] grade failed for ${callId}:`, e?.message);
  }

  if (!raw) {
    return fallbackGrade(callId, startTime, durationSeconds, customerPhone, extensionNumber, roNumber);
  }

  return {
    callId,
    startTime,
    durationSeconds,
    customerPhone,
    extensionNumber,
    roNumber,
    overallGrade: raw.overallGrade ?? 'C',
    overallScore: typeof raw.overallScore === 'number' ? raw.overallScore : 2.5,
    summary: raw.summary ?? '',
    ticketCoverage: raw.ticketCoverage ?? { totalItems: 0, mentionedItems: 0, omittedItems: [], totalValueCents: 0, omittedValueCents: 0 },
    dimensionScores: raw.dimensionScores ?? {},
    improvements: Array.isArray(raw.improvements) ? raw.improvements : [],
    strongestMoment: raw.strongestMoment ?? '',
    weakestMoment: raw.weakestMoment ?? '',
    needsCoaching: raw.needsCoaching ?? (raw.overallScore < 3.0),
  };
}

function fallbackGrade(callId: string, startTime: string, durationSeconds: number, customerPhone: string, extensionNumber: string, roNumber: number | null): SalesGrade {
  return { callId, startTime, durationSeconds, customerPhone, extensionNumber, roNumber, overallGrade: 'C', overallScore: 0, summary: 'Grading failed — will retry on next sync.', ticketCoverage: { totalItems: 0, mentionedItems: 0, omittedItems: [], totalValueCents: 0, omittedValueCents: 0 }, dimensionScores: {}, improvements: [], strongestMoment: '', weakestMoment: '', needsCoaching: false };
}

// --- RO matching ---

async function matchROForCall(
  customerPhone: string,
  callTimeISO: string,
  shopTekId: number,
  startDate: string,
  endDate: string,
): Promise<{ roNumber: number | null; jobs: Job[] }> {
  if (!customerPhone) return { roNumber: null, jobs: [] };
  try {
    const customerId = await searchCustomersByPhone(shopTekId, customerPhone);
    if (!customerId) return { roNumber: null, jobs: [] };

    const callMs = new Date(callTimeISO).getTime();
    const ros = await fetchROsByCreatedDate(shopTekId, startDate, endDate);
    const matched = ros
      .filter(ro => ro.customerId === customerId && new Date(ro.createdDate).getTime() <= callMs)
      .sort((a, b) => new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime());

    if (matched.length === 0) return { roNumber: null, jobs: [] };
    return { roNumber: matched[0].repairOrderNumber, jobs: matched[0].jobs ?? [] };
  } catch {
    return { roNumber: null, jobs: [] };
  }
}

// --- Handled/resolved tracking ---

export async function markSalesCallHandled(shopNum: string, callId: string): Promise<void> {
  const key = HANDLED_KEY(shopNum);
  const existing = await readCache<Record<string, number>>(key) ?? {};
  existing[callId] = Date.now();
  await writeCache(key, existing, { ttlSeconds: 14 * 24 * 60 * 60 });
}

export async function getSalesCallHandled(shopNum: string): Promise<Set<string>> {
  const existing = await readCache<Record<string, number>>(HANDLED_KEY(shopNum)) ?? {};
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return new Set(Object.entries(existing).filter(([, t]) => t > cutoff).map(([id]) => id));
}

// --- Main sync function ---

export async function warmSalesEffectivenessForShop(shopNum: string): Promise<string> {
  if (!process.env.RINGCENTRAL_JWT) throw new Error('RINGCENTRAL_JWT not configured');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const num = shopNum as ShopNum;
  const shop = SHOP_BY_NUM[num];
  if (!shop) throw new Error(`unknown shop ${shopNum}`);

  const w = resolveRange('last_7_days');
  const startDate = w.startISO.slice(0, 10);
  const endDate = w.endISO.slice(0, 10);

  const calls = await fetchOutboundCalls({ shop: num, startDate, endDate });
  const withRecording = calls.filter(c => c.contentUri);
  const withTranscript = calls.filter(c => c.transcript.length >= 50);

  if (withTranscript.length === 0) {
    await writeCache(SHOP_CACHE_KEY(num), {
      shopNum: num, shopName: shop.name,
      computedAt: new Date().toISOString(),
      windowStart: startDate, windowEnd: endDate,
      avgScore: 0, totalGraded: 0, needsCoachingCount: 0, grades: [],
    } satisfies SalesEffectivenessShopCache);
    return `shop ${num} (${shop.name}) — no outbound calls with transcripts (${calls.length} calls found, ${withRecording.length} with recordings)`;
  }

  const grades: SalesGrade[] = [];
  let newGrades = 0;

  for (const call of withTranscript) {
    const cached = await readCache<SalesGrade>(GRADE_CACHE_KEY(call.id));
    if (cached) { grades.push(cached); continue; }

    const { roNumber, jobs } = await matchROForCall(
      call.customerPhone, call.startTime, shop.tekmetricId, startDate, endDate
    );
    const ticketText = jobs.length > 0 ? formatTicket(jobs) : null;
    const grade = await gradeCall(
      call.transcript, ticketText, call.id, call.startTime,
      call.durationSeconds, call.customerPhone, call.extensionNumber, roNumber
    );
    await writeCache(GRADE_CACHE_KEY(call.id), grade, { ttlSeconds: 30 * 24 * 60 * 60 });
    grades.push(grade);
    newGrades++;
  }

  const avgScore = grades.length
    ? Math.round((grades.reduce((s, g) => s + g.overallScore, 0) / grades.length) * 10) / 10
    : 0;
  const needsCoachingCount = grades.filter(g => g.needsCoaching).length;

  const shopCache: SalesEffectivenessShopCache = {
    shopNum: num,
    shopName: shop.name,
    computedAt: new Date().toISOString(),
    windowStart: startDate,
    windowEnd: endDate,
    avgScore,
    totalGraded: grades.length,
    needsCoachingCount,
    grades,
  };
  await writeCache(SHOP_CACHE_KEY(num), shopCache);

  return `shop ${num} (${shop.name}) — ${grades.length} graded (${newGrades} new) · avg ${avgScore}/5 · ${needsCoachingCount} need coaching`;
}

export { SHOP_CACHE_KEY as SE_SHOP_CACHE_KEY };
