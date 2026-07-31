'use client';

// Sales Effectiveness — grades outbound "inspection results" calls where the
// advisor walks the customer through the ticket and asks for authorization.
// Shows per-shop average scores, a "Needs Guava" coaching queue of calls that
// scored below 3/5, and a "Mark handled" action per call.

import { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, Star, TrendingUp } from 'lucide-react';
import { TrophyIcon } from './Trophy';

interface OmittedItem { name: string; severity: string; amount: string }
interface DimScores { openingRapport?: number | null; ticketCompleteness?: number | null; prioritization?: number | null; explanationPerItem?: number | null; warrantyPitch?: number | null; totalPresentation?: number | null; objectionHandling?: number | null; authorizationAsk?: number | null; personalization?: number | null }

interface Grade {
  callId: string;
  startTime: string;
  durationSeconds: number;
  customerPhone: string;
  roNumber: number | null;
  overallGrade: string;
  overallScore: number;
  summary: string;
  ticketCoverage: { totalItems: number; mentionedItems: number; omittedItems: OmittedItem[] };
  dimensionScores: DimScores;
  improvements: string[];
  strongestMoment: string;
  weakestMoment: string;
  needsCoaching: boolean;
  handled?: boolean;
}

interface ShopData {
  shopNum: string;
  shopName: string;
  cached: boolean;
  computedAt: string | null;
  avgScore: number;
  totalGraded: number;
  needsCoachingCount: number;
  grades: Grade[];
}

interface Snap {
  shops: ShopData[];
  chain: { avgScore: number; totalGraded: number };
}

const SCORE_COLOR = (s: number) => {
  if (s >= 4) return '#5BAA59';
  if (s >= 3) return '#A8CE5A';
  if (s >= 2) return '#F5E580';
  if (s >= 1) return '#F4B65C';
  return '#C9412A';
};

const DIM_LABELS: Record<string, string> = {
  openingRapport: 'A. Opening',
  ticketCompleteness: 'B. Ticket completeness',
  prioritization: 'C. Prioritization',
  explanationPerItem: 'D. Explanation',
  warrantyPitch: 'E. Warranty pitch',
  totalPresentation: 'F. Total presented',
  objectionHandling: 'G. Objections',
  authorizationAsk: 'H. Authorization ask',
  personalization: 'I. Personalization',
};

function ScoreBar({ score, max = 5 }: { score: number; max?: number }) {
  const pct = Math.round((score / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-mango-line overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: SCORE_COLOR(score) }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums w-6 text-right" style={{ color: SCORE_COLOR(score) }}>{score.toFixed(1)}</span>
    </div>
  );
}

