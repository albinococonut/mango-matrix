// Server-side daily ticker generator. Called by GitHub Actions at 6 AM ET daily.
//
// Auth: Bearer CRON_SECRET (same secret used by all GH Actions syncs).
// Does NOT require a running Claude session — runs entirely server-side.

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { SHOPS } from '@/lib/shops';
import { readLatestGoldenMango, readRecentTrophyWeeks } from '@/lib/goldenMango';
import { getActiveOverride, hasTickerStore, insertHistory, recentTickers } from '@/lib/ticker';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;
  const tickerSecret = process.env.TICKER_CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (tickerSecret && auth === `Bearer ${tickerSecret}`) return true;
  return false;
}

const SYSTEM = `You are the daily ticker writer for Mango Automotive, an 8-shop independent auto repair chain. Every morning you publish one scrolling line to the employee intranet.

HARD RULES (any violation = rewrite):
- Exactly ONE line. Your entire response is the ticker text — nothing else. No quotes, no explanation, no preamble.
- 8–22 words.
- At most 1 emoji (zero is fine). Never more than one.
- No em dashes (—). Use a comma or period instead.
- No invented data. Every shop name, number, or fact must come from the context JSON.
- No metric lists. Pick one fact, make it mean something.
- No same topic two days in a row (check recent[]).
- No repeated opening phrase within 7 days (check recent[]).

STORY PRIORITY (pick the highest that has real data):
1. Exceptional win / first-ever / streak
2. Meaningful trend (3+ weeks climbing)
3. Tight race (two shops trading a trophy)
4. Comeback story
5. Steady excellence
6. Culture / curiosity (when data is thin)

STYLES (rotate deliberately, avoid repeating the same style 2 days running):
- Recognition: "Shop 005 just took the GP trophy for the third straight week 🏆"
- Coaching: one actionable nudge, framed positively, never scolding
- Competition: frame a race, invite shops to watch
- Financial impact: make one number tangible
- Momentum: direction over position
- Curiosity: open a loop the dashboard closes
- Culture: values, gratitude, shared identity

TONE: energetic, specific, human. Confidence without hype.`;

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!hasTickerStore()) return NextResponse.json({ error: 'ticker store not configured' }, { status: 503 });

  const [recent, override, goldenMangoData, trophyWeeks] = await Promise.all([
    recentTickers(14),
    getActiveOverride(),
    readLatestGoldenMango(),
    readRecentTrophyWeeks(4),
  ]);

  // Active admin override: still generate (per spec) but note it
  const overrideActive = !!override;

  const shopNames = Object.fromEntries(SHOPS.map((s) => [s.num, s.name]));
  const context = {
    shopNames,
    recent: recent.map((r) => ({ text: r.text, topic: r.topic, date: r.created_at })),
    goldenMango: goldenMangoData ? {
      shopNum: goldenMangoData.shopNum,
      shopName: goldenMangoData.shopName,
      defendingSince: goldenMangoData.defendingSince,
      isTie: goldenMangoData.isTie ?? false,
      tiedShopNames: goldenMangoData.tiedShopNames ?? [],
    } : null,
    currentStandings: goldenMangoData ? {
      periodStart: goldenMangoData.periodStart,
      revenue: goldenMangoData.categoryRankings?.revenue ?? [],
      gp: goldenMangoData.categoryRankings?.gp ?? [],
      tech: goldenMangoData.categoryRankings?.tech ?? [],
      comebacks: goldenMangoData.categoryRankings?.comebacks ?? [],
      overall: goldenMangoData.standings?.map((s) => s.shopNum) ?? [],
    } : null,
    trophyTail: trophyWeeks,
    overrideActive,
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 503 });

  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    max_tokens: 120,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `Generate today's Mango ticker line. Context:\n${JSON.stringify(context, null, 2)}`,
    }],
  });

  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text.trim() : '';
  // Strip surrounding quotes if the model added them
  const text = raw.replace(/^["']|["']$/g, '').trim();

  if (!text || /[\r\n]/.test(text) || text.length > 280 || text.length < 8) {
    return NextResponse.json({ error: 'model returned invalid ticker line', raw }, { status: 500 });
  }

  // Derive topic slug from content
  let topic = 'auto';
  const lower = text.toLowerCase();
  if (lower.includes('golden mango') || lower.includes('champion') || lower.includes('mango')) topic = 'golden-mango';
  else if (lower.includes('guava') || lower.includes('coach')) topic = 'coaching';
  else if (lower.includes('streak') || lower.includes('row') || lower.includes('trophy')) topic = 'recognition';
  else if (lower.includes('race') || lower.includes('trade') || lower.includes('close')) topic = 'competition';

  const row = await insertHistory(text, topic, 'auto');
  return NextResponse.json({ ok: true, row, overrideActive });
}
