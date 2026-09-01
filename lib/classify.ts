// Call Conversion classifier. A call is "converted" when both halves are present:
//   (1) Recipient (shop rep) used booking language tied to a time.
//   (2) Customer agreed to that specific time.

import Anthropic from '@anthropic-ai/sdk';
import { readCache, writeCache } from './cache';
import type { Lead } from './whatconverts';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You classify a phone call transcript from an auto repair shop.

STEP 1 — Is this a new customer inquiry?
Set is_new_inquiry = TRUE when the caller is seeking service they have NOT yet started:
  examples: wants a diagnosis, asking about pricing, wants to schedule a repair, first-time inquiry

Set is_new_inquiry = FALSE when:
  - Existing customer calling about an open or completed repair order ("when is my car ready?", "did you find the part?", "I'm picking it up")
  - Vendor, supplier, or parts call
  - Wrong number
  - Employee or internal call
  - Customer checking on a warranty claim or insurance authorization already in progress

If is_new_inquiry = FALSE, set call_converted = false and stop — do not evaluate booking.

STEP 2 — Did the call convert to a booking? (Only when is_new_inquiry = TRUE)

call_converted = TRUE only when BOTH of these are present in the transcript:

(1) The shop representative used booking language tied to a SPECIFIC time. Examples:
    - "let me get you scheduled"
    - "we'll see you tomorrow at 9"
    - "I can get you in today at 12"
    - "I've got you on the books"
    - "how about 10 a.m.?"
    - "8am Tuesday work for you?"

(2) The customer AGREED to that specific time. Examples:
    - "I'll be there"
    - "I'll bring it in tomorrow"
    - "that works"
    - "sounds good"
    - "see you then"
    - "yes" / "yeah" tied to the proposed time

BOTH halves must be present. The rep saying "I can get you in" without the customer
agreeing to a time is just an offer the customer ducked — that is FALSE. The customer
saying "sounds good" to a vague "swing by whenever" with no clock time is FALSE.

Mark call_converted = FALSE if any of these:
- Price quote given but no time was offered or agreed
- "Bring it in whenever" / "drop off anytime today" / walk-in offers with no clock time
- Customer said "I'll call back" / "let me check my schedule"
- Time was discussed but the customer didn't explicitly agree
- Rep offered a time but the customer asked to think about it / didn't commit

Respond with ONLY the JSON object: {"is_new_inquiry": true|false, "call_converted": true|false, "confidence": 0-1, "reason": "one short sentence"}.`;

export interface Classification {
  /** Legacy field name kept for compatibility with existing call sites. */
  appointment_booked: boolean;
  /** True when the caller was a new customer inquiry (not a status/pickup call). */
  is_new_inquiry: boolean;
  confidence: number;
  reason: string;
}

let client: Anthropic | null = null;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function classifyTranscript(transcript: string): Promise<Classification> {
  // Hard truncate to keep token cost predictable
  const text = transcript.length > 6000 ? transcript.slice(0, 6000) + '\n[...]' : transcript;
  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 200,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Transcript:\n\n${text}` }],
  });
  const raw = (resp.content[0] as any).text as string;
  // Tolerate minor formatting noise around the JSON
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { appointment_booked: false, is_new_inquiry: true, confidence: 0, reason: 'no json in response' };
  try {
    const obj = JSON.parse(m[0]);
    const booked = !!(obj.call_converted ?? obj.appointment_booked);
    const isNewInquiry = obj.is_new_inquiry !== false; // default true for legacy responses without the field
    return {
      appointment_booked: booked,
      is_new_inquiry: isNewInquiry,
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.5,
      reason: String(obj.reason || ''),
    };
  } catch {
    return { appointment_booked: false, is_new_inquiry: true, confidence: 0, reason: 'invalid json' };
  }
}

// -------- Missed Conversion Callbacks scorer --------
//
// Runs ONLY on the subset of calls that were eligible but did NOT convert.
// Asks: "of the customers who didn't book, which ones were realistically
// salvageable if we called them back?" — produces an actionable callback queue.
//
// We score AFTER `classifyTranscript` has marked a call as not-booked, so
// the input set is already trimmed of spam / wrong-numbers / dropped calls.
// Result is cached per `lead_id` (a stable, immutable identifier) so the
// score is computed exactly once per call across the call's lifetime.

const SALVAGEABILITY_SYSTEM_PROMPT = `You analyze a phone call transcript from an auto-repair shop where the customer did NOT book an appointment. The call has already passed basic eligibility filters (not spam, not a wrong number, not dropped). Your job is to judge whether the customer is realistically SALVAGEABLE with a callback — i.e. there was real demand and the call ended without a booking because of fixable advisor or process reasons, not because the customer was outside the shop's market.

Return a single JSON object with these fields:
- "probability": number 0-1. Conservative. Reserve >0.6 for calls with clear positive intent (specific problem, asked about availability/pricing, expressed urgency, trust signals). Use 0.2-0.4 for tepid interest. Use <0.2 when the conversation showed real friction the callback won't overcome (already booked elsewhere, out-of-area, abusive).
- "reason": one short sentence explaining what specifically caused the call to end without a booking. Examples: "Advisor quoted price but did not offer a time", "Customer was price shopping and conversation ended without commitment", "Customer asked about availability but no urgency was created", "Customer hesitated and advisor did not offer financing".
- "angle": one short sentence suggesting how the callback should be approached. Examples: "Offer specific same-day appointment slot", "Ask if they got their issue resolved elsewhere; if not, offer financing", "Lead with availability and a specific time", "Confirm pricing and create urgency around safety implications".

Exclude (return probability 0) if any of these are clear: customer is out-of-area, customer was abusive, customer was already booked at another shop, customer was asking about a vehicle or service the shop doesn't handle, request was impossible.

Respond with ONLY the JSON object. No prose around it.`;

