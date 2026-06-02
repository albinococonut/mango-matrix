'use client';

// Missed Conversion Callbacks — the queue of inbound calls that didn't book
// but the AI thinks were realistically salvageable.
//
// This component is rendered TWICE on Call Conversion:
//   1. As a top metric strip (mode="chain") — chain-wide rollup tiles
//   2. As an inline queue inside each shop row (mode="shop") — the queue
//
// Mode separation keeps a single fetch shared by both via parent prop drilling,
// but for now the component owns its own fetch with React state cached at
// module scope, so both render sites share the same response.

import { useEffect, useState, useCallback } from 'react';
import { Phone, PlayCircle, ChevronDown, ChevronUp, Check, X, MessageSquare, AlertTriangle, ArrowUpDown } from 'lucide-react';
import { num, usd, usdK } from '@/lib/format';

type Status = 'open' | 'resolved' | 'not_salvageable';

interface CallRow {
  leadId: number;
  dateCreated: string;
  callerName: string;
  callerPhone: string;
  callerCity?: string;
  callerState?: string;
  callDurationSeconds: number;
  recording?: string;
  transcriptPreview: string;
  salesAgent?: string;
  sentimentDetection?: string;
  intentDetection?: string;
  customerType?: string;
  wcSummary?: string;
  probability: number;
  reason: string;
  angle: string;
  estimatedMissedRevenue: number;
  resolution: {
    leadId: number;
    status: Status;
    note?: string;
    resolvedBy?: string;
    resolvedAt?: string;
    attemptCount?: number;
    lastAttemptAt?: string;
    updatedAt: string;
  } | null;
}

export interface MissedCallbacksData {
  shops: Array<{
    shopNum: string;
    shopName: string;
    computedAt: string | null;
    windowStart: string | null;
    windowEnd: string | null;
    calls: CallRow[];
    pending?: true;
  }>;
  chain: {
    totalSalvageable: number;
    estimatedMissedRevenue: number;
    resolvedCount: number;
    revenueRecovered: number;
    avgResponseTimeHours: number | null;
  };
  aroByShop: Record<string, number>;
}

// Module-level cache so two render sites share one fetch.
let _cached: MissedCallbacksData | null = null;
let _error: string | null = null;
let _subscribers: Array<(d: MissedCallbacksData | null) => void> = [];
let _inflight: Promise<void> | null = null;

