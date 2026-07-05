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
import { Phone, PlayCircle, Check, X, MessageSquare, AlertTriangle, ArrowUpDown } from 'lucide-react';
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
  playRecording?: string;
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

// Design tokens — match Concept2TodoSection exactly
const INK = '#221F1A';
const INK2 = '#5C5852';
const FAINT = '#938C81';
const LINE = 'rgba(34,32,28,0.10)';
const LINE_STRONG = 'rgba(34,32,28,0.08)';

function cardStyle(row: CallRow): { background: string; border: string; opacity?: number } {
  const probHigh = row.probability >= 0.65;
  const probMid = row.probability >= 0.45;
  const done = row.resolution?.status === 'resolved' || row.resolution?.status === 'not_salvageable';
  return {
    background: probHigh ? 'rgba(192,90,46,0.07)' : probMid ? 'rgba(176,120,32,0.06)' : 'rgba(255,255,255,0.60)',
    border: probHigh ? '1px solid rgba(192,90,46,0.22)' : probMid ? '1px solid rgba(176,120,32,0.18)' : `1px solid ${LINE}`,
    ...(done ? { opacity: 0.45 } : {}),
  };
}

function probBadge(p: number): { bg: string; color: string; label: string } {
  if (p >= 0.65) return { bg: 'rgba(192,90,46,0.13)', color: '#8E3F22', label: 'High' };
  if (p >= 0.45) return { bg: 'rgba(176,120,32,0.12)', color: '#7A5300', label: 'Med-high' };
  return { bg: 'rgba(34,32,28,0.07)', color: INK2, label: 'Medium' };
}

// ---------- Chain summary strip (mode = "chain") ----------

export function MissedCallbacksChainStrip() {
  const { data } = useMissedCallbacks();
  if (!data) return null;
  const c = data.chain;
  if (c.totalSalvageable === 0 && c.resolvedCount === 0) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-4 mb-2">
      <SummaryTile label="Missed rev. opportunity" value={usdK(c.estimatedMissedRevenue)} bg="rgba(192,90,46,0.07)" border="rgba(192,90,46,0.22)" valColor="#8E3F22" />
      <SummaryTile label="Salvageable calls" value={num(c.totalSalvageable)} bg="rgba(176,120,32,0.06)" border="rgba(176,120,32,0.18)" valColor="#7A5300" />
      <SummaryTile label="Callbacks resolved" value={num(c.resolvedCount)} bg="rgba(62,142,94,0.07)" border="rgba(62,142,94,0.22)" valColor="#2F6E3A" />
      <SummaryTile label="Revenue recovered (est.)" value={usdK(c.revenueRecovered)} bg="rgba(62,142,94,0.07)" border="rgba(62,142,94,0.22)" valColor="#2F6E3A" />
      <SummaryTile label="Avg response time" value={c.avgResponseTimeHours == null ? '—' : `${c.avgResponseTimeHours.toFixed(1)}h`} bg="rgba(255,255,255,0.60)" border={LINE} valColor={INK2} />
    </div>
  );
}

