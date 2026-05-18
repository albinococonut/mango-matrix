// Call Conversion classifier. A call is "converted" when both halves are present:
//   (1) Recipient (shop rep) used booking language tied to a time.
//   (2) Customer agreed to that specific time.

import Anthropic from '@anthropic-ai/sdk';
import type { Lead } from './whatconverts';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You classify a phone call transcript from an auto repair shop.

Decide whether the call resulted in an APPOINTMENT BOOKING ("call conversion").

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

Mark FALSE if any of these:
- Price quote given but no time was offered or agreed
- "Bring it in whenever" / "drop off anytime today" / walk-in offers with no clock time
- Customer said "I'll call back" / "let me check my schedule"
- Wrong number, vendor call, status check on an existing repair
- Time was discussed but the customer didn't explicitly agree
- Rep offered a time but the customer asked to think about it / didn't commit

Respond with ONLY the JSON object: {"call_converted": true|false, "confidence": 0-1, "reason": "one short sentence"}.`;

export interface Classification {
  /** Legacy field name kept for compatibility with existing call sites. */
  appointment_booked: boolean;
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
  if (!m) return { appointment_booked: false, confidence: 0, reason: 'no json in response' };
  try {
    const obj = JSON.parse(m[0]);
    // Accept either the new "call_converted" field or the legacy "appointment_booked"
    const booked = !!(obj.call_converted ?? obj.appointment_booked);
    return {
      appointment_booked: booked,
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.5,
      reason: String(obj.reason || ''),
    };
  } catch {
    return { appointment_booked: false, confidence: 0, reason: 'invalid json' };
  }
}

/** Run with bounded concurrency to stay polite. */
export async function classifyBatch(leads: Lead[], concurrency = 8): Promise<Map<number, Classification>> {
  const results = new Map<number, Classification>();
  const queue = leads.slice();
  let errors = 0;
  let lastError: string | undefined;
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const lead = queue.shift()!;
      try {
        const c = await classifyTranscript(lead.call_transcription || '');
        results.set(lead.lead_id, c);
      } catch (e: any) {
        errors++;
        lastError = e?.message || 'unknown';
        results.set(lead.lead_id, { appointment_booked: false, confidence: 0, reason: `error: ${lastError}` });
      }
    }
  });
  await Promise.all(workers);
  if (errors > 0) console.error(`[classify] ${errors}/${leads.length} transcripts errored. Last error: ${lastError}`);
  return results;
}