async function loadOnce(force = false): Promise<void> {
  if (_inflight && !force) return _inflight;
  _inflight = (async () => {
    try {
      const r = await fetch('/api/extras?view=missed-callbacks', { cache: 'no-store' });
      if (!r.ok) {
        _error = `HTTP ${r.status} loading missed callbacks`;
        _subscribers.forEach(fn => fn(null));
        return;
      }
      const d = await r.json();
      if (!d || typeof d !== 'object' || !Array.isArray(d.shops)) {
        _error = `unexpected response shape (no shops array)`;
        _subscribers.forEach(fn => fn(null));
        return;
      }
      _error = null;
      _cached = d;
      _subscribers.forEach(fn => fn(d));
    } catch (e: any) {
      _error = e?.message || 'network error';
      _subscribers.forEach(fn => fn(null));
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

function useMissedCallbacks(): { data: MissedCallbacksData | null; error: string | null; refresh: () => Promise<void> } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(x => x + 1);
    _subscribers.push(fn);
    if (!_cached && !_error) loadOnce();
    else force(x => x + 1);
    return () => { _subscribers = _subscribers.filter(s => s !== fn); };
  }, []);
  return { data: _cached, error: _error, refresh: () => { _error = null; return loadOnce(true); } };
}

// ---------- Chain summary strip (mode = "chain") ----------

export function MissedCallbacksChainStrip() {
  const { data } = useMissedCallbacks();
  if (!data) return null;
  const c = data.chain;
  // If there are 0 salvageable calls AND nothing resolved, skip the strip
  // entirely — no signal to show.
  if (c.totalSalvageable === 0 && c.resolvedCount === 0) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-4 mb-2">
      <SummaryTile label="Missed rev. opportunity this week" value={usdK(c.estimatedMissedRevenue)} tone="red" />
      <SummaryTile label="Total salvageable calls" value={num(c.totalSalvageable)} tone="amber" />
      <SummaryTile label="Callbacks resolved" value={num(c.resolvedCount)} tone="green" />
      <SummaryTile label="Revenue recovered (est.)" value={usdK(c.revenueRecovered)} tone="green" />
      <SummaryTile label="Avg response time" value={c.avgResponseTimeHours == null ? '—' : `${c.avgResponseTimeHours.toFixed(1)}h`} tone="neutral" />
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone: 'red' | 'amber' | 'green' | 'neutral' }) {
  const cls =
    tone === 'red' ? 'bg-mango-red/8 border-mango-red/25 text-mango-red' :
    tone === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-700' :
    tone === 'green' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
    'bg-mango-bg/50 border-mango-line text-mango-ink';
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-80 leading-tight">{label}</div>
      <div className="text-xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}

// ---------- Per-shop queue (mode = "shop") ----------

type SortKey = 'probability' | 'revenue' | 'date';

export function MissedCallbacksShopQueue({ shopNum }: { shopNum: string }) {
  const { data, error, refresh } = useMissedCallbacks();
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [advisorFilter, setAdvisorFilter] = useState<string>('');
  const [unresolvedOnly, setUnresolvedOnly] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const shop = data?.shops.find(s => s.shopNum === shopNum);
  if (error) return <div className="text-xs text-mango-red py-3">Couldn't load missed callbacks: {error}</div>;
  if (!data) return <div className="text-xs text-mango-muted italic py-3">Loading missed callbacks…</div>;
  if (!shop) return null;
  if (shop.pending) return <div className="text-xs text-mango-muted italic py-3">Warming — callback data appears within ~5 min after the first booked-rate refresh.</div>;
  if (shop.calls.length === 0) return <div className="text-xs text-mango-green py-3">No salvageable missed calls this week ✓</div>;

  // Unique advisors for the filter dropdown.
  const advisors = Array.from(new Set(shop.calls.map(c => c.salesAgent).filter(Boolean))) as string[];

  let rows = shop.calls.slice();
  if (advisorFilter) rows = rows.filter(c => c.salesAgent === advisorFilter);
  if (unresolvedOnly) rows = rows.filter(c => !c.resolution || c.resolution.status === 'open');
  if (sortKey === 'probability') rows.sort((a, b) => b.probability - a.probability);
  else if (sortKey === 'revenue') rows.sort((a, b) => b.estimatedMissedRevenue - a.estimatedMissedRevenue);
  else rows.sort((a, b) => +new Date(b.dateCreated) - +new Date(a.dateCreated));

  return (
    <div className="bg-mango-bg/30 rounded-lg p-3 mt-2 mb-3">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="text-xs text-mango-muted">
          {rows.length} call{rows.length === 1 ? '' : 's'} shown · window {shop.windowStart} → {shop.windowEnd}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <button onClick={() => setUnresolvedOnly(!unresolvedOnly)} className={`px-2 py-1 rounded-md border ${unresolvedOnly ? 'bg-mango-ink text-white border-mango-ink' : 'border-mango-line text-mango-muted'}`}>
            Unresolved only
          </button>
          {advisors.length > 0 && (
            <select value={advisorFilter} onChange={e => setAdvisorFilter(e.target.value)} className="border border-mango-line rounded-md px-2 py-1 bg-white text-mango-ink">
              <option value="">All advisors</option>
              {advisors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} className="border border-mango-line rounded-md px-2 py-1 bg-white text-mango-ink">
            <option value="revenue">Sort: revenue $</option>
            <option value="probability">Sort: probability</option>
            <option value="date">Sort: most recent</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map(row => (
          <CallbackRow key={row.leadId} row={row} expanded={expanded === row.leadId} onToggle={() => setExpanded(expanded === row.leadId ? null : row.leadId)} onChange={refresh} />
        ))}
      </div>
    </div>
  );
}

function urgencyClass(row: CallRow): string {
  // Today's high-probability + high-revenue calls stand out.
  const isToday = row.dateCreated.slice(0, 10) === new Date().toISOString().slice(0, 10);
  const high = row.probability >= 0.65 && row.estimatedMissedRevenue >= 200;
  if (isToday && high) return 'border-mango-red bg-mango-red/8 ring-1 ring-mango-red/40';
  if (high) return 'border-orange-300 bg-orange-50/50';
  if (row.resolution?.status === 'resolved') return 'border-mango-line bg-emerald-50/40 opacity-70';
  if (row.resolution?.status === 'not_salvageable') return 'border-mango-line bg-mango-bg opacity-50';
  return 'border-mango-line bg-white';
}

function probabilityTone(p: number): { bg: string; color: string; label: string } {
  if (p >= 0.65) return { bg: '#FDE2E2', color: '#8B1F1F', label: 'High' };
  if (p >= 0.45) return { bg: '#FFE9B8', color: '#7A5300', label: 'Medium-high' };
  return { bg: '#F2EFE7', color: '#6B7280', label: 'Medium' };
}

function CallbackRow({ row, expanded, onToggle, onChange }: { row: CallRow; expanded: boolean; onToggle: () => void; onChange: () => Promise<void> }) {
  const ptone = probabilityTone(row.probability);
  const status = row.resolution?.status ?? 'open';
  const [busy, setBusy] = useState<string | null>(null);

  const post = useCallback(async (action: string, extra: Record<string, any> = {}) => {
    setBusy(action);
    try {
      await fetch(`/api/callback/${row.leadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      await onChange();
    } finally {
      setBusy(null);
    }
  }, [row.leadId, onChange]);

  // Defensive: WhatConverts always returns this as a string, but the FBR
  // missed-rebooks code had a crash from a numeric phone returned by
  // Tekmetric. Coerce here too so a future shape drift doesn't blow up
  // the entire Call Conversion section.
  const callerPhoneStr = row.callerPhone == null ? '' : String(row.callerPhone);
  const telHref = callerPhoneStr ? `tel:${callerPhoneStr.replace(/[^0-9+]/g, '')}` : undefined;

  return (
    <div className={`rounded-lg border p-3 ${urgencyClass(row)}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-mango-ink">{row.callerName || 'Unknown caller'}</span>
            {callerPhoneStr && <span className="text-xs text-mango-muted tabular-nums">{callerPhoneStr}</span>}
            {row.salesAgent && <span className="text-[10px] uppercase tracking-wide text-mango-muted bg-mango-bg/50 px-1.5 py-0.5 rounded">{row.salesAgent}</span>}
            <span className="inline-block text-[10px] font-semibold uppercase rounded-full px-2 py-0.5" style={{ background: ptone.bg, color: ptone.color }}>
              {ptone.label} · {(row.probability * 100).toFixed(0)}%
            </span>
            {status === 'resolved' && <span className="inline-block text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700">Resolved</span>}
            {status === 'not_salvageable' && <span className="inline-block text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 bg-mango-bg text-mango-muted">Dismissed</span>}
          </div>
          <div className="text-xs text-mango-ink/80 mt-1">{row.reason || '—'}</div>
          {row.angle && <div className="text-xs text-mango-ink/70 mt-0.5 italic"><span className="font-medium not-italic">Suggested angle:</span> {row.angle}</div>}
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-mango-muted">
            <span className="tabular-nums">{new Date(row.dateCreated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            <span>·</span>
            <span>{Math.round(row.callDurationSeconds / 60)}m call</span>
            {row.callerCity && <><span>·</span><span>{row.callerCity}, {row.callerState}</span></>}
            {row.resolution?.attemptCount ? <><span>·</span><span>{row.resolution.attemptCount} callback attempt{row.resolution.attemptCount === 1 ? '' : 's'}</span></> : null}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase text-mango-muted leading-none">est. missed revenue</div>
          <div className="text-lg font-bold text-mango-red tabular-nums">{row.estimatedMissedRevenue > 0 ? usd(Math.round(row.estimatedMissedRevenue)) : '—'}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mt-3">
        {telHref ? (
          <a href={telHref} onClick={() => post('log_attempt')} className="inline-flex items-center gap-1.5 bg-mango-orange text-white text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-mango-orange/90">
            <Phone className="w-3.5 h-3.5" /> Call Back Now
          </a>
        ) : (
          <button disabled className="inline-flex items-center gap-1.5 bg-mango-bg text-mango-muted text-xs font-semibold px-3 py-1.5 rounded-md cursor-not-allowed">
            <Phone className="w-3.5 h-3.5" /> No phone number
          </button>
        )}
        {status !== 'resolved' && (
          <button disabled={busy !== null} onClick={() => post('resolve')} className="inline-flex items-center gap-1.5 border border-emerald-300 text-emerald-700 text-xs font-medium px-2.5 py-1.5 rounded-md hover:bg-emerald-50 disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> Mark resolved
          </button>
        )}
        {status !== 'not_salvageable' && (
          <button disabled={busy !== null} onClick={() => post('not_salvageable')} className="inline-flex items-center gap-1.5 border border-mango-line text-mango-muted text-xs font-medium px-2.5 py-1.5 rounded-md hover:bg-mango-bg disabled:opacity-50">
            <X className="w-3.5 h-3.5" /> Not salvageable
          </button>
        )}
        {status !== 'open' && (
          <button disabled={busy !== null} onClick={() => post('reopen')} className="text-xs text-mango-muted hover:text-mango-ink underline">
            Reopen
          </button>
        )}
        <button onClick={onToggle} className="ml-auto inline-flex items-center gap-1 text-xs text-mango-muted hover:text-mango-ink">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-mango-line/60 space-y-3">
          {row.recording && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-mango-muted font-semibold mb-1.5 flex items-center gap-1.5">
                <PlayCircle className="w-3.5 h-3.5" /> Call recording
              </div>
              <audio controls preload="none" src={row.recording} className="w-full max-w-md" />
            </div>
          )}
          {row.wcSummary && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-mango-muted font-semibold mb-1">WhatConverts summary</div>
              <div className="text-xs text-mango-ink/85">{row.wcSummary}</div>
            </div>
          )}
          {row.transcriptPreview && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-mango-muted font-semibold mb-1 flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> Transcript
              </div>
              <div className="text-xs text-mango-ink/85 whitespace-pre-wrap font-mono bg-white border border-mango-line/60 rounded p-2 max-h-64 overflow-y-auto">{row.transcriptPreview}</div>
            </div>
          )}
          {row.resolution?.note && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-mango-muted font-semibold mb-1">Note</div>
              <div className="text-xs text-mango-ink/85">{row.resolution.note}</div>
            </div>
          )}
          <NoteEditor leadId={row.leadId} initialNote={row.resolution?.note} onSave={onChange} />
        </div>
      )}
    </div>
  );
}

function NoteEditor({ leadId, initialNote, onSave }: { leadId: number; initialNote?: string; onSave: () => Promise<void> }) {
  const [note, setNote] = useState(initialNote ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = note !== (initialNote ?? '');
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-mango-muted font-semibold mb-1">Add / update note</div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={2}
        placeholder="e.g. Left voicemail Tuesday 10am; will retry Wednesday morning."
        className="w-full text-xs border border-mango-line/60 rounded p-2 resize-y"
      />
      <div className="flex items-center justify-end mt-1">
        <button
          disabled={!dirty || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await fetch(`/api/callback/${leadId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'note', note }),
              });
              await onSave();
            } finally {
              setBusy(false);
            }
          }}
          className="text-xs bg-mango-ink text-white px-3 py-1 rounded-md disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </div>
  );
}