function CallCard({ grade, shopNum, onHandled }: { grade: Grade; shopNum: string; onHandled: (callId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);

  const date = new Date(grade.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Denver' });
  const mins = Math.floor(grade.durationSeconds / 60);
  const secs = grade.durationSeconds % 60;
  const dur = `${mins}:${String(secs).padStart(2, '0')}`;

  const handleMark = async () => {
    setMarking(true);
    try {
      await fetch('/api/extras?view=sales-effectiveness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopNum, callId: grade.callId }),
      });
      onHandled(grade.callId);
    } catch { /* swallow */ } finally { setMarking(false); }
  };

  return (
    <div className="border border-mango-line rounded-xl mb-2 overflow-hidden" style={{ opacity: grade.handled ? 0.5 : 1 }}>
      <button className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-mango-bg/50 transition" onClick={() => setOpen(o => !o)}>
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-[12px] font-bold text-white flex-shrink-0"
          style={{ background: SCORE_COLOR(grade.overallScore) }}>{grade.overallGrade}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12.5px] font-semibold">{date} · {dur}</span>
            {grade.roNumber && <span className="text-[11px] text-mango-muted">RO #{grade.roNumber}</span>}
            {grade.ticketCoverage.omittedItems.length > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: '#FEE2E2', color: '#DC2626' }}>
                {grade.ticketCoverage.omittedItems.length} items skipped
              </span>
            )}
            {grade.handled && <span className="text-[10px] text-mango-muted italic">handled</span>}
          </div>
          <p className="text-[11px] text-mango-muted mt-0.5 line-clamp-1">{grade.summary}</p>
        </div>
        <ScoreBar score={grade.overallScore} />
        {open ? <ChevronUp className="w-3.5 h-3.5 text-mango-muted flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-mango-muted flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-mango-line bg-mango-bg/40 space-y-3">
          <p className="text-[12px] mt-3 text-mango-ink">{grade.summary}</p>

          {grade.ticketCoverage.omittedItems.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-mango-muted mb-1">Items skipped on call</div>
              <div className="space-y-0.5">
                {grade.ticketCoverage.omittedItems.map((it, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: it.severity === 'safety-critical' ? '#DC2626' : '#F4B65C' }} />
                    <span className="font-medium">{it.name}</span>
                    {it.amount && it.amount !== 'unknown' && <span className="text-mango-muted">{it.amount}</span>}
                    {it.severity === 'safety-critical' && <span className="text-[10px] font-bold text-red-600">SAFETY</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(grade.dimensionScores).filter(([, v]) => v != null).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-1">
                <span className="text-[10.5px] text-mango-muted truncate">{DIM_LABELS[k] ?? k}</span>
                <span className="text-[10.5px] font-bold tabular-nums" style={{ color: SCORE_COLOR(v as number) }}>{(v as number).toFixed(0)}/5</span>
              </div>
            ))}
          </div>

          {grade.improvements.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-mango-muted mb-1">Coaching points</div>
              <ol className="space-y-0.5 list-decimal list-inside">
                {grade.improvements.map((imp, i) => <li key={i} className="text-[11.5px] text-mango-ink">{imp}</li>)}
              </ol>
            </div>
          )}

          {grade.weakestMoment && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-mango-muted mb-1">Weakest moment</div>
              <p className="text-[11.5px] italic text-mango-ink bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">{grade.weakestMoment}</p>
            </div>
          )}

          {!grade.handled && (
            <button onClick={handleMark} disabled={marking}
              className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg border border-mango-line hover:bg-mango-bg transition disabled:opacity-50">
              {marking ? 'Saving…' : '✓ Mark as handled'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SalesEffectiveness() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [expandedShop, setExpandedShop] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    fetch('/api/extras?view=sales-effectiveness')
      .then(r => r.json())
      .then(d => { if (!cancelled) setSnap(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleHandled = useCallback((shopNum: string, callId: string) => {
    setSnap(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        shops: prev.shops.map(s => s.shopNum !== shopNum ? s : {
          ...s,
          grades: s.grades.map(g => g.callId === callId ? { ...g, handled: true } : g),
          needsCoachingCount: Math.max(0, s.needsCoachingCount - 1),
        }),
      };
    });
  }, []);

  if (!snap) return <div className="card animate-pulse h-[300px] mb-6" />;

  const sorted = [...snap.shops].sort((a, b) => b.avgScore - a.avgScore);
  const leader = sorted[0]?.avgScore ?? 0;
  const warming = snap.chain.totalGraded === 0;

  return (
    <div className="rounded-2xl border border-mango-line bg-white p-5 mb-6">
      <div className="flex items-start gap-3 mb-4">
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
          style={{ background: 'rgba(251,191,36,0.12)', boxShadow: 'inset 0 0 0 1px rgba(251,191,36,0.28)' }}>
          <TrendingUp className="w-[18px] h-[18px]" style={{ color: '#D97706' }} />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Sales Effectiveness — Rolling 7 Days</h2>
          <p className="text-[12.5px] text-mango-muted mt-0.5">
            Outbound inspection-result calls graded by AI on 9 dimensions: ticket completeness, warranty pitch, authorization ask, and more.
            Counts toward the weekly trophy. Calls scoring below 3/5 appear in the Needs Guava coaching queue below.
          </p>
        </div>
      </div>

      {warming ? (
        <div className="text-center py-8 text-mango-muted text-sm">
          Warming up — Sales Effectiveness grades will populate on the next cron tick.
        </div>
      ) : (
        <>
          {/* Chain summary */}
          <div className="flex items-center gap-6 mb-4 text-[13px]">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-mango-muted">Chain avg score</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: SCORE_COLOR(snap.chain.avgScore) }}>
                {snap.chain.avgScore.toFixed(1)}<span className="text-base font-normal text-mango-muted">/5</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-mango-muted">Calls graded</div>
              <div className="text-2xl font-bold tabular-nums text-mango-ink">{snap.chain.totalGraded}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-mango-muted">Need coaching</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: '#DC2626' }}>
                {snap.shops.reduce((s, r) => s + (r.grades.filter(g => g.needsCoaching && !g.handled).length), 0)}
              </div>
            </div>
          </div>

          {/* Per-shop rows */}
          <div className="space-y-1 mb-6">
            {sorted.map((shop, i) => {
              const rank = i + 1;
              const isExpanded = expandedShop === shop.shopNum;
              const coaching = shop.grades.filter(g => g.needsCoaching && !g.handled);
              const visibleGrades = showAll[shop.shopNum] ? coaching : coaching.slice(0, 3);

              return (
                <div key={shop.shopNum}>
                  <button
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-mango-bg/60 transition text-left"
                    onClick={() => setExpandedShop(isExpanded ? null : shop.shopNum)}
                  >
                    <TrophyIcon rank={rank as 1 | 2 | 3} size={16} />
                    <span className="w-32 text-[13px] font-semibold truncate">{shop.shopName}</span>
                    <div className="flex-1">
                      <ScoreBar score={shop.avgScore} />
                    </div>
                    <span className="text-[11px] text-mango-muted w-24 text-right tabular-nums">
                      {shop.totalGraded} call{shop.totalGraded !== 1 ? 's' : ''}
                    </span>
                    {coaching.length > 0 && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: '#FEF3C7', color: '#92400E' }}>
                        {coaching.length} Needs Guava
                      </span>
                    )}
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-mango-muted flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-mango-muted flex-shrink-0" />}
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-2 pt-1">
                      {coaching.length === 0 ? (
                        <p className="text-[12px] text-mango-muted py-2">No calls needing coaching this week.</p>
                      ) : (
                        <>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-mango-muted mb-2 flex items-center gap-1.5">
                            <span style={{ color: '#92400E' }}>🥭 Needs Guava</span>
                            <span className="font-normal text-mango-faint">— calls scoring below 3/5</span>
                          </div>
                          {visibleGrades.map(g => (
                            <CallCard key={g.callId} grade={g} shopNum={shop.shopNum}
                              onHandled={(callId) => handleHandled(shop.shopNum, callId)} />
                          ))}
                          {coaching.length > 3 && (
                            <button className="text-[11.5px] text-mango-muted hover:text-mango-ink mt-1 transition"
                              onClick={() => setShowAll(p => ({ ...p, [shop.shopNum]: !p[shop.shopNum] }))}>
                              {showAll[shop.shopNum] ? 'Show fewer' : `Show ${coaching.length - 3} more`}
                            </button>
                          )}
                        </>
                      )}

                      {/* All graded calls for this shop */}
                      {shop.grades.filter(g => !g.needsCoaching).length > 0 && (
                        <details className="mt-3">
                          <summary className="text-[11px] text-mango-muted cursor-pointer hover:text-mango-ink">
                            {shop.grades.filter(g => !g.needsCoaching).length} passing calls (score ≥ 3)
                          </summary>
                          <div className="mt-2">
                            {shop.grades.filter(g => !g.needsCoaching).map(g => (
                              <CallCard key={g.callId} grade={g} shopNum={shop.shopNum}
                                onHandled={(callId) => handleHandled(shop.shopNum, callId)} />
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