export interface SalvageScore {
  probability: number;          // 0..1
  reason: string;
  angle: string;
}

export async function scoreSalvageability(transcript: string): Promise<SalvageScore> {
  const text = transcript.length > 6000 ? transcript.slice(0, 6000) + '\n[...]' : transcript;
  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SALVAGEABILITY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Transcript:\n\n${text}` }],
  });
  const raw = (resp.content[0] as any).text as string;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { probability: 0, reason: 'no json in response', angle: '' };
  try {
    const obj = JSON.parse(m[0]);
    const p = typeof obj.probability === 'number' ? Math.max(0, Math.min(1, obj.probability)) : 0;
    return {
      probability: p,
      reason: String(obj.reason || '').slice(0, 240),
      angle: String(obj.angle || '').slice(0, 240),
    };
  } catch {
    return { probability: 0, reason: 'invalid json', angle: '' };
  }
}

const SALVAGE_CACHE_KEY = (leadId: number) => `salvage:${leadId}`;
const SALVAGE_TTL = 14 * 24 * 60 * 60;

export async function scoreSalvageabilityBatch(leads: Lead[], concurrency = 6): Promise<Map<number, SalvageScore>> {
  const results = new Map<number, SalvageScore>();

  const cached = await Promise.all(leads.map(l => readCache<SalvageScore>(SALVAGE_CACHE_KEY(l.lead_id))));
  const toScore: Lead[] = [];
  for (let i = 0; i < leads.length; i++) {
    if (cached[i]) {
      results.set(leads[i].lead_id, cached[i]!);
    } else {
      toScore.push(leads[i]);
    }
  }

  const queue = toScore.slice();
  let errors = 0;
  let lastError: string | undefined;
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const lead = queue.shift()!;
      try {
        const s = await scoreSalvageability(lead.call_transcription || '');
        if (lead.call_transcription && lead.call_transcription.length >= 30) {
          await writeCache(SALVAGE_CACHE_KEY(lead.lead_id), s, { ttlSeconds: SALVAGE_TTL });
        }
        results.set(lead.lead_id, s);
      } catch (e: any) {
        errors++;
        lastError = e?.message || 'unknown';
        results.set(lead.lead_id, { probability: 0, reason: `error: ${lastError}`, angle: '' });
      }
    }
  });
  await Promise.all(workers);
  if (errors > 0) console.error(`[salvageability] ${errors}/${toScore.length} errored. Last: ${lastError}`);
  return results;
}

const CLASSIFY_CACHE_KEY = (leadId: number) => `classify:${leadId}`;
const CLASSIFY_TTL = 14 * 24 * 60 * 60; // 14 days — call outcomes don't change

/** Run with bounded concurrency to stay polite. Skips leads already cached. */
export async function classifyBatch(leads: Lead[], concurrency = 8): Promise<Map<number, Classification>> {
  const results = new Map<number, Classification>();

  // Batch-load all cached results in one pass before spinning up workers.
  const cached = await Promise.all(leads.map(l => readCache<Classification>(CLASSIFY_CACHE_KEY(l.lead_id))));
  const toClassify: Lead[] = [];
  for (let i = 0; i < leads.length; i++) {
    if (cached[i]) {
      results.set(leads[i].lead_id, cached[i]!);
    } else {
      toClassify.push(leads[i]);
    }
  }

  if (toClassify.length > 0) {
    console.log(`[classify] ${results.size} cached, ${toClassify.length} new to classify`);
  }

  const queue = toClassify.slice();
  let errors = 0;
  let lastError: string | undefined;
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const lead = queue.shift()!;
      try {
        const c = await classifyTranscript(lead.call_transcription || '');
        // Only cache if transcript was non-empty — a blank transcript produces
        // a meaningless result and we want to re-try when the transcript arrives.
        if (lead.call_transcription && lead.call_transcription.length >= 30) {
          await writeCache(CLASSIFY_CACHE_KEY(lead.lead_id), c, { ttlSeconds: CLASSIFY_TTL });
        }
        results.set(lead.lead_id, c);
      } catch (e: any) {
        errors++;
        lastError = e?.message || 'unknown';
        results.set(lead.lead_id, { appointment_booked: false, is_new_inquiry: true, confidence: 0, reason: `error: ${lastError}` });
      }
    }
  });
  await Promise.all(workers);
  if (errors > 0) console.error(`[classify] ${errors}/${toClassify.length} errored. Last: ${lastError}`);
  return results;
}
