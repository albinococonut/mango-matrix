'use client';

import { useEffect, useState, useCallback } from 'react';
import { Phone, PhoneIncoming, PhoneOutgoing, Check, ChevronDown, ChevronUp, PlayCircle, Search, X } from 'lucide-react';
import { SHOPS, SHOP_BY_NUM } from '@/lib/shops';

interface CallEntry {
  callId: string;
  direction: 'Inbound' | 'Outbound';
  startTime: string;
  durationSeconds: number;
  customerPhone: string;
  customerName: string;
  extensionNumber?: string;
  hasRecording: boolean;
  transcript: string;
  handled?: boolean;
  note?: string;
}

interface ShopData {
  shopNum: string;
  shopName: string;
  cached: boolean;
  computedAt: string | null;
  entries: CallEntry[];
}

const SHOP_SS_KEY = 'callRecShop:v1';
const TAB_SS_KEY  = 'callRecTab:v1';
type Tab = 'inbound' | 'outbound';

function fmtDur(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver',
    });
  } catch { return iso.slice(0, 16); }
}

function thisWeekStart() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow).getTime();
}

function CallRow({ entry, shopNum, onHandled }: { entry: CallEntry; shopNum: string; onHandled: (callId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [marking, setMarking] = useState(false);
  const [note, setNote] = useState(entry.note ?? '');
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const handleMark = async () => {
    setMarking(true);
    try {
      await fetch('/api/extras?view=call-recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopNum, callId: entry.callId }),
      });
      onHandled(entry.callId);
    } catch { /* swallow */ } finally { setMarking(false); }
  };

  const handleSaveNote = async () => {
    setSavingNote(true);
    try {
      await fetch('/api/extras?view=call-recordings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopNum, callId: entry.callId, note }),
      });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch { /* swallow */ } finally { setSavingNote(false); }
  };

  const noteDirty = note !== (entry.note ?? '');
  const audioSrc = entry.hasRecording
    ? `/api/recording?rcId=${encodeURIComponent(entry.callId)}&shop=${shopNum}`
    : null;

  return (
    <div
      className="border rounded-xl mb-2 overflow-hidden transition-opacity"
      style={{ borderColor: 'rgba(34,32,28,0.10)', opacity: entry.handled ? 0.5 : 1 }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        style={{ background: 'rgba(255,255,255,0.55)' }}
        onClick={() => setOpen(o => !o)}
      >
        <span
          className="text-[11px] font-semibold rounded-full px-2 py-0.5 shrink-0 c2ui"
          style={{
            background: entry.direction === 'Inbound' ? 'rgba(91,170,89,0.15)' : 'rgba(232,134,62,0.15)',
            color: entry.direction === 'Inbound' ? '#3E7A3C' : '#9A4B1A',
          }}
        >
          {entry.direction === 'Inbound' ? '↓ In' : '↑ Out'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="c2ui text-[13px] font-semibold truncate" style={{ color: '#221F1A' }}>
            {entry.customerName || entry.customerPhone}
          </div>
          <div className="c2ui text-[11.5px]" style={{ color: 'rgba(34,32,28,0.55)' }}>
            {fmtTime(entry.startTime)} · {fmtDur(entry.durationSeconds)}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {entry.hasRecording && <PlayCircle size={14} style={{ color: 'rgba(34,32,28,0.40)' }} />}
          {entry.handled && <Check size={14} style={{ color: '#3E8E5E' }} />}
          {open
            ? <ChevronUp size={15} style={{ color: 'rgba(34,32,28,0.40)' }} />
            : <ChevronDown size={15} style={{ color: 'rgba(34,32,28,0.40)' }} />}
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 pt-3" style={{ borderTop: '1px solid rgba(34,32,28,0.08)', background: 'rgba(255,255,255,0.35)' }}>
          <div className="c2ui text-[12px]" style={{ color: 'rgba(34,32,28,0.55)' }}>
            <span className="font-medium">Phone:</span> {entry.customerPhone}
            {entry.extensionNumber && <span className="ml-2 text-[11px]">(ext {entry.extensionNumber})</span>}
          </div>

          {audioSrc && (
            <div>
              <div className="c2ui text-[11px] font-semibold uppercase tracking-[0.14em] mb-1.5" style={{ color: 'rgba(34,32,28,0.45)' }}>Recording</div>
              <audio controls src={audioSrc} className="w-full" style={{ height: 36, borderRadius: 10 }} preload="none" />
            </div>
          )}

          {entry.transcript && (
            <div>
              <button
                onClick={() => setShowTranscript(t => !t)}
                className="c2ui text-[12px] font-semibold transition"
                style={{ color: 'rgba(34,32,28,0.55)' }}
              >
                {showTranscript ? '▲ Hide transcript' : '▼ Show transcript'}
              </button>
              {showTranscript && (
                <div
                  className="mt-2 c2ui text-[11.5px] whitespace-pre-wrap rounded-xl p-3 max-h-64 overflow-y-auto"
                  style={{ background: 'rgba(34,32,28,0.04)', border: '1px solid rgba(34,32,28,0.08)', color: '#3C3830' }}
                >
                  {entry.transcript}
                </div>
              )}
            </div>
          )}

          <div>
            <div className="c2ui text-[11px] font-semibold uppercase tracking-[0.14em] mb-1.5" style={{ color: 'rgba(34,32,28,0.45)' }}>Notes</div>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              placeholder="Add a note about this call…"
              className="c2ui w-full text-[12.5px] rounded-xl px-3 py-2 resize-none outline-none"
              style={{
                background: 'rgba(255,255,255,0.70)',
                border: '1px solid rgba(34,32,28,0.12)',
                color: '#221F1A',
              }}
            />
            {noteDirty && (
              <button
                onClick={handleSaveNote}
                disabled={savingNote}
                className="c2ui mt-1.5 text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition disabled:opacity-50"
                style={{ background: 'rgba(34,32,28,0.07)', color: '#221F1A', boxShadow: 'inset 0 0 0 1px rgba(34,32,28,0.10)' }}
              >
                {savingNote ? 'Saving…' : noteSaved ? '✓ Saved' : 'Save note'}
              </button>
            )}
          </div>

          {!entry.handled && (
            <button
              onClick={handleMark}
              disabled={marking}
              className="c2ui text-[12px] font-semibold px-3.5 py-1.5 rounded-full transition disabled:opacity-50"
              style={{ background: 'rgba(34,32,28,0.07)', color: '#221F1A', boxShadow: 'inset 0 0 0 1px rgba(34,32,28,0.10)' }}
            >
              {marking ? 'Saving…' : '✓ Mark as handled'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function CallRecordingsSection() {
  const [shops, setShops] = useState<ShopData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeShop, setActiveShop] = useState<string>(() =>
    (typeof window !== 'undefined' ? sessionStorage.getItem(SHOP_SS_KEY) : null) ?? SHOPS[0]?.num ?? ''
  );
  const [activeTab, setActiveTab] = useState<Tab>(() =>
    ((typeof window !== 'undefined' ? sessionStorage.getItem(TAB_SS_KEY) : null) ?? 'inbound') as Tab
  );
  const [search, setSearch] = useState('');

  useEffect(() => { sessionStorage.setItem(SHOP_SS_KEY, activeShop); }, [activeShop]);
  useEffect(() => { sessionStorage.setItem(TAB_SS_KEY, activeTab); }, [activeTab]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/extras?view=call-recordings', { cache: 'no-store' });
      if (!r.ok) { setError(`HTTP ${r.status}`); return; }
      const d = await r.json();
      setShops(d.shops ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markHandled = useCallback((callId: string) => {
    setShops(prev => prev.map(s => ({
      ...s,
      entries: s.entries.map(e => e.callId === callId ? { ...e, handled: true } : e),
    })));
  }, []);

  const weekStart = thisWeekStart();
  const current = shops.find(s => s.shopNum === activeShop);
  const allEntries = current?.entries ?? [];

  const q = search.trim().toLowerCase();
  const tabEntries = allEntries.filter(e => {
    if (activeTab === 'inbound' ? e.direction !== 'Inbound' : e.direction !== 'Outbound') return false;
    if (!q) return true;
    return (
      e.customerName.toLowerCase().includes(q) ||
      e.customerPhone.replace(/\D/g, '').includes(q.replace(/\D/g, '')) ||
      e.customerPhone.toLowerCase().includes(q)
    );
  });

  const inboundThisWeek = allEntries.filter(e =>
    e.direction === 'Inbound' && new Date(e.startTime).getTime() >= weekStart
  ).length;
  const outboundThisWeek = allEntries.filter(e =>
    e.direction === 'Outbound' && new Date(e.startTime).getTime() >= weekStart
  ).length;

  return (
    <div
      className="rounded-[26px] border mb-6"
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.94), rgba(255,255,255,0.82))',
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)',
        borderColor: 'rgba(255,255,255,0.75)',
        boxShadow: '0 18px 48px -28px rgba(40,34,26,0.30), 0 2px 8px -4px rgba(40,34,26,0.08)',
      }}
    >
      {/* Header */}
      <div className="px-7 pt-6 pb-5" style={{ borderBottom: '1px solid rgba(34,32,28,0.10)' }}>
        <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'rgba(34,32,28,0.55)' }}>
          Operations · Recordings
        </div>
        <h2 className="c2disp leading-tight mt-1" style={{ color: '#221F1A', fontSize: 30, letterSpacing: '-0.02em' }}>
          Call Recordings — Trailing 7 Days
        </h2>
        <p className="c2ui text-[13px] mt-1.5" style={{ color: '#5C5852' }}>
          Pick a shop, then a direction. Check off calls or leave a note.
        </p>
      </div>

      <div className="px-7 pt-5 pb-3">
        {/* Shop selector — same pill pattern as To-Do */}
        <div className="c2ui text-[12.5px] font-semibold uppercase tracking-[0.18em] mb-2.5" style={{ color: 'rgba(34,32,28,0.55)' }}>Shop</div>
        <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1 -mx-1 px-1">
          {SHOPS.map(s => {
            const active = s.num === activeShop;
            return (
              <button
                key={s.num}
                onClick={() => setActiveShop(s.num)}
                className="c2ui shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-semibold transition"
                style={active
                  ? { background: s.color, color: '#fff', boxShadow: '0 4px 14px -6px rgba(40,34,26,0.30)' }
                  : { background: 'rgba(255,255,255,0.6)', color: '#221F1A', boxShadow: 'inset 0 0 0 1px rgba(34,32,28,0.10)' }}
                aria-pressed={active}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{
                    background: active ? 'rgba(255,255,255,0.85)' : s.color,
                    boxShadow: active ? 'none' : `0 0 0 3px ${s.color}22`,
                  }}
                />
                {s.name}
              </button>
            );
          })}
        </div>

        {/* This-week stats */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(91,170,89,0.22) 0%, rgba(232,248,232,0.55) 60%, rgba(255,255,255,0) 100%)' }}>
            <div className="c2ui text-[11.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#2F6E3A' }}>
              <span className="inline-flex items-center gap-1"><PhoneIncoming size={11} /> Incoming · this week</span>
            </div>
            <div className="c2disp tabular-nums leading-none mt-2" style={{ color: '#221F1A', fontSize: 44, letterSpacing: '-0.03em' }}>
              {loading ? '—' : inboundThisWeek}
            </div>
          </div>
          <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(232,134,62,0.22) 0%, rgba(255,244,232,0.55) 60%, rgba(255,255,255,0) 100%)' }}>
            <div className="c2ui text-[11.5px] font-semibold uppercase tracking-[0.18em]" style={{ color: '#8E3F22' }}>
              <span className="inline-flex items-center gap-1"><PhoneOutgoing size={11} /> Outgoing · this week</span>
            </div>
            <div className="c2disp tabular-nums leading-none mt-2" style={{ color: '#221F1A', fontSize: 44, letterSpacing: '-0.03em' }}>
              {loading ? '—' : outboundThisWeek}
            </div>
          </div>
        </div>
      </div>

      <div className="px-7 pb-6">
        {/* Search */}
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(34,32,28,0.40)' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or phone…"
            className="c2ui w-full text-[13px] pl-9 pr-9 py-2.5 rounded-full outline-none"
            style={{
              background: 'rgba(255,255,255,0.65)',
              border: '1px solid rgba(34,32,28,0.12)',
              color: '#221F1A',
              boxShadow: 'inset 0 1px 3px rgba(34,32,28,0.05)',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2"
              style={{ color: 'rgba(34,32,28,0.40)' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Incoming / Outgoing tabs */}
        <div className="inline-flex rounded-full p-1 mb-5" style={{ background: 'rgba(34,32,28,0.05)', border: '1px solid rgba(34,32,28,0.08)' }}>
          {(['inbound', 'outbound'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className="c2ui rounded-full px-4 py-1.5 text-[13px] font-semibold transition"
              style={activeTab === t
                ? { background: '#fff', color: '#221F1A', boxShadow: '0 1px 3px rgba(0,0,0,0.14)' }
                : { color: 'rgba(34,32,28,0.55)' }
              }
            >
              {t === 'inbound' ? 'Incoming' : 'Outgoing'}
            </button>
          ))}
        </div>

        {loading && (
          <div className="c2ui text-[13px]" style={{ color: 'rgba(34,32,28,0.55)' }}>Loading…</div>
        )}
        {error && (
          <div className="c2ui text-[13px]" style={{ color: '#C05A2E' }}>Error: {error}</div>
        )}

        {!loading && current && tabEntries.length === 0 && (
          <div className="c2ui text-[13px]" style={{ color: 'rgba(34,32,28,0.55)' }}>
            {current.cached
              ? `No ${activeTab === 'inbound' ? 'incoming' : 'outgoing'} calls in the trailing 7 days.`
              : 'Cache warming — check back in a few minutes.'}
          </div>
        )}

        {!loading && current && tabEntries.length > 0 && (
          <div>
            {tabEntries.map(e => (
              <CallRow key={e.callId} entry={e} shopNum={activeShop} onHandled={markHandled} />
            ))}
          </div>
        )}

        {current?.computedAt && (
          <div className="c2ui text-[11px] mt-3" style={{ color: 'rgba(34,32,28,0.40)' }}>
            Updated {new Date(current.computedAt).toLocaleString('en-US', {
              timeZone: 'America/Denver', month: 'short', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            })} MT
          </div>
        )}
      </div>
    </div>
  );
}