function SummaryTile({ label, value, bg, border, valColor }: { label: string; value: string; bg: string; border: string; valColor: string }) {
  return (
    <div className="rounded-2xl p-3" style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="c2ui text-[10.5px] uppercase tracking-[0.12em] leading-tight" style={{ color: FAINT }}>{label}</div>
      <div className="c2disp tabular-nums font-semibold mt-1" style={{ color: valColor, fontSize: 20 }}>{value}</div>
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
  if (error) return <div className="c2ui text-[12px] py-3" style={{ color: '#8E3F22' }}>Couldn't load missed callbacks: {error}</div>;
  if (!data) return <div className="c2ui text-[12px] italic py-3" style={{ color: FAINT }}>Loading missed callbacks…</div>;
  if (!shop) return null;
  if (shop.pending) return <div className="c2ui text-[12px] italic py-3" style={{ color: FAINT }}>Warming — callback data appears within ~5 min after the first booked-rate refresh.</div>;
  if (shop.calls.length === 0) return <div className="c2ui text-[12px] py-3" style={{ color: '#2F6E3A' }}>No salvageable missed calls this week ✓</div>;

  const advisors = Array.from(new Set(shop.calls.map(c => c.salesAgent).filter(Boolean))) as string[];

  let rows = shop.calls.slice();
  if (advisorFilter) rows = rows.filter(c => c.salesAgent === advisorFilter);
  if (unresolvedOnly) rows = rows.filter(c => !c.resolution || c.resolution.status === 'open');
  if (sortKey === 'probability') rows.sort((a, b) => b.probability - a.probability);
  else if (sortKey === 'revenue') rows.sort((a, b) => b.estimatedMissedRevenue - a.estimatedMissedRevenue);
  else rows.sort((a, b) => +new Date(b.dateCreated) - +new Date(a.dateCreated));

  const ctrlStyle = { background: 'rgba(255,255,255,0.65)', border: `1px solid ${LINE}`, color: INK2 };

  return (
    <div className="mt-2 mb-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="c2ui text-[11px]" style={{ color: FAINT }}>
          {rows.length} call{rows.length === 1 ? '' : 's'} · {shop.windowStart} → {shop.windowEnd}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setUnresolvedOnly(!unresolvedOnly)}
            className="c2ui text-[11.5px] font-semibold px-3 py-1.5 rounded-full"
            style={unresolvedOnly ? { background: INK, color: 'white', border: `1px solid ${INK}` } : ctrlStyle}
          >
            Unresolved only
          </button>
          {advisors.length > 0 && (
            <select value={advisorFilter} onChange={e => setAdvisorFilter(e.target.value)}
              className="c2ui text-[11.5px] px-3 py-1.5 rounded-full"
              style={ctrlStyle}>
              <option value="">All advisors</option>
              {advisors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
            className="c2ui text-[11.5px] px-3 py-1.5 rounded-full"
            style={ctrlStyle}>
            <option value="revenue">Sort: revenue $</option>
            <option value="probability">Sort: probability</option>
            <option value="date">Sort: most recent</option>
          </select>
        </div>
      </div>

      {rows.map(row => (
        <CallbackRow key={row.leadId} row={row} shopNum={shopNum} onChange={refresh} />
      ))}
    </div>
  );
}

function CallbackRow({ row, shopNum, onChange }: { row: CallRow; shopNum: string; onChange: () => Promise<void> }) {
  const status = row.resolution?.status ?? 'open';
  const [busy, setBusy] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const badge = probBadge(row.probability);
  // Derive the /play page URL — play_recording is the canonical player URL;
  // fall back to swapping /download → /play on the direct audio URL.
  const callPageUrl = row.playRecording
    || (row.recording ? row.recording.replace(/\/download$/, '/play') : null);

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

  // Defensive coerce — WhatConverts returns string but guard against numeric drift
  const callerPhoneStr = row.callerPhone == null ? '' : String(row.callerPhone);
  const telHref = callerPhoneStr ? `tel:${callerPhoneStr.replace(/[^0-9+]/g, '')}` : undefined;

  return (
    <div className="rounded-2xl p-4" style={cardStyle(row)}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="c2ui font-semibold" style={{ color: INK, fontSize: 14 }}>{row.callerName || 'Unknown caller'}</span>
            {row.salesAgent && (
              <span className="c2ui text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,32,28,0.07)', color: FAINT }}>
                {row.salesAgent}
              </span>
            )}
            <span className="c2ui text-[10px] font-semibold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full" style={{ background: badge.bg, color: badge.color }}>
              {badge.label} · {(row.probability * 100).toFixed(0)}%
            </span>
            {status === 'resolved' && (
              <span className="c2ui text-[10px] font-semibold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full" style={{ background: 'rgba(62,142,94,0.12)', color: '#2F6E3A' }}>Resolved</span>
            )}
            {status === 'not_salvageable' && (
              <span className="c2ui text-[10px] font-semibold uppercase tracking-[0.08em] px-2 py-0.5 rounded-full" style={{ background: 'rgba(34,32,28,0.06)', color: FAINT }}>Dismissed</span>
            )}
          </div>
          {/* Phone */}
          {callerPhoneStr
            ? <div className="c2disp tabular-nums mt-2 leading-none" style={{ color: INK, fontSize: 20, letterSpacing: '-0.01em' }}>{callerPhoneStr}</div>
            : <div className="c2ui text-[13px] mt-2 italic" style={{ color: FAINT }}>no phone on file</div>}
          {/* Reason */}
          {row.reason && <div className="c2ui mt-1.5 text-[12.5px]" style={{ color: INK2 }}>{row.reason}</div>}
          {/* Angle */}
          {row.angle && (
            <div className="c2ui mt-0.5 text-[12px]" style={{ color: FAINT }}>
              <span style={{ color: INK2, fontWeight: 600 }}>Angle:</span>{' '}{row.angle}
            </div>
          )}
        </div>
        {/* Est. lost */}
        {row.estimatedMissedRevenue > 0 && (
          <div className="shrink-0 text-right">
            <div className="c2ui text-[10px] uppercase tracking-[0.12em]" style={{ color: FAINT }}>Est. lost</div>
            <div className="c2disp tabular-nums font-semibold" style={{ color: '#8E3F22', fontSize: 18 }}>{usd(Math.round(row.estimatedMissedRevenue))}</div>
          </div>
        )}
      </div>

      {/* WC summary — always visible when present */}
      {row.wcSummary && (
        <div className="c2ui mt-2 text-[12px] rounded-xl px-3 py-2"
          style={{ background: 'rgba(34,32,28,0.04)', color: INK2, border: `1px solid ${LINE}` }}>
          {row.wcSummary}
        </div>
      )}

      {/* Saved note — always visible when present (hidden while editor is open) */}
      {row.resolution?.note && !showNoteEditor && (
        <div className="c2ui mt-2 text-[12px]" style={{ color: INK2 }}>
          <span className="font-semibold" style={{ color: FAINT }}>Note:</span>{' '}{row.resolution.note}
        </div>
      )}

      {/* Meta row */}
      <div className="c2ui flex items-center gap-2 mt-2 text-[11px]" style={{ color: FAINT }}>
        <span className="tabular-nums">{new Date(row.dateCreated).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
        <span>·</span>
        <span>{Math.round(row.callDurationSeconds / 60)}m call</span>
        {row.callerCity && <><span>·</span><span>{row.callerCity}, {row.callerState}</span></>}
        {row.resolution?.attemptCount ? <><span>·</span><span>{row.resolution.attemptCount} attempt{row.resolution.attemptCount === 1 ? '' : 's'}</span></> : null}
      </div>

      {/* Action row */}
      <div className="mt-3 pt-2.5 flex items-center gap-2 flex-wrap" style={{ borderTop: `1px solid ${LINE_STRONG}` }}>
        {telHref ? (
          <a href={telHref} onClick={() => post('log_attempt')}
            className="c2ui inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(232,134,62,0.92)', color: 'white', border: '1px solid transparent' }}>
            <Phone className="w-3.5 h-3.5" /> Call Back Now
          </a>
        ) : (
          <button disabled className="c2ui inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full"
            style={{ background: 'rgba(34,32,28,0.06)', color: FAINT, border: `1px solid ${LINE}` }}>
            <Phone className="w-3.5 h-3.5" /> No phone
          </button>
        )}
        {status !== 'resolved' && (
          <button disabled={busy !== null} onClick={() => post('resolve')}
            className="c2ui inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-full disabled:opacity-50"
            style={{ background: 'rgba(62,142,94,0.12)', border: '1px solid rgba(62,142,94,0.28)', color: '#2F6E3A' }}>
            <Check className="w-3 h-3" strokeWidth={2.5} /> Resolved
          </button>
        )}
        {status !== 'not_salvageable' && (
          <button disabled={busy !== null} onClick={() => post('not_salvageable')}
            className="c2ui inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-full disabled:opacity-50"
            style={{ background: 'rgba(34,32,28,0.06)', border: `1px solid ${LINE}`, color: FAINT }}>
            <X className="w-3 h-3" /> Not salvageable
          </button>
        )}
        {status !== 'open' && (
          <button disabled={busy !== null} onClick={() => post('reopen')}
            className="c2ui text-[11px] disabled:opacity-50"
            style={{ color: FAINT, textDecoration: 'underline' }}>
            Reopen
          </button>
        )}

        {/* Media + note — right side */}
        <div className="ml-auto flex items-center gap-1.5">
          {callPageUrl && (
            <a href={callPageUrl} target="_blank" rel="noreferrer"
              className="c2ui inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.65)', border: `1px solid ${LINE}`, color: INK2 }}>
              <PlayCircle className="w-3 h-3" /> Recording ↗
            </a>
          )}
          {row.transcriptPreview && (
            <button onClick={() => setShowTranscript(v => !v)}
              className="c2ui inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-full"
              style={showTranscript
                ? { background: 'rgba(232,134,62,0.12)', border: '1px solid rgba(232,134,62,0.35)', color: '#B5631F' }
                : { background: 'rgba(255,255,255,0.65)', border: `1px solid ${LINE}`, color: INK2 }}>
              <MessageSquare className="w-3 h-3" /> Transcript
            </button>
          )}
          <button onClick={() => setShowNoteEditor(v => !v)}
            className="c2ui inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-full"
            style={showNoteEditor
              ? { background: 'rgba(232,134,62,0.12)', border: '1px solid rgba(232,134,62,0.35)', color: '#B5631F' }
              : { background: 'rgba(255,255,255,0.65)', border: `1px solid ${LINE}`, color: INK2 }}>
            Note
          </button>
        </div>
      </div>

      {/* Transcript inline */}
      {showTranscript && row.transcriptPreview && (
        <div className="c2ui mt-2 text-[12px] whitespace-pre-wrap rounded-xl p-3 max-h-48 overflow-y-auto"
          style={{ background: 'rgba(255,255,255,0.55)', color: INK2, border: `1px solid ${LINE}`, lineHeight: 1.6 }}>
          {row.transcriptPreview}
        </div>
      )}

      {/* Note editor */}
      {showNoteEditor && (
        <div className="mt-2">
          <NoteEditor leadId={row.leadId} initialNote={row.resolution?.note}
            onSave={() => { setShowNoteEditor(false); return onChange(); }} />
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
      <div className="c2ui text-[10.5px] uppercase tracking-[0.12em] mb-1" style={{ color: FAINT }}>Add / update note</div>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        rows={2}
        placeholder="e.g. Left voicemail Tuesday 10am; will retry Wednesday morning."
        className="c2ui w-full text-[12px] rounded-xl p-3 resize-y"
        style={{ background: 'rgba(255,255,255,0.65)', border: `1px solid ${LINE}`, color: INK, outline: 'none' }}
      />
      <div className="flex items-center justify-end mt-2">
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
          className="c2ui text-[12px] font-semibold px-4 py-1.5 rounded-full disabled:opacity-40"
          style={{ background: INK, color: 'white', border: `1px solid ${INK}` }}
        >
          {busy ? 'Saving…' : 'Save note'}
        </button>
      </div>
    </div>
  );
}
